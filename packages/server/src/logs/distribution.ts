import type { DistributionInfo, EventLine, MetaFile, RefillEvent, RefillStats, RuleSelection } from '@viewer/shared';

/*
 * 目標分布との比較。toyWorld の rule-editor（packages/rule-editor/src/sim.ts）の
 * refill プレビューと同じ考え方を、シミュレーションではなく実際の実験ログに当てる。
 */

/** refill に差したルールの target の既定値（toyWorld の rules/defaults.ts と同じ） */
const DEFAULT_TARGET = 'targetDistribution';
/** target を持つルール（params に target が無いときは既定値を使う） */
const TARGET_RULES: Record<string, string[]> = {
    refill: ['mixedRefill'],
    initMap: ['shuffledTarget'],
};

/** toyWorld の createRng と同じ（mulberry32） */
function createRng(seed: number): () => number {
    let b = seed >>> 0;
    return () => {
        b = (b + 0x6d2b79f5) >>> 0;
        let t = b;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** 割合 p の ID が M マス中に占める割合の標準偏差（2項分布 B(M, p) を M で割ったもの） */
export function binomialSd(p: number, M: number): number {
    return Math.sqrt((p * (1 - p)) / M);
}

/** 2項分布 B(M, p) の確率 P(X = c)（c = 0..M）。大きな M でも溢れないように対数で計算する */
export function binomialPmf(M: number, p: number): number[] {
    if (p <= 0) return Array.from({ length: M + 1 }, (_, c) => (c === 0 ? 1 : 0));
    if (p >= 1) return Array.from({ length: M + 1 }, (_, c) => (c === M ? 1 : 0));
    const lf = [0];
    for (let i = 1; i <= M; i++) lf.push(lf[i - 1] + Math.log(i));
    const lp = Math.log(p), lq = Math.log(1 - p);
    return Array.from({ length: M + 1 }, (_, c) => Math.exp(lf[M] - lf[c] - lf[M - c] + c * lp + (M - c) * lq));
}

/** 目標どおりの確率で M マスにばらまく（多項分布）のを trials 回やって、L1 の q 分位点を返す */
function chanceL1(target: number[], M: number, seed: number, trials = 300, q = 0.95): number {
    const rng = createRng(seed);
    const N = target.length - 1;
    const cum: number[] = [];
    let acc = 0;
    for (let k = 1; k <= N; k++) {
        acc += target[k];
        cum.push(acc);
    }
    const l1s: number[] = [];
    const c = new Array<number>(N + 1);
    for (let t = 0; t < trials; t++) {
        c.fill(0);
        for (let i = 0; i < M; i++) {
            const r = rng() * acc;
            let lo = 0, hi = N - 1;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (cum[mid] > r) hi = mid;
                else lo = mid + 1;
            }
            c[lo + 1]++;
        }
        let l1 = 0;
        for (let k = 1; k <= N; k++) l1 += Math.abs(c[k] / M - target[k]);
        l1s.push(l1);
    }
    l1s.sort((a, b) => a - b);
    return l1s[Math.min(trials - 1, Math.floor(q * trials))];
}

/** 目標どおりにばらまいたとき、±2σ から外れる ID の数の期待値 */
function expectedOutside(target: number[], M: number): number {
    let sum = 0;
    for (let k = 1; k < target.length; k++) {
        const p = target[k];
        if (p <= 0 || p >= 1) continue;
        const sd = binomialSd(p, M);
        sum += binomialPmf(M, p).reduce((a, v, c) => a + (Math.abs(c / M - p) > 2 * sd ? v : 0), 0);
    }
    return sum;
}

/** マップ上の ID ごとの個数（添字 = ID、0 は数えない） */
export function countIds(map: readonly (readonly number[])[], N: number): number[] {
    const c = new Array<number>(N + 1).fill(0);
    for (const row of map) for (const v of row) if (v >= 1 && v <= N) c[v]++;
    return c;
}

/**
 * mixedRefill の確率：(1 − α)·p*(k) + α·d(k)。toyWorld の refillProbabilities と同じ。
 * counts は補充を呼ぶ時点の個数（取ったマスは 0 にしてある）。
 */
function refillProbabilities(p: readonly number[], counts: readonly number[], total: number, alpha: number): number[] {
    const deficit = p.map((v, k) => (k === 0 ? 0 : Math.max(0, v * total - counts[k])));
    const D = deficit.reduce((a, b) => a + b, 0);
    return p.map((v, k) => (k === 0 ? 0 : (1 - alpha) * v + alpha * (D > 0 ? deficit[k] / D : v)));
}

function isDistribution(v: unknown): v is number[] {
    return Array.isArray(v) && v.length > 1 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
}

/** refill か initMap のルールが target として使っている目標分布（toyWorld の targetDistributionOf と同じ順で探す） */
function findTarget(meta: MetaFile): { name: string; dist: number[] } | null {
    const artifacts = meta.ruleFile?.artifacts;
    if (!artifacts || !meta.runtime) return null;
    for (const hook of ['refill', 'initMap']) {
        const sel: RuleSelection | undefined = meta.runtime[hook];
        if (!sel) continue;
        const given: unknown = sel.params?.target;
        const name = typeof given === 'string' ? given : TARGET_RULES[hook]?.includes(sel.rule) ? DEFAULT_TARGET : null;
        if (name === null) continue;
        const dist = artifacts[name]?.baked;
        if (isDistribution(dist)) return { name, dist };
    }
    return null;
}

/** 1e-6 未満の裾を切る（大きなマップでもレスポンスを小さく保つ） */
function trimPmf(p: number[]): { lo: number; p: number[] } {
    let lo = 0, hi = p.length - 1;
    while (lo < hi && p[lo] < 1e-6) lo++;
    while (hi > lo && p[hi] < 1e-6) hi--;
    return { lo, p: p.slice(lo, hi + 1).map((v) => +v.toPrecision(4)) };
}

/** events.jsonl から補充の記録を取り出す */
export function parseRefills(events: EventLine[], T: number): RefillEvent[] {
    const out: RefillEvent[] = [];
    for (const e of events) {
        if (e.kind !== 'refill' || typeof e.tick !== 'number') continue;
        if (typeof e.x !== 'number' || typeof e.y !== 'number' || typeof e.block !== 'number') continue;
        const t = e.tick - 1;
        if (t < 0 || t >= T) continue;
        out.push({
            t,
            cause: typeof e.cause === 'string' ? e.cause : '?',
            x: e.x,
            y: e.y,
            block: e.block,
            taken: typeof e.taken === 'number' ? e.taken : -1,
            by: typeof e.by === 'string' ? e.by : null,
        });
    }
    return out;
}

export function buildDistribution(meta: MetaFile | null, maps: number[][][], nx: number, ny: number): DistributionInfo | null {
    if (!meta) return null;
    const found = findTarget(meta);
    if (!found) return null;
    const target = found.dist;
    const N = target.length - 1;
    const M = nx * ny;
    const l1: number[] = [];
    const outside: number[] = [];
    const band = target.map((p) => 2 * binomialSd(p, M));
    for (const map of maps) {
        const c = countIds(map, N);
        let d = 0, o = 0;
        for (let k = 1; k <= N; k++) {
            const diff = Math.abs(c[k] / M - target[k]);
            d += diff;
            if (diff > band[k]) o++;
        }
        l1.push(d);
        outside.push(o);
    }
    const sel = meta.runtime?.refill ?? null;
    const alphaRaw = sel?.params?.alpha;
    const alpha = sel?.rule === 'mixedRefill' ? (typeof alphaRaw === 'number' ? alphaRaw : 0.2) : null;
    const seed = meta.ruleFile?.constants?.seed ?? 0;
    return {
        refillRule: sel?.rule ?? null,
        alpha,
        targetName: found.name,
        target,
        N,
        M,
        l1,
        outside,
        // シードは rule-editor の simulateRefill と同じ取り方（同じルールなら同じ値になる）
        l1Chance: chanceL1(target, M, seed ^ 0x2545f491),
        outsideExpected: expectedOutside(target, M),
        pmf: target.map((p) => trimPmf(binomialPmf(M, p))),
    };
}

/**
 * ティック範囲 [from, to] の補充と分布の集計。
 * 補充は「範囲内のティックで選ばれた行動によるもの」を数える。
 */
export function computeRefillStats(
    maps: number[][][],
    refills: RefillEvent[],
    dist: DistributionInfo | null,
    blockMax: number,
    from: number,
    to: number,
): RefillStats {
    const N = dist ? dist.N : Math.max(1, blockMax - 1);
    const observed = new Array<number>(N + 1).fill(0);
    const byCause: Record<string, number> = {};
    let n = 0, same = 0;
    const inRange = refills.filter((r) => r.t >= from && r.t <= to);
    for (const r of inRange) {
        n++;
        byCause[r.cause] = (byCause[r.cause] ?? 0) + 1;
        if (r.block === r.taken) same++;
        if (r.block >= 1 && r.block <= N) observed[r.block]++;
    }

    // 補充以外のマスの変化：ティック t の行動の前（maps[t]）と後（maps[t + 1]）を比べる
    const refilled = new Map<number, Set<number>>();
    for (const r of inRange) {
        let s = refilled.get(r.t);
        if (!s) refilled.set(r.t, (s = new Set()));
        s.add(r.y * 1e6 + r.x);
    }
    let otherChanges = 0;
    for (let t = from; t <= to && t + 1 < maps.length; t++) {
        const a = maps[t], b = maps[t + 1], s = refilled.get(t);
        for (let y = 0; y < a.length; y++) {
            for (let x = 0; x < a[y].length; x++) {
                if (a[y][x] !== b[y]?.[x] && !s?.has(y * 1e6 + x)) otherChanges++;
            }
        }
    }

    if (!dist) {
        return { n, byCause, same, otherChanges, observed, targetExpected: null, ruleExpected: null, hist: null, samples: 0, meanL1: null, maxL1: null, overChance: null };
    }

    const { target, M } = dist;
    const targetExpected = target.map((p, k) => (k === 0 ? 0 : n * p));

    // mixedRefill の確率を、そのときのマップから計算し直す。
    // 基準はその行動のティックのマップ（行動前）。同じティックで先に起きた補充は反映し、取ったマスは 0 にする。
    // 他のプレイヤーの put や fusion（相手が手持ち）によるマップの変化は追えないので推定。
    let ruleExpected: number[] | null = null;
    if (dist.alpha !== null) {
        ruleExpected = new Array<number>(N + 1).fill(0);
        let curT = -1;
        let counts: number[] = [];
        let cells: number[][] = [];
        for (const r of inRange) {
            if (r.t !== curT) {
                curT = r.t;
                cells = maps[r.t].map((row) => row.slice());
                counts = countIds(cells, N);
            }
            const before = cells[r.y]?.[r.x];
            if (before === undefined) continue;
            if (before >= 1 && before <= N) counts[before]--;
            const q = refillProbabilities(target, counts, M, dist.alpha);
            for (let k = 1; k <= N; k++) ruleExpected[k] += q[k];
            cells[r.y][r.x] = r.block;
            if (r.block >= 1 && r.block <= N) counts[r.block]++;
        }
    }

    const hist = Array.from({ length: N + 1 }, () => new Array<number>(M + 1).fill(0));
    let samples = 0, sum = 0, max = 0, over = 0;
    for (let t = from; t <= to; t++) {
        const c = countIds(maps[t], N);
        for (let k = 1; k <= N; k++) hist[k][Math.min(M, c[k])]++;
        samples++;
        const d = dist.l1[t];
        sum += d;
        if (d > max) max = d;
        if (d > dist.l1Chance) over++;
    }
    return {
        n, byCause, same, otherChanges, observed, targetExpected, ruleExpected, hist, samples,
        meanL1: samples ? sum / samples : null,
        maxL1: samples ? max : null,
        overChance: samples ? over / samples : null,
    };
}
