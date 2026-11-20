import { $ } from './dom.js';

export function showTip(html: string, clientX: number, clientY: number): void {
    const tip = $('tip');
    tip.innerHTML = html;
    tip.hidden = false;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let left = clientX + 14;
    let top = clientY + 14;
    if (left + tw > window.innerWidth - 8) left = clientX - tw - 14;
    if (top + th > window.innerHeight - 8) top = clientY - th - 14;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${Math.max(8, top)}px`;
}

export function hideTip(): void {
    $('tip').hidden = true;
}
