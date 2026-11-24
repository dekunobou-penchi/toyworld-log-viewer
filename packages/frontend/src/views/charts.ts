import { ACTION_GROUPS, GROUP_OF, type PlayerSeries } from '@viewer/shared';
import { $, esc, niceTicks, playerColor, svgNS } from '../dom.js';
import { S, requireExp } from '../state.js';
import { hideTip, showTip } from '../tooltip.js';
import { imgButtons } from './export.js';

const M = { l: 42, r: 14, t: 6, b: 22 };
const CHART_H = 128;
const OVERVIEW_H = 40;
/** これ以上は拡大しない（ティック数） */
const MIN_SPAN = 10;
/** ドラッグとクリックを分けるしきい値（px） */
const DRAG_PX = 5;

interface XScale {
    x: (t: number) => number;
    inv: (px: number) => number;
    iw: number;
    a: number;
    b: number;
}

interface ChartDef {
    key: string;
    title: string;
    get: (P: PlayerSeries) => (number | null)[];
    step: boolean;
    deaths?: boolean;
}

const CHART_DEFS: ChartDef[] = [
    { key: 'lp', title: 'LP', get: (P) => P.lp, step: false, deaths: true },
    { key: 'hold', title: '保持ブロック', get: (P) => P.hold, step: true },
    { key: 'lt', title: 'Ltime', get: (P) => P.lt, step: false },
];

/** 現在ティックの破線を動かす対象 */
const cursors: { line: SVGLineElement; sx: XScale }[] = [];
let width = 800;
let pickCb: (t: number) => void = () => {};
let overviewEls: { win: SVGRectElement; maskL: SVGRectElement; maskR: SVGRectElement; hL: SVGRectElement; hR: SVGRectElement; cursor: SVGLineElement } | null = null;

/* ---------------- 表示範囲 ---------------- */

function fullSpan(): number {
    return Math.max(1, requireExp().T - 1);
}

function minSpan(): number {
    return Math.min(fullSpan(), MIN_SPAN);
}

export function resetWindow(): void {
    S.win = { a: 0, b: fullSpan() };
}

export function isFullWindow(): boolean {
    return S.win.a <= 0 && S.win.b >= fullSpan();
}

/** 範囲を [0, T-1] に収め、最小幅を守る */
function clampWindow(a: number, b: number): { a: number; b: number } {
    const full = fullSpan();
    let span = Math.max(minSpan(), Math.min(full, b - a));
    if (!Number.isFinite(span)) span = full;
    let na = Math.max(0, Math.min(full - span, a));
    if (!Number.isFinite(na)) na = 0;
    return { a: na, b: na + span };
}

let raf = 0;
function setWindow(a: number, b: number): void {
    S.win = clampWindow(a, b);
    if (!raf) {
        raf = requestAnimationFrame(() => {
            raf = 0;
            redraw();
        });
    }
}

/** f < 1 で拡大、f > 1 で縮小。center のティックを画面上で動かさない */
export function zoomBy(f: number, center?: number): void {
    const { a, b } = S.win;
    const c = center ?? (Math.max(a, Math.min(b, S.t)));
    setWindow(c - (c - a) * f, c + (b - c) * f);
}

export function zoomReset(): void {
    setWindow(0, fullSpan());
}

/** 再生やキー操作でカーソルが範囲の外に出たら、範囲をずらして追いかける */
export function ensureVisible(t: number): void {
    const { a, b } = S.win;
    if (t >= a && t <= b) return;
    const span = b - a;
    const na = t < a ? t - span * 0.9 : t - span * 0.1;
    setWindow(na, na + span);
}

/* ---------------- 描画の部品 ---------------- */

function xScale(a = S.win.a, b = S.win.b): XScale {
    const iw = width - M.l - M.r;
    const span = Math.max(1e-9, b - a);
    return {
        x: (t) => M.l + ((t - a) / span) * iw,
        inv: (px) => Math.round(a + ((px - M.l) / iw) * span),
        iw, a, b,
    };
}

/** 描く必要のあるティックの範囲（端の線がつながるよう1つ外側まで） */
function drawRange(sx: XScale): [number, number] {
    const E = requireExp();
    return [Math.max(0, Math.floor(sx.a) - 1), Math.min(E.T - 1, Math.ceil(sx.b) + 1)];
}

function xAxis(sx: XScale, h: number): string {
    const lo = Math.ceil(sx.a) + 1, hi = Math.floor(sx.b) + 1;
    const ticks = niceTicks(lo, hi, Math.max(2, Math.floor(sx.iw / 90))).filter((v) => Number.isInteger(v) && v >= lo && v <= hi);
    return `<g class="axis">${ticks.map((v) => `<text x="${sx.x(v - 1)}" y="${h - 6}" text-anchor="middle">${v}</text>`).join('')}</g>`;
}

function clip(id: string, top: number, h: number): string {
    return `<defs><clipPath id="${id}"><rect x="${M.l}" y="${top - 4}" width="${width - M.l - M.r}" height="${h - M.b - top + 8}"/></clipPath></defs>`;
}

/** グラフの描画域を囲む軸の枠 */
function plotFrame(h: number): string {
    return `<rect class="plotframe" x="${M.l}" y="${M.t}" width="${width - M.l - M.r}" height="${h - M.t - M.b}"/>`;
}

function frame(h: number, label: string): string {
    return `<svg viewBox="0 0 ${width} ${h}" height="${h}" role="img" aria-label="${esc(label)}">`;
}

function overlays(h: number, top: number): string {
    return (
        `<line class="cursor" x1="0" x2="0" y1="${top}" y2="${h - M.b}"/>` +
        `<line class="hoverline" x1="0" x2="0" y1="${top}" y2="${h - M.b}" visibility="hidden"/>` +
        `<g class="hoverdots"></g>` +
        `<rect class="brush" x="0" y="${top}" width="0" height="${h - M.b - top}" visibility="hidden"/>` +
        `<rect class="hit" x="${M.l}" y="0" width="${width - M.l - M.r}" height="${h}" fill="transparent" style="cursor:crosshair"/>`
    );
}

function tipRow(P: PlayerSeries, value: string): string {
    return `<div class="r" style="--pc:${playerColor(P.idx)}"><span class="n"><span class="sw"></span>${esc(P.name)}</span><span class="v">${esc(value)}</span></div>`;
}

function eventTick(svg: SVGSVGElement, clientX: number, sx: XScale): number {
    const r = svg.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * width;
    return Math.max(0, Math.min(requireExp().T - 1, sx.inv(px)));
}

/** ホバー時のツールチップ。クリック・ドラッグは bindChartEvents でまとめて扱う */
function attachHover(svg: SVGSVGElement, sx: XScale, onMove: (t: number, px: number) => string, onLeave: () => void): void {
    const hit = svg.querySelector<SVGRectElement>('.hit');
    if (!hit) return;
    hit.addEventListener('pointermove', (ev) => {
        if (drag) return;
        const t = eventTick(svg, ev.clientX, sx);
        showTip(onMove(t, sx.x(t)), ev.clientX, ev.clientY);
    });
    hit.addEventListener('pointerleave', () => {
        hideTip();
        onLeave();
    });
}

/* ---------------- 凡例・グラフ ---------------- */

export function buildLegend(): void {
    const E = requireExp();
    $('legend').innerHTML = E.players
        .map(
            (P) =>
                `<button type="button" style="--pc:${playerColor(P.idx)}" data-p="${P.idx}" aria-pressed="${!S.hidden.has(P.idx)}"><span class="sw"></span>${esc(P.name)}</button>`,
        )
        .join('');
}

/** 実験の読み込み・プレイヤーの表示切替・幅の変更時に呼ぶ。全部作り直す */
export function buildCharts(onPick: (t: number) => void): void {
    pickCb = onPick;
    width = Math.max(320, $('charts').clientWidth || 800);
    S.win = clampWindow(S.win.a, S.win.b);
    buildOverview();
    redraw();
}

/** 表示範囲が変わったときに呼ぶ。グラフとタイムラインを描き直す */
function redraw(): void {
    drawCharts();
    drawTimeline();
    updateOverview();
    renderZoomLabel();
    renderCursors();
}

function drawCharts(): void {
    const E = requireExp();
    const host = $('charts');
    host.innerHTML = '';
    cursors.length = 0;
    const h = CHART_H;
    const sx = xScale();
    const [t0, t1] = drawRange(sx);
    const visible = E.players.filter((P) => !S.hidden.has(P.idx));

    for (const def of CHART_DEFS) {
        // 縦軸は全期間で固定（拡大しても高さの比較ができるように）
        let max = 1;
        for (const P of visible) for (const v of def.get(P)) if (v != null && v > max) max = v;
        if (def.key === 'hold') max = Math.max(max, E.blockMax - 1);
        const yt = niceTicks(0, max * 1.04, 4);
        const ymax = Math.max(yt[yt.length - 1] ?? max, max);
        const y = (v: number) => M.t + (1 - v / ymax) * (h - M.t - M.b);
        const clipId = `clip-${def.key}`;

        let s = frame(h, `${def.title} の推移`) + clip(clipId, M.t, h);
        s += `<g class="grid">${yt.map((v) => `<line x1="${M.l}" x2="${width - M.r}" y1="${y(v)}" y2="${y(v)}"/>`).join('')}</g>`;
        s += `<g class="axis">${yt.map((v) => `<text x="${M.l - 6}" y="${y(v)}" text-anchor="end" dominant-baseline="central">${v}</text>`).join('')}</g>`;
        s += xAxis(sx, h) + plotFrame(h);
        s += `<g clip-path="url(#${clipId})">`;
        // 拡大時はティックごとの点も打つ（1点あたり 8px 以上あるとき）
        const showDots = sx.iw / (sx.b - sx.a) >= 8;
        for (const P of visible) {
            const vals = def.get(P);
            let d = '';
            let pen = false;
            for (let t = t0; t <= t1; t++) {
                const v = vals[t];
                if (v == null) {
                    pen = false;
                    continue;
                }
                const X = sx.x(t).toFixed(1), Y = y(v).toFixed(1);
                if (!pen) {
                    d += `M${X},${Y}`;
                    pen = true;
                } else d += def.step ? `H${X}V${Y}` : `L${X},${Y}`;
            }
            const color = playerColor(P.idx);
            s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
            if (showDots && !def.step) {
                for (let t = t0; t <= t1; t++) {
                    const v = vals[t];
                    if (v != null && !(def.deaths && P.dead[t])) s += `<circle cx="${sx.x(t)}" cy="${y(v)}" r="2" fill="${color}"/>`;
                }
            }
            if (def.deaths) {
                for (let t = t0; t <= t1; t++) {
                    const v = vals[t];
                    if (P.dead[t] && v != null) {
                        s += `<circle cx="${sx.x(t)}" cy="${y(v)}" r="3.5" fill="${color}" stroke="var(--bg)" stroke-width="2"/>`;
                    }
                }
            }
        }
        s += '</g>' + overlays(h, M.t) + '</svg>';

        const div = document.createElement('div');
        div.className = 'chart';
        const note = def.deaths ? ' <span class="muted">● 死亡</span>' : '';
        div.innerHTML = `<div class="ctitle">${esc(def.title)}${note}${imgButtons(def.key)}</div>${s}`;
        host.append(div);

        hookChart(div, sx, (t) => {
            let dh = '';
            const rows = visible.map((P) => {
                const v = def.get(P)[t];
                if (v != null) dh += `<circle cx="${sx.x(t)}" cy="${y(v)}" r="4" fill="${playerColor(P.idx)}" stroke="var(--bg)" stroke-width="2"/>`;
                return tipRow(P, v == null ? '—' : `${v}${P.dead[t] && def.deaths ? '（死亡）' : ''}`);
            });
            return { dots: dh, html: `<div class="h">tick ${t + 1} · ${esc(def.title)}</div>${rows.join('')}` };
        });
    }
    if (E.dist) drawL1Chart(host, sx, t0, t1);
}

/** ホバーで縦線・点・ツールチップを出す。カーソル線を登録する */
function hookChart(div: HTMLElement, sx: XScale, onMove: (t: number) => { dots: string; html: string }): void {
    const svg = div.querySelector('svg')!;
    const hl = svg.querySelector<SVGLineElement>('.hoverline')!;
    const dots = svg.querySelector<SVGGElement>('.hoverdots')!;
    cursors.push({ line: svg.querySelector<SVGLineElement>('.cursor')!, sx });
    attachHover(
        svg, sx,
        (t, px) => {
            hl.setAttribute('x1', String(px));
            hl.setAttribute('x2', String(px));
            hl.setAttribute('visibility', 'visible');
            const r = onMove(t);
            dots.innerHTML = r.dots;
            return r.html;
        },
        () => {
            hl.setAttribute('visibility', 'hidden');
            dots.innerHTML = '';
        },
    );
}

/** 目標とのズレ（L1）。実験全体で1本。偶然でも出る L1 の目安を点線で重ねる */
function drawL1Chart(host: HTMLElement, sx: XScale, t0: number, t1: number): void {
    const D = requireExp().dist!;
    const h = CHART_H;
    let max = D.l1Chance;
    for (const v of D.l1) if (v > max) max = v;
    const yt = niceTicks(0, max * 1.04, 4);
    const ymax = Math.max(yt[yt.length - 1] ?? max, max);
    const y = (v: number) => M.t + (1 - v / ymax) * (h - M.t - M.b);
    let s = frame(h, '目標とのズレ（L1）の推移') + clip('clip-l1', M.t, h);
    s += `<g class="grid">${yt.map((v) => `<line x1="${M.l}" x2="${width - M.r}" y1="${y(v)}" y2="${y(v)}"/>`).join('')}</g>`;
    s += `<g class="axis">${yt.map((v) => `<text x="${M.l - 6}" y="${y(v)}" text-anchor="end" dominant-baseline="central">${v}</text>`).join('')}</g>`;
    s += xAxis(sx, h) + plotFrame(h);
    s += `<line x1="${M.l}" x2="${width - M.r}" y1="${y(D.l1Chance)}" y2="${y(D.l1Chance)}" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="5 4"/>`;
    let d = '';
    for (let t = t0; t <= t1; t++) d += `${t === t0 ? 'M' : 'L'}${sx.x(t).toFixed(1)},${y(D.l1[t]).toFixed(1)}`;
    s += `<g clip-path="url(#clip-l1)"><path d="${d}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>`;
    if (sx.iw / (sx.b - sx.a) >= 8) {
        for (let t = t0; t <= t1; t++) s += `<circle cx="${sx.x(t)}" cy="${y(D.l1[t])}" r="2" fill="var(--ink)"/>`;
    }
    s += '</g>' + overlays(h, M.t) + '</svg>';
    const div = document.createElement('div');
    div.className = 'chart';
    div.innerHTML =
        `<div class="ctitle">目標とのズレ（L1） <span class="muted">— 実線 L1　<span style="color:var(--accent)">┄ 偶然でも出る L1 の目安（95%）${D.l1Chance.toFixed(3)}</span></span>${imgButtons('l1')}</div>${s}`;
    host.append(div);
    hookChart(div, sx, (t) => {
        const v = D.l1[t];
        const over = v > D.l1Chance;
        return {
            dots: `<circle cx="${sx.x(t)}" cy="${y(v)}" r="4" fill="var(--ink)" stroke="var(--bg)" stroke-width="2"/>`,
            html:
                `<div class="h">tick ${t + 1} · 目標とのズレ</div>` +
                `<div class="r"><span class="n">L1</span><span class="v">${v.toFixed(3)}${over ? '（目安超え）' : ''}</span></div>` +
                `<div class="r"><span class="n">±2σ の外の ID</span><span class="v">${D.outside[t]} / ${D.N}</span></div>`,
        };
    });
}

function drawTimeline(): void {
    const E = requireExp();
    const rowH = 16, gap = 6;
    const h = E.players.length * (rowH + gap) + M.b;
    const sx = xScale();
    const [t0, t1] = drawRange(sx);
    const colW = sx.iw / Math.max(1e-9, sx.b - sx.a);

    let s = frame(h, '行動タイムライン') + clip('clip-tl', 4, h);
    let body = '';
    E.players.forEach((P, r) => {
        const y0 = r * (rowH + gap);
        const label = P.name.length > 6 ? `${P.name.slice(0, 5)}…` : P.name;
        s += `<text x="${M.l - 6}" y="${y0 + rowH / 2}" text-anchor="end" dominant-baseline="central" font-size="11" fill="var(--ink2)" style="font-family:var(--font-ui)">${esc(label)}</text>`;
        s += `<rect x="${M.l}" y="${y0}" width="${sx.iw}" height="${rowH}" fill="var(--bg)"/>`;
        // 同じグループ・同じ有効/空振りが続く区間を1つの矩形にまとめる
        let t = t0;
        while (t <= t1) {
            const a = P.act[t];
            if (a == null) {
                t++;
                continue;
            }
            const g = GROUP_OF[a];
            const ok = P.valid[t] !== false;
            let u = t + 1;
            while (u <= t1) {
                const b = P.act[u];
                if (b == null || GROUP_OF[b] !== g || (P.valid[u] !== false) !== ok) break;
                u++;
            }
            const x0 = sx.x(t) - colW / 2;
            const x1 = sx.x(u - 1) + colW / 2;
            // 拡大して1ティックが太いときは、ティックの境目に細い隙間を入れる
            const gapPx = colW >= 10 ? 1 : 0;
            if (gapPx) {
                for (let k = t; k < u; k++) {
                    const kx = sx.x(k) - colW / 2;
                    body += `<rect x="${(kx + gapPx / 2).toFixed(2)}" y="${y0}" width="${(colW - gapPx).toFixed(2)}" height="${rowH}" fill="var(--s${g + 1})" fill-opacity="${ok ? 1 : 0.3}"/>`;
                }
            } else {
                body += `<rect x="${x0.toFixed(2)}" y="${y0}" width="${(x1 - x0).toFixed(2)}" height="${rowH}" fill="var(--s${g + 1})" fill-opacity="${ok ? 1 : 0.3}"/>`;
            }
            t = u;
        }
        for (let k = t0; k <= t1; k++) {
            if (P.dead[k]) body += `<line x1="${sx.x(k)}" x2="${sx.x(k)}" y1="${y0 - 2}" y2="${y0 + rowH + 2}" stroke="var(--crit)" stroke-width="2"/>`;
        }
    });
    s += `<g clip-path="url(#clip-tl)">${body}</g>`;
    s += xAxis(sx, h) + overlays(h, 0) + '</svg>';
    $('timeline').innerHTML = s;

    const svg = $('timeline').querySelector('svg')!;
    const hl = svg.querySelector<SVGLineElement>('.hoverline')!;
    cursors.push({ line: svg.querySelector<SVGLineElement>('.cursor')!, sx });
    attachHover(
        svg, sx,
        (t, px) => {
            hl.setAttribute('x1', String(px));
            hl.setAttribute('x2', String(px));
            hl.setAttribute('visibility', 'visible');
            const rows = E.players.map((P) => {
                const a = P.act[t];
                const v = a == null ? '—' : `${a}${P.valid[t] === false ? '（空振り）' : ''}${P.dead[t] ? ' · 死亡' : ''}`;
                return tipRow(P, v);
            });
            return `<div class="h">tick ${t + 1} · 選択した行動</div>${rows.join('')}`;
        },
        () => hl.setAttribute('visibility', 'hidden'),
    );

    $('tlLegend').innerHTML =
        ACTION_GROUPS.map((g, i) => `<span><i style="background:var(--s${i + 1})"></i>${esc(g.label)}</span>`).join('') +
        '<span><i style="background:var(--s1);opacity:0.3"></i>薄色 = 空振り</span>' +
        '<span><i style="background:var(--crit);width:2px"></i>死亡</span>';
}

/* ---------------- 全体のミニバー ---------------- */

function buildOverview(): void {
    const E = requireExp();
    const h = OVERVIEW_H;
    const sx = xScale(0, fullSpan());
    const visible = E.players.filter((P) => !S.hidden.has(P.idx));
    let max = 1;
    for (const P of visible) for (const v of P.lp) if (v != null && v > max) max = v;
    const y = (v: number) => 4 + (1 - v / max) * (h - M.b + 2 - 8);

    let s = frame(h, '表示範囲の選択');
    s += `<rect x="${M.l}" y="2" width="${sx.iw}" height="${h - M.b}" fill="var(--bg)"/>`;
    for (const P of visible) {
        let d = '';
        let pen = false;
        // 横幅のピクセル数以上は描いても見えないので間引く
        const step = Math.max(1, Math.floor(E.T / sx.iw));
        for (let t = 0; t < E.T; t += step) {
            const v = P.lp[t];
            if (v == null) {
                pen = false;
                continue;
            }
            d += `${pen ? 'L' : 'M'}${sx.x(t).toFixed(1)},${y(v).toFixed(1)}`;
            pen = true;
        }
        s += `<path d="${d}" fill="none" stroke="${playerColor(P.idx)}" stroke-width="1" opacity="0.7"/>`;
    }
    s += xAxis(sx, h) + plotFrame(h);
    s +=
        `<rect class="ov-mask" data-side="l" y="2" height="${h - M.b}"/>` +
        `<rect class="ov-mask" data-side="r" y="2" height="${h - M.b}"/>` +
        `<line class="cursor" x1="0" x2="0" y1="2" y2="${h - M.b + 2}"/>` +
        `<rect class="ov-win" y="2" height="${h - M.b}"/>` +
        `<rect class="ov-handle" data-edge="l" y="${(h - M.b) / 2 - 7}" width="6" height="16"/>` +
        `<rect class="ov-handle" data-edge="r" y="${(h - M.b) / 2 - 7}" width="6" height="16"/>` +
        `<rect class="ov-hit" x="${M.l}" y="0" width="${sx.iw}" height="${h - M.b + 4}" fill="transparent"/>`;
    s += '</svg>';
    $('overview').innerHTML = s;
    const svg = $('overview').querySelector('svg')!;
    overviewEls = {
        maskL: svg.querySelector<SVGRectElement>('[data-side="l"]')!,
        maskR: svg.querySelector<SVGRectElement>('[data-side="r"]')!,
        win: svg.querySelector<SVGRectElement>('.ov-win')!,
        hL: svg.querySelector<SVGRectElement>('[data-edge="l"]')!,
        hR: svg.querySelector<SVGRectElement>('[data-edge="r"]')!,
        cursor: svg.querySelector<SVGLineElement>('.cursor')!,
    };
}

function updateOverview(): void {
    if (!overviewEls) return;
    const sx = xScale(0, fullSpan());
    const x0 = sx.x(S.win.a), x1 = sx.x(S.win.b);
    const set = (el: Element, attrs: Record<string, number>) => {
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v.toFixed(2));
    };
    set(overviewEls.maskL, { x: M.l, width: Math.max(0, x0 - M.l) });
    set(overviewEls.maskR, { x: x1, width: Math.max(0, M.l + sx.iw - x1) });
    set(overviewEls.win, { x: x0, width: Math.max(2, x1 - x0) });
    set(overviewEls.hL, { x: x0 - 3 });
    set(overviewEls.hR, { x: x1 - 3 });
}

function renderZoomLabel(): void {
    const E = requireExp();
    const a = Math.round(S.win.a) + 1, b = Math.round(S.win.b) + 1;
    $('zoomLabel').textContent = isFullWindow() ? `全期間（tick 1–${E.T}）` : `tick ${a}–${b}（${b - a + 1} / ${E.T}）`;
    $<HTMLButtonElement>('zoomReset').disabled = isFullWindow();
    $<HTMLButtonElement>('zoomOut').disabled = isFullWindow();
    $<HTMLButtonElement>('zoomIn').disabled = S.win.b - S.win.a <= minSpan() + 1e-6;
}

export function renderCursors(): void {
    for (const c of cursors) {
        const x = String(c.sx.x(S.t));
        c.line.setAttribute('x1', x);
        c.line.setAttribute('x2', x);
        c.line.setAttribute('visibility', S.t >= c.sx.a - 0.5 && S.t <= c.sx.b + 0.5 ? 'visible' : 'hidden');
    }
    if (overviewEls) {
        const x = String(xScale(0, fullSpan()).x(S.t));
        overviewEls.cursor.setAttribute('x1', x);
        overviewEls.cursor.setAttribute('x2', x);
    }
}

/* ---------------- 操作 ---------------- */

type Drag =
    | { kind: 'brush'; svg: SVGSVGElement; sx: XScale; startX: number; startT: number; moved: boolean; pointerId: number }
    | { kind: 'pan' | 'left' | 'right'; startX: number; a: number; b: number; pointerId: number };
let drag: Drag | null = null;

function svgX(svg: SVGSVGElement, clientX: number): number {
    const r = svg.getBoundingClientRect();
    return ((clientX - r.left) / r.width) * width;
}

/** 一度だけ呼ぶ。グラフは描き直されるので、イベントは親要素で受ける */
export function bindChartEvents(): void {
    const area = $('tsArea');

    // グラフ上: ドラッグで範囲を選んで拡大、動かさずに離したらそのティックへ移動
    area.addEventListener('pointerdown', (ev) => {
        const hit = (ev.target as Element).closest('.hit');
        if (!hit || ev.button !== 0) return;
        const svg = hit.closest('svg') as SVGSVGElement;
        const c = cursors.find((k) => k.line.ownerSVGElement === svg);
        if (!c) return;
        drag = { kind: 'brush', svg, sx: c.sx, startX: ev.clientX, startT: eventTick(svg, ev.clientX, c.sx), moved: false, pointerId: ev.pointerId };
        (hit as Element).setPointerCapture(ev.pointerId);
    });
    area.addEventListener('pointermove', (ev) => {
        if (!drag || drag.kind !== 'brush' || ev.pointerId !== drag.pointerId) return;
        if (!drag.moved && Math.abs(ev.clientX - drag.startX) < DRAG_PX) return;
        drag.moved = true;
        hideTip();
        const brush = drag.svg.querySelector<SVGRectElement>('.brush')!;
        const x0 = svgX(drag.svg, drag.startX), x1 = svgX(drag.svg, ev.clientX);
        const lo = Math.max(M.l, Math.min(x0, x1)), hi = Math.min(width - M.r, Math.max(x0, x1));
        brush.setAttribute('x', String(lo));
        brush.setAttribute('width', String(Math.max(0, hi - lo)));
        brush.setAttribute('visibility', 'visible');
    });
    const endBrush = (ev: PointerEvent) => {
        if (!drag || drag.kind !== 'brush' || ev.pointerId !== drag.pointerId) return;
        const d = drag;
        drag = null;
        d.svg.querySelector('.brush')?.setAttribute('visibility', 'hidden');
        if (ev.type === 'pointercancel') return;
        if (!d.moved) {
            pickCb(d.startT);
            return;
        }
        const endT = eventTick(d.svg, ev.clientX, d.sx);
        const lo = Math.min(d.startT, endT), hi = Math.max(d.startT, endT);
        if (hi - lo >= 2) setWindow(lo, hi);
    };
    area.addEventListener('pointerup', endBrush);
    area.addEventListener('pointercancel', endBrush);

    // Ctrl/⌘ + ホイール（トラックパッドのピンチも ctrlKey 付きで来る）で拡大縮小、
    // 横スクロールか Shift + ホイールで左右に移動。普通の縦ホイールはページのスクロールのまま
    area.addEventListener(
        'wheel',
        (ev) => {
            const hit = (ev.target as Element).closest('.hit, .ov-hit');
            if (!hit || !S.exp) return;
            const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
            const dx = ev.deltaX * unit, dy = ev.deltaY * unit;
            const span = S.win.b - S.win.a;
            if (ev.ctrlKey || ev.metaKey) {
                ev.preventDefault();
                const svg = hit.closest('svg') as SVGSVGElement;
                const sx = hit.classList.contains('ov-hit') ? xScale(0, fullSpan()) : xScale();
                const center = Math.max(0, Math.min(fullSpan(), sx.a + ((svgX(svg, ev.clientX) - M.l) / sx.iw) * (sx.b - sx.a)));
                zoomBy(Math.exp(Math.max(-60, Math.min(60, dy)) * 0.01), center);
            } else if (ev.shiftKey || Math.abs(dx) > Math.abs(dy)) {
                if (isFullWindow()) return;
                ev.preventDefault();
                const move = ((ev.shiftKey && !dx ? dy : dx) * span) / (width - M.l - M.r);
                setWindow(S.win.a + move, S.win.b + move);
            }
        },
        { passive: false },
    );

    // ミニバー: 窓をドラッグして移動、端をつまんで幅を変える、外をクリックするとそこへ移動
    const ov = $('overview');
    ov.addEventListener('pointerdown', (ev) => {
        const svg = (ev.target as Element).closest('svg');
        if (!svg || ev.button !== 0 || !S.exp) return;
        const sx = xScale(0, fullSpan());
        const px = svgX(svg, ev.clientX);
        const x0 = sx.x(S.win.a), x1 = sx.x(S.win.b);
        let kind: 'pan' | 'left' | 'right' = 'pan';
        if (Math.abs(px - x0) <= 6 && !isFullWindow()) kind = 'left';
        else if (Math.abs(px - x1) <= 6 && !isFullWindow()) kind = 'right';
        else if (px < x0 || px > x1) {
            const span = S.win.b - S.win.a;
            const c = sx.a + ((px - M.l) / sx.iw) * fullSpan();
            S.win = clampWindow(c - span / 2, c + span / 2);
            redraw();
        }
        drag = { kind, startX: ev.clientX, a: S.win.a, b: S.win.b, pointerId: ev.pointerId };
        (ev.target as Element).setPointerCapture(ev.pointerId);
        ev.preventDefault();
    });
    ov.addEventListener('pointermove', (ev) => {
        const svg = (ev.target as Element).closest('svg');
        if (!svg) return;
        if (!drag || drag.kind === 'brush' || ev.pointerId !== drag.pointerId) {
            // カーソルの形で操作を示す
            if (!S.exp || !overviewEls) return;
            const sx = xScale(0, fullSpan());
            const px = svgX(svg, ev.clientX);
            const x0 = sx.x(S.win.a), x1 = sx.x(S.win.b);
            const edge = !isFullWindow() && (Math.abs(px - x0) <= 6 || Math.abs(px - x1) <= 6);
            (svg as SVGSVGElement).style.cursor = edge ? 'ew-resize' : px >= x0 && px <= x1 ? 'grab' : 'pointer';
            return;
        }
        const ticksPerPx = fullSpan() / (width - M.l - M.r);
        const r = svg.getBoundingClientRect();
        const move = ((ev.clientX - drag.startX) / r.width) * width * ticksPerPx;
        if (drag.kind === 'pan') setWindow(drag.a + move, drag.b + move);
        else if (drag.kind === 'left') setWindow(Math.min(drag.a + move, drag.b - minSpan()), drag.b);
        else setWindow(drag.a, Math.max(drag.b + move, drag.a + minSpan()));
    });
    const endPan = (ev: PointerEvent) => {
        if (drag && drag.kind !== 'brush' && ev.pointerId === drag.pointerId) drag = null;
    };
    ov.addEventListener('pointerup', endPan);
    ov.addEventListener('pointercancel', endPan);

    $('zoomIn').addEventListener('click', () => zoomBy(0.5));
    $('zoomOut').addEventListener('click', () => zoomBy(2));
    $('zoomReset').addEventListener('click', zoomReset);
}
