import { $, esc } from '../dom.js';
import { S, requireExp } from '../state.js';

export function renderMeta(): void {
    const E = requireExp();
    $('expName').textContent = E.title;
    const p = E.params;
    const kv: [string, string | number][] = [
        ['ticks', E.T],
        ['map', `${E.nx}×${E.ny}`],
        ['block', p ? `${p.map.blockMin}–${p.map.blockMax - 1}` : `0–${E.blockMax - 1}`],
        ['lp', p ? `${p.player.lpInitial} −${p.player.lpDecreasePerTick}/tick` : '—'],
        ['view', p ? p.player.viewRange : '—'],
        ['mode', p ? (p.transition === 'agent' ? 'agent' : `person ${p.tickIntervalSec}s`) : '—'],
        ['players', E.players.length],
    ];
    $('meta').innerHTML = kv.map(([k, v]) => `<span><span class="k">${esc(k)}</span> ${esc(v)}</span>`).join('');
    $('notes').innerHTML = E.notes.map((n) => `<div>${esc(n)}</div>`).join('');
}

export function renderExperimentSelect(): void {
    const sel = $<HTMLSelectElement>('expSelect');
    sel.innerHTML = S.list
        .map((e) => {
            const size = e.nx != null ? ` · ${e.nx}×${e.ny}` : '';
            return `<option value="${esc(e.id)}">${esc(e.id)}（${e.ticks} tick${size}）</option>`;
        })
        .join('');
    if (S.exp) sel.value = S.exp.id;
}

export function showError(message: string): void {
    $('notes').insertAdjacentHTML('afterbegin', `<div class="err">${esc(message)}</div>`);
}
