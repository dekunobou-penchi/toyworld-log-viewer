import express, { type NextFunction, type Request, type Response } from 'express';
import compression from 'compression';
import { resolve } from 'node:path';
import type { ApiError } from '@viewer/shared';
import { config, hasFrontendBuild } from './config.js';
import { ExperimentStore } from './logs/store.js';
import { createApiRouter } from './routes.js';

const app = express();
const store = new ExperimentStore(config.dataDir);

// マップ全ティック分を返すのでレスポンスが大きい。gzip で 1/10 程度になる
app.use(compression());
app.use('/api', createApiRouter(config.dataDir, store));

if (hasFrontendBuild()) {
    app.use(express.static(config.frontendDist));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
        res.sendFile(resolve(config.frontendDist, 'index.html'));
    });
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[server]', err);
    const body: ApiError = { error: 'internal', message: 'ログの読み込み中にサーバでエラーが起きました。サーバのコンソールを確認してください。' };
    res.status(500).json(body);
});

app.listen(config.port, () => {
    console.log(`[viewer] data dir: ${config.dataDir}`);
    console.log(`[viewer] api:      http://localhost:${config.port}/api/experiments`);
    if (hasFrontendBuild()) console.log(`[viewer] ui:       http://localhost:${config.port}/`);
    else console.log('[viewer] フロントエンドは未ビルド。開発時は pnpm dev で Vite（http://localhost:5180、VIEWER_DEV_PORT で変更可）を使う');
});
