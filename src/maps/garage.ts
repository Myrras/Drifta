import type { Floor, GameMap, Helix, Rect, Solid, Vec } from '../types';

const W = 140;
const H = 80;
const BAY_W = 2.5;
const BAY_D = 5;
const CAR_W = 1.8;
const CAR_L = 4.2;
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
      v(26, 62),
      v(40, 70),
      v(54, 64),
      v(66, 50),
      v(80, 45),
      v(94, 54),
      v(106, 66),
      v(120, 65),
      v(127, 54),
      v(127, 40),
      v(124, 28),
      v(114, 18),
      v(100, 12),
      v(86, 20),
      v(70, 24),
      v(56, 16),
      v(44, 8),
      v(30, 6),
      ...arc(H0, 0, 0.5),
    ],
  },
  {
    floor: 1,
    points: [
      ...arc(H0, 0.5, 1),
      v(25, 30),
      v(31, 38),
      v(32, 48),
      v(38, 55),
      v(46.5, 57),
      v(56.5, 65),
      v(66.5, 72),
      v(76.5, 65),
      v(86.5, 57),
      v(95, 50),
      v(99, 40),
      v(94, 30),
      v(98, 20),
      v(106, 12),
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
      v(106, 40),
      v(94, 46),
      v(80, 38),
      v(66, 47),
      v(52, 39),
      v(38, 47),
      v(24, 40),
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

type Parked = { bays: Rect[]; cars: Solid[] };

/** n tall bays side by side from (x, y), bay i shifted down by i * shift (angled look); cars where fill(i). */
function parkedRow(
  x: number,
  y: number,
  n: number,
  fill = (_i: number) => true,
  shift = 0,
): Parked {
  const bays: Rect[] = [];
  const cars: Solid[] = [];
  for (let i = 0; i < n; i++) {
    const bay = { x: x + i * BAY_W, y: y + i * shift, w: BAY_W, h: BAY_D };
    bays.push(bay);
    if (fill(i)) {
      cars.push({
        kind: 'car',
        x: bay.x + (BAY_W - CAR_W) / 2,
        y: bay.y + (BAY_D - CAR_L) / 2,
        w: CAR_W,
        h: CAR_L,
      });
    }
  }
  return { bays, cars };
}

/** `rows` full parkedRows of n bays stacked nose to tail from (x, y): a solid block of cars. */
function parkedBlock(x: number, y: number, n: number, rows: number): Parked {
  const parts = Array.from({ length: rows }, (_, r) => parkedRow(x, y + r * BAY_D, n));
  return { bays: parts.flatMap((p) => p.bays), cars: parts.flatMap((p) => p.cars) };
}

/** Irregular grid of 1 m pillars (jitter ±1 m, so gaps ≥ step - 3) over r, kept where keep(center). */
function pillarGrid(r: Rect, step: number, keep: (p: Vec) => boolean): Solid[] {
  const out: Solid[] = [];
  for (let i = 0; i * step <= r.w; i++) {
    for (let k = 0; k * step <= r.h; k++) {
      const p = {
        x: r.x + i * step + (((i * 7 + k * 3) % 5) - 2) * 0.5,
        y: r.y + k * step + (((i * 3 + k * 7) % 5) - 2) * 0.5,
      };
      if (keep(p)) out.push(pillar(p.x, p.y));
    }
  }
  return out;
}

const segDist = (p: Vec, a: Vec, b: Vec) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
const rectDist = (p: Vec, r: Rect) =>
  Math.hypot(Math.max(r.x - p.x, 0, p.x - (r.x + r.w)), Math.max(r.y - p.y, 0, p.y - (r.y + r.h)));
const routeDist = (p: Vec, pts: Vec[]) =>
  Math.min(...pts.slice(1).map((b, i) => segDist(p, pts[i], b)));
const routeLength = (pts: Vec[]) =>
  pts.slice(1).reduce((sum, b, i) => sum + Math.hypot(b.x - pts[i].x, b.y - pts[i].y), 0);

/** Light points every 12 m along a polyline. */
function lightsAlong(pts: Vec[]): Vec[] {
  const out: Vec[] = [];
  let d = 6;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    for (; d <= len; d += 12)
      out.push(v(a.x + ((b.x - a.x) * d) / len, a.y + ((b.y - a.y) * d) / len));
    d -= len;
  }
  return out;
}

function floor(
  name: string,
  idx: number,
  solids: Solid[],
  parked: Parked[],
  gap?: [number, number],
): Floor {
  const joined = helixes.filter((h) => h.from === idx || h.from + 1 === idx);
  return {
    name,
    w: W,
    h: H,
    solids: [
      ...perimeter(gap),
      ...joined.flatMap((h) => helixGuards(h, h.from === idx)),
      ...solids,
      ...parked.flatMap((p) => p.cars),
    ],
    bays: parked.flatMap((p) => p.bays),
    lights: lightsAlong(garageRoute[idx].points),
    ramps: [],
    circles: joined.map((h) => ({ ...h.center, r: h.rCore })),
  };
}

/** Fill pattern: every k-th bay (offset by salt) stays empty. */
const gaps =
  (k: number, salt = 0) =>
  (i: number) =>
    (i + salt) % k !== 0;

// ROOF: open deck split by a planter wall; out east along the south in wide S-curves around
// loose clusters, up the east side, back west along the north into helix 0.
const roof = floor(
  'ROOF',
  0,
  [
    wall(35, 33.2, 77, 1.5),
    post(18, 48),
    post(50, 77),
    post(108, 40),
    post(118, 46),
    post(92, 6),
    post(80, 9),
  ],
  [
    parkedRow(34, 46, 5, gaps(4, 1), 0.6),
    parkedRow(56, 73, 9, gaps(3)),
    parkedRow(74, 58, 4, gaps(4, 2), -0.6),
    parkedRow(96, 41, 5, gaps(3, 1), 0.6),
    parkedRow(100, 73, 10, gaps(4)),
    parkedRow(2, 73, 8, gaps(3, 2)),
    parkedRow(110, 2, 8, gaps(3)),
    parkedRow(80, 28, 6, gaps(4, 1)),
    parkedRow(62, 2, 6, gaps(3, 2), 0.5),
    parkedRow(46, 27, 6, gaps(3)),
  ],
);

// LEVEL 2: a big parked island; slalom between staggered car rows along the south, a pillar
// chicane up the middle aisle, then around a second island into helix 1 along the east wall.
const level2 = floor(
  'LEVEL 2',
  1,
  [...[91, 93.5].map((x) => pillar(x, 40)), ...[99.5, 102].map((x) => pillar(x, 30))],
  [
    parkedBlock(40, 20, 20, 6),
    parkedBlock(104, 19.5, 9, 5),
    parkedBlock(64, 50, 2, 3),
    parkedBlock(44, 64, 2, 3),
    parkedBlock(84, 64, 2, 3),
    parkedRow(38, 1.5, 22, gaps(3)),
    parkedRow(2, 73, 14, gaps(4, 1)),
    parkedRow(3, 42, 8, gaps(3, 1)),
    parkedRow(3, 54, 8, gaps(4)),
  ],
);

// GROUND: west through a pillar forest with tight lines, up the west side, then a straight
// sprint east along the north wall to the exit gate. A wall keeps the sprint lane separate.
const groundRoute = garageRoute[2].points;
const groundWalls = [wall(24, 24, 115, 2)];
const groundParked = [parkedRow(30, 1.5, 36, gaps(3)), parkedRow(2, 73.5, 40, gaps(4, 2))];
const groundBlocked = [
  ...groundWalls,
  ...helixGuards(H1, false),
  ...groundParked.flatMap((p) => p.bays),
];
const ground = floor(
  'GROUND',
  2,
  [
    ...groundWalls,
    ...pillarGrid({ x: 5, y: 5, w: 130, h: 72 }, 9, (p) => {
      const lane = p.y < 24 ? 6.5 : 4.5; // wider lane on the sprint
      const nearSolid = groundBlocked.some((r) => rectDist(p, r) < 2);
      const nearHelix = Math.hypot(p.x - H1.center.x, p.y - H1.center.y) < R_OUTER + 3;
      return routeDist(p, groundRoute) >= lane && !nearSolid && !nearHelix;
    }),
  ],
  groundParked,
  [7, 17],
);

const total = garageRoute.reduce((sum, r) => sum + routeLength(r.points), 0);

export const garage: GameMap = {
  name: 'Parking Garage',
  parTime: Math.round(total / 17),
  floors: [roof, level2, ground],
  helixes,
  start: { floor: 0, pos: v(10, 58), angle: 0 },
  finish: { floor: 2, zone: { x: 129, y: 8.5, w: 10, h: 7 } },
};
