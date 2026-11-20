import { DIR_VEC, type Direction, type ViewCell, type WorldPlayer } from '@viewer/shared';

/**
 * toyWorld の packages/server/src/game/view.ts と同じ規則で視界を計算する。
 * 向いている方向に range マスまで。他プレイヤーがいたらそこで遮られる。
 * プレイヤーログが無い・対応が取れないときの代わりに使う。
 */
export function computeView(
    map: number[][],
    nx: number,
    ny: number,
    players: WorldPlayer[],
    selfUid: string,
    x: number,
    y: number,
    dir: Direction,
    range: number,
): ViewCell[] {
    const v = DIR_VEC[dir];
    if (!v) return [];
    const cells: ViewCell[] = [];
    for (let i = 1; i <= range; i++) {
        const cx = (((x + v[0] * i) % nx) + nx) % nx;
        const cy = (((y + v[1] * i) % ny) + ny) % ny;
        const other = players.find((q) => q.uid !== selfUid && q.pos.x === cx && q.pos.y === cy);
        if (other) {
            cells.push({
                x: cx,
                y: cy,
                block: map[cy][cx],
                player: { name: other.profile?.name ?? other.uid.slice(0, 6), dir: other.dir, lp: other.lp, hold: other.hold },
            });
            break;
        }
        cells.push({ x: cx, y: cy, block: map[cy][cx], player: null });
    }
    return cells;
}
