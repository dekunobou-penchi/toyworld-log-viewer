/**
 * toyWorld 側のログ形式に対応する型。
 * toyWorld の packages/shared/src/domain.ts と同じ形を写している（依存はしない）。
 */

export type Direction = 'N' | 'E' | 'S' | 'W';

export const ACTIONS = ['N', 'E', 'S', 'W', 'forward', 'get', 'eat', 'put', 'fusion'] as const;
export type Action = (typeof ACTIONS)[number];

export interface Position {
    x: number;
    y: number;
}

export interface VisiblePlayer {
    name: string;
    dir: Direction;
    lp: number;
    hold: number;
}

/** 視界の1マス */
export interface ViewCell {
    x: number;
    y: number;
    block: number;
    player: VisiblePlayer | null;
}

export interface GameParams {
    tickIntervalSec: number;
    actionsPerTick: number;
    reconnectTimeoutSec: number;
    map: { nx: number; ny: number; blockMin: number; blockMax: number };
    player: { lpInitial: number; lpDecreasePerTick: number; viewRange: number };
    transition: 'person' | 'agent';
}

/** meta.json */
export interface MetaFile {
    experimentName?: string | null;
    params?: GameParams | null;
    energyTable?: number[] | null;
    fusionTable?: number[][] | null;
}

/** world.jsonl の players 要素（サーバの Player 型そのもの） */
export interface WorldPlayer {
    uid: string;
    profile?: { name?: string; age?: number; gender?: string; isAgent?: boolean };
    pos: Position;
    dir: Direction;
    lp: number;
    hold: number;
    Ltime: number;
    Ltmax: number;
    selectedAction: Action | null;
}

/** world.jsonl の1行 */
export interface WorldLine {
    map: { nx: number; ny: number; blockMax?: number; data: number[][] };
    players: WorldPlayer[];
}

/** player_{uid}.jsonl の1行 */
export interface PlayerLine {
    pos: Position;
    dir: Direction;
    lp: number;
    hold: number;
    action: Action | null;
    view: ViewCell[];
}
