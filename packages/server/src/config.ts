import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

/** リポジトリのルート（packages/server/src から3つ上） */
const repoRoot = resolve(here, '..', '..', '..');

export const config = {
    port: Number(process.env.PORT ?? 3200),
    /**
     * 実験フォルダ（exp_…）が並んでいるディレクトリ。
     * toyWorld のログを見るなら DATA_DIR=/path/to/toyWorld/data/experiments を指定する。
     */
    dataDir: resolve(process.env.DATA_DIR ?? resolve(repoRoot, 'sample-data')),
    /** ビルド済みフロントエンド。あれば同じポートで配信する */
    frontendDist: resolve(repoRoot, 'packages', 'frontend', 'dist'),
};

export function hasFrontendBuild(): boolean {
    return existsSync(resolve(config.frontendDist, 'index.html'));
}
