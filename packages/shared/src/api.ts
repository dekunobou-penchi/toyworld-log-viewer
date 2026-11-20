import type { Action, Direction, GameParams, ViewCell } from './game.js';
import type { ContextKey } from './constants.js';

/** 実験一覧の1件（GET /api/experiments） */
export interface ExperimentSummary {
    /** フォルダ名（exp_YYYYMMDD_HHMM_name） */
    id: string;
    title: string;
    ticks: number;
    playerFiles: number;
    nx: number | null;
    ny: number | null;
    transition: GameParams['transition'] | null;
    /** world.jsonl の最終更新（UNIX ms） */
    updatedAt: number;
}

export interface ExperimentListResponse {
    dataDir: string;
    experiments: ExperimentSummary[];
}

/**
 * 1プレイヤーのティックごとの系列。配列の添字 = ティック（0 始まり）。
 * そのティックにいなかった場合は null。
 */
export interface PlayerSeries {
    uid: string;
    name: string;
    isAgent: boolean;
    /** 参加順（色のスロット） */
    idx: number;
    /** world.jsonl で最初に現れたティック */
    first: number;
    x: (number | null)[];
    y: (number | null)[];
    dir: (Direction | null)[];
    lp: (number | null)[];
    hold: (number | null)[];
    lt: (number | null)[];
    ltmax: (number | null)[];
    act: (Action | null)[];
    view: (ViewCell[] | null)[];
    /** Ltime が 0 = そのティックで死亡して再配置された */
    dead: boolean[];
    ctx: (ContextKey | null)[];
    /** 行動の前提条件を満たしたか（action.ts の分岐から判定）。判定不能は null */
    valid: (boolean | null)[];
    /** 有効な eat で得たエネルギー */
    gain: number[];
}

/** GET /api/experiments/:id */
export interface Experiment {
    id: string;
    title: string;
    params: GameParams | null;
    energy: number[] | null;
    fusion: number[][] | null;
    T: number;
    nx: number;
    ny: number;
    blockMax: number;
    /** maps[t][y][x] */
    maps: number[][][];
    players: PlayerSeries[];
    /** 読み込み時の注意（壊れた行、視界の再計算など） */
    notes: string[];
}

export interface PlayerSummary {
    uid: string;
    ticks: number;
    deaths: number;
    maxLtime: number;
    meanLp: number | null;
    validEats: number;
    energyGained: number | null;
    actions: number;
    invalidActions: number;
}

export interface ActionCount {
    n: number;
    /** 前提条件を満たした回数 */
    ok: number;
    /** 判定できた回数 */
    known: number;
}

export interface PlayerActionStats {
    uid: string;
    total: number;
    counts: Record<Action, ActionCount>;
}

export interface PlayerContextStats {
    uid: string;
    rows: Record<ContextKey, { total: number; counts: Record<Action, number> }>;
}

/** GET /api/experiments/:id/stats?from=&to=（ティックは 0 始まり、両端含む） */
export interface StatsResponse {
    from: number;
    to: number;
    summary: PlayerSummary[];
    actions: PlayerActionStats[];
    context: PlayerContextStats[];
}

export interface ApiError {
    error: string;
    message: string;
}
