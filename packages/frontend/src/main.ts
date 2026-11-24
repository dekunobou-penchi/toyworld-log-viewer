import './styles.css';
import { api } from './api.js';
import { $, esc } from './dom.js';
import { S, requireExp } from './state.js';
import { hideTip } from './tooltip.js';
import {
    bindChartEvents,
    buildCharts,
    buildLegend,
    ensureVisible,
    isFullWindow,
    renderCursors,
    resetWindow,
    zoomBy,
    zoomReset,
} from './views/charts.js';
import { bindExportEvents, renderExportButtons } from './views/export.js';
import { bindDistEvents, buildDist, renderDistNow, renderDistRange } from './views/dist.js';
import { bindMapEvents, buildMap, renderMap } from './views/map.js';
import { renderExperimentSelect, renderMeta, showError } from './views/meta.js';
import { bindPlayerEvents, renderPlayers } from './views/players.js';
import { buildContextSelect, renderContext, renderRangeInputs, renderStats } from './views/stats.js';

/* ---------------- tick cursor ---------------- */

function seek(t: number): void {
    const E = requireExp();
    S.t = Math.max(0, Math.min(E.T - 1, t));
    $<HTMLInputElement>('slider').value = String(S.t);
    $('tickLabel').textContent = `tick ${S.t + 1} / ${E.T}`;
    // 入力中の値は上書きしない（打っている途中で再生が進んでも消えないように）
    if (document.activeElement !== $('dTick')) $<HTMLInputElement>('dTick').value = String(S.t + 1);
    renderMap();
    renderPlayers();
    renderCursors();
    renderDistNow();
    renderExportButtons();
    // 時系列を拡大しているときは、カーソルが範囲の外に出たら追いかける
    ensureVisible(S.t);
}

let raf = 0;
let last = 0;
let acc = 0;
function loop(ts: number): void {
    if (!S.playing || !S.exp) return;
    if (!last) last = ts;
    acc += ((ts - last) / 1000) * S.speed;
    last = ts;
    if (acc >= 1) {
        const step = Math.floor(acc);
        acc -= step;
        if (S.t + step >= S.exp.T - 1) {
            seek(S.exp.T - 1);
            stop();
            return;
        }
        seek(S.t + step);
    }
    raf = requestAnimationFrame(loop);
}

function setPlayButton(playing: boolean): void {
    for (const id of ['bPlay']) {
        const b = $(id);
        b.textContent = playing ? '❚❚' : '▶';
        b.title = playing ? '停止（Space）' : '再生（Space）';
        b.setAttribute('aria-label', playing ? '停止' : '再生');
    }
}

function play(): void {
    if (!S.exp) return;
    if (S.t >= S.exp.T - 1) seek(0);
    S.playing = true;
    last = 0;
    acc = 0;
    setPlayButton(true);
    raf = requestAnimationFrame(loop);
}

function stop(): void {
    S.playing = false;
    cancelAnimationFrame(raf);
    setPlayButton(false);
}

function pick(t: number): void {
    stop();
    seek(t);
}

function selectPlayer(idx: number): void {
    S.sel = idx;
    $<HTMLSelectElement>('ctxPlayer').value = String(idx);
    renderContext();
    renderMap();
    renderPlayers();
}

/* ---------------- data ---------------- */

let statsAbort: AbortController | null = null;
async function loadStats(): Promise<void> {
    const E = requireExp();
    statsAbort?.abort();
    const ctrl = new AbortController();
    statsAbort = ctrl;
    renderRangeInputs();
    renderExportButtons();
    $('statsGrid').classList.add('loading');
    $('distSec').classList.add('loading');
    try {
        S.stats = await api.stats(E.id, Math.min(S.from, S.to), Math.max(S.from, S.to), ctrl.signal);
        renderStats();
        renderDistRange();
    } catch (e) {
        if ((e as Error).name !== 'AbortError') showError(`集計を取得できませんでした: ${(e as Error).message}`);
    } finally {
        if (statsAbort === ctrl) {
            $('statsGrid').classList.remove('loading');
            $('distSec').classList.remove('loading');
        }
    }
}

function showEmpty(html: string): void {
    $('main').hidden = true;
    const empty = $('empty');
    empty.hidden = false;
    empty.innerHTML = html;
}

async function refreshList(): Promise<void> {
    const res = await api.list();
    S.list = res.experiments;
    $('dataDir').textContent = `データフォルダ: ${res.dataDir}`;
    renderExperimentSelect();
    if (!S.list.length) {
        showEmpty(
            `<p>データフォルダに実験がありません。<code>world.jsonl</code> を含む <code>exp_…</code> フォルダが必要です。</p>` +
                `<p class="muted">サーバを <code>DATA_DIR=/path/to/toyWorld/data/experiments pnpm dev</code> のように起動して、toyWorld のログフォルダを指定してください。</p>`,
        );
    }
}

/**
 * 実験を開く。keepView が true（同じ実験の再読み込み）なら、
 * 表示中のティック・選択・集計範囲を引き継ぐ。
 */
async function openExperiment(id: string, keepView = false): Promise<void> {
    const prev = S.exp;
    const wasAtEnd = prev ? S.to >= prev.T - 1 : true;
    const wasFull = prev ? isFullWindow() : true;
    stop();
    $('app').classList.add('loading');
    try {
        const exp = await api.experiment(id);
        S.exp = exp;
        if (!keepView || !prev || prev.id !== id) {
            S.t = 0;
            S.sel = 0;
            S.hidden = new Set();
            S.from = 0;
            S.to = exp.T - 1;
            resetWindow();
        } else {
            S.t = Math.min(S.t, exp.T - 1);
            S.sel = Math.min(S.sel, exp.players.length - 1);
            S.from = Math.min(S.from, exp.T - 1);
            S.to = wasAtEnd ? exp.T - 1 : Math.min(S.to, exp.T - 1);
            // 全期間を表示していたなら、追記されたティックまで広げる。拡大中なら範囲はそのまま
            if (wasFull) resetWindow();
        }
        try {
            history.replaceState(null, '', `#${encodeURIComponent(id)}`);
        } catch {
            /* 埋め込み表示などで URL を変えられない場合は無視 */
        }
        $('empty').hidden = true;
        $('main').hidden = false;
        $<HTMLInputElement>('slider').max = String(exp.T - 1);
        $<HTMLInputElement>('dTick').max = String(exp.T);
        $('dTotal').textContent = `/ ${exp.T}`;
        $<HTMLInputElement>('rFrom').max = String(exp.T);
        $<HTMLInputElement>('rTo').max = String(exp.T);
        renderExperimentSelect();
        renderMeta();
        buildMap();
        buildLegend();
        buildCharts(pick);
        buildContextSelect();
        buildDist();
        seek(S.t);
        await loadStats();
    } catch (e) {
        if (prev) showError((e as Error).message);
        else showEmpty(`<p class="err">${esc((e as Error).message)}</p>`);
    } finally {
        $('app').classList.remove('loading');
    }
}

/* ---------------- events ---------------- */

function bindEvents(): void {
    $<HTMLSelectElement>('expSelect').addEventListener('change', (e) => {
        void openExperiment((e.target as HTMLSelectElement).value);
    });
    $('reloadBtn').addEventListener('click', async () => {
        try {
            await refreshList();
            const id = S.exp?.id;
            if (id && S.list.some((x) => x.id === id)) await openExperiment(id, true);
            else if (S.list.length) await openExperiment(S.list[S.list.length - 1].id);
        } catch (e) {
            showError((e as Error).message);
        }
    });

    $('bPlay').addEventListener('click', () => (S.playing ? stop() : play()));
    $('bPrev').addEventListener('click', () => pick(S.t - 1));
    $('bNext').addEventListener('click', () => pick(S.t + 1));
    $('bStart').addEventListener('click', () => pick(0));
    $<HTMLInputElement>('slider').addEventListener('input', (e) => pick(Number((e.target as HTMLInputElement).value)));
    $<HTMLSelectElement>('speed').addEventListener('change', (e) => {
        S.speed = Number((e.target as HTMLSelectElement).value);
    });
    $('trail').addEventListener('change', renderMap);
    $('showView').addEventListener('change', renderMap);

    bindTickInput();
    bindTabs();
    bindMapEvents(selectPlayer);
    bindPlayerEvents(selectPlayer);
    bindChartEvents();
    bindDistEvents();
    bindExportEvents();

    $('legend').addEventListener('click', (e) => {
        const b = (e.target as Element).closest<HTMLElement>('[data-p]');
        if (!b?.dataset.p) return;
        const i = Number(b.dataset.p);
        if (S.hidden.has(i)) S.hidden.delete(i);
        else S.hidden.add(i);
        buildLegend();
        buildCharts(pick);
        renderCursors();
        renderMap();
    });

    const tickInput = (v: string) => Math.max(0, Math.min(requireExp().T - 1, (parseInt(v, 10) || 1) - 1));
    $<HTMLInputElement>('rFrom').addEventListener('change', (e) => {
        S.from = tickInput((e.target as HTMLInputElement).value);
        void loadStats();
    });
    $<HTMLInputElement>('rTo').addEventListener('change', (e) => {
        S.to = tickInput((e.target as HTMLInputElement).value);
        void loadStats();
    });
    $('rAll').addEventListener('click', () => {
        S.from = 0;
        S.to = requireExp().T - 1;
        void loadStats();
    });
    $('rUpTo').addEventListener('click', () => {
        S.from = 0;
        S.to = S.t;
        void loadStats();
    });
    $<HTMLSelectElement>('ctxPlayer').addEventListener('change', (e) => selectPlayer(Number((e.target as HTMLSelectElement).value)));

    document.addEventListener('keydown', (e) => {
        if (!S.exp || $('main').hidden) return;
        const target = e.target as HTMLElement;
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            pick(S.t + (e.shiftKey ? 10 : 1));
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            pick(S.t - (e.shiftKey ? 10 : 1));
        } else if (e.key === ' ' && tag !== 'BUTTON' && target.dataset.p == null) {
            e.preventDefault();
            if (S.playing) stop();
            else play();
        } else if ((e.key === '+' || e.key === '=' || e.key === ';') && !e.ctrlKey && !e.metaKey) {
            // 時系列の拡大縮小（現在のティックを中心に）。; は JIS 配列の + キー
            e.preventDefault();
            zoomBy(0.5);
        } else if (e.key === '-' && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            zoomBy(2);
        } else if (e.key === '0' && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            zoomReset();
        }
    });

    // 幅が変わったら時系列を描き直す
    let timer = 0;
    let lastW = 0;
    new ResizeObserver(() => {
        clearTimeout(timer);
        timer = window.setTimeout(() => {
            const w = $('charts').clientWidth;
            if (S.exp && !$('main').hidden && Math.abs(w - lastW) > 4) {
                lastW = w;
                buildCharts(pick);
                renderCursors();
                renderDistNow();
                renderDistRange();
            }
        }, 120);
    }).observe($('charts'));

    window.addEventListener('scroll', hideTip, { passive: true });
}

/* ---------------- ツールバーのティック入力 ---------------- */

function bindTickInput(): void {
    const dTick = $<HTMLInputElement>('dTick');
    const go = () => {
        const v = parseInt(dTick.value, 10);
        if (S.exp && Number.isFinite(v)) pick(v - 1);
        if (S.exp) dTick.value = String(S.t + 1);
    };
    dTick.addEventListener('change', go);
    dTick.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            go();
            dTick.select();
        } else if (e.key === 'Escape') {
            if (S.exp) dTick.value = String(S.t + 1);
            dTick.blur();
        }
    });
}

/* ---------------- タブ ---------------- */

const TAB_KEY = 'toyworld-viewer.tab';

function showTab(name: string): void {
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-tab]')];
    if (!tabs.some((b) => b.dataset.tab === name)) name = 'ts';
    for (const b of tabs) b.setAttribute('aria-selected', String(b.dataset.tab === name));
    for (const p of document.querySelectorAll<HTMLElement>('[data-panel]')) p.hidden = p.dataset.panel !== name;
    try {
        localStorage.setItem(TAB_KEY, name);
    } catch {
        /* 保存できなくても表示はできる */
    }
    if (!S.exp || $('main').hidden) return;
    // 隠れていた間は幅が測れないので、出したときに描き直す
    if (name === 'ts') {
        buildCharts(pick);
        renderCursors();
    } else if (name === 'dist') {
        renderDistNow();
        renderDistRange();
    }
}

function bindTabs(): void {
    const list = document.querySelector<HTMLElement>('.tabs')!;
    list.addEventListener('click', (e) => {
        const b = (e.target as Element).closest<HTMLElement>('[data-tab]');
        if (b) showTab(b.dataset.tab!);
    });
    // ← → でタブを移動（タブにフォーカスがあるとき）
    list.addEventListener('keydown', (e) => {
        const tabs = [...list.querySelectorAll<HTMLButtonElement>('[data-tab]')];
        const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
        if (i < 0 || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
        e.preventDefault();
        e.stopPropagation();
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        next.focus();
        showTab(next.dataset.tab!);
    });
    let saved = 'ts';
    try {
        saved = localStorage.getItem(TAB_KEY) ?? 'ts';
    } catch {
        /* 読めなければ時系列 */
    }
    showTab(saved);
}

async function init(): Promise<void> {
    bindEvents();
    try {
        await refreshList();
    } catch (e) {
        showEmpty(`<p class="err">${esc((e as Error).message)}</p>`);
        return;
    }
    if (!S.list.length) return;
    const fromHash = decodeURIComponent(location.hash.slice(1));
    const id = S.list.some((x) => x.id === fromHash) ? fromHash : S.list[S.list.length - 1].id;
    await openExperiment(id);
}

void init();
