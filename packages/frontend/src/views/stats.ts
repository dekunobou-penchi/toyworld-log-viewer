import { ACTIONS, CONTEXTS } from '@viewer/shared';
import { $, esc, fmt, pct, playerColor } from '../dom.js';
import { S, requireExp } from '../state.js';

/** 割合 p (0–1) を逐次色で塗る */
function heat(p: number | null): string {
    if (p == null || !(p > 0)) return '';
    const k = Math.round(Math.min(1, p) * 100);
    const fg = p > 0.55 ? '#fff' : 'var(--ink)';
    return `background:color-mix(in oklab, var(--seq-hi) ${k}%, var(--seq-lo));color:${fg}`;
}

function playerName(uid: string): { name: string; idx: number } {
    const P = requireExp().players.find((p) => p.uid === uid);
    return { name: P?.name ?? uid.slice(0, 6), idx: P?.idx ?? 0 };
}

function playerLabel(uid: string): string {
    const { name, idx } = playerName(uid);
    return `<span class="pn" style="--pc:${playerColor(idx)}"><i></i>${esc(name)}</span>`;
}

export function buildContextSelect(): void {
    const sel = $<HTMLSelectElement>('ctxPlayer');
    sel.innerHTML = requireExp()
        .players.map((P) => `<option value="${P.idx}">${esc(P.name)}</option>`)
        .join('');
    sel.value = String(S.sel);
}

export function renderRangeInputs(): void {
    $<HTMLInputElement>('rFrom').value = String(Math.min(S.from, S.to) + 1);
    $<HTMLInputElement>('rTo').value = String(Math.max(S.from, S.to) + 1);
}

export function renderStats(): void {
    const st = S.stats;
    if (!st) return;

    const summaryRows = st.summary
        .map(
            (s) =>
                `<tr><td>${playerLabel(s.uid)}</td><td class="num">${s.ticks}</td><td class="num">${s.deaths}</td><td class="num">${s.maxLtime}</td>` +
                `<td class="num">${fmt(s.meanLp)}</td><td class="num">${s.validEats}</td><td class="num">${s.energyGained ?? '—'}</td>` +
                `<td class="num">${s.actions ? pct(s.invalidActions / s.actions) : '—'}</td></tr>`,
        )
        .join('');
    $('tSummary').innerHTML =
        '<thead><tr><th>プレイヤー</th><th>記録ティック</th><th>死亡</th><th>最長生存</th><th>平均 LP</th><th>有効な eat</th><th>獲得エネルギー</th><th>空振り率</th></tr></thead>' +
        `<tbody>${summaryRows}</tbody>`;

    const head = `<tr><th>行動</th>${st.actions.map((a) => `<th>${playerLabel(a.uid)}</th>`).join('')}</tr>`;
    let body = '';
    for (const x of ACTIONS) {
        body += `<tr><td class="mono">${x}</td>`;
        for (const a of st.actions) {
            const c = a.counts[x];
            const p = a.total ? c.n / a.total : null;
            const ok = c.known ? c.ok / c.known : null;
            body += `<td class="heat" style="${heat(p)}">${c.n} <span style="opacity:.8">(${pct(p)})</span><span class="sub"> / ${pct(ok)}</span></td>`;
        }
        body += '</tr>';
    }
    body += `<tr><td>合計</td>${st.actions.map((a) => `<td class="num">${a.total}</td>`).join('')}</tr>`;
    $('tActions').innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;

    renderContext();
}

export function renderContext(): void {
    const st = S.stats;
    if (!st) return;
    const idx = Number($<HTMLSelectElement>('ctxPlayer').value);
    const P = requireExp().players[idx] ?? requireExp().players[0];
    const ctx = st.context.find((c) => c.uid === P.uid);
    if (!ctx) return;
    const head = `<tr><th>状況</th>${ACTIONS.map((x) => `<th class="mono">${x}</th>`).join('')}<th>件数</th></tr>`;
    const body = CONTEXTS.map((c) => {
        const row = ctx.rows[c.key];
        const cells = ACTIONS.map((x) => {
            const p = row.total ? row.counts[x] / row.total : null;
            return `<td class="heat" style="${heat(p)}">${row.total ? pct(p) : '—'}</td>`;
        }).join('');
        return `<tr><td>${esc(c.label)}</td>${cells}<td class="num">${row.total}</td></tr>`;
    }).join('');
    $('tContext').innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
}
