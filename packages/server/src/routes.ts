import { Router, type Response } from 'express';
import type { ApiError, ExperimentListResponse } from '@viewer/shared';
import { LogFormatError } from './logs/build.js';
import { listExperiments } from './logs/reader.js';
import { computeStats } from './logs/stats.js';
import { computeLifeStats } from './logs/life.js';
import { EXPORT_KINDS, ExportUnavailableError, exportData, type ExportKind } from './logs/export.js';
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

    // 生存時間の分布だけを任意の範囲で（集計範囲とは別に指定できる）。from / to は 0 始まり、両端含む
    router.get('/experiments/:id/life', async (req, res) => {
        try {
            const exp = await store.get(req.params.id);
            if (!exp) return fail(res, 404, 'not_found', `実験 ${req.params.id} が見つかりません。`);
            const from = req.query.from === undefined ? 0 : Number(req.query.from);
            const to = req.query.to === undefined ? exp.T - 1 : Number(req.query.to);
            if (!Number.isFinite(from) || !Number.isFinite(to)) {
                return fail(res, 400, 'bad_range', 'from と to は数値で指定してください（0 始まりのティック）。');
            }
            const clamp = (v: number) => Math.max(0, Math.min(exp.T - 1, Math.trunc(v)));
            const lo = clamp(Math.min(from, to)), hi = clamp(Math.max(from, to));
            res.json({ from: lo, to: hi, ...computeLifeStats(exp, lo, hi) });
        } catch (e) {
            if (e instanceof LogFormatError) return fail(res, 422, 'bad_log', e.message);
            throw e;
        }
    });

    // データの書き出し。kind は EXPORT_KINDS のどれか。from / to / t は 0 始まり
    router.get('/experiments/:id/export/:kind', async (req, res) => {
        try {
            const kind = req.params.kind as ExportKind;
            if (!EXPORT_KINDS.includes(kind)) return fail(res, 400, 'bad_kind', `kind は ${EXPORT_KINDS.join(' / ')} のどれかです。`);
            const exp = await store.get(req.params.id);
            if (!exp) return fail(res, 404, 'not_found', `実験 ${req.params.id} が見つかりません。`);
            const num = (v: unknown, d: number) => (v === undefined ? d : Number(v));
            const from = num(req.query.from, 0), to = num(req.query.to, exp.T - 1), t = num(req.query.t, 0);
            if (![from, to, t].every(Number.isFinite)) return fail(res, 400, 'bad_range', 'from / to / t は数値で指定してください（0 始まりのティック）。');
            const bin = req.query.bin === undefined ? 0 : Number(req.query.bin);
            // 生存時間の範囲（まとめての JSON 用。省略なら集計範囲と同じ）
            const lfrom = req.query.lfrom === undefined ? undefined : Number(req.query.lfrom);
            const lto = req.query.lto === undefined ? undefined : Number(req.query.lto);
            const out = exportData(exp, kind, {
                from, to, t, bin: Number.isFinite(bin) ? bin : 0,
                lifeFrom: Number.isFinite(lfrom) ? lfrom : undefined,
                lifeTo: Number.isFinite(lto) ? lto : undefined,
            });
            res.attachment(out.filename);
            res.type(out.contentType);
            res.send(out.body);
        } catch (e) {
            if (e instanceof ExportUnavailableError) return fail(res, 409, 'unavailable', e.message);
            if (e instanceof LogFormatError) return fail(res, 422, 'bad_log', e.message);
            throw e;
        }
    });

    return router;
}
