import type { GameMap, Solid } from '../types';

const S = 200;
const wall = (x: number, y: number, w: number, h: number): Solid => ({ x, y, w, h, kind: 'wall' });
const lights = [25, 50, 75, 100, 125, 150, 175].flatMap((x) =>
  [25, 50, 75, 100, 125, 150, 175].map((y) => ({ x, y })),
);

/** Open concrete slab, perimeter walls only. Free roam: the finish zone is unreachable. */
export const testpad: GameMap = {
  name: 'TEST PAD',
  parTime: 0,
  floors: [
    {
      name: 'TEST PAD',
      w: S,
      h: S,
      solids: [
        wall(0, 0, S, 1),
        wall(0, S - 1, S, 1),
        wall(0, 1, 1, S - 2),
        wall(S - 1, 1, 1, S - 2),
      ],
      bays: [],
      lights,
      circles: [],
    },
  ],
  helixes: [],
  start: { floor: 0, pos: { x: 100, y: 100 }, angle: 0 },
  finish: { floor: -1, zone: { x: 0, y: 0, w: 0, h: 0 } },
};
