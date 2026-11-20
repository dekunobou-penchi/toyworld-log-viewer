import { DIR_VEC } from '@viewer/shared';
import { $, esc, initial, playerColor, svgNS } from '../dom.js';
import { S, requireExp } from '../state.js';
import { hideTip, showTip } from '../tooltip.js';

/** SVG 上の1マスの大きさ */
const C = 40;
const TRAIL_SPAN = 14;

interface MapEls {
    rects: SVGRectElement[];
    texts: SVGTextElement[];
    gView: SVGGElement;
    gTrail: SVGGElement;
    gPlayers: SVGGElement;
}
let els: MapEls | null = null;

function blockRatio(b: number): number {
    const E = requireExp();
    return Math.max(0, Math.min(1, (b - 1) / Math.max(1, E.blockMax - 2)));
}
/** ブロックIDは無彩色の明度で表す（プレイヤーの色と混ざらないように） */
function blockFill(b: number): string {
    if (b === 0) return 'var(--bg)';
    return `color-mix(in oklab, var(--blk-hi) ${Math.round(blockRatio(b) * 100)}%, var(--blk-lo))`;
}
function blockText(b: number): string {
    return blockRatio(b) > 0.55 ? 'var(--blk-txt-hi)' : 'var(--blk-txt-lo)';
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
    const e = document.createElementNS(svgNS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    return e;
}

export function buildMap(): void {
    const E = requireExp();
    const svg = $<SVGSVGElement>('map');
    svg.setAttribute('viewBox', `-1 -1 ${E.nx * C + 2} ${E.ny * C + 2}`);
    svg.innerHTML = '';
    const gCells = el('g', {});
    const gView = el('g', {});
    const gTrail = el('g', {});
    const gPlayers = el('g', {});
    const rects: SVGRectElement[] = [];
    const texts: SVGTextElement[] = [];
    const fs = Math.max(9, Math.round(C * 0.32));
    for (let y = 0; y < E.ny; y++) {
        for (let x = 0; x < E.nx; x++) {
            const r = el('rect', { x: x * C + 1, y: y * C + 1, width: C - 2, height: C - 2, stroke: 'none' });
            r.dataset.x = String(x);
            r.dataset.y = String(y);
            const tx = el('text', {
                x: x * C + C / 2, y: y * C + C / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central',
                'font-size': fs, class: 'cell-txt',
            });
            gCells.append(r, tx);
            rects.push(r);
            texts.push(tx);
        }
    }
    svg.append(gCells, gView, gTrail, gPlayers);
    els = { rects, texts, gView, gTrail, gPlayers };
}

export function renderMap(): void {
    if (!els) return;
    const E = requireExp();
    const t = S.t;
    const m = E.maps[t];
    for (let y = 0; y < E.ny; y++) {
        for (let x = 0; x < E.nx; x++) {
            const i = y * E.nx + x;
            const b = m[y][x];
            const r = els.rects[i];
            r.setAttribute('fill', blockFill(b));
            // 空きマスは塗らずに細い枠だけ
            r.setAttribute('stroke', b === 0 ? 'var(--line2)' : 'none');
            els.texts[i].textContent = b === 0 ? '' : String(b);
            els.texts[i].setAttribute('fill', blockText(b));
        }
    }

    // 選択中プレイヤーの視界
    let vh = '';
    const P = E.players[S.sel];
    const view = P?.view[t];
    if ($<HTMLInputElement>('showView').checked && P && view) {
        for (const c of view) {
            vh += `<rect x="${c.x * C + 3}" y="${c.y * C + 3}" width="${C - 6}" height="${C - 6}" fill="${playerColor(P.idx)}" fill-opacity="0.16" stroke="${playerColor(P.idx)}" stroke-width="2"/>`;
        }
    }
    els.gView.innerHTML = vh;

    // 直近の軌跡（トーラスの折り返しと死亡時の再配置は線を引かない）
    let th = '';
    if ($<HTMLInputElement>('trail').checked) {
        for (const Q of E.players) {
            if (S.hidden.has(Q.idx)) continue;
            for (let k = Math.max(1, t - TRAIL_SPAN + 1); k <= t; k++) {
                const x0 = Q.x[k - 1], y0 = Q.y[k - 1], x1 = Q.x[k], y1 = Q.y[k];
                if (x0 == null || y0 == null || x1 == null || y1 == null || Q.dead[k]) continue;
                if (Math.abs(x1 - x0) + Math.abs(y1 - y0) !== 1) continue;
                const op = 0.12 + 0.55 * (1 - (t - k) / TRAIL_SPAN);
                th += `<line x1="${x0 * C + C / 2}" y1="${y0 * C + C / 2}" x2="${x1 * C + C / 2}" y2="${y1 * C + C / 2}" stroke="${playerColor(Q.idx)}" stroke-width="3" stroke-linecap="round" opacity="${op.toFixed(2)}"/>`;
            }
        }
    }
    els.gTrail.innerHTML = th;

    // プレイヤー
    let ph = '';
    for (const Q of E.players) {
        const x = Q.x[t], y = Q.y[t], dir = Q.dir[t];
        if (x == null || y == null || dir == null) continue;
        const cx = x * C + C / 2, cy = y * C + C / 2;
        const v = DIR_VEC[dir];
        const rr = C * 0.3;
        const tipx = cx + v[0] * C * 0.47, tipy = cy + v[1] * C * 0.47;
        const bx = cx + v[0] * rr * 0.75, by = cy + v[1] * rr * 0.75;
        const px = -v[1] * C * 0.17, py = v[0] * C * 0.17;
        const sel = Q.idx === S.sel;
        const color = playerColor(Q.idx);
        ph += `<g opacity="${S.hidden.has(Q.idx) ? 0.35 : 1}" data-p="${Q.idx}" style="cursor:pointer">`;
        if (Q.dead[t]) ph += `<circle cx="${cx}" cy="${cy}" r="${rr + 6}" fill="none" stroke="var(--crit)" stroke-width="2" stroke-dasharray="3 2"/>`;
        ph += `<polygon points="${tipx},${tipy} ${bx + px},${by + py} ${bx - px},${by - py}" fill="${color}" stroke="var(--bg)" stroke-width="1.5" stroke-linejoin="round"/>`;
        ph += `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="${color}" stroke="${sel ? 'var(--ink)' : 'var(--bg)'}" stroke-width="${sel ? 2.5 : 2}"/>`;
        ph += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="${Math.round(C * 0.3)}" font-weight="600" fill="#fff" style="pointer-events:none;font-family:var(--font-ui)">${esc(initial(Q.name))}</text>`;
        const hold = Q.hold[t];
        if (hold) {
            ph += `<g style="pointer-events:none"><rect x="${cx + rr * 0.35}" y="${cy - rr - 6}" width="15" height="13" fill="var(--ink)"/><text x="${cx + rr * 0.35 + 7.5}" y="${cy - rr + 0.5}" text-anchor="middle" dominant-baseline="central" font-size="9.5" fill="var(--bg)" style="font-family:var(--font-data)">${hold}</text></g>`;
        }
        ph += '</g>';
    }
    els.gPlayers.innerHTML = ph;
}

/** マップ上のホバー（ブロック情報）とプレイヤーのクリック選択 */
export function bindMapEvents(onSelectPlayer: (idx: number) => void): void {
    const svg = $<SVGSVGElement>('map');
    svg.addEventListener('click', (e) => {
        const g = (e.target as Element).closest<SVGElement>('[data-p]');
        if (g?.dataset.p != null) onSelectPlayer(Number(g.dataset.p));
    });
    svg.addEventListener('pointermove', (e) => {
        const r = (e.target as Element).closest<SVGRectElement>('rect[data-x]');
        if (!r || !S.exp) return hideTip();
        const x = Number(r.dataset.x), y = Number(r.dataset.y);
        const b = S.exp.maps[S.t][y][x];
        const en = S.exp.energy ? S.exp.energy[b] : null;
        showTip(
            `<div class="h">(${x}, ${y})</div><div class="r"><span>ブロック</span><span class="v">${b === 0 ? '0（空き）' : b}</span></div>` +
                (en != null ? `<div class="r"><span>エネルギー</span><span class="v">${en}</span></div>` : ''),
            e.clientX,
            e.clientY,
        );
    });
    svg.addEventListener('pointerleave', hideTip);
}
