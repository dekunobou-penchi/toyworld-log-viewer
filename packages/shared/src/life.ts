/*
 * 生存時間（1 回の生存の長さ）。サーバとフロントで同じ区切り方をするための共通の計算。
 * 1 回の生存 = 生き返ってから死ぬまで。長さは死ぬ直前の Ltime（集計の「最長生存」と同じ数え方）。
 */

/** 1 回の生存 */
export interface LifeRecord {
    uid: string;
    /** そのプレイヤーの何回目の生存か（1 始まり） */
    life: number;
    /** 生存の最初と最後のティック（0 始まり、両端含む） */
    start: number;
    end: number;
    /** 長さ（死ぬ直前の Ltime。打ち切りは区間の終わりの時点の Ltime） */
    length: number;
    /** 区間（または実験）の終わりでまだ生きていた＝長さが確定していない */
    censored: boolean;
}

export interface LifeSummary {
    uid: string;
    /** 死亡で終わった回 */
    deaths: number;
    /** 打ち切り */
    censored: number;
    mean: number | null;
    median: number | null;
    min: number | null;
    max: number | null;
    sd: number | null;
}

/** 範囲内の生存時間の集計（StatsResponse.life） */
export interface LifeStats {
    /** 範囲内に死亡した回と、範囲の終わりで打ち切りの回 */
    records: LifeRecord[];
    summary: LifeSummary[];
    all: LifeSummary;
    /** 死亡で終わった回の最長（棒の幅の自動決定に使う） */
    maxLength: number;
}

export const LIFE_BINS = [1, 2, 5, 10, 20, 50, 100] as const;

/** 自動の棒の幅：最長に合わせて棒が 30 本前後になる切りのいい幅 */
export function autoLifeBin(maxLength: number): number {
    const raw = Math.max(1, maxLength) / 30;
    for (const w of LIFE_BINS) if (w >= raw) return w;
    return Math.ceil(raw / 100) * 100;
}

/** 長さ len が入る棒の番号。棒 i は長さ [i·w, (i+1)·w − 1] */
export function lifeBinOf(len: number, width: number): number {
    return Math.floor(Math.max(0, len) / width);
}

/** 死亡で終わった回を、プレイヤーごとに棒に数える */
export function binLives(records: readonly LifeRecord[], width: number): { nbins: number; counts: Map<string, number[]> } {
    let maxLen = 0;
    for (const r of records) if (!r.censored && r.length > maxLen) maxLen = r.length;
    const nbins = lifeBinOf(maxLen, width) + 1;
    const counts = new Map<string, number[]>();
    for (const r of records) {
        if (r.censored) continue;
        let c = counts.get(r.uid);
        if (!c) counts.set(r.uid, (c = new Array<number>(nbins).fill(0)));
        c[lifeBinOf(r.length, width)]++;
    }
    return { nbins, counts };
}
