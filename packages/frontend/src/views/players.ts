import { $, esc, initial, playerColor } from '../dom.js';
import { S, requireExp } from '../state.js';

/** 現在ティックの各プレイヤーの状態を1行ずつ表で出す */
export function renderPlayers(): void {
    const E = requireExp();
    const t = S.t;

    const rows = E.players
        .map((P) => {
            const style = `--pc:${playerColor(P.idx)}`;
            const name = `<span class="pn" style="${style}"><i></i>${esc(P.name)}</span>`;
            const sel = P.idx === S.sel;
            const attrs = `data-p="${P.idx}" tabindex="0" aria-selected="${sel}" class="${sel ? 'sel' : ''}"`;
            const x = P.x[t], y = P.y[t], lp = P.lp[t];
            if (x == null || y == null || lp == null) {
                return `<tr ${attrs}><td>${name}</td><td colspan="7" class="muted">未参加</td></tr>`;
            }
            const a = P.act[t];
            const act = (a ?? '—') + (P.valid[t] === false ? '<span class="flag">空振り</span>' : '');
            const lpCell = String(lp) + (P.dead[t] ? '<span class="flag dead">死亡</span>' : '');
            const view = (P.view[t] ?? [])
                .map((c) =>
                    c.player
                        ? `<span class="vc pl" style="${style}" title="${esc(c.player.name)}（保持 ${c.player.hold}）">${esc(initial(String(c.player.name), 'P'))}</span>`
                        : `<span class="vc" title="(${c.x}, ${c.y})">${c.block === 0 ? '·' : c.block}</span>`,
                )
                .join('');
            return (
                `<tr ${attrs}><td>${name}</td><td>${act}</td><td>${lpCell}</td><td>${x},${y}</td><td>${P.dir[t]}</td>` +
                `<td>${P.hold[t]}</td><td>${P.lt[t]} / ${P.ltmax[t]}</td><td><span class="vcells">${view || '—'}</span></td></tr>`
            );
        })
        .join('');

    $('plist').innerHTML =
        '<table class="ptable"><thead><tr><th>プレイヤー</th><th>行動</th><th>LP</th><th>位置</th><th>向き</th><th>保持</th><th>生存 / 最長</th><th>視界</th></tr></thead>' +
        `<tbody>${rows}</tbody></table>`;
}

export function bindPlayerEvents(onSelectPlayer: (idx: number) => void): void {
    const list = $('plist');
    list.addEventListener('click', (e) => {
        const r = (e.target as Element).closest<HTMLElement>('[data-p]');
        if (r?.dataset.p != null) onSelectPlayer(Number(r.dataset.p));
    });
    list.addEventListener('keydown', (e) => {
        const target = e.target as HTMLElement;
        if ((e.key === 'Enter' || e.key === ' ') && target.dataset.p != null) {
            e.preventDefault();
            onSelectPlayer(Number(target.dataset.p));
        }
    });
}
