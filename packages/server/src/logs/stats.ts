import {
    ACTIONS,
    CONTEXTS,
    type Action,
    type ActionCount,
    type ContextKey,
    type Experiment,
    type PlayerActionStats,
    type PlayerContextStats,
    type PlayerSummary,
    type StatsResponse,
} from '@viewer/shared';
import { computeRefillStats } from './distribution.js';
import { computeLifeStats } from './life.js';

function zeroActions<V>(make: () => V): Record<Action, V> {
    return Object.fromEntries(ACTIONS.map((a) => [a, make()])) as Record<Action, V>;
}

/** ティック範囲 [from, to]（0 始まり、両端含む）の集計 */
export function computeStats(exp: Experiment, fromIn: number, toIn: number): StatsResponse {
    const clamp = (v: number) => Math.max(0, Math.min(exp.T - 1, Math.trunc(v)));
    const from = clamp(Math.min(fromIn, toIn));
    const to = clamp(Math.max(fromIn, toIn));

    const summary: PlayerSummary[] = [];
    const actions: PlayerActionStats[] = [];
    const context: PlayerContextStats[] = [];

    for (const P of exp.players) {
        let ticks = 0, deaths = 0, maxLtime = 0, lpSum = 0, validEats = 0, gain = 0, acts = 0, bad = 0;
        const counts = zeroActions<ActionCount>(() => ({ n: 0, ok: 0, known: 0 }));
        const rows = Object.fromEntries(
            CONTEXTS.map((c) => [c.key, { total: 0, counts: zeroActions(() => 0) }]),
        ) as PlayerContextStats['rows'];

        for (let t = from; t <= to; t++) {
            const lp = P.lp[t];
            if (lp == null) continue;
            ticks++;
            lpSum += lp;
            if (P.dead[t]) deaths++;
            const lt = P.lt[t] ?? 0;
            if (lt > maxLtime) maxLtime = lt;

            const a = P.act[t];
            if (!a) continue;
            acts++;
            const valid = P.valid[t];
            if (valid === false) bad++;
            counts[a].n++;
            if (valid != null) {
                counts[a].known++;
                if (valid) counts[a].ok++;
            }
            if (a === 'eat' && valid) {
                validEats++;
                gain += P.gain[t];
            }
            const k: ContextKey | null = P.ctx[t];
            if (k) {
                rows[k].total++;
                rows[k].counts[a]++;
            }
        }

        summary.push({
            uid: P.uid,
            ticks,
            deaths,
            maxLtime,
            meanLp: ticks ? lpSum / ticks : null,
            validEats,
            energyGained: exp.energy ? gain : null,
            actions: acts,
            invalidActions: bad,
        });
        actions.push({ uid: P.uid, total: acts, counts });
        context.push({ uid: P.uid, rows });
    }

    const refill = computeRefillStats(exp.maps, exp.refills, exp.dist, exp.blockMax, from, to);
    const life = computeLifeStats(exp, from, to);
    return { from, to, summary, actions, context, refill, life };
}
