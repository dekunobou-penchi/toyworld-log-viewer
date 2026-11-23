import type { DistributionInfo, RefillStats } from '@viewer/shared';
import { $, esc, niceTicks, pct } from '../dom.js';
import { S, requireExp } from '../state.js';
import { hideTip, showTip } from '../tooltip.js';

/*
 * 目標分布との比較（toyWorld の rule-editor の refill プレビューと同じ見せ方）。
 * - 選択中ティックの分布：再生に合わせて動く
 * - 個数の分布・補充された ID・表：集計の範囲（S.from–S.to）
 * 値はサーバが計算したもの（Experiment.dist と StatsResponse.refill）を描くだけ。
 */

const MAX_PICKS = 5;
const PICK_COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s7)', 'var(--s4)'];
const PAD = { l: 42, r: 14, t: 8, b: 34 };

/** 個数の分布に出す ID。null = まだ選んでいない（既定を使う） */
let picked: number[] | null = null;
let pickedFor = '';

function width(id: string): number {
    return Math.max(320, $(id).clientWidth || 800);
}

function f3(v: number | null | undefined): string {
    return v == null ? '—' : v.toFixed(3);
}

function pct1(v: number): string {
    return `${(v * 100).toFixed(1)}%`;
}

/** 2項分布の ±2σ の帯 */
function band(D: DistributionInfo, k: number): { lo: number; hi: number } {
    const p = D.target[k];
    const sd = Math.sqrt((p * (1 - p)) / D.M);
    return { lo: Math.max(0, p - 2 * sd), hi: p + 2 * sd };
}

/** 最初に見る ID：目標の割合が大・中・小のものを 1 つずつ（期待個数 1 未満はできるだけ避ける） */
function defaultPicks(D: DistributionInfo): number[] {
    const byValue = new Map<number, number>();
    const minP = D.target.slice(1).some((v) => v * D.M >= 1) ? 1 / D.M : Number.MIN_VALUE;
    for (let k = 1; k <= D.N; k++) if (D.target[k] >= minP && !byValue.has(D.target[k])) byValue.set(D.target[k], k);
    const ids = [...byValue.entries()].sort((a, b) => b[0] - a[0]).map(([, k]) => k);
    if (ids.length <= 3) return ids.sort((a, b) => a - b);
    return [ids[0], ids[Math.floor((ids.length - 1) / 2)], ids[ids.length - 1]].sort((a, b) => a - b);
}

function currentPicks(): number[] {
    const E = requireExp();
    if (!E.dist) return [];
    if (pickedFor !== E.id) {
        picked = null;
        pickedFor = E.id;
    }
    return (picked ?? defaultPicks(E.dist)).filter((k) => k >= 1 && k <= E.dist!.N);
}

function togglePick(k: number): void {
    const cur = currentPicks();
    if (cur.includes(k)) picked = cur.filter((x) => x !== k);
    else if (cur.length < MAX_PICKS) picked = [...cur, k].sort((a, b) => a - b);
    renderDistNow();
    renderDistRange();
}

/* ---------------- 実験を開いたとき ---------------- */

export function buildDist(): void {
    const E = requireExp();
    // 比較できない実験でもセクションは出し、理由を書く（黙って消えると機能が無いように見えるため）
    $('distSec').hidden = false;
    $('distBody').hidden = !E.dist;
    $('refillSummary').hidden = E.refills.length === 0 && !E.dist;
    const D = E.dist;
    if (D) {
        const rule = D.refillRule ? `refill: ${D.refillRule}${D.alpha != null ? `（α = ${D.alpha}）` : ''}` : 'refill: —';
        $('distRule').textContent = `${rule} · 目標: ${D.targetName} · N = ${D.N} · ${D.M} マス`;
        $('distNone').hidden = true;
    } else {
        $('distRule').textContent = '';
        $('distNone').hidden = false;
        const tail = E.refills.length ? ' 補充の集計だけ表示します。' : '';
        $('distNone').textContent = `目標分布との比較はこの実験では表示できません：${E.distReason ?? '目標分布が見つかりません。'}${tail}`;
    }
}

/* ---------------- 選択中ティックの分布 ---------------- */

/** 再生・ティック移動のたびに呼ぶ */
export function renderDistNow(): void {
    const E = requireExp();
    const D = E.dist;
    if (!D || $('distSec').hidden) return;
    const map = E.maps[S.t];
    const c = new Array<number>(D.N + 1).fill(0);
    for (const row of map) for (const v of row) if (v >= 1 && v <= D.N) c[v]++;
    const share = c.map((n) => n / D.M);

    const W = width('distNow'), H = 210;
    const { l, r, t: top, b } = PAD;
    const bottom = H - b;
    let maxY = 0.01;
    for (let k = 1; k <= D.N; k++) maxY = Math.max(maxY, share[k], band(D, k).hi);
    const yt = niceTicks(0, maxY * 1.08, 4);
    const ymax = Math.max(yt[yt.length - 1] ?? maxY, maxY);
    const Y = (v: number) => bottom - (v / ymax) * (bottom - top);
    const bw = (W - l - r) / D.N;
    const every = Math.ceil(D.N / Math.max(4, Math.floor((W - l - r) / 28)));
    const picks = currentPicks();

    let s = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="tick ${S.t + 1} の ID ごとの割合と目標">`;
    s += `<g class="grid">${yt.map((v) => `<line x1="${l}" x2="${W - r}" y1="${Y(v)}" y2="${Y(v)}"/>`).join('')}</g>`;
    s += `<g class="axis">${yt.map((v) => `<text x="${l - 6}" y="${Y(v)}" text-anchor="end" dominant-baseline="central">${Math.round(v * 1000) / 10}%</text>`).join('')}</g>`;
    let outside = 0;
    for (let k = 1; k <= D.N; k++) {
        const x0 = l + (k - 1) * bw;
        const bd = band(D, k);
        const out = share[k] < bd.lo || share[k] > bd.hi;
        if (out) outside++;
        const pi = picks.indexOf(k);
        s += `<g data-k="${k}" style="cursor:pointer">`;
        s += `<rect x="${x0}" y="${top}" width="${bw}" height="${bottom - top}" fill="${pi >= 0 ? PICK_COLORS[pi] : 'transparent'}" fill-opacity="0.12"/>`;
        s += `<rect x="${x0 + bw * 0.06}" y="${Y(bd.hi)}" width="${bw * 0.88}" height="${Math.max(Y(bd.lo) - Y(bd.hi), 1)}" class="d-band"/>`;
        const bh = Math.max(bottom - Y(share[k]), share[k] > 0 ? 1 : 0);
        s += `<rect x="${x0 + bw * 0.25}" y="${bottom - bh}" width="${Math.max(bw * 0.5, 1)}" height="${bh}" class="${out ? 'd-out' : 'd-in'}"/>`;
        s += `<line x1="${x0 + bw * 0.06}" x2="${x0 + bw * 0.94}" y1="${Y(D.target[k])}" y2="${Y(D.target[k])}" class="d-target"/>`;
        s += '</g>';
        if ((k - 1) % every === 0 || k === D.N) s += `<text class="d-xl" x="${x0 + bw / 2}" y="${bottom + 14}" text-anchor="middle">${k}</text>`;
    }
    s += `<line x1="${l}" x2="${W - r}" y1="${bottom}" y2="${bottom}" class="d-base"/>`;
    s += `<text class="d-xt" x="${(l + W - r) / 2}" y="${H - 4}" text-anchor="middle">ブロック ID</text>`;
    s += '</svg>';
    $('distNow').innerHTML = s;

    $('distNowTitle').innerHTML =
        `tick ${S.t + 1} のマップの分布 <span class="muted">L1 ${f3(D.l1[S.t])}${D.l1[S.t] > D.l1Chance ? '（偶然の目安超え）' : ''}` +
        ` · ±2σ の外 ${outside} / ${D.N} ID（偶然でも約 ${D.outsideExpected.toFixed(1)} 個）</span>`;
    // ツールチップ用に今の値を持っておく
    nowShare = share;
    nowCount = c;
}

let nowShare: number[] = [];
let nowCount: number[] = [];

/* ---------------- 集計の範囲 ---------------- */

/** 集計（S.stats）が届いたときと、見る ID を変えたときに呼ぶ */
export function renderDistRange(): void {
    const E = requireExp();
    const st = S.stats?.refill;
    if (!st || $('refillSummary').hidden) return;
    const from = Math.min(S.from, S.to) + 1, to = Math.max(S.from, S.to) + 1;
    for (const id of ['histRange', 'refillRange', 'tRefillRange']) $(id).textContent = `tick ${from}–${to}`;
    renderRefillTable(st, E.dist);
    if (!E.dist) return;
    renderPickBar(E.dist);
    renderHist(st, E.dist);
    renderRefillIds(st, E.dist);
}

function renderPickBar(D: DistributionInfo): void {
    const picks = currentPicks();
    const chips = picks
        .map((k, i) => `<button type="button" class="chip" data-unpick="${k}" style="--pc:${PICK_COLORS[i]}" title="クリックで外す">ID ${k} ✕</button>`)
        .join('');
    const full = picks.length >= MAX_PICKS;
    $('pickBar').innerHTML =
        `<span>見る ID</span>${chips}` +
        `<input type="number" id="pickAdd" min="1" max="${D.N}" aria-label="追加する ID" ${full ? 'disabled' : ''}>` +
        `<button type="button" id="pickAddBtn" ${full ? 'disabled' : ''}>追加</button>` +
        `<span class="muted">（${MAX_PICKS} 個まで。上の棒グラフのクリックでも選べる）</span>`;
}

/** 選んだ ID ごとに、範囲内の個数のヒストグラム（棒）と 2項分布 B(M, p*)（線） */
function renderHist(st: RefillStats, D: DistributionInfo): void {
    const picks = currentPicks();
    if (!st.hist || picks.length === 0 || st.samples === 0) {
        $('distHist').innerHTML = `<div class="muted small">${picks.length === 0 ? 'ID を選んでください' : '範囲にティックがありません'}</div>`;
        return;
    }
    const series = picks.map((k) => ({
        k,
        emp: st.hist![k].map((n) => n / st.samples),
        pmf: D.pmf[k],
    }));
    const theory = (s: (typeof series)[number], c: number) => (c >= s.pmf.lo && c < s.pmf.lo + s.pmf.p.length ? s.pmf.p[c - s.pmf.lo] : 0);
    let lo = D.M, hi = 0, maxY = 0.01;
    for (const s of series) {
        for (let c = 0; c <= D.M; c++) {
            const t = theory(s, c), e = s.emp[c] ?? 0;
            if (t > 1e-3 || e > 0) {
                lo = Math.min(lo, c);
                hi = Math.max(hi, c);
            }
            maxY = Math.max(maxY, t, e);
        }
    }
    if (lo > hi) {
        lo = 0;
        hi = Math.min(D.M, 10);
    }
    lo = Math.max(0, lo - 1);
    hi = Math.min(D.M, hi + 1);
    const W = width('distHist'), H = 230;
    const { l, r, t: top, b } = PAD;
    const bottom = H - b;
    const yt = niceTicks(0, maxY * 1.08, 4);
    const ymax = Math.max(yt[yt.length - 1] ?? maxY, maxY);
    const span = hi - lo + 1;
    const cw = (W - l - r) / span;
    const X = (c: number) => l + (c - lo + 0.5) * cw;
    const Y = (v: number) => bottom - (v / ymax) * (bottom - top);
    const every = Math.ceil(span / Math.max(4, Math.floor((W - l - r) / 30)));
    const nb = series.length;

    let s = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="ID ごとの個数の分布と 2項分布">`;
    s += `<g class="grid">${yt.map((v) => `<line x1="${l}" x2="${W - r}" y1="${Y(v)}" y2="${Y(v)}"/>`).join('')}</g>`;
    s += `<g class="axis">${yt.map((v) => `<text x="${l - 6}" y="${Y(v)}" text-anchor="end" dominant-baseline="central">${Math.round(v * 100)}%</text>`).join('')}</g>`;
    series.forEach((sr, i) => {
        for (let c = lo; c <= hi; c++) {
            const v = sr.emp[c] ?? 0;
            if (v <= 0) continue;
            const x = l + (c - lo) * cw + cw * 0.1 + (cw * 0.8 * i) / nb;
            s += `<rect x="${x.toFixed(2)}" y="${Y(v).toFixed(2)}" width="${Math.max((cw * 0.8) / nb, 1).toFixed(2)}" height="${(bottom - Y(v)).toFixed(2)}" fill="${PICK_COLORS[i]}" fill-opacity="0.4"/>`;
        }
    });
    series.forEach((sr, i) => {
        const pts: string[] = [];
        for (let c = lo; c <= hi; c++) pts.push(`${X(c).toFixed(1)},${Y(theory(sr, c)).toFixed(1)}`);
        s += `<polyline points="${pts.join(' ')}" fill="none" stroke="${PICK_COLORS[i]}" stroke-width="2" stroke-linejoin="round"/>`;
    });
    for (let c = lo; c <= hi; c++) {
        if ((c - lo) % every === 0 || c === hi) s += `<text class="d-xl" x="${X(c)}" y="${bottom + 14}" text-anchor="middle">${c}</text>`;
        s += `<rect data-c="${c}" x="${l + (c - lo) * cw}" y="${top}" width="${cw}" height="${bottom - top}" fill="transparent"/>`;
    }
    s += `<line x1="${l}" x2="${W - r}" y1="${bottom}" y2="${bottom}" class="d-base"/>`;
    s += `<text class="d-xt" x="${(l + W - r) / 2}" y="${H - 4}" text-anchor="middle">マップ上の個数（${D.M} マス中）</text>`;
    s += '</svg>';
    $('distHist').innerHTML = s;
    histSeries = series.map((sr) => ({ k: sr.k, emp: sr.emp, th: (c: number) => theory(sr, c) }));
}

let histSeries: { k: number; emp: number[]; th: (c: number) => number }[] = [];

/** ID ごとの補充回数（棒）と、目標どおりの期待 n·p*（黒線）、ルールの確率から計算し直した期待（橙の点） */
function renderRefillIds(st: RefillStats, D: DistributionInfo): void {
    if (st.n === 0) {
        $('refillIds').innerHTML = '<div class="muted small">範囲内に補充がありません</div>';
        $('refillIdsLegend').innerHTML = '';
        return;
    }
    const W = width('refillIds'), H = 200;
    const { l, r, t: top, b } = PAD;
    const bottom = H - b;
    let maxY = 1;
    for (let k = 1; k <= D.N; k++) maxY = Math.max(maxY, st.observed[k], st.targetExpected?.[k] ?? 0, st.ruleExpected?.[k] ?? 0);
    const yt = niceTicks(0, maxY * 1.08, 4);
    const ymax = Math.max(yt[yt.length - 1] ?? maxY, maxY);
    const Y = (v: number) => bottom - (v / ymax) * (bottom - top);
    const bw = (W - l - r) / D.N;
    const every = Math.ceil(D.N / Math.max(4, Math.floor((W - l - r) / 28)));
    let s = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="ID ごとの補充回数と期待回数">`;
    s += `<g class="grid">${yt.map((v) => `<line x1="${l}" x2="${W - r}" y1="${Y(v)}" y2="${Y(v)}"/>`).join('')}</g>`;
    s += `<g class="axis">${yt.map((v) => `<text x="${l - 6}" y="${Y(v)}" text-anchor="end" dominant-baseline="central">${v}</text>`).join('')}</g>`;
    for (let k = 1; k <= D.N; k++) {
        const x0 = l + (k - 1) * bw;
        const o = st.observed[k];
        s += `<g data-rk="${k}"><rect x="${x0}" y="${top}" width="${bw}" height="${bottom - top}" fill="transparent"/>`;
        const bh = Math.max(bottom - Y(o), o > 0 ? 1 : 0);
        s += `<rect x="${x0 + bw * 0.25}" y="${bottom - bh}" width="${Math.max(bw * 0.5, 1)}" height="${bh}" class="d-in"/>`;
        if (st.targetExpected) s += `<line x1="${x0 + bw * 0.06}" x2="${x0 + bw * 0.94}" y1="${Y(st.targetExpected[k])}" y2="${Y(st.targetExpected[k])}" class="d-target"/>`;
        if (st.ruleExpected) s += `<circle cx="${x0 + bw / 2}" cy="${Y(st.ruleExpected[k])}" r="${Math.min(3.5, Math.max(2, bw * 0.18))}" class="d-rule"/>`;
        s += '</g>';
        if ((k - 1) % every === 0 || k === D.N) s += `<text class="d-xl" x="${x0 + bw / 2}" y="${bottom + 14}" text-anchor="middle">${k}</text>`;
    }
    s += `<line x1="${l}" x2="${W - r}" y1="${bottom}" y2="${bottom}" class="d-base"/>`;
    s += `<text class="d-xt" x="${(l + W - r) / 2}" y="${H - 4}" text-anchor="middle">補充されたブロック ID</text>`;
    s += '</svg>';
    $('refillIds').innerHTML = s;
    $('refillIdsLegend').innerHTML =
        '<span><i class="d-in"></i>実際の補充回数</span>' +
        '<span><i class="d-target" style="height:2px"></i>目標どおりに補充したときの期待 n·p*</span>' +
        (st.ruleExpected ? `<span><i class="d-rule" style="border-radius:50%"></i>ルールの確率（α = ${D.alpha}）で計算し直した期待（推定）</span>` : '');
}

function renderRefillTable(st: RefillStats, D: DistributionInfo | null): void {
    const causes = Object.entries(st.byCause)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${esc(k)} ${v}`)
        .join(' / ');
    const rows: [string, string][] = [
        ['補充回数', `${st.n}${causes ? `（${causes}）` : ''}`],
        ['取ったものと同じ ID が出た', st.n ? `${st.same}（${pct(st.same / st.n)}）` : '—'],
        ['補充以外のマスの変化', `${st.otherChanges}`],
    ];
    if (D) {
        rows.push(
            ['目標とのズレ（L1）平均 / 最大', `${f3(st.meanL1)} / ${f3(st.maxL1)}`],
            ['偶然でも出る L1（95%）', f3(D.l1Chance)],
            ['L1 が目安を超えたティック', st.overChance == null ? '—' : pct(st.overChance)],
        );
        if (st.ruleExpected && st.n) {
            // 実際とルールの期待のズレ（回数の差の絶対値の和 / n）。目標 n·p* とのズレと並べる
            let dr = 0, dt = 0;
            for (let k = 1; k <= D.N; k++) {
                dr += Math.abs(st.observed[k] - st.ruleExpected[k]);
                dt += Math.abs(st.observed[k] - (st.targetExpected?.[k] ?? 0));
            }
            rows.push(['補充の内訳と期待のズレ（L1）', `ルール ${(dr / st.n).toFixed(3)} / 目標 ${(dt / st.n).toFixed(3)}`]);
        }
    }
    $('tRefill').innerHTML = `<tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td class="num">${v}</td></tr>`).join('')}</tbody>`;
}

/* ---------------- 操作 ---------------- */

export function bindDistEvents(): void {
    $('distNow').addEventListener('click', (e) => {
        const g = (e.target as Element).closest<SVGGElement>('[data-k]');
        if (g) togglePick(Number(g.dataset.k));
    });
    $('distNow').addEventListener('pointermove', (e) => {
        const D = S.exp?.dist;
        const g = (e.target as Element).closest<SVGGElement>('[data-k]');
        if (!D || !g) return hideTip();
        const k = Number(g.dataset.k);
        const bd = band(D, k);
        const out = nowShare[k] < bd.lo || nowShare[k] > bd.hi;
        showTip(
            `<div class="h">ID ${k} · tick ${S.t + 1}</div>` +
                `<div class="r"><span class="n">マップ</span><span class="v">${nowCount[k]} 個（${pct1(nowShare[k])}）</span></div>` +
                `<div class="r"><span class="n">目標</span><span class="v">${(D.target[k] * D.M).toFixed(1)} 個（${pct1(D.target[k])}）</span></div>` +
                `<div class="r"><span class="n">偶然の範囲</span><span class="v">${pct1(bd.lo)}–${pct1(bd.hi)}${out ? ' 範囲外' : ''}</span></div>`,
            e.clientX, e.clientY,
        );
    });
    $('distNow').addEventListener('pointerleave', hideTip);

    $('distHist').addEventListener('pointermove', (e) => {
        const el = (e.target as Element).closest<SVGRectElement>('[data-c]');
        if (!el || !histSeries.length) return hideTip();
        const c = Number(el.dataset.c);
        const rows = histSeries
            .map((sr, i) => `<div class="r" style="--pc:${PICK_COLORS[i]}"><span class="n"><span class="sw"></span>ID ${sr.k}</span><span class="v">${pct1(sr.emp[c] ?? 0)} / 理論 ${pct1(sr.th(c))}</span></div>`)
            .join('');
        showTip(`<div class="h">${c} 個だったティックの割合</div>${rows}`, e.clientX, e.clientY);
    });
    $('distHist').addEventListener('pointerleave', hideTip);

    $('refillIds').addEventListener('pointermove', (e) => {
        const st = S.stats?.refill;
        const g = (e.target as Element).closest<SVGGElement>('[data-rk]');
        if (!st || !g) return hideTip();
        const k = Number(g.dataset.rk);
        showTip(
            `<div class="h">ID ${k} の補充</div>` +
                `<div class="r"><span class="n">実際</span><span class="v">${st.observed[k]} 回</span></div>` +
                (st.targetExpected ? `<div class="r"><span class="n">目標どおりの期待</span><span class="v">${st.targetExpected[k].toFixed(1)} 回</span></div>` : '') +
                (st.ruleExpected ? `<div class="r"><span class="n">ルールの期待（推定）</span><span class="v">${st.ruleExpected[k].toFixed(1)} 回</span></div>` : ''),
            e.clientX, e.clientY,
        );
    });
    $('refillIds').addEventListener('pointerleave', hideTip);

    $('pickBar').addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        const un = t.closest<HTMLElement>('[data-unpick]');
        if (un) return togglePick(Number(un.dataset.unpick));
        if (t.id === 'pickAddBtn') addFromInput();
    });
    $('pickBar').addEventListener('keydown', (e) => {
        if ((e.target as HTMLElement).id === 'pickAdd' && e.key === 'Enter') addFromInput();
    });
}

function addFromInput(): void {
    const D = S.exp?.dist;
    const v = Number($<HTMLInputElement>('pickAdd').value);
    if (!D || !Number.isInteger(v) || v < 1 || v > D.N || currentPicks().includes(v)) return;
    togglePick(v);
}
