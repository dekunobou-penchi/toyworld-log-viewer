import type { Action, Direction, GameParams, ViewCell } from './game.js';
import type { ContextKey } from './constants.js';
import type { LifeRecord, LifeStats } from './life.js';

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

/** 補充の記録（events.jsonl の kind = "refill"） */
export interface RefillEvent {
    /** その行動が選ばれたティック（0 始まり）。補充後のマップは t + 1 に現れる */
    t: number;
    cause: 'get' | 'fusion' | string;
    x: number;
    y: number;
    block: number;
    taken: number;
    by: string | null;
}

/**
 * 目標分布との比較に使う情報。refill（無ければ initMap）のルールが target を持つ実験だけ。
 * ID の配列は添字 = ブロック ID（0 = 空きは使わない）。
 */
export interface DistributionInfo {
    /** refill に差したルールの名前と α（mixedRefill のとき） */
    refillRule: string | null;
    alpha: number | null;
    /** 目標分布の artifact 名 */
    targetName: string;
    target: number[];
    /** ブロックの種類数 */
    N: number;
    /** マップのマス数（2項分布の試行回数） */
    M: number;
    /** ティックごとの目標とのズレ（L1、割合の差の絶対値の和） */
    l1: number[];
    /** ティックごとの ±2σ から外れた ID の数 */
    outside: number[];
    /** 目標どおりの確率で M マスにばらまいたとき、L1 の 95% がこれ以下になる値（モンテカルロ） */
    l1Chance: number;
    /** 目標どおりにばらまいても ±2σ から外れる ID の数の期待値（2項分布から計算） */
    outsideExpected: number;
    /** ID ごとの 2項分布 B(M, p*)。p[i] = P(X = lo + i)。小さすぎる裾は切ってある */
    pmf: { lo: number; p: number[] }[];
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
    /** 全期間の 1 回ごとの生存（最後の回は打ち切り） */
    lives: LifeRecord[];
    /** events.jsonl の補充の記録（ファイルが無ければ空） */
    refills: RefillEvent[];
    /** 目標分布との比較（目標分布を使わない実験は null） */
    dist: DistributionInfo | null;
    /** dist が null の理由（画面に出す説明） */
    distReason: string | null;
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

/** 範囲内の補充と分布の集計 */
export interface RefillStats {
    /** 範囲内のティックで選ばれた行動による補充の回数 */
    n: number;
    byCause: Record<string, number>;
    /** 取られたものと同じ ID が補充された回数 */
    same: number;
    /**
     * 補充では説明できないマスの変化の回数（put で置いた、手持ちと交換した など）。
     * 範囲内のティックの行動前後のマップを比べて、補充のあったマスを除いて数える。
     */
    otherChanges: number;
    /** 補充された回数（添字 = ID） */
    observed: number[];
    /** 目標どおりの確率で補充したときの期待回数 n·p*（目標分布が無ければ null） */
    targetExpected: number[] | null;
    /**
     * そのときのマップから mixedRefill の確率を計算し直して足した期待回数（mixedRefill のときだけ）。
     * 同じティックの他の行動の影響は一部しか反映できないので推定値。
     */
    ruleExpected: number[] | null;
    /** hist[id][c] = その ID がマップ上に c 個あったティックの数（目標分布が無ければ null） */
    hist: number[][] | null;
    /** hist に入れたティック数 */
    samples: number;
    /** 範囲内の L1 の平均・最大（目標分布が無ければ null） */
    meanL1: number | null;
    maxL1: number | null;
    /** L1 が偶然の目安を超えていたティックの割合 */
    overChance: number | null;
}

/** GET /api/experiments/:id/stats?from=&to=（ティックは 0 始まり、両端含む） */
export interface StatsResponse {
    from: number;
    to: number;
    summary: PlayerSummary[];
    actions: PlayerActionStats[];
    context: PlayerContextStats[];
    refill: RefillStats;
    /** 生存時間の分布 */
    life: LifeStats;
}

export interface ApiError {
    error: string;
    message: string;
}

/** GET /api/experiments/:id/life?from=&to=（ティックは 0 始まり、両端含む） */
export interface LifeResponse extends LifeStats {
    from: number;
    to: number;
}
