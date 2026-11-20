import { Router, type Response } from 'express';
import type { ApiError, ExperimentListResponse } from '@viewer/shared';
import { LogFormatError } from './logs/build.js';
import { listExperiments } from './logs/reader.js';
import { computeStats } from './logs/stats.js';
import type { ExperimentStore } from './logs/store.js';

function fail(res: Response, status: number, error: string, message: string): void {
    const body: ApiError = { error, message };
    res.status(status).json(body);
}

export function createApiRouter(dataDir: string, store: ExperimentStore): Router {
    const router = Router();

    router.get('/experiments', async (_req, res) => {
        const body: ExperimentListResponse = { dataDir, experiments: await listExperiments(dataDir) };
        res.json(body);
    });

    router.get('/experiments/:id', async (req, res) => {
        try {
            const exp = await store.get(req.params.id);
            if (!exp) return fail(res, 404, 'not_found', `実験 ${req.params.id} が見つかりません（world.jsonl がない、または ID が不正）。`);
            res.json(exp);
        } catch (e) {
            if (e instanceof LogFormatError) return fail(res, 422, 'bad_log', e.message);
            throw e;
        }
    });

    router.get('/experiments/:id/stats', async (req, res) => {
        try {
            const exp = await store.get(req.params.id);
            if (!exp) return fail(res, 404, 'not_found', `実験 ${req.params.id} が見つかりません。`);
            const from = req.query.from === undefined ? 0 : Number(req.query.from);
            const to = req.query.to === undefined ? exp.T - 1 : Number(req.query.to);
            if (!Number.isFinite(from) || !Number.isFinite(to)) {
                return fail(res, 400, 'bad_range', 'from と to は数値で指定してください（0 始まりのティック）。');
            }
            res.json(computeStats(exp, from, to));
        } catch (e) {
            if (e instanceof LogFormatError) return fail(res, 422, 'bad_log', e.message);
            throw e;
        }
    });

    return router;
}
