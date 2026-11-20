import type {
    Action,
    ContextKey,
    EventLine,
    Experiment,
    MetaFile,
    PlayerLine,
    PlayerSeries,
    ViewCell,
    WorldLine,
} from '@viewer/shared';
import type { RawExperiment } from './reader.js';
import { computeView } from './view.js';
import { buildDistribution, parseRefills } from './distribution.js';

export class LogFormatError extends Error {}

function parseLines<T>(text: string, label: string, notes: string[]): T[] {
    const out: T[] = [];
    let bad = 0;
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
            out.push(JSON.parse(line) as T);
        } catch {
            bad++;
        }
    }
    if (bad) notes.push(`${label}: 読めない行が ${bad} 行あったので飛ばしました（書き込み途中の最終行など）。`);
    return out;
}

function emptySeries(uid: string, name: string, isAgent: boolean, idx: number, first: number, T: number): PlayerSeries {
    const nulls = <V>() => new Array<V | null>(T).fill(null);
    return {
        uid, name, isAgent, idx, first,
        x: nulls<number>(), y: nulls<number>(), dir: nulls(), lp: nulls<number>(), hold: nulls<number>(),
        lt: nulls<number>(), ltmax: nulls<number>(), act: nulls<Action>(), view: nulls<ViewCell[]>(),
        dead: new Array<boolean>(T).fill(false),
        ctx: nulls<ContextKey>(),
        valid: nulls<boolean>(),
        gain: new Array<number>(T).fill(0),
    };
}

/**
 * 行動の前提条件を満たしたか。toyWorld の game/action.ts の分岐に対応。
 * 同じティックの他プレイヤーの行動は先に適用されることがあるので、厳密ではなく推定。
 */
function judgeAction(a: Action, dir: string, hold: number, front: ViewCell | null): boolean | null {
    const held = hold !== 0;
    switch (a) {
        case 'N':
        case 'E':
        case 'S':
        case 'W':
            return dir !== a;
        case 'forward':
            return front ? !front.player : null;
        case 'get':
            return front ? (front.player ? front.player.hold !== 0 : front.block !== 0) : null;
        case 'eat':
        case 'put':
            return held;
        case 'fusion':
            if (!held) return false;
            return front ? (front.player ? front.player.hold !== 0 : front.block !== 0) : null;
    }
}

export function buildExperiment(raw: RawExperiment): Experiment {
    const notes: string[] = [];
    let meta: MetaFile | null = null;
    if (raw.meta) {
        try {
            meta = JSON.parse(raw.meta) as MetaFile;
        } catch {
            notes.push('meta.json を読めなかったので、パラメータとエネルギー表は不明として扱います。');
        }
    } else {
        notes.push('meta.json がないので、パラメータとエネルギー表は不明として扱います。');
    }

    const W = parseLines<WorldLine>(raw.world, 'world.jsonl', notes);
    if (!W.length) throw new LogFormatError('world.jsonl に有効な行がありません。');
    const T = W.length;
    const { nx, ny } = W[0].map;
    const params = meta?.params ?? null;
    const energy = meta?.energyTable ?? null;
    const fusion = meta?.fusionTable ?? null;

    // world.jsonl から各プレイヤーの系列を組む
    const byUid = new Map<string, PlayerSeries>();
    const players: PlayerSeries[] = [];
    W.forEach((w, t) => {
        for (const p of w.players) {
            let P = byUid.get(p.uid);
            if (!P) {
                P = emptySeries(p.uid, p.profile?.name ?? p.uid.slice(0, 6), !!p.profile?.isAgent, players.length, t, T);
                byUid.set(p.uid, P);
                players.push(P);
            }
            P.x[t] = p.pos.x;
            P.y[t] = p.pos.y;
            P.dir[t] = p.dir;
            P.lp[t] = p.lp;
            P.hold[t] = p.hold;
            P.lt[t] = p.Ltime;
            P.ltmax[t] = p.Ltmax;
            P.act[t] = p.selectedAction ?? null;
        }
    });

    // 視界: player_{uid}.jsonl の k 行目 = そのプレイヤーが最初に現れたティック + k
    let viewRange = params?.player.viewRange ?? null;
    let fromFiles = 0;
    let computed = 0;
    for (const P of players) {
        const text = raw.players[P.uid];
        const lines = text != null ? parseLines<PlayerLine>(text, `player_${P.uid.slice(0, 8)}….jsonl`, notes) : null;
        for (let t = P.first; t < T; t++) {
            const x = P.x[t], y = P.y[t], dir = P.dir[t];
            if (x == null || y == null || dir == null) continue;
            const L = lines ? lines[t - P.first] : undefined;
            if (L && L.pos && L.pos.x === x && L.pos.y === y && Array.isArray(L.view)) {
                P.view[t] = L.view;
                fromFiles++;
                if (viewRange == null) viewRange = L.view.length;
            } else {
                P.view[t] = computeView(W[t].map.data, nx, ny, W[t].players, P.uid, x, y, dir, viewRange ?? 5);
                computed++;
            }
        }
    }
    if (computed && fromFiles) {
        notes.push(`視界の一部（${computed} 件）はプレイヤーログと対応が取れなかったため、マップから再計算しました。`);
    } else if (computed) {
        notes.push('プレイヤーログがないので、視界はマップから再計算しています（サーバの view.ts と同じ規則）。');
    }
    const unknown = Object.keys(raw.players).filter((u) => !byUid.has(u));
    if (unknown.length) notes.push(`world.jsonl に登場しないプレイヤーログが ${unknown.length} 件あったので無視しました。`);

    const maps = W.map((w) => w.map.data);
    let blockMax = params?.map.blockMax ?? W[0].map.blockMax ?? 0;
    if (!blockMax) {
        blockMax = 1;
        for (const m of maps) for (const row of m) for (const v of row) if (v + 1 > blockMax) blockMax = v + 1;
    }

    // ティックごとの派生値
    for (const P of players) {
        for (let t = 0; t < T; t++) {
            const dir = P.dir[t], hold = P.hold[t];
            if (dir == null || hold == null) continue;
            P.dead[t] = P.lt[t] === 0;
            const front = P.view[t]?.[0] ?? null;
            const kind = !front ? null : front.player ? 'player' : front.block !== 0 ? 'block' : 'empty';
            P.ctx[t] = kind ? (`${kind}-${hold !== 0 ? 1 : 0}` as ContextKey) : null;
            const a = P.act[t];
            if (!a) continue;
            P.valid[t] = judgeAction(a, dir, hold, front);
            if (a === 'eat' && hold !== 0 && energy) P.gain[t] = energy[hold] ?? 0;
        }
    }

    // 補充の記録と目標分布との比較
    const refills = raw.events ? parseRefills(parseLines<EventLine>(raw.events, 'events.jsonl', notes), T) : [];
    const dist = buildDistribution(meta, maps, nx, ny);
    if (dist && raw.events === null) notes.push('events.jsonl がないので、補充の回数と内訳は出せません（分布の比較はマップから計算しています）。');

    return {
        id: raw.id,
        title: meta?.experimentName ?? raw.id,
        params, energy, fusion, T, nx, ny, blockMax, maps, players, refills, dist, notes,
    };
}
