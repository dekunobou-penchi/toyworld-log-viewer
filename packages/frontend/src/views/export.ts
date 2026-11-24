import { $, esc } from '../dom.js';
import { S, requireExp } from '../state.js';
import { ACTION_GROUPS } from '@viewer/shared';
import { playerColor } from '../dom.js';
import { showError } from './meta.js';
import { PICK_COLORS, currentPicks } from './dist.js';

/*
 * 書き出し。
 * - データ：サーバの /api/experiments/:id/export/:kind を集計の範囲（S.from–S.to）で呼んでダウンロードする
 * - グラフ：画面の SVG を複製し、色や線をライトテーマの値で埋め込んで SVG / PNG にする（論文・スライド用）
 */

/** 目標分布がある実験でだけ出す書き出し */
const DIST_KINDS = new Set(['dist_series', 'dist_ids']);

function range(): { from: number; to: number } {
    return { from: Math.min(S.from, S.to), to: Math.max(S.from, S.to) };
}

/** グラフの見出しに付ける SVG / PNG ボタン */
export function imgButtons(name: string, src?: string): string {
    const s = src ? ` data-src="${esc(src)}"` : '';
    return (
        `<span class="imgdl">` +
        `<button type="button" class="dlbtn" data-img="svg" data-name="${esc(name)}"${s} title="このグラフを SVG で保存（論文・スライド用、ライトの配色）">SVG</button>` +
        `<button type="button" class="dlbtn" data-img="png" data-name="${esc(name)}"${s} title="このグラフを PNG（2 倍の解像度）で保存">PNG</button>` +
        `</span>`
    );
}

/** 実験を開いたとき・集計範囲や選択中ティックが変わったときに呼ぶ */
export function renderExportButtons(): void {
    const E = requireExp();
    const { from, to } = range();
    const label = `集計の範囲（tick ${from + 1}–${to + 1}）`;
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-export]')) {
        const kind = b.dataset.export!;
        b.hidden = (DIST_KINDS.has(kind) && !E.dist) || (kind === 'refills' && E.refills.length === 0);
        const what = b.dataset.what ?? kind;
        b.title = kind === 'dist_ids' ? `${what}：tick ${S.t + 1} の個数と、${label}の補充` : `${what}：${label}`;
    }
    for (const el of document.querySelectorAll<HTMLElement>('.dlrange')) el.textContent = `tick ${from + 1}–${to + 1}`;
}

function download(href: string, filename?: string): void {
    const a = document.createElement('a');
    a.href = href;
    if (filename) a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
}

function exportData(kind: string): void {
    const E = requireExp();
    const { from, to } = range();
    // ファイル名はサーバが Content-Disposition で付ける
    download(`/api/experiments/${encodeURIComponent(E.id)}/export/${kind}?from=${from}&to=${to}&t=${S.t}`);
}

/* ---------------- グラフ画像 ---------------- */

/* 画像に描き足す凡例（画面の凡例は HTML なので画像に入らないため） */

interface LegendItem {
    /** CSS の色（var(--x) も可。ライトテーマで解決する） */
    color: string;
    label: string;
    mark: 'box' | 'line' | 'dash' | 'ring' | 'faint';
}

function legendFor(name: string): LegendItem[] {
    const E = requireExp();
    const players = (all: boolean) =>
        E.players.filter((P) => all || !S.hidden.has(P.idx)).map((P): LegendItem => ({ color: playerColor(P.idx), label: P.name, mark: 'line' }));
    if (name === 'lp') return [...players(false), { color: 'var(--ink2)', label: '● 死亡', mark: 'faint' }];
    if (name === 'hold' || name === 'lt') return players(false);
    if (name === 'l1') {
        return [
            { color: 'var(--ink)', label: '目標とのズレ（L1）', mark: 'line' },
            { color: 'var(--accent)', label: `偶然でも出る L1 の目安（95%）${E.dist?.l1Chance.toFixed(3) ?? ''}`, mark: 'dash' },
        ];
    }
    if (name === 'actions_timeline') {
        return [
            ...ACTION_GROUPS.map((g, i): LegendItem => ({ color: `var(--s${i + 1})`, label: g.label, mark: 'box' })),
            { color: 'color-mix(in oklab, var(--s1) 30%, #ffffff)', label: '薄色 = 空振り', mark: 'box' },
            { color: 'var(--crit)', label: '死亡', mark: 'line' },
        ];
    }
    if (name.startsWith('dist_tick')) {
        return [
            { color: 'var(--accent)', label: `tick ${S.t + 1} の割合`, mark: 'box' },
            { color: 'var(--s2)', label: '偶然の範囲の外', mark: 'box' },
            { color: 'var(--ink)', label: '目標 p*', mark: 'line' },
            { color: 'color-mix(in oklab, var(--accent) 16%, var(--bg))', label: '偶然の範囲（±2σ）', mark: 'box' },
        ];
    }
    const { from, to } = range();
    if (name === 'count_hist') {
        return [
            ...currentPicks().map((k, i): LegendItem => ({ color: PICK_COLORS[i], label: `ID ${k}`, mark: 'box' })),
            { color: 'var(--ink2)', label: `棒：tick ${from + 1}–${to + 1} でその個数だった割合　線：2項分布 B(M, p*)`, mark: 'faint' },
        ];
    }
    if (name === 'refills_by_id') {
        const items: LegendItem[] = [
            { color: 'var(--accent)', label: `補充回数（tick ${from + 1}–${to + 1}）`, mark: 'box' },
            { color: 'var(--ink)', label: '目標どおりの期待 n·p*', mark: 'line' },
        ];
        if (S.stats?.refill.ruleExpected) items.push({ color: 'var(--s2)', label: `ルールの期待（α = ${E.dist?.alpha}、推定）`, mark: 'ring' });
        return items;
    }
    return [];
}

/** 凡例を SVG の下に足す。増えた高さを返す */
function appendLegend(svg: SVGSVGElement, items: LegendItem[], w: number, h: number): number {
    if (!items.length) return 0;
    const NS = 'http://www.w3.org/2000/svg';
    // 色はライトテーマのまま解決する（呼び出し側で data-theme=light にしてある）
    const probe = document.createElement('span');
    document.body.append(probe);
    const resolve = (c: string) => {
        probe.style.color = c;
        return getComputedStyle(probe).color;
    };
    const font = getComputedStyle(document.body).fontFamily;
    const g = document.createElementNS(NS, 'g');
    const rowH = 18, left = 42, maxX = w - 14;
    let x = left, y = h + 14;
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `12px ${font}`;
    for (const it of items) {
        const col = resolve(it.color);
        const tw = ctx.measureText(it.label).width;
        const iw = (it.mark === 'faint' ? 0 : 20) + tw + 16;
        if (x + iw > maxX && x > left) {
            x = left;
            y += rowH;
        }
        const add = (tag: string, attrs: Record<string, string | number>) => {
            const el = document.createElementNS(NS, tag);
            for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
            g.append(el);
            return el;
        };
        let tx = x;
        if (it.mark === 'box') add('rect', { x, y: y - 5, width: 12, height: 10, fill: col });
        else if (it.mark === 'line') add('line', { x1: x, x2: x + 14, y1: y, y2: y, stroke: col, 'stroke-width': 2.5 });
        else if (it.mark === 'dash') add('line', { x1: x, x2: x + 14, y1: y, y2: y, stroke: col, 'stroke-width': 1.5, 'stroke-dasharray': '4 3' });
        else if (it.mark === 'ring') add('circle', { cx: x + 6, cy: y, r: 3.5, fill: '#ffffff', stroke: col, 'stroke-width': 2 });
        if (it.mark !== 'faint') tx += 20;
        const t = add('text', { x: tx, y, 'dominant-baseline': 'central', 'font-size': 12, fill: it.mark === 'faint' ? col : resolve('var(--ink)'), 'font-family': font });
        t.textContent = it.label;
        x += iw;
    }
    probe.remove();
    svg.append(g);
    return y + rowH - h - 2;
}

/** 書き出す SVG に埋め込むスタイル */
const STYLE_PROPS = [
    'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'stroke-linejoin', 'stroke-linecap',
    'opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline',
] as const;

/** ホバーやドラッグ用の要素は画像に入れない */
const DROP = '.hit, .hoverline, .hoverdots, .brush, .cursor, .ov-hit, .ov-mask, .ov-win, .ov-handle';

/**
 * 画面の SVG から、外部の CSS に頼らない SVG を作る。
 * 配色はライトテーマで固定する（一瞬だけ data-theme を light にして計算し、すぐ戻す。描画の間には戻るので画面はちらつかない）。
 */
function standaloneSvg(src: SVGSVGElement, title: string, legend: LegendItem[]): { svg: string; w: number; h: number } {
    const root = document.documentElement;
    const prevTheme = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'light');
    try {
        const clone = src.cloneNode(true) as SVGSVGElement;
        const a = [src, ...src.querySelectorAll('*')];
        const b = [clone, ...clone.querySelectorAll('*')];
        a.forEach((el, i) => {
            const cs = getComputedStyle(el);
            const target = b[i] as SVGElement;
            if (cs.display === 'none' || cs.visibility === 'hidden') {
                target.setAttribute('data-drop', '');
                return;
            }
            for (const p of STYLE_PROPS) {
                const v = cs.getPropertyValue(p);
                if (v) target.style.setProperty(p, v);
                // CSS 変数のままの属性は外のツール（Illustrator など）で読めないので消す（値は style に入れた）
                if (target.getAttribute(p)?.includes('var(')) target.removeAttribute(p);
            }
        });
        clone.querySelectorAll(`${DROP}, [data-drop]`).forEach((el) => el.remove());
        clone.removeAttribute('class');
        const vb = src.viewBox.baseVal;
        const w = vb && vb.width ? vb.width : src.clientWidth;
        const h0 = vb && vb.height ? vb.height : src.clientHeight;
        const h = h0 + appendLegend(clone, legend, w, h0);
        clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clone.setAttribute('width', String(w));
        clone.setAttribute('height', String(h));
        clone.style.overflow = 'visible';
        // 背景（透明だと暗いスライドに貼ったとき文字が見えないので白にする）
        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bg.setAttribute('x', '0');
        bg.setAttribute('y', '0');
        bg.setAttribute('width', String(w));
        bg.setAttribute('height', String(h));
        bg.setAttribute('fill', getComputedStyle(root).getPropertyValue('--bg').trim() || '#ffffff');
        clone.insertBefore(bg, clone.firstChild);
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        t.textContent = title;
        clone.insertBefore(t, clone.firstChild);
        return { svg: '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone), w, h };
    } finally {
        if (prevTheme === null) root.removeAttribute('data-theme');
        else root.setAttribute('data-theme', prevTheme);
    }
}

async function exportChart(btn: HTMLElement): Promise<void> {
    const E = requireExp();
    const host = btn.dataset.src ? document.getElementById(btn.dataset.src) : btn.closest('.chart');
    const svgEl = host?.querySelector<SVGSVGElement>('svg');
    if (!svgEl) return;
    const name = btn.dataset.name ?? 'chart';
    const fmt = btn.dataset.img;
    const { svg, w, h } = standaloneSvg(svgEl, `${E.title} — ${svgEl.getAttribute('aria-label') ?? name}`, legendFor(name));
    const base = `${E.id}_${name}`;
    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    if (fmt === 'svg') {
        const url = URL.createObjectURL(svgBlob);
        download(url, `${base}.svg`);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
    }
    // PNG：2 倍の解像度で描く
    const url = URL.createObjectURL(svgBlob);
    try {
        const img = new Image();
        await new Promise<void>((ok, ng) => {
            img.onload = () => ok();
            img.onerror = () => ng(new Error('SVG を画像にできませんでした'));
            img.src = url;
        });
        const scale = 2;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext('2d')!;
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, w, h);
        const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
        if (!blob) throw new Error('PNG を作れませんでした');
        const pngUrl = URL.createObjectURL(blob);
        download(pngUrl, `${base}.png`);
        setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);
    } finally {
        URL.revokeObjectURL(url);
    }
}

export function bindExportEvents(): void {
    document.addEventListener('click', (e) => {
        const t = e.target as Element;
        const dl = t.closest<HTMLElement>('[data-export]');
        if (dl && S.exp) {
            exportData(dl.dataset.export!);
            return;
        }
        const img = t.closest<HTMLElement>('[data-img]');
        if (img && S.exp) {
            exportChart(img).catch((err: Error) => showError(`画像を保存できませんでした: ${err.message}`));
        }
    });
}
