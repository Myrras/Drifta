import type { Floor, GameMap, Rect, Solid, Vec } from '../types';

const W = 120;
const H = 70;
const BAY_W = 2.5;
const BAY_D = 5;
const CAR_W = 1.8;
const CAR_L = 4.2;

// Lane centers (y): A north, B middle, C south. Islands sit between them.
const LANE_A = 12.5;
const LANE_B = 35;
const LANE_C = 57.5;

// Start/arrival corner (east, lane A) and ramp/exit corner (west, lane C) stay free of bays and cars.
const KEEP_CLEAR: Rect[] = [
  { x: 100, y: 6, w: 19, h: 13 },
  { x: 1, y: 51, w: 20, h: 13 },
];

const hits = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const free = (r: Rect) => !KEEP_CLEAR.some((k) => hits(r, k));

/** Row of n painted bays; every 4th (offset by salt) holds a parked car, offset dy from the bay's top edge. */
function bayRow(x0: number, y: number, n: number, dy: number, salt: number) {
  const bays: Rect[] = [];
  const cars: Solid[] = [];
  for (let i = 0; i < n; i++) {
    const bay = { x: x0 + i * BAY_W, y, w: BAY_W, h: BAY_D };
    if (!free(bay)) continue;
    bays.push(bay);
    if ((i * 5 + salt) % 4 === 0) {
      cars.push({ kind: 'car', x: bay.x + (BAY_W - CAR_W) / 2, y: y + dy, w: CAR_W, h: CAR_L });
    }
  }
  return { bays, cars };
}

/** Square solids along the horizontal line y, every `step` m starting at x0, kept inside the walls. */
function pillarRow(x0: number, y: number, x1: number, step: number, size: number): Solid[] {
  const out: Solid[] = [];
  for (let x = x0; x <= x1; x += step) {
    if (x - size / 2 >= 1 && x + size / 2 <= W - 1) {
      out.push({ kind: 'pillar', x: x - size / 2, y: y - size / 2, w: size, h: size });
    }
  }
  return out;
}

/** A double-sided island: bays facing north and south around a pillar line at y + BAY_D. */
function island(x0: number, y: number, n: number, salt: number, pillars: [number, number]) {
  const north = bayRow(x0, y, n, 0.2, salt);
  const south = bayRow(x0, y + BAY_D, n, 0.6, salt + 2);
  const [step, size] = pillars;
  return {
    bays: [...north.bays, ...south.bays],
    solids: [...north.cars, ...south.cars, ...pillarRow(x0, y + BAY_D, x0 + n * BAY_W, step, size)],
  };
}

function lights(): Vec[] {
  const out: Vec[] = [];
  for (const y of [LANE_A, LANE_B, LANE_C]) for (let x = 8; x < W - 4; x += 12) out.push({ x, y });
  return out;
}

function buildFloor(
  name: string,
  salt: number,
  pillars: [number, number],
  opts: { exitGap?: boolean; ramps: Floor['ramps'] },
): Floor {
  const wallN = bayRow(2, 1, 46, 0.4, salt);
  const wallS = bayRow(2, 64, 46, 0.4, salt + 1);
  const isl1 = island(21.5, 19, 39, salt + 1, pillars); // touches east wall, west U-turn
  const isl2 = island(1, 41, 38, salt + 3, pillars); // touches west wall, east U-turn
  const wall = (x: number, y: number, w: number, h: number): Solid => ({
    kind: 'wall',
    x,
    y,
    w,
    h,
  });
  const walls = [
    wall(0, 0, W, 1),
    wall(0, H - 1, W, 1),
    wall(W - 1, 1, 1, H - 2),
    ...(opts.exitGap ? [wall(0, 1, 1, 53), wall(0, 61, 1, 8)] : [wall(0, 1, 1, H - 2)]),
  ];
  return {
    name,
    w: W,
    h: H,
    solids: [...walls, ...wallN.cars, ...wallS.cars, ...isl1.solids, ...isl2.solids].filter(
      (s) => s.kind === 'wall' || free(s),
    ),
    bays: [...wallN.bays, ...wallS.bays, ...isl1.bays, ...isl2.bays],
    lights: lights(),
    ramps: opts.ramps,
    circles: [],
  };
}

// Roof: no pillars, a few light posts. Route: start east lane A, west, U-turn, east lane B,
// U-turn, west lane C, ramp at the west end. Level 2 runs it reversed; ground runs it like the roof.
export const garage: GameMap = {
  name: 'Parking Garage',
  parTime: 60,
  floors: [
    buildFloor('ROOF', 0, [30, 0.6], {
      ramps: [
        {
          zone: { x: 2, y: 51, w: 10, h: 13 },
          toFloor: 1,
          spawn: { pos: { x: 14, y: LANE_C }, angle: 0 },
        },
      ],
    }),
    buildFloor('LEVEL 2', 1, [7.5, 1], {
      ramps: [
        {
          zone: { x: 108, y: 6, w: 10, h: 13 },
          toFloor: 2,
          spawn: { pos: { x: 106, y: LANE_A }, angle: Math.PI },
        },
      ],
    }),
    buildFloor('GROUND', 2, [7.5, 1], { exitGap: true, ramps: [] }),
  ],
  helixes: [],
  start: { floor: 0, pos: { x: 112, y: LANE_A }, angle: Math.PI },
  finish: { floor: 2, zone: { x: 2, y: 54.5, w: 10, h: 6 } },
};
