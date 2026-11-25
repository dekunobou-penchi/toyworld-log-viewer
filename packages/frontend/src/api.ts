import type { ApiError, Experiment, ExperimentListResponse, LifeResponse, StatsResponse } from '@viewer/shared';

export class ApiRequestError extends Error {}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
    let res: Response;
    try {
        res = await fetch(url, { signal });
    } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        throw new ApiRequestError('ログサーバに接続できません。pnpm dev（または pnpm start）でサーバが動いているか確認してください。');
    }
    if (!res.ok) {
        let msg = `${res.status} ${res.statusText}`;
        try {
            const body = (await res.json()) as ApiError;
            if (body.message) msg = body.message;
        } catch {
            /* JSON でないエラー本文は無視 */
        }
        throw new ApiRequestError(msg);
    }
    return (await res.json()) as T;
}

export const api = {
    list: () => getJson<ExperimentListResponse>('/api/experiments'),
    experiment: (id: string) => getJson<Experiment>(`/api/experiments/${encodeURIComponent(id)}`),
    stats: (id: string, from: number, to: number, signal?: AbortSignal) =>
        getJson<StatsResponse>(`/api/experiments/${encodeURIComponent(id)}/stats?from=${from}&to=${to}`, signal),
    life: (id: string, from: number, to: number, signal?: AbortSignal) =>
        getJson<LifeResponse>(`/api/experiments/${encodeURIComponent(id)}/life?from=${from}&to=${to}`, signal),
};
