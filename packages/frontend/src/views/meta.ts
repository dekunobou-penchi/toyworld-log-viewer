import { $, esc } from '../dom.js';
import { S, requireExp } from '../state.js';

export function renderMeta(): void {
    const E = requireExp();
    $('expName').textContent = E.title;
    const p = E.params;
    const kv: [string, string | number][] = [
        ['ティック数', E.T],
        ['マップ', `${E.nx}×${E.ny}`],
        ['ブロック ID', p ? `${p.map.blockMin}–${p.map.blockMax - 1}` : `0–${E.blockMax - 1}`],
        ['LP', p ? `${p.player.lpInitial} −${p.player.lpDecreasePerTick}/tick` : '—'],
        ['視界', p ? p.player.viewRange : '—'],
        ['遷移', p ? (p.transition === 'agent' ? 'agent' : `person ${p.tickIntervalSec}s`) : '—'],
        ['プレイヤー数', E.players.length],
    ];
    $('meta').innerHTML = `<tbody>${[['名前', E.title] as [string, string | number], ['ID', E.id] as [string, string | number], ...kv]
        .map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`)
        .join('')}</tbody>`;
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
