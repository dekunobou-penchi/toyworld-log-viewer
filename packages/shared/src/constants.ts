import type { Action, Direction } from './game.js';

export const DIR_VEC: Record<Direction, readonly [number, number]> = {
    N: [0, -1],
    E: [1, 0],
    S: [0, 1],
    W: [-1, 0],
};

/** タイムライン用に行動をまとめたグループ。並び順が色のスロット順になる */
export const ACTION_GROUPS = [
    { key: 'turn', label: 'N/E/S/W', acts: ['N', 'E', 'S', 'W'] },
    { key: 'forward', label: 'forward', acts: ['forward'] },
    { key: 'get', label: 'get', acts: ['get'] },
    { key: 'eat', label: 'eat', acts: ['eat'] },
    { key: 'put', label: 'put', acts: ['put'] },
    { key: 'fusion', label: 'fusion', acts: ['fusion'] },
] as const satisfies readonly { key: string; label: string; acts: readonly Action[] }[];

export const GROUP_OF: Record<Action, number> = Object.fromEntries(
    ACTION_GROUPS.flatMap((g, i) => g.acts.map((a) => [a, i] as const)),
) as Record<Action, number>;

/** 行動を選んだ時点の状況（正面1マス × 手持ち） */
export const CONTEXTS = [
    { key: 'empty-0', label: '正面: 空き (0)・手ぶら' },
    { key: 'empty-1', label: '正面: 空き (0)・保持中' },
    { key: 'block-0', label: '正面: ブロック・手ぶら' },
    { key: 'block-1', label: '正面: ブロック・保持中' },
    { key: 'player-0', label: '正面: プレイヤー・手ぶら' },
    { key: 'player-1', label: '正面: プレイヤー・保持中' },
] as const;

export type ContextKey = (typeof CONTEXTS)[number]['key'];
