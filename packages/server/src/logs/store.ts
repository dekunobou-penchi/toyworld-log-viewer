import type { Experiment } from '@viewer/shared';
import { buildExperiment } from './build.js';
import { readExperiment, resolveExperimentDir, worldStamp } from './reader.js';

interface Entry {
    key: string;
    exp: Experiment;
}

/**
 * 組み立て済みの実験をメモリに持つ。
 * world.jsonl の更新時刻とサイズが変わったら（実験が進んだら）読み直す。
 */
export class ExperimentStore {
    private cache = new Map<string, Entry>();
    private readonly limit = 8;

    constructor(private readonly dataDir: string) {}

    async get(id: string): Promise<Experiment | null> {
        const dir = resolveExperimentDir(this.dataDir, id);
        if (!dir) return null;
        const stamp = await worldStamp(dir);
        if (!stamp) return null;
        const key = `${stamp.mtimeMs}:${stamp.size}`;
        const hit = this.cache.get(id);
        if (hit && hit.key === key) {
            // LRU: 使ったものを末尾へ
            this.cache.delete(id);
            this.cache.set(id, hit);
            return hit.exp;
        }
        const raw = await readExperiment(this.dataDir, id);
        if (!raw) return null;
        const exp = buildExperiment(raw);
        this.cache.set(id, { key, exp });
        while (this.cache.size > this.limit) {
            const oldest = this.cache.keys().next().value;
            if (oldest === undefined) break;
            this.cache.delete(oldest);
        }
        return exp;
    }
}
