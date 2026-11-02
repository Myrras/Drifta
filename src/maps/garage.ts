import { CAR_MODELS } from '../models';
import type { CarModel, Floor, GameMap, Helix, Rect, Solid, Vec } from '../types';

const W = 140;
const H = 80;
const BAY_W = 2.5;
const BAY_D = 5;
const R_CORE = 6;
const R_OUTER = 16;
const R_MID = (R_CORE + R_OUTER) / 2;
const PI = Math.PI;

// Helix 0 (NW): enter at the north point driving west, around the west side (ccw), out east.
// Helix 1 (SE): enter at the east point driving south, around the south side (cw), out north.
const helixes: Helix[] = [
  {
    from: 0,
    center: { x: 17, y: 17 },
    rCore: R_CORE,
    rOuter: R_OUTER,
    enterAngle: -PI / 2,
    sweep: -PI,
  },
  { from: 1, center: { x: 123, y: 63 }, rCore: R_CORE, rOuter: R_OUTER, enterAngle: 0, sweep: PI },
];
const [H0, H1] = helixes;

const polar = (h: Helix, a: number, r = R_MID): Vec => ({
  x: h.center.x + r * Math.cos(a),
  y: h.center.y + r * Math.sin(a),
});

/** Mid-radius centerline of a helix from progress t0 to t1 (0..1). */
function arc(h: Helix, t0: number, t1: number): Vec[] {
  return Array.from({ length: 7 }, (_, i) =>
    polar(h, h.enterAngle + h.sweep * (t0 + ((t1 - t0) * i) / 6)),
  );
}

const v = (x: number, y: number): Vec => ({ x, y });

/** Hand-written driving line per floor; each helix half circle switches floor at its midpoint. */
export const garageRoute: { floor: number; points: Vec[] }[] = [
  {
    floor: 0,
    points: [
      v(10, 58),
      v(26, 66),
      v(42, 67),
      v(52, 58),
      v(62, 48),
      v(78, 47),
      v(88, 56),
      v(96, 66),
      v(112, 67),
      v(124, 58),
      v(127, 44),
      v(125, 32),
      v(114, 26.5),
      v(98, 26.5),
      v(82, 26.5),
      v(72, 18),
      v(64, 9.5),
      v(46, 9),
      v(30, 6),
      ...arc(H0, 0, 0.5),
    ],
  },
  {
    floor: 1,
    points: [
      ...arc(H0, 0.5, 1),
      v(26, 29),
      v(32, 38),
      v(34, 50),
      v(37, 61),
      v(46, 68),
      v(70, 67),
      v(76, 60),
      v(78, 52),
      v(86, 46),
      v(97, 40),
      v(99, 30),
      v(106, 17),
      v(120, 10),
      v(130, 16),
      v(134, 28),
      ...arc(H1, 0, 0.5),
    ],
  },
  {
    floor: 2,
    points: [
      ...arc(H1, 0.5, 1),
      v(112, 50),
      v(84, 50),
      v(80, 41),
      v(76, 33),
      v(60, 32),
      v(50, 33),
      v(46.5, 41),
      v(43, 49),
      v(34, 50),
      v(22, 50),
      v(16, 43),
      v(15, 30),
      v(16, 20),
      v(24, 13),
      v(36, 12),
      v(134, 12),
    ],
  },
];

const wall = (x: number, y: number, w: number, h: number): Solid => ({ kind: 'wall', x, y, w, h });
const pillar = (cx: number, cy: number, size = 1): Solid => ({
  kind: 'pillar',
  x: cx - size / 2,
  y: cy - size / 2,
  w: size,
  h: size,
});
const post = (cx: number, cy: number) => pillar(cx, cy, 0.6);

/** Clip a rect to the inside of the perimeter walls; null if nothing is left. */
function clip(r: Solid): Solid | null {
  const x0 = Math.max(r.x, 1);
  const y0 = Math.max(r.y, 1);
  const x1 = Math.min(r.x + r.w, W - 1);
  const y1 = Math.min(r.y + r.h, H - 1);
  return x1 > x0 && y1 > y0 ? { ...r, x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Perimeter walls; `gap` opens the east wall between y0 and y1 (exit gate). */
function perimeter(gap?: [number, number]): Solid[] {
  const east = gap
    ? [wall(W - 1, 1, 1, gap[0] - 1), wall(W - 1, gap[1], 1, H - 1 - gap[1])]
    : [wall(W - 1, 1, 1, H - 2)];
  return [wall(0, 0, W, 1), wall(0, H - 1, W, 1), wall(0, 1, 1, H - 2), ...east];
}

/**
 * Walls that make a helix one-way: a separator from the core outward between the two tangent
 * lanes, a block across the closed lane (exit lane on `from`, entry lane on `from + 1`) and
 * outer guards so the ring can't be entered across its rim. Local frame: u along the separator,
 * v across it.
 */
// shortcut: the separator must be axis-aligned (helix entered at a N/E/S/W point); fine for corner helixes.
function helixGuards(h: Helix, onFrom: boolean): Solid[] {
  const a = h.enterAngle - h.sweep / 2;
  const U = { x: Math.round(Math.cos(a)), y: Math.round(Math.sin(a)) };
  const V = { x: -U.y, y: U.x };
  const e = polar(h, h.enterAngle);
  const sEntry = Math.sign((e.x - h.center.x) * V.x + (e.y - h.center.y) * V.y);
  const s = onFrom ? -sEntry : sEntry;
  const R = h.rOuter;
  const at = (u: number, w: number) => ({
    x: h.center.x + U.x * u + V.x * w,
    y: h.center.y + U.y * u + V.y * w,
  });
  const box = (u0: number, u1: number, w0: number, w1: number) => {
    const p = at(u0, w0);
    const q = at(u1, w1);
    return clip(
      wall(Math.min(p.x, q.x), Math.min(p.y, q.y), Math.abs(q.x - p.x), Math.abs(q.y - p.y)),
    );
  };
  return [
    box(h.rCore - 0.5, R + 2.5, -0.5, 0.5),
    box(R + 1.5, R + 2.5, 0, s * (R + 1.2)),
    box(-(R + 2), R + 2.5, s * (R + 0.2), s * (R + 1.2)),
    box(-(R + 2), 1, -s * (R + 0.2), -s * (R + 1.2)),
  ].filter((b): b is Solid => b !== null);
}

/** Direction from a bay to its aisle, as a heading (0 = +x, y down). */
type Dir = 'N' | 'E' | 'S' | 'W';
const HEADING: Record<Dir, number> = { E: 0, S: PI / 2, W: PI, N: -PI / 2 };
type Bay = Rect & { open: Dir };
type Layout = { bays: Bay[]; solids: Solid[] };

/**
 * n bays side by side from (x, y), opening onto the aisle at `open` (N/S: 2.5 wide x 5 deep,
 * E/W: 5 x 2.5). Every `slot` bays a 1 m gap holds a structural pillar on the back line, moved
 * `inset` toward the aisle (0.5 against a wall).
 */
function row(x: number, y: number, n: number, open: Dir, slot = 0, inset = 0): Layout {
  const alongX = open === 'N' || open === 'S';
  const back = { N: y + BAY_D - inset, S: y + inset, W: x + BAY_D - inset, E: x + inset }[open];
  const bays: Bay[] = [];
  const solids: Solid[] = [];
  let pos = alongX ? x : y;
  for (let i = 0; i < n; i++) {
    if (slot && i > 0 && i % slot === 0) {
      solids.push(alongX ? pillar(pos + 0.5, back) : pillar(back, pos + 0.5));
      pos += 1;
    }
    bays.push(
      alongX ? { x: pos, y, w: BAY_W, h: BAY_D, open } : { x, y: pos, w: BAY_D, h: BAY_W, open },
    );
    pos += BAY_W;
  }
  return { bays, solids };
}

/** Back-to-back rows (10 m deep) sharing one pillar line: N/S rows if `alongX`, else W/E rows. */
function pair(x: number, y: number, n: number, slot = 0, alongX = true): Layout {
  const a = row(x, y, n, alongX ? 'N' : 'W', slot);
  const b = alongX ? row(x, y + BAY_D, n, 'S', slot) : row(x + BAY_D, y, n, 'E', slot);
  return { bays: [...a.bays, ...b.bays], solids: a.solids };
}

const segDist = (p: Vec, a: Vec, b: Vec) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
const routeDist = (p: Vec, pts: Vec[]) =>
  Math.min(...pts.slice(1).map((b, i) => segDist(p, pts[i], b)));
const routeLength = (pts: Vec[]) =>
  pts.slice(1).reduce((sum, b, i) => sum + Math.hypot(b.x - pts[i].x, b.y - pts[i].y), 0);
const inRect = (p: Vec, r: Rect) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;

/** Light points every 18 m along a polyline. */
function lightsAlong(pts: Vec[]): Vec[] {
  const out: Vec[] = [];
  let d = 6;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    for (; d <= len; d += 18)
      out.push(v(a.x + ((b.x - a.x) * d) / len, a.y + ((b.y - a.y) * d) / len));
    d -= len;
  }
  return out;
}

/** Deterministic PRNG (mulberry32), 0..1. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MODELS = Object.keys(CAR_MODELS) as CarModel[];

/**
 * Fill ~half the bays with JDM cars, centered, reverse-parked (nose to the aisle) or nose-in.
 * Reverse-parked cars facing the route's aisle may have headlights on; a few blink hazards.
 */
function park(bays: Bay[], route: Vec[], solids: Solid[], rand: () => number): Solid[] {
  const cars: Solid[] = [];
  for (const b of bays) {
    if (rand() >= 0.5) continue;
    const model = MODELS[Math.floor(rand() * MODELS.length)];
    const { length, width, colors } = CAR_MODELS[model];
    const color = colors[Math.floor(rand() * colors.length)];
    const reverse = rand() < 0.6;
    const facing = HEADING[b.open] + (reverse ? 0 : PI);
    const dx = Math.round(Math.cos(facing));
    const dy = Math.round(Math.sin(facing));
    const w = dx ? length : width;
    const h = dx ? width : length;
    const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const at = (d: number) => v(c.x + dx * (length / 2 + d), c.y + dy * (length / 2 + d));
    const lit =
      reverse &&
      routeDist(at(4), route) < 7 &&
      !solids.some((s) => inRect(at(6), s)) &&
      rand() < 0.9;
    const lights = lit ? 'on' : rand() < 0.05 ? 'hazard' : undefined;
    cars.push({
      kind: 'car',
      x: c.x - w / 2,
      y: c.y - h / 2,
      w,
      h,
      model,
      color,
      facing,
      ...(lights && { lights }),
    });
  }
  return cars;
}

function floor(name: string, idx: number, layouts: Layout[], gap?: [number, number]): Floor {
  const joined = helixes.filter((h) => h.from === idx || h.from + 1 === idx);
  const bays = layouts.flatMap((l) => l.bays);
  const solids = [
    ...perimeter(gap),
    ...joined.flatMap((h) => helixGuards(h, h.from === idx)),
    ...layouts.flatMap((l) => l.solids),
  ];
  const route = garageRoute[idx].points;
  return {
    name,
    w: W,
    h: H,
    solids: [...solids, ...park(bays, route, solids, rng(idx * 101 + 7))],
    bays: bays.map(({ x, y, w, h }) => ({ x, y, w, h })),
    lights: lightsAlong(route),
    circles: joined.map((h) => ({ ...h.center, r: h.rCore })),
  };
}

const solid = (...solids: Solid[]): Layout => ({ bays: [], solids });

// ROOF: open deck. A parking spine (in line with the helix guard) splits it: east along the south
// in wide S-curves around staggered islands, up the east side, west along the north into helix 0.
const roof = floor('ROOF', 0, [
  pair(38, 30, 26),
  solid(wall(103.5, 31, 8, 10)), // stair/elevator housing
  row(1, 37, 6, 'E'),
  row(1, 66, 5, 'E'),
  row(14, 74, 46, 'N'),
  pair(30, 49, 6),
  pair(60, 56, 7),
  pair(97, 49, 6),
  row(134, 18, 18, 'W'),
  row(86, 1, 14, 'S'),
  pair(84, 13, 8),
  pair(44, 13, 7),
  solid(
    wall(116, 44, 3, 6), // planters
    wall(44, 1, 14, 1.5),
    wall(18, 40, 1.5, 6),
    post(20, 52),
    post(118, 72),
    post(126, 10),
  ),
]);

// LEVEL 2: three double-loaded modules with staggered ends; the route drops down the west
// cross-aisle, runs the south aisle, then climbs past each module end through a pillar chicane.
const level2 = floor('LEVEL 2', 1, [
  row(38, 1, 33, 'S', 6, 0.5),
  pair(40, 14, 22, 6),
  pair(40, 32, 16, 6),
  pair(44, 52, 10, 6),
  pair(82, 52, 8, 6),
  row(22, 74, 33, 'N', 6, 0.5),
  row(1, 36, 14, 'E', 6, 0.5),
  pair(14, 40, 11, 6, false),
  solid(pillar(90, 37), pillar(92.5, 37), pillar(104, 34), pillar(106.5, 34)),
]);

// GROUND: long modules on a 16 m pillar grid; tight lines weaving between the two middle aisles
// through cross-aisles, up the west side, then a straight sprint east to the exit gate.
const ground = floor(
  'GROUND',
  2,
  [
    row(2, 1, 50, 'S', 6, 0.5),
    pair(28, 18, 38, 6),
    pair(24, 36, 6),
    pair(54, 36, 7, 6),
    pair(88, 36, 6),
    pair(24, 54, 30, 6),
    row(2, 74, 38, 'N', 6, 0.5),
    row(1, 30, 16, 'E', 6, 0.5),
    row(134, 29, 6, 'W', 6, 0.5),
  ],
  [7, 17],
);

const total = garageRoute.reduce((sum, r) => sum + routeLength(r.points), 0);

export const garage: GameMap = {
  name: 'JAPAN GARAGE',
  parTime: Math.round(total / 17),
  floors: [roof, level2, ground],
  helixes,
  start: { floor: 0, pos: v(10, 58), angle: 0 },
  finish: { floor: 2, zone: { x: 129, y: 8.5, w: 10, h: 7 } },
};
