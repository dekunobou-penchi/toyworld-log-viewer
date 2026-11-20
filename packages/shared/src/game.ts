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

/** meta.json の runtime の1項目（フックに差したルールとそのパラメータ） */
export interface RuleSelection {
    rule: string;
    params?: Record<string, unknown>;
}

/** meta.json の ruleFile（ビューアが使うところだけ） */
export interface RuleFileMeta {
    constants?: { N?: number; nx?: number; ny?: number; seed?: number };
    /** 生成ルールで作った表や分布。baked が実際の値 */
    artifacts?: Record<string, { baked?: unknown } | undefined>;
}

/** meta.json */
export interface MetaFile {
    experimentName?: string | null;
    params?: GameParams | null;
    energyTable?: number[] | null;
    fusionTable?: number[][] | null;
    ruleFile?: RuleFileMeta | null;
    runtime?: Partial<Record<string, RuleSelection>> | null;
}

/**
 * events.jsonl の1行。tick は toyWorld の world.tick（行動を適用したときの値、1 始まり）。
 * world.jsonl の行 k（0 始まり）の行動で起きたことは tick = k + 1 で記録される。
 */
export interface EventLine {
    tick: number;
    kind: string;
    cause?: string;
    x?: number;
    y?: number;
    /** 補充されたブロック */
    block?: number;
    /** 取られた（消えた）ブロック */
    taken?: number;
    by?: string;
    [key: string]: unknown;
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
