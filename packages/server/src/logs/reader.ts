import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { ExperimentSummary, MetaFile } from '@viewer/shared';

/** 1つの実験フォルダの生ファイル */
export interface RawExperiment {
    id: string;
    meta: string | null;
    world: string;
    /** uid -> player_{uid}.jsonl の中身 */
    players: Record<string, string>;
}

const ID_PATTERN = /^[\w.\-]+$/;
const PLAYER_FILE = /^player_(.+)\.jsonl$/;

/** URL から来た実験IDを検証し、dataDir 配下の実パスを返す（ディレクトリトラバーサル対策） */
export function resolveExperimentDir(dataDir: string, id: string): string | null {
    if (!ID_PATTERN.test(id) || id === '.' || id === '..') return null;
    const dir = resolve(dataDir, id);
    if (!dir.startsWith(resolve(dataDir) + sep)) return null;
    return dir;
}

async function readOptional(path: string): Promise<string | null> {
    try {
        return await readFile(path, 'utf8');
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
    }
}

/** world.jsonl の更新時刻とサイズ。キャッシュの鍵に使う（実験中は追記されていくため） */
export async function worldStamp(dir: string): Promise<{ mtimeMs: number; size: number } | null> {
    try {
        const s = await stat(join(dir, 'world.jsonl'));
        return { mtimeMs: s.mtimeMs, size: s.size };
    } catch {
        return null;
    }
}

export async function readExperiment(dataDir: string, id: string): Promise<RawExperiment | null> {
    const dir = resolveExperimentDir(dataDir, id);
    if (!dir) return null;
    const world = await readOptional(join(dir, 'world.jsonl'));
    if (world === null) return null;
    const meta = await readOptional(join(dir, 'meta.json'));
    const players: Record<string, string> = {};
    for (const name of await readdir(dir)) {
        const m = name.match(PLAYER_FILE);
        if (m) players[m[1]] = await readFile(join(dir, name), 'utf8');
    }
    return { id, meta, world, players };
}

function countLines(text: string): number {
    let n = 0;
    let lineHasContent = false;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c === 10) {
            if (lineHasContent) n++;
            lineHasContent = false;
        } else if (c !== 13 && c !== 32) {
            lineHasContent = true;
        }
    }
    return lineHasContent ? n + 1 : n;
}

/** dataDir 直下で world.jsonl を持つフォルダを実験として列挙する */
export async function listExperiments(dataDir: string): Promise<ExperimentSummary[]> {
    let entries;
    try {
        entries = await readdir(dataDir, { withFileTypes: true });
    } catch {
        return [];
    }
    const out: ExperimentSummary[] = [];
    for (const e of entries) {
        if (!e.isDirectory() || !ID_PATTERN.test(e.name)) continue;
        const dir = join(dataDir, e.name);
        const stamp = await worldStamp(dir);
        if (!stamp) continue;
        const files = await readdir(dir);
        let meta: MetaFile | null = null;
        try {
            const text = await readOptional(join(dir, 'meta.json'));
            meta = text ? (JSON.parse(text) as MetaFile) : null;
        } catch {
            meta = null;
        }
        const world = await readFile(join(dir, 'world.jsonl'), 'utf8');
        out.push({
            id: e.name,
            title: meta?.experimentName ?? e.name,
            ticks: countLines(world),
            playerFiles: files.filter((f) => PLAYER_FILE.test(f)).length,
            nx: meta?.params?.map.nx ?? null,
            ny: meta?.params?.map.ny ?? null,
            transition: meta?.params?.transition ?? null,
            updatedAt: stamp.mtimeMs,
        });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
}
