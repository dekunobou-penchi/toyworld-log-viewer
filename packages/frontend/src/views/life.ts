import { LIFE_BINS, autoLifeBin, binLives, type LifeSummary } from '@viewer/shared';
import { api } from '../api.js';
import { $, esc, fmt, niceTicks, playerColor } from '../dom.js';
import { S, requireExp } from '../state.js';
import { hideTip, showTip } from '../tooltip.js';
import { imgButtons, renderExportButtons } from './export.js';

/*
 * 生存時間の分布（集計タブ）。範囲はこの欄だけのもの（S.lifeFrom–S.lifeTo、ツールバーの集計範囲とは別）。
 * 値はサーバの /api/experiments/:id/life。棒への振り分けは shared の binLives（書き出しと同じ区切り）。
 */

type Mode = 'stack' | 'each';
const KEY = 'toyworld-viewer.life';
let mode: Mode = 'stack';
/** 0 = 自動 */
let binSetting = 0;
try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { mode?: Mode; bin?: number };
    if (saved.mode === 'stack' || saved.mode === 'each') mode = saved.mode;
    if (typeof saved.bin === 'number') binSetting = saved.bin;
} catch {
    /* 読めなければ既定のまま */
}

function save(): void {
    try {
        localStorage.setItem(KEY, JSON.stringify({ mode, bin: binSetting }));
    } catch {
        /* 保存できなくても表示はできる */
    }
}

/** 書き出し用：今の棒の幅の設定（0 = 自動） */
export function lifeBinSetting(): number {
    return binSetting;
}

/** 画像の凡例用：名前から対象のプレイヤーを引く（life_hist_{idx}_{名前}） */
export function lifeLegendPlayers(name: string): number[] | null {
    if (name === 'life_hist') return requireExp().players.map((P) => P.idx);
    const m = /^life_hist_(\d+)_/.exec(name);
    return m ? [Number(m[1])] : null;
}

function width(): number {
    return Math.max(320, $('lifeCharts').clientWidth || 800);
}

function safe(name: string): string {
    return name.replace(/[^\w.-]+/g, '_');
}

/** 今の表示のための棒の幅と、プレイヤーごとの回数 */
function current() {
    const st = S.life!;
    const w = binSetting && (LIFE_BINS as readonly number[]).includes(binSetting) ? binSetting : autoLifeBin(st.maxLength);
    return { st, w, ...binLives(st.records, w) };
}

let tipData: { w: number; rows: { idx: number; counts: number[] }[] } | null = null;

const PAD = { l: 46, r: 14, t: 8, b: 40 };

/** ヒストグラム 1 枚。series を積み上げて描く */
function histSvg(series: { idx: number; counts: number[] }[], nbins: number, w: number, ymax: number, H: number, label: string): string {
    const W = width();
    const { l, r, t: top, b } = PAD;
    const bottom = H - b;
    const yt = niceTicks(0, ymax, H > 180 ? 5 : 3).filter((v) => Number.isInteger(v));
    const ytop = Math.max(yt[yt.length - 1] ?? ymax, ymax, 1);
    const Y = (v: number) => bottom - (v / ytop) * (bottom - top);
    const bw = (W - l - r) / Math.max(1, nbins);
    const every = Math.max(1, Math.ceil(nbins / Math.max(4, Math.floor((W - l - r) / 48))));
    let s = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(label)}">`;
    s += `<g class="grid">${yt.map((v) => `<line x1="${l}" x2="${W - r}" y1="${Y(v)}" y2="${Y(v)}"/>`).join('')}</g>`;
    s += `<g class="axis">${yt.map((v) => `<text x="${l - 6}" y="${Y(v)}" text-anchor="end" dominant-baseline="central">${v}</text>`).join('')}</g>`;
    for (let i = 0; i < nbins; i++) {
        let acc = 0;
        for (const sr of series) {
            const v = sr.counts[i] ?? 0;
            if (!v) continue;
            const y1 = Y(acc + v), y0 = Y(acc);
            s += `<rect x="${(l + i * bw + (bw > 4 ? 1 : 0)).toFixed(2)}" y="${y1.toFixed(2)}" width="${Math.max(1, bw - (bw > 4 ? 2 : 0)).toFixed(2)}" height="${(y0 - y1).toFixed(2)}" fill="${playerColor(sr.idx)}" stroke="#000" stroke-width="0.5"/>`;
            acc += v;
        }
        s += `<rect data-bin="${i}" x="${l + i * bw}" y="${top}" width="${bw}" height="${bottom - top}" fill="transparent"/>`;
    }
    s += '<g class="axis">';
    for (let i = 0; i <= nbins; i += every) s += `<text x="${(l + i * bw).toFixed(1)}" y="${bottom + 14}" text-anchor="middle">${i * w}</text>`;
    s += '</g>';
    s += `<text class="d-xt" x="${(l + W - r) / 2}" y="${H - 4}" text-anchor="middle">1 回の生存の長さ（ティック、棒 1 本 = ${w} ティック）</text>`;
    s += `<text class="d-xt" transform="translate(12 ${(top + bottom) / 2}) rotate(-90)" text-anchor="middle">回数</text>`;
    s += `<rect class="plotframe" x="${l}" y="${top}" width="${W - l - r}" height="${bottom - top}"/>`;
    return s + '</svg>';
}

function summaryText(x: LifeSummary | undefined): string {
    if (!x) return '';
    return `死亡 ${x.deaths} 回・打ち切り ${x.censored} 回・平均 ${fmt(x.mean)}・中央値 ${fmt(x.median)}`;
}

/** 集計（S.stats）が届いたとき・設定を変えたとき・幅が変わったときに呼ぶ */
export function renderLife(): void {
    const E = requireExp();
    renderLifeInputs();
    renderExportButtons();
    if (!S.life || $('secStats').hidden) return;
    const { st, w, nbins, counts } = current();
    const same = S.life.from === Math.min(S.from, S.to) && S.life.to === Math.max(S.from, S.to);
    $('lifeRange').textContent = same ? '（集計範囲と同じ）' : '';
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-life-mode]')) b.setAttribute('aria-pressed', String(b.dataset.lifeMode === mode));
    const sel = $<HTMLSelectElement>('lifeBin');
    sel.options[0].textContent = `自動（${autoLifeBin(st.maxLength)}）`;
    sel.value = String(binSetting);

    const series = E.players.map((P) => ({ idx: P.idx, counts: counts.get(P.uid) ?? new Array<number>(nbins).fill(0) }));
    tipData = { w, rows: series };
    let html = '';
    if (st.all.deaths === 0) {
        html = '<div class="notes-box">この範囲には死亡で終わった生存がありません。集計範囲を広げてください。</div>';
    } else if (mode === 'stack') {
        let ymax = 0;
        for (let i = 0; i < nbins; i++) ymax = Math.max(ymax, series.reduce((a, sr) => a + (sr.counts[i] ?? 0), 0));
        html =
            `<div class="chart" data-life="all"><div class="ctitle">全員（プレイヤーごとに積み上げ）<span class="muted" style="font-weight:400">${esc(summaryText(st.all))}</span>${imgButtons('life_hist')}</div>` +
            histSvg(series, nbins, w, ymax, 250, '生存の長さのヒストグラム（全員）') +
            `<div class="tl-legend">${E.players.map((P) => `<span><i style="background:${playerColor(P.idx)}"></i>${esc(P.name)}</span>`).join('')}</div></div>`;
    } else {
        // 縦軸・横軸は全員でそろえる
        let ymax = 0;
        for (const sr of series) for (const v of sr.counts) ymax = Math.max(ymax, v);
        html = E.players
            .map((P, k) => {
                const x = st.summary.find((s) => s.uid === P.uid);
                return (
                    `<div class="chart" data-life="${P.idx}"><div class="ctitle"><span class="pn" style="--pc:${playerColor(P.idx)}"><i></i>${esc(P.name)}</span>` +
                    `<span class="muted" style="font-weight:400">${esc(summaryText(x))}</span>${imgButtons(`life_hist_${P.idx}_${safe(P.name)}`)}</div>` +
                    histSvg([series[k]], nbins, w, ymax, 170, `生存の長さのヒストグラム（${P.name}）`) +
                    '</div>'
                );
            })
            .join('');
    }
    $('lifeCharts').innerHTML = html;

    const row = (label: string, x: LifeSummary) =>
        `<tr><td>${label}</td><td class="num">${x.deaths}</td><td class="num">${x.censored}</td><td class="num">${fmt(x.mean)}</td>` +
        `<td class="num">${fmt(x.median)}</td><td class="num">${fmt(x.min)}</td><td class="num">${fmt(x.max)}</td><td class="num">${fmt(x.sd)}</td></tr>`;
    $('tLife').innerHTML =
        '<thead><tr><th>プレイヤー</th><th>死亡で終わった回</th><th>打ち切り</th><th>平均</th><th>中央値</th><th>最短</th><th>最長</th><th>標準偏差</th></tr></thead><tbody>' +
        E.players
            .map((P) => {
                const x = st.summary.find((s) => s.uid === P.uid)!;
                return row(`<span class="pn" style="--pc:${playerColor(P.idx)}"><i></i>${esc(P.name)}</span>`, x);
            })
            .join('') +
        row('<b>全体</b>', st.all) +
        '</tbody>';
}

function renderLifeInputs(): void {
    $<HTMLInputElement>('lifeFrom').value = String(Math.min(S.lifeFrom, S.lifeTo) + 1);
    $<HTMLInputElement>('lifeTo').value = String(Math.max(S.lifeFrom, S.lifeTo) + 1);
}

/** 実験を開いたとき。同じ実験の読み直しなら範囲を引き継ぐ（終わりまでを見ていたら追記分まで広げる） */
export function resetLifeRange(keep: boolean, prevT: number): void {
    const E = requireExp();
    if (!keep) {
        S.lifeFrom = 0;
        S.lifeTo = E.T - 1;
    } else {
        const atEnd = Math.max(S.lifeFrom, S.lifeTo) >= prevT - 1;
        S.lifeFrom = Math.min(S.lifeFrom, E.T - 1);
        S.lifeTo = atEnd ? E.T - 1 : Math.min(S.lifeTo, E.T - 1);
    }
    const max = String(E.T);
    $<HTMLInputElement>('lifeFrom').max = max;
    $<HTMLInputElement>('lifeTo').max = max;
}

let lifeAbort: AbortController | null = null;
/** 生存時間の範囲が変わったら呼ぶ */
export async function loadLife(): Promise<void> {
    const E = requireExp();
    lifeAbort?.abort();
    const ctrl = new AbortController();
    lifeAbort = ctrl;
    renderLifeInputs();
    $('lifeCharts').classList.add('loading');
    try {
        S.life = await api.life(E.id, Math.min(S.lifeFrom, S.lifeTo), Math.max(S.lifeFrom, S.lifeTo), ctrl.signal);
        renderLife();
    } catch (e) {
        if ((e as Error).name !== 'AbortError') $('lifeCharts').innerHTML = `<div class="notes-box err">生存時間を取得できませんでした: ${esc((e as Error).message)}</div>`;
    } finally {
        if (lifeAbort === ctrl) $('lifeCharts').classList.remove('loading');
    }
}

function setLifeRange(from: number, to: number): void {
    const T = requireExp().T;
    const c = (v: number) => Math.max(0, Math.min(T - 1, v));
    S.lifeFrom = c(Math.min(from, to));
    S.lifeTo = c(Math.max(from, to));
    void loadLife();
}

export function bindLifeEvents(): void {
    const tickInput = (id: string) => (parseInt($<HTMLInputElement>(id).value, 10) || 1) - 1;
    $('lifeFrom').addEventListener('change', () => S.exp && setLifeRange(tickInput('lifeFrom'), Math.max(S.lifeFrom, S.lifeTo)));
    $('lifeTo').addEventListener('change', () => S.exp && setLifeRange(Math.min(S.lifeFrom, S.lifeTo), tickInput('lifeTo')));
    $('lifeAll').addEventListener('click', () => S.exp && setLifeRange(0, S.exp.T - 1));
    $('lifeUpTo').addEventListener('click', () => S.exp && setLifeRange(0, S.t));
    $('lifeSync').addEventListener('click', () => S.exp && setLifeRange(S.from, S.to));

    $('lifeBar').addEventListener('click', (e) => {
        const b = (e.target as Element).closest<HTMLElement>('[data-life-mode]');
        if (!b) return;
        mode = b.dataset.lifeMode as Mode;
        save();
        renderLife();
    });
    $<HTMLSelectElement>('lifeBin').addEventListener('change', (e) => {
        binSetting = Number((e.target as HTMLSelectElement).value) || 0;
        save();
        renderLife();
    });
    $('lifeCharts').addEventListener('pointermove', (e) => {
        const el = (e.target as Element).closest<SVGRectElement>('[data-bin]');
        const chart = (e.target as Element).closest<HTMLElement>('[data-life]');
        if (!el || !chart || !tipData || !S.exp) return hideTip();
        const i = Number(el.dataset.bin);
        const which = chart.dataset.life;
        const rows = tipData.rows.filter((r) => which === 'all' || String(r.idx) === which);
        const total = rows.reduce((a, r) => a + (r.counts[i] ?? 0), 0);
        const P = (idx: number) => S.exp!.players[idx];
        showTip(
            `<div class="h">長さ ${i * tipData.w}〜${(i + 1) * tipData.w - 1}</div>` +
                rows.map((r) => `<div class="r" style="--pc:${playerColor(r.idx)}"><span class="n"><span class="sw"></span>${esc(P(r.idx)?.name ?? '')}</span><span class="v">${r.counts[i] ?? 0} 回</span></div>`).join('') +
                (rows.length > 1 ? `<div class="r"><span class="n">合計</span><span class="v">${total} 回</span></div>` : ''),
            e.clientX, e.clientY,
        );
    });
    $('lifeCharts').addEventListener('pointerleave', hideTip);

    // 幅が変わったら描き直す（集計タブを開いているときだけ）
    let timer = 0;
    let lastW = 0;
    new ResizeObserver(() => {
        clearTimeout(timer);
        timer = window.setTimeout(() => {
            const w = $('lifeCharts').clientWidth;
            if (w > 0 && Math.abs(w - lastW) > 4 && S.exp && S.life) {
                lastW = w;
                renderLife();
            }
        }, 120);
    }).observe($('lifeCharts'));
}
