import type { Experiment, ExperimentSummary, StatsResponse } from '@viewer/shared';

export interface ViewerState {
    list: ExperimentSummary[];
    exp: Experiment | null;
    /** 表示中のティック（0 始まり） */
    t: number;
    playing: boolean;
    /** tick / 秒 */
    speed: number;
    /** 選択中プレイヤーの idx */
    sel: number;
    /** 時系列で非表示にしたプレイヤーの idx */
    hidden: Set<number>;
    /** 集計範囲（0 始まり、両端含む） */
    from: number;
    to: number;
    stats: StatsResponse | null;
    /** 時系列の表示範囲（ティック、0 始まり、小数可）。a < b */
    win: { a: number; b: number };
}

export const S: ViewerState = {
    list: [],
    exp: null,
    t: 0,
    playing: false,
    speed: 5,
    sel: 0,
    hidden: new Set(),
    from: 0,
    to: 0,
    stats: null,
    win: { a: 0, b: 1 },
};

export function requireExp(): Experiment {
    if (!S.exp) throw new Error('実験が読み込まれていません');
    return S.exp;
}
