export const svgNS = 'http://www.w3.org/2000/svg';

export function $<T extends Element = HTMLElement>(id: string): T {
    const el = document.getElementById(id);
    if (!el) throw new Error(`#${id} がありません`);
    return el as unknown as T;
}

export function esc(s: unknown): string {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** プレイヤーの色（参加順でカテゴリカルのスロットに固定） */
export const playerColor = (idx: number): string => `var(--s${(idx % 8) + 1})`;

export function fmt(v: number | null | undefined, digits = 1): string {
    if (v == null || Number.isNaN(v)) return '—';
    return Number.isInteger(v) ? String(v) : v.toFixed(digits);
}

export function pct(v: number | null | undefined): string {
    if (v == null || Number.isNaN(v)) return '—';
    return `${Math.round(v * 100)}%`;
}

export function initial(name: string, fallback = '?'): string {
    return [...name][0] ?? fallback;
}

export function niceTicks(min: number, max: number, n: number): number[] {
    const span = max - min || 1;
    const step0 = span / n;
    const mag = 10 ** Math.floor(Math.log10(step0));
    const e = step0 / mag;
    const step = (e >= 7.5 ? 10 : e >= 3.5 ? 5 : e >= 1.5 ? 2 : 1) * mag;
    const out: number[] = [];
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
}
