import { ACTIONS, CONTEXTS, type Experiment, type StatsResponse } from '@viewer/shared';
import { countIds } from './distribution.js';
import { computeStats } from './stats.js';

/*
 * データの書き出し（GET /api/experiments/:id/export/:kind）。
 * CSV は 1 行 1 観測の縦長、列名は英語の snake_case。tick は画面と同じ 1 始まり。
 * Excel で文字化けしないよう BOM 付き UTF-8、改行は CRLF（RFC 4180）。
 */

export const EXPORT_KINDS = ['players', 'dist_series', 'summary', 'actions', 'context', 'dist_ids', 'refills', 'bundle'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

type Cell = string | number | boolean | null | undefined;
type Row = Record<string, Cell>;

export interface ExportRange {
    /** 0 始まり、両端含む */
    from: number;
    to: number;
    /** 目標分布の ID ごとの表で「選択中のティック」に使う（0 始まり） */
    t: number;
}

export class ExportUnavailableError extends Error {}

function csvCell(v: Cell): string {
    if (v == null) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(+v.toPrecision(12)) : '';
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Row[], columns?: string[]): string {
    const cols = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
    const lines = [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))];
    return '﻿' + lines.join('\r\n') + '\r\n';
}

function nameOf(exp: Experiment, uid: string): string {
    return exp.players.find((p) => p.uid === uid)?.name ?? uid;
}

/** ティック × プレイヤーの系列 */
function playerRows(exp: Experiment, r: ExportRange): Row[] {
    const rows: Row[] = [];
    for (let t = r.from; t <= r.to; t++) {
        for (const P of exp.players) {
            if (P.lp[t] == null) continue;
            rows.push({
                tick: t + 1,
                player: P.name,
                uid: P.uid,
                is_agent: P.isAgent,
                x: P.x[t],
                y: P.y[t],
                dir: P.dir[t],
                lp: P.lp[t],
                hold: P.hold[t],
                ltime: P.lt[t],
                ltmax: P.ltmax[t],
                action: P.act[t],
                action_valid: P.valid[t],
                dead: P.dead[t],
                energy_gained: P.gain[t],
                context: P.ctx[t],
            });
        }
    }
    return rows;
}

/** ティックごとの目標とのズレ */
function distSeriesRows(exp: Experiment, r: ExportRange): Row[] {
    const D = exp.dist;
    if (!D) throw new ExportUnavailableError(exp.distReason ?? 'この実験には目標分布がありません。');
    const rows: Row[] = [];
    for (let t = r.from; t <= r.to; t++) {
        rows.push({ tick: t + 1, l1: D.l1[t], l1_over_chance: D.l1[t] > D.l1Chance, outside_ids: D.outside[t], n_ids: D.N });
    }
    return rows;
}

function summaryRows(exp: Experiment, st: StatsResponse): Row[] {
    return st.summary.map((s) => ({
        player: nameOf(exp, s.uid),
        uid: s.uid,
        ticks: s.ticks,
        deaths: s.deaths,
        max_ltime: s.maxLtime,
        mean_lp: s.meanLp,
        valid_eats: s.validEats,
        energy_gained: s.energyGained,
        actions: s.actions,
        invalid_actions: s.invalidActions,
        invalid_rate: s.actions ? s.invalidActions / s.actions : null,
    }));
}

function actionRows(exp: Experiment, st: StatsResponse): Row[] {
    const rows: Row[] = [];
    for (const a of st.actions) {
        for (const x of ACTIONS) {
            const c = a.counts[x];
            rows.push({
                player: nameOf(exp, a.uid),
                uid: a.uid,
                action: x,
                n: c.n,
                share: a.total ? c.n / a.total : null,
                judged: c.known,
                valid: c.ok,
                valid_rate: c.known ? c.ok / c.known : null,
            });
        }
    }
    return rows;
}

function contextRows(exp: Experiment, st: StatsResponse): Row[] {
    const rows: Row[] = [];
    for (const c of st.context) {
        for (const ctx of CONTEXTS) {
            const row = c.rows[ctx.key];
            for (const x of ACTIONS) {
                rows.push({
                    player: nameOf(exp, c.uid),
                    uid: c.uid,
                    context: ctx.key,
                    action: x,
                    n: row.counts[x],
                    context_total: row.total,
                    share: row.total ? row.counts[x] / row.total : null,
                });
            }
        }
    }
    return rows;
}

/** ID ごとの比較：目標、選択中ティックの個数、偶然の範囲、範囲内の補充回数と期待 */
function distIdRows(exp: Experiment, st: StatsResponse, r: ExportRange): Row[] {
    const D = exp.dist;
    if (!D) throw new ExportUnavailableError(exp.distReason ?? 'この実験には目標分布がありません。');
    const counts = countIds(exp.maps[r.t], D.N);
    const rf = st.refill;
    const rows: Row[] = [];
    for (let k = 1; k <= D.N; k++) {
        const p = D.target[k];
        const sd = Math.sqrt((p * (1 - p)) / D.M);
        const share = counts[k] / D.M;
        const lo = Math.max(0, p - 2 * sd), hi = p + 2 * sd;
        rows.push({
            id: k,
            energy: exp.energy?.[k] ?? null,
            target_share: p,
            target_count: p * D.M,
            band_lo: lo,
            band_hi: hi,
            tick: r.t + 1,
            count: counts[k],
            share,
            outside_band: share < lo || share > hi,
            refills: rf.observed[k],
            refills_expected_target: rf.targetExpected?.[k] ?? null,
            refills_expected_rule: rf.ruleExpected?.[k] ?? null,
        });
    }
    return rows;
}

function refillRows(exp: Experiment, r: ExportRange): Row[] {
    return exp.refills
        .filter((e) => e.t >= r.from && e.t <= r.to)
        .map((e) => ({
            tick: e.t + 1,
            cause: e.cause,
            x: e.x,
            y: e.y,
            taken: e.taken,
            block: e.block,
            same: e.block === e.taken,
            player: e.by ? nameOf(exp, e.by) : null,
            uid: e.by,
        }));
}

/** 書き出したデータの条件（あとで「どの条件の数字か」を追えるように） */
function metaOf(exp: Experiment, r: ExportRange) {
    const D = exp.dist;
    return {
        experiment: exp.id,
        title: exp.title,
        exported_at: new Date().toISOString(),
        tick_base: 1,
        range: { from: r.from + 1, to: r.to + 1 },
        selected_tick: r.t + 1,
        ticks_total: exp.T,
        map: { nx: exp.nx, ny: exp.ny },
        params: exp.params,
        players: exp.players.map((P) => ({ name: P.name, uid: P.uid, is_agent: P.isAgent })),
        refill_rule: D?.refillRule ?? null,
        alpha: D?.alpha ?? null,
        target: D ? { name: D.targetName, n_ids: D.N, cells: D.M, l1_chance_95: D.l1Chance, outside_expected: D.outsideExpected, distribution: D.target } : null,
        target_unavailable_reason: exp.distReason,
        notes: exp.notes,
    };
}

export interface ExportResult {
    filename: string;
    contentType: string;
    body: string;
}

export function exportData(exp: Experiment, kind: ExportKind, rIn: ExportRange): ExportResult {
    const clamp = (v: number) => Math.max(0, Math.min(exp.T - 1, Math.trunc(v)));
    const r: ExportRange = { from: clamp(Math.min(rIn.from, rIn.to)), to: clamp(Math.max(rIn.from, rIn.to)), t: clamp(rIn.t) };
    const base = `${exp.id}_tick${r.from + 1}-${r.to + 1}`;
    const needsStats = kind === 'summary' || kind === 'actions' || kind === 'context' || kind === 'dist_ids' || kind === 'bundle';
    const st = needsStats ? computeStats(exp, r.from, r.to) : null;
    const csv = (rows: Row[], name: string): ExportResult => ({ filename: `${base}_${name}.csv`, contentType: 'text/csv; charset=utf-8', body: toCsv(rows) });

    switch (kind) {
        case 'players':
            return csv(playerRows(exp, r), 'players');
        case 'dist_series':
            return csv(distSeriesRows(exp, r), 'dist_series');
        case 'summary':
            return csv(summaryRows(exp, st!), 'summary');
        case 'actions':
            return csv(actionRows(exp, st!), 'actions');
        case 'context':
            return csv(contextRows(exp, st!), 'context');
        case 'dist_ids':
            return { ...csv(distIdRows(exp, st!, r), 'dist_ids'), filename: `${base}_dist_ids_at${r.t + 1}.csv` };
        case 'refills':
            return csv(refillRows(exp, r), 'refills');
        case 'bundle': {
            const body = {
                meta: metaOf(exp, r),
                players: playerRows(exp, r),
                dist_series: exp.dist ? distSeriesRows(exp, r) : null,
                summary: summaryRows(exp, st!),
                actions: actionRows(exp, st!),
                context: contextRows(exp, st!),
                dist_ids: exp.dist ? distIdRows(exp, st!, r) : null,
                refills: refillRows(exp, r),
                refill_stats: { n: st!.refill.n, by_cause: st!.refill.byCause, same: st!.refill.same, other_changes: st!.refill.otherChanges, mean_l1: st!.refill.meanL1, max_l1: st!.refill.maxL1, over_chance: st!.refill.overChance },
            };
            return { filename: `${base}.json`, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body, null, 1) };
        }
    }
}
