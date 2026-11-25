import type { Experiment, LifeRecord, LifeStats, LifeSummary, PlayerSeries } from '@viewer/shared';

/**
 * 1 回ごとの生存を取り出す。Ltime が 0 のティック＝そこで死んで生き返った。
 * 直前のティックで生存が終わり、長さはそのときの Ltime。記録が途切れたら、そこで打ち切り。
 */
export function buildLives(players: PlayerSeries[], T: number): LifeRecord[] {
    const out: LifeRecord[] = [];
    for (const P of players) {
        let start = -1;
        let n = 0;
        const close = (end: number, censored: boolean) => {
            out.push({ uid: P.uid, life: ++n, start, end, length: P.lt[end] ?? 0, censored });
            start = -1;
        };
        for (let t = P.first; t < T; t++) {
            if (P.lt[t] == null) {
                if (start >= 0) close(t - 1, true);
                continue;
            }
            if (start < 0) start = t;
            else if (P.dead[t]) {
                close(t - 1, false);
                start = t;
            }
        }
        if (start >= 0) close(T - 1, true);
    }
    return out;
}

function summarize(uid: string, recs: LifeRecord[]): LifeSummary {
    const done = recs.filter((r) => !r.censored).map((r) => r.length).sort((a, b) => a - b);
    const n = done.length;
    const mean = n ? done.reduce((a, b) => a + b, 0) / n : null;
    return {
        uid,
        deaths: n,
        censored: recs.length - n,
        mean,
        median: n ? (n % 2 ? done[(n - 1) / 2] : (done[n / 2 - 1] + done[n / 2]) / 2) : null,
        min: n ? done[0] : null,
        max: n ? done[n - 1] : null,
        sd: n && mean != null ? Math.sqrt(done.reduce((a, v) => a + (v - mean) ** 2, 0) / n) : null,
    };
}

/**
 * 範囲 [from, to] の生存時間。
 * - 範囲内に死亡した回（死亡のティック＝end + 1 が範囲内）。長さは 1 回分の全体（範囲より前に生まれていても）
 * - 範囲の終わり（to）でまだ生きている回は打ち切り。長さは to の時点の Ltime
 */
export function computeLifeStats(exp: Experiment, from: number, to: number): LifeStats {
    const records: LifeRecord[] = [];
    for (const r of exp.lives) {
        const deathTick = r.censored ? Infinity : r.end + 1;
        if (deathTick >= from && deathTick <= to) records.push(r);
        else if (r.start <= to && (r.censored ? r.end >= to : deathTick > to)) {
            records.push({ ...r, end: to, length: exp.players.find((p) => p.uid === r.uid)?.lt[to] ?? r.length, censored: true });
        }
    }
    let maxLength = 0;
    for (const r of records) if (!r.censored && r.length > maxLength) maxLength = r.length;
    return {
        records,
        summary: exp.players.map((P) => summarize(P.uid, records.filter((r) => r.uid === P.uid))),
        all: summarize('all', records),
        maxLength,
    };
}
