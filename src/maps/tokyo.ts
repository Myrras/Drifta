import { CAR_MODELS } from '../models';
import type { CityGraph, Lane, Signal, Walkway } from '../traffic';
import type { CarModel, Floor, Rect, Solid, Vec } from '../types';
import { blockOutline, type Decor, type DecoratedMap } from './decor';

// TOKYO NIGHTS: a neon district at night. A block grid inside a ring street, a scramble crossing
// at its heart, and an expressway deck looping the whole district on one floor behind a barrier.
// The route runs the grid, drifts through the scramble, climbs the on-ramp and laps three
// sweepers of the expressway to the finish on its west side.
const W = 400;
const H = 300;
const PI = Math.PI;
const v = (x: number, y: number): Vec => ({ x, y });
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// --- expressway ring ---
// Deck centerline at inset 10 (deck 1..19, barrier 19..23), corner radii of that centerline:
// nw, ne, se, sw. Every curve of the district (deck, barrier, ring street, block corners) is
// concentric with these corners.
const R = [55, 60, 45, 75];
const CORNER = [
  v(10 + R[0], 10 + R[0]),
  v(W - 10 - R[1], 10 + R[1]),
  v(W - 10 - R[2], H - 10 - R[2]),
  v(10 + R[3], H - 10 - R[3]),
];
/** Radius of the concentric curve at inset d around corner k. */
const rAt = (k: number, d: number) => R[k] + 10 - d;
/** On-ramp: opening in the north barrier, x range. */
const GAP: [number, number] = [266, 306];
const DECK_HALF = 9;

/** Closed clockwise loop at inset d (deck centerline: d = 10), corners every 3°. */
function ring(d: number): Vec[] {
  const out: Vec[] = [];
  for (let k = 0; k < 4; k++) {
    const a0 = ((k + 2) * PI) / 2;
    for (let i = 0; i <= 30; i++) {
      const a = a0 + (i / 30) * (PI / 2);
      out.push(v(CORNER[k].x + rAt(k, d) * Math.cos(a), CORNER[k].y + rAt(k, d) * Math.sin(a)));
    }
  }
  out.push({ ...out[0] });
  return out;
}
/** Deck centerline and half width, for tests and the wiring (no traffic up here). */
export const tokyoDeck = { center: ring(10), half: DECK_HALF };

// --- polylines ---
type Path = { pts: Vec[]; cum: number[]; len: number; closed: boolean };
function path(pts: Vec[], closed = false): Path {
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return { pts, cum, len: cum[cum.length - 1], closed };
}
/** Point and heading at distance s (wraps on closed paths). */
function at(p: Path, s: number): Vec & { h: number } {
  if (p.closed) s = ((s % p.len) + p.len) % p.len;
  let i = 0;
  while (i < p.cum.length - 2 && s > p.cum[i + 1]) i++;
  const a = p.pts[i];
  const b = p.pts[i + 1];
  const t = Math.max(0, Math.min(1, (s - p.cum[i]) / (p.cum[i + 1] - p.cum[i] || 1)));
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    h: Math.atan2(b.y - a.y, b.x - a.x),
  };
}
/** Sub-polyline from s0 to s1 (s1 may pass the end of a closed path). */
function sub(p: Path, s0: number, s1: number): Vec[] {
  const out: Vec[] = [at(p, s0)];
  for (const off of p.closed ? [0, p.len] : [0])
    p.cum.forEach((c, i) => {
      if (c + off > s0 + 1e-6 && c + off < s1 - 1e-6) out.push(p.pts[i]);
    });
  out.push(at(p, s1));
  return out
    .filter((q, i) => !i || Math.hypot(q.x - out[i - 1].x, q.y - out[i - 1].y) > 1e-6)
    .map((q) => v(q.x, q.y));
}
/** Arc length of the closest point. */
function project(p: Path, q: Vec): number {
  let best = Infinity;
  let s = 0;
  for (let i = 1; i < p.pts.length; i++) {
    const a = p.pts[i - 1];
    const b = p.pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / (dx * dx + dy * dy)));
    const d = Math.hypot(a.x + t * dx - q.x, a.y + t * dy - q.y);
    if (d < best) [best, s] = [d, p.cum[i - 1] + t * (p.cum[i] - p.cum[i - 1])];
  }
  return s;
}
/** Resampled every `step` m, so long straights can be cut. */
function dense(pts: Vec[], step = 2): Vec[] {
  const p = path(pts);
  const n = Math.max(1, Math.ceil(p.len / step));
  return Array.from({ length: n + 1 }, (_, i) =>
    v(at(p, (p.len * i) / n).x, at(p, (p.len * i) / n).y),
  );
}
/** Splits a polyline into the runs where `drop` is false. */
function cut(pts: Vec[], drop: (p: Vec) => boolean): Vec[][] {
  const runs: Vec[][] = [[]];
  for (const p of dense(pts)) {
    if (drop(p)) {
      if (runs[runs.length - 1].length) runs.push([]);
    } else runs[runs.length - 1].push(p);
  }
  return runs.filter((r) => r.length > 1);
}
const inGap = (p: Vec) => p.y < 26 && p.x > GAP[0] && p.x < GAP[1];

// --- solids ---
const wall = (x: number, y: number, w: number, h: number): Solid => ({ kind: 'wall', x, y, w, h });

/**
 * Curved wall t m thick inside radius r1 around o, polar angle a0 to a1: rotated rects about
 * `seg` m long whose outer corners sit on the arc. Thin and long, since the renderer outlines
 * every solid and short thick pieces read as a ladder.
 */
function arcWall(o: Vec, r1: number, t: number, a0: number, a1: number, seg = 8): Solid[] {
  const n = Math.ceil((Math.abs(a1 - a0) * r1) / seg);
  const da = (a1 - a0) / n;
  const len = 2 * r1 * Math.sin(Math.abs(da) / 2) + 0.1; // a hair of overlap: no seams
  const rm = r1 * Math.cos(da / 2) - t / 2;
  return Array.from({ length: n }, (_, k) => {
    const a = a0 + da * (k + 0.5);
    const c = v(o.x + rm * Math.cos(a), o.y + rm * Math.sin(a));
    return { kind: 'wall', x: c.x - len / 2, y: c.y - t / 2, w: len, h: t, angle: a + PI / 2 };
  });
}
const cornersOf = (s: Solid): Vec[] => {
  const a = s.angle ?? 0;
  const c = v(s.x + s.w / 2, s.y + s.h / 2);
  return [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ].map(([i, j]) => {
    const u = (i * s.w) / 2;
    const w = (j * s.h) / 2;
    return v(c.x + u * Math.cos(a) - w * Math.sin(a), c.y + u * Math.sin(a) + w * Math.cos(a));
  });
};
const inMap = (s: Solid) => cornersOf(s).every((p) => p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H);

const expressway: Solid[] = [
  // perimeter; outer deck edge round each corner (end pieces poking off the map are dropped:
  // the perimeter wall covers them)
  wall(0, 0, W, 1),
  wall(0, H - 1, W, 1),
  wall(0, 1, 1, H - 2),
  wall(W - 1, 1, 1, H - 2),
  ...CORNER.flatMap((o, k) =>
    arcWall(o, rAt(k, 0), 1, ((k + 2) * PI) / 2, ((k + 3) * PI) / 2).filter(inMap),
  ),
  // inner barrier, open for the on-ramp
  wall(CORNER[0].x, 19, GAP[0] - CORNER[0].x, 4),
  wall(GAP[1], 19, CORNER[1].x - GAP[1], 4),
  wall(W - 23, CORNER[1].y, 4, CORNER[2].y - CORNER[1].y),
  wall(CORNER[3].x, H - 23, CORNER[2].x - CORNER[3].x, 4),
  wall(19, CORNER[0].y, 4, CORNER[3].y - CORNER[0].y),
  // round the corners: two thin rails, deck side and city side, sealed by the straights
  ...CORNER.flatMap((o, k) => [
    ...arcWall(o, rAt(k, 19), 1.2, ((k + 2) * PI) / 2, ((k + 3) * PI) / 2),
    ...arcWall(o, rAt(k, 23) + 1.2, 1.2, ((k + 2) * PI) / 2, ((k + 3) * PI) / 2),
  ]),
];
/** The deck runs one way: closed west of the on-ramp. Road works on the south straight. */
const BARRIERS: Solid[] = [wall(258, 1, 2, 18), wall(243, H - 19, 8, 7), wall(200, H - 8, 7, 7)];

// --- city blocks ---
// Ring street at inset 23..39 (centerline 31); interior streets X1 (x 133..153, the scramble
// boulevard), X2 (x 249..265) and Y1 (y 140..160).
type Block = { x: number; y: number; w: number; h: number; round?: { corner: number; r: number } };
const BLOCKS: Block[] = [
  { x: 39, y: 39, w: 94, h: 101, round: { corner: 0, r: rAt(0, 39) } },
  { x: 153, y: 39, w: 96, h: 101 },
  { x: 265, y: 39, w: 96, h: 101, round: { corner: 1, r: rAt(1, 39) } },
  { x: 265, y: 160, w: 96, h: 101, round: { corner: 2, r: rAt(2, 39) } },
  { x: 153, y: 160, w: 96, h: 101 },
  { x: 39, y: 160, w: 94, h: 101, round: { corner: 3, r: rAt(3, 39) } },
];
const WALK = 4.5;

/** A block's solids: one rect, or two rects plus a curved curb round its rounded corner. */
function blockSolids(b: Block): Solid[] {
  if (!b.round) return [wall(b.x, b.y, b.w, b.h)];
  const { corner: k, r } = b.round;
  const west = k === 0 || k === 3;
  const north = k < 2;
  const o = v(b.x + (west ? r : b.w - r), b.y + (north ? r : b.h - r));
  const x1 = b.x + b.w;
  const y1 = b.y + b.h;
  const slab = west ? wall(o.x, b.y, x1 - o.x, b.h) : wall(b.x, b.y, o.x - b.x, b.h);
  const cx0 = west ? b.x : o.x;
  const cw = west ? o.x - b.x : x1 - o.x;
  const col = north ? wall(cx0, o.y, cw, y1 - o.y) : wall(cx0, b.y, cw, o.y - b.y);
  const a0 = ((k + 2) * PI) / 2;
  return [slab, col, ...arcWall(o, r, 1.2, a0, a0 + PI / 2, 4)];
}

// --- traffic graph (left-hand traffic, one lane each way) ---
type Street = 'R' | 'X1' | 'X2' | 'Y1';
const HALF: Record<Street, number> = { R: 8, X1: 10, X2: 8, Y1: 10 };
const DIRS: { id: string; street: Street; p: Path }[] = [
  { id: 'Rcw', street: 'R', p: path(ring(31 - 3.5), true) },
  { id: 'Rccw', street: 'R', p: path(ring(31 + 3.5).reverse(), true) },
  { id: 'X1n', street: 'X1', p: path([v(139, 269), v(139, 31)]) },
  { id: 'X1s', street: 'X1', p: path([v(147, 31), v(147, 269)]) },
  { id: 'X2n', street: 'X2', p: path([v(253.5, 269), v(253.5, 31)]) },
  { id: 'X2s', street: 'X2', p: path([v(260.5, 31), v(260.5, 269)]) },
  { id: 'Y1e', street: 'Y1', p: path([v(31, 146), v(369, 146)]) },
  { id: 'Y1w', street: 'Y1', p: path([v(369, 154), v(31, 154)]) },
];
/** A junction's major street gets phase a; ped = all-red pedestrian phase (s). */
type Junction = {
  id: string;
  at: Vec;
  streets: [Street, Street];
  major: Street;
  ped: number;
  offset: number;
};
const JUNCTIONS: Junction[] = [
  { id: 'S', at: v(143, 150), streets: ['Y1', 'X1'], major: 'Y1', ped: 24, offset: 0 },
  { id: 'Q', at: v(257, 150), streets: ['Y1', 'X2'], major: 'Y1', ped: 12, offset: 13 },
  { id: 'NT1', at: v(143, 31), streets: ['R', 'X1'], major: 'R', ped: 0, offset: 6 },
  { id: 'NT2', at: v(257, 31), streets: ['R', 'X2'], major: 'R', ped: 0, offset: 21 },
  { id: 'ET', at: v(369, 150), streets: ['R', 'Y1'], major: 'R', ped: 0, offset: 30 },
  { id: 'ST2', at: v(257, 269), streets: ['R', 'X2'], major: 'R', ped: 0, offset: 9 },
  { id: 'ST1', at: v(143, 269), streets: ['R', 'X1'], major: 'R', ped: 0, offset: 27 },
  { id: 'WT', at: v(31, 150), streets: ['R', 'Y1'], major: 'R', ped: 0, offset: 15 },
];
const other = (j: Junction, s: Street) => (j.streets[0] === s ? j.streets[1] : j.streets[0]);
/** Box half-extent along street s at j: up to the stop line, behind the crosswalk. */
const reachAt = (j: Junction, s: Street) => HALF[other(j, s)] + 6;
const ZEBRA = 2.5; // crosswalk center past the box edge (4 m wide)

type Piece = { id: string; street: Street; from: string; to: string; pts: Vec[] };
const pieces: Piece[] = [];
for (const d of DIRS) {
  const js = JUNCTIONS.filter((j) => j.streets.includes(d.street))
    .map((j) => ({ j, s: project(d.p, j.at), e: reachAt(j, d.street) }))
    .sort((a, b) => a.s - b.s);
  const pairs = d.p.closed
    ? js.map((a, i) => [a, js[(i + 1) % js.length]])
    : js.slice(1).map((b, i) => [js[i], b]);
  for (const [a, b] of pairs) {
    const s1 = b.s - b.e + (b.s <= a.s ? d.p.len : 0);
    pieces.push({
      id: `${d.id}:${a.j.id}`,
      street: d.street,
      from: a.j.id,
      to: b.j.id,
      pts: sub(d.p, a.s + a.e, s1),
    });
  }
}
const headOf = (a: Vec, b: Vec) => Math.atan2(b.y - a.y, b.x - a.x);
const endHead = (p: Vec[]) => headOf(p[p.length - 2], p[p.length - 1]);

/** Quadratic curve from P (heading hp) to Q (heading hq) through their tangents' crossing. */
function bend(P: Vec, hp: number, Q: Vec, hq: number): Vec[] {
  const [ax, ay, bx, by] = [Math.cos(hp), Math.sin(hp), Math.cos(hq), Math.sin(hq)];
  const det = ax * by - ay * bx;
  const t = ((Q.x - P.x) * by - (Q.y - P.y) * bx) / det;
  const C = v(P.x + t * ax, P.y + t * ay);
  return Array.from({ length: 11 }, (_, i) => {
    const u = i / 10;
    const k = [(1 - u) ** 2, 2 * u * (1 - u), u * u];
    return v(k[0] * P.x + k[1] * C.x + k[2] * Q.x, k[0] * P.y + k[1] * C.y + k[2] * Q.y);
  });
}

const lanes: Lane[] = pieces.map((p) => ({ id: p.id, pts: p.pts, speed: 11, next: [] }));
const laneOf = new Map(lanes.map((l) => [l.id, l]));
for (const j of JUNCTIONS) {
  for (const a of pieces.filter((p) => p.to === j.id)) {
    for (const b of pieces.filter((p) => p.from === j.id)) {
      const P = a.pts[a.pts.length - 1];
      const Q = b.pts[0];
      const hp = endHead(a.pts);
      const hq = headOf(b.pts[0], b.pts[1]);
      const turn = wrap(hq - hp);
      if (Math.abs(turn) > 2.6) continue; // no U-turns
      const through = Math.abs(turn) < 0.3;
      if (through && a.street !== b.street) continue;
      // right turns cross the oncoming lane: only from the stem of a T, whose red holds the rest
      if (turn > 0.3 && (j.ped > 0 || a.street === j.major)) continue;
      const id = `${a.id}>${b.id}`;
      lanes.push({
        id,
        pts: through ? [P, Q] : bend(P, hp, Q, hq),
        speed: through ? 10 : 6.5,
        next: [b.id],
        light: { id: `${j.id}${a.street === j.major ? 'a' : 'b'}`, stopAt: 0 },
      });
      laneOf.get(a.id)!.next.push(id);
    }
  }
}

/** Two-phase program with all-red clearances, plus an all-red pedestrian scramble if ped > 0. */
function program(j: Junction): Signal[] {
  const [ga, gb, clear] = [18, 13, 3];
  const ped: Signal['cycle'] = j.ped
    ? [
        { car: 'red', ped: true, dur: j.ped },
        { car: 'red', ped: false, dur: 5 },
      ]
    : [];
  return [
    {
      id: `${j.id}a`,
      offset: j.offset,
      cycle: [
        { car: 'green', ped: false, dur: ga },
        { car: 'amber', ped: false, dur: 3 },
        { car: 'red', ped: false, dur: clear + gb + 3 + clear },
        ...ped,
      ],
    },
    {
      id: `${j.id}b`,
      offset: j.offset,
      cycle: [
        { car: 'red', ped: false, dur: ga + 3 + clear },
        { car: 'green', ped: false, dur: gb },
        { car: 'amber', ped: false, dur: 3 },
        { car: 'red', ped: false, dur: clear },
        ...ped,
      ],
    },
  ];
}

/** Walkway with an optional kerb hint: the side of pts order (a -> b) where the road is, -1 = left. */
export type KerbWalkway = Walkway & { kerb?: -1 | 1 };
const crossings: KerbWalkway[] = [];
for (const j of JUNCTIONS.filter((j) => j.ped > 0)) {
  const { x, y } = j.at;
  const [ew, ns] = j.streets; // Y1 first: arms west/east cross Y1, north/south arms cross X
  const dy = HALF[ew] + ZEBRA; // north/south arms, across the X street
  const dx = HALF[ns] + ZEBRA;
  const ax = HALF[ns] + 2;
  const ay = HALF[ew] + 2;
  const lines: [Vec, Vec][] = [
    [v(x - ax, y - dy), v(x + ax, y - dy)],
    [v(x - ax, y + dy), v(x + ax, y + dy)],
    [v(x - dx, y - ay), v(x - dx, y + ay)],
    [v(x + dx, y - ay), v(x + dx, y + ay)],
  ];
  if (j.id === 'S')
    lines.push([v(x - ax, y - ay), v(x + ax, y + ay)], [v(x + ax, y - ay), v(x - ax, y + ay)]);
  // the scramble gets three parallel files per crossing: crowds
  for (const [a, b] of lines)
    for (const o of j.id === 'S' ? [-1.3, 0, 1.3] : [0]) {
      const h = headOf(a, b);
      const n = v(-Math.sin(h) * o, Math.cos(h) * o);
      crossings.push({
        id: `${j.id}x${crossings.length}`,
        pts: [v(a.x + n.x, a.y + n.y), v(b.x + n.x, b.y + n.y)],
        crossing: { signal: `${j.id}a` },
      });
    }
}
const sidewalks: KerbWalkway[] = BLOCKS.map((b, i) => {
  const pts = blockOutline(b, 2);
  return { id: `walk${i}`, pts: [...pts, { ...pts[0] }], kerb: -1 };
});

export const tokyoCity: CityGraph = {
  lanes,
  signals: JUNCTIONS.flatMap(program),
  walkways: [...sidewalks, ...crossings],
  cars: 30,
  peds: 56,
};

// --- route ---
type Pose = Vec & { a: number };
/**
 * Course through control points [x, y, radius] (as B2 MEET): every inner point is rounded by an
 * arc. The driving line keeps at most 45° per vertex and stays within 1.5 m of the arc.
 */
function course(ctl: number[][]) {
  const P = ctl.map(([x, y]) => v(x, y));
  const corners: { o: Vec; r: number; turn: number; mid: Pose; s: Vec; e: Vec; a1: number }[] = [];
  for (let i = 1; i < P.length - 1; i++) {
    const a1 = headOf(P[i - 1], P[i]);
    const turn = wrap(headOf(P[i], P[i + 1]) - a1);
    const r = ctl[i][2];
    const t = r * Math.tan(Math.abs(turn) / 2);
    const g = Math.sign(turn);
    const s = v(P[i].x - t * Math.cos(a1), P[i].y - t * Math.sin(a1));
    const e = v(P[i].x + t * Math.cos(a1 + turn), P[i].y + t * Math.sin(a1 + turn));
    const o = v(s.x - g * r * Math.sin(a1), s.y + g * r * Math.cos(a1));
    const am = a1 + turn / 2;
    corners.push({
      o,
      r,
      turn,
      s,
      e,
      a1,
      mid: { x: o.x + g * r * Math.sin(am), y: o.y - g * r * Math.cos(am), a: am },
    });
  }
  const line: Vec[] = [P[0]];
  let from = P[0];
  for (const c of corners) {
    if (
      Math.abs(wrap(headOf(from, c.s) - c.a1)) > 1e-3 &&
      Math.hypot(c.s.x - from.x, c.s.y - from.y) > 1e-6
    )
      throw new Error(`corner ${c.mid.x},${c.mid.y} overlaps`);
    const g = Math.sign(c.turn);
    const n = Math.max(
      Math.ceil(Math.abs(c.turn) / (PI / 4) - 1e-9),
      Math.ceil(Math.abs(c.turn) / (2 * Math.acos(c.r / (c.r + 1.5)))),
    );
    const step = c.turn / n;
    for (let k = 0; k < n; k++) {
      const am = c.a1 + step * (k + 0.5);
      const rr = c.r / Math.cos(step / 2);
      line.push(v(c.o.x + g * rr * Math.sin(am), c.o.y - g * rr * Math.cos(am)));
    }
    from = c.e;
  }
  line.push(P[P.length - 1]);
  return { line, corners };
}

const START = v(75, 150);
const C = course([
  [START.x, START.y], // Y1 eastbound
  [143, 150, 20], // scramble: wide left, north up the boulevard
  [143, 31, 16], // right onto the north ring street
  [272, 31, 30], // on-ramp: bear left...
  [302, 10, 30], // ...and right onto the deck
  [390, 10, 60], // NE sweeper
  [390, 290, 45], // SE sweeper, tighter
  [272, 290, 40], // road works: shift out past the inner block...
  [257, 293.5, 40],
  [236, 293.5, 40],
  [215, 286.5, 40], // ...and in past the outer one
  [194, 286.5, 40],
  [179, 290, 40],
  [10, 290, 75], // SW sweeper, the widest
  [10, 192], // finish on the west deck
]);
/** Fillet radius and signed turn of every corner (see tokyo.test). */
export const tokyoCorners = C.corners.map(({ r, turn }) => ({ r, turn }));
export const tokyoRoute: { floor: number; points: Vec[] }[] = [{ floor: 0, points: C.line }];
const FINISH: Rect = { x: 1.5, y: 184, w: 17, h: 14 };

/** Clipping zones: 5 m squares outside the scramble turn, the ring-street right and two sweepers. */
const clipZones: Rect[] = [0, 1, 5, 12].map((i) => {
  const { turn, mid } = C.corners[i];
  const g = Math.sign(turn);
  const x = mid.x + g * 4.5 * Math.sin(mid.a);
  const y = mid.y - g * 4.5 * Math.cos(mid.a);
  return { x: x - 2.5, y: y - 2.5, w: 5, h: 5 };
});

// --- parked cars: taxi rank on X2, delivery vans with hazards off the route ---
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const MODELS = Object.keys(CAR_MODELS) as CarModel[];
/** Parked car centered at c, nose along facing. */
function parked(c: Vec, facing: number, model: CarModel, color: string, lights?: 'hazard'): Solid {
  const { length, width } = CAR_MODELS[model];
  return {
    kind: 'car',
    x: c.x - length / 2,
    y: c.y - width / 2,
    w: length,
    h: width,
    angle: facing,
    facing,
    model,
    color,
    ...(lights && { lights }),
  };
}
const TAXI = ['#f2c230', '#f2c230', '#2e7d4f', '#1b1c20', '#f2c230', '#e8e8ea'];
const taxis = TAXI.map((color, i) => {
  const w = CAR_MODELS.civic.width;
  return parked(v(249 + 0.35 + w / 2, 66 + i * 6), -PI / 2, 'civic', color);
});
const vrand = rng(77);
// [curb x, curb y, normal off the curb, facing]
const vans = (
  [
    [361, 186, 1, 0, -PI / 2],
    [361, 206, 1, 0, -PI / 2],
    [361, 236, 1, 0, -PI / 2],
    [300, 261, 0, 1, 0],
    [208, 261, 0, 1, 0],
    [98, 261, 0, 1, 0],
    [265, 214, -1, 0, PI / 2],
    [265, 236, -1, 0, PI / 2],
  ] as const
).map(([x, y, nx, ny, facing]) => {
  const model = MODELS[Math.floor(vrand() * MODELS.length)];
  const { width, colors } = CAR_MODELS[model];
  const d = 0.35 + width / 2;
  const color = colors[Math.floor(vrand() * colors.length)];
  return parked(v(x + nx * d, y + ny * d), facing, model, color, 'hazard');
});

const solids: Solid[] = [
  ...expressway,
  ...BARRIERS,
  ...BLOCKS.flatMap(blockSolids),
  ...taxis,
  ...vans,
];

// --- street lights: alternate curbs every 22 m ---
const lights: Vec[] = [];
/** Where each lamp's light lands: out over the lane. */
const lamps: Vec[] = [];
for (const [pts, hw, closed] of [
  [ring(31), 8, true],
  [[v(143, 39), v(143, 261)], 10, false],
  [[v(257, 39), v(257, 261)], 8, false],
  [[v(39, 150), v(361, 150)], 10, false],
] as [Vec[], number, boolean][]) {
  const p = path(pts, closed);
  for (let s = 8, k = 0; s < p.len; s += 22, k++) {
    const q = at(p, s);
    const o = (k % 2 ? 1 : -1) * (hw - 1.2);
    const n = v(-Math.sin(q.h), Math.cos(q.h));
    lights.push(v(q.x + n.x * o, q.y + n.y * o));
    lamps.push(v(q.x + n.x * o * 0.55, q.y + n.y * o * 0.55));
  }
}

const floor: Floor = {
  name: 'NEON CITY',
  w: W,
  h: H,
  solids,
  bays: [],
  lights,
  circles: [],
  clipZones,
};

// --- decor ---
const NEON = ['#ff2d95', '#2de2ff', '#9b5cff', '#ffb03a', '#4dff9a', '#ff4a3a'];
const SHOP = [
  '#ffd9a0',
  '#ffe8c4',
  '#e6f0ff',
  '#ffd9a0',
  '#ff6fb5',
  '#5fe6ff',
  '#ffb347',
  '#8affc0',
  '#c49bff',
];
const NAMES = [
  'KARAOKE',
  'RAMEN',
  'IZAKAYA',
  'HOTEL',
  'GAME',
  'SUSHI',
  'MANGA',
  'BAR 21',
  'CAFE',
  '24H',
  'NEON KISS',
  'KAIJU',
  'MOMO',
  'HIKARI',
  'YORU',
  'TOKI',
  'LUCKY 7',
  'ROBO',
  'DRIFT',
  'YAKITORI',
];
const decor: Decor[] = [];
type Item<D = Decor> = D extends unknown ? Omit<D, 'floor'> : never;
const add = (d: Item) => decor.push({ floor: 0, ...d } as Decor);
const paint = (pts: Vec[], w: number, color?: string, dash?: number[], top?: boolean) => {
  if (pts.length > 1)
    add({ kind: 'paint', x: pts[0].x, y: pts[0].y, to: pts.slice(1), w, color, dash, top });
};
const rand = rng(2024);
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const PAINT_W = 'rgba(215,215,205,0.5)';
const YELLOW = 'rgba(225,170,40,0.6)';
/** Half size of a junction box: [x, y]. Y1 is the only east-west street besides the ring. */
const boxOf = (j: Junction) =>
  j.streets.includes('Y1') ? [HALF[other(j, 'Y1')], HALF.Y1] : [HALF[other(j, 'R')], HALF.R];
const nearJunction = (p: Vec, pad = 0) =>
  JUNCTIONS.some((j) => {
    const [hx, hy] = boxOf(j);
    return Math.abs(p.x - j.at.x) < hx + pad && Math.abs(p.y - j.at.y) < hy + pad;
  });

// street lamps light the road well past the render's ceiling-lamp pools: drivable reads lighter
for (const l of lamps) add({ kind: 'pool', ...l, r: 12, color: '#1e222b' });
// ground: wet asphalt, the deck a smoother tone, the ramp up to it
add({ kind: 'asphalt', x: 0, y: 0, w: W, h: H, seed: 1 });
paint(ring(10), 18, '#34353b');
paint([v(256, 31), v(272, 31), v(302, 10), v(318, 10)], 13, '#34353b');
// shadow cast by the deck onto the ring street, with pillar shadows
for (const run of cut(ring(24.5), inGap)) paint(run, 3, 'rgba(0,0,0,0.2)');
for (const run of cut(ring(24), inGap)) paint(run, 2, 'rgba(0,0,0,0.18)');
for (const run of cut(ring(26), inGap)) paint(run, 6, 'rgba(0,0,0,0.16)', [2.5, 15.5]);
// deck paint: lane dashes, edge lines, expansion joints, sodium lamps on the barrier
paint(ring(7), 0.15, PAINT_W, [5, 7]);
paint(ring(13), 0.15, PAINT_W, [5, 7]);
paint(ring(2.3), 0.18, PAINT_W);
for (const run of cut(ring(17.7), (p) => inGap(p) && p.x > GAP[0] + 4)) paint(run, 0.18, PAINT_W);
{
  const p = path(ring(10), true);
  for (let s = 20; s < p.len; s += 45) {
    const q = at(p, s);
    const n = v(-Math.sin(q.h), Math.cos(q.h));
    paint(
      [v(q.x - n.x * 8.8, q.y - n.y * 8.8), v(q.x + n.x * 8.8, q.y + n.y * 8.8)],
      0.35,
      '#131417',
    );
  }
  // sodium lamps on the barrier, their light out over the deck
  const b = path(ring(15), true);
  for (let s = 10; s < b.len; s += 30) {
    const q = at(b, s);
    if (!inGap(q)) add({ kind: 'pool', x: q.x, y: q.y, r: 12, color: '#9a5a22' });
  }
  // old tire marks round the three sweepers
  for (const k of [1, 2, 3])
    for (const dr of [-2.5, 1.5, 4]) {
      const a0 = ((k + 2) * PI) / 2;
      const points = Array.from({ length: 31 }, (_, i) => {
        const a = a0 + 0.1 + (i / 30) * (PI / 2 - 0.2);
        const r = rAt(k, 10) + dr + Math.sin(i * 0.5 + k) * 0.8;
        return v(CORNER[k].x + r * Math.cos(a), CORNER[k].y + r * Math.sin(a));
      });
      add({ kind: 'skid', points });
    }
}
add({
  kind: 'text',
  x: 340,
  y: 10,
  angle: PI / 2,
  text: '80',
  size: 4,
  color: 'rgba(225,225,215,0.45)',
});
add({
  kind: 'text',
  x: 390,
  y: 120,
  angle: PI,
  text: '80',
  size: 4,
  color: 'rgba(225,225,215,0.45)',
});
add({
  kind: 'text',
  x: 250,
  y: 10,
  angle: -PI / 2,
  text: 'CLOSED',
  size: 3,
  color: 'rgba(230,80,60,0.6)',
});
add({ kind: 'hatch', x: 246, y: 2, w: 11, h: 16, color: '230,80,60' });
add({ kind: 'hatch', x: 239, y: H - 19, w: 16, h: 8 });
add({ kind: 'hatch', x: 196, y: H - 9, w: 15, h: 8 });
add({ kind: 'arrow', x: 287, y: 21, angle: -0.61 });
add({ kind: 'arrow', x: 300, y: 290, angle: PI - 0.25 });
add({ kind: 'arrow', x: 226, y: 290, angle: PI + 0.32 });
// finish line across the west deck
paint([v(1.2, 197.5), v(18.8, 197.5)], 1, '#e8e8e2');
paint([v(1.2, 197.25), v(18.8, 197.25)], 0.5, '#111', [0.5, 0.5]);
paint([v(1.2, 197.75), v(18.8, 197.75)], 0.5, '#111', [0, 0.5, 0.5, 0]);

// streets: center lines, edge lines, stop lines, zebras, diamonds, arrows, manholes, stains
for (const run of cut(ring(31), (p) => nearJunction(p, 6))) paint(run, 0.15, PAINT_W, [3, 3]);
for (const run of cut([v(257, 39), v(257, 261)], (p) => nearJunction(p, 6)))
  paint(run, 0.15, PAINT_W, [3, 3]);
for (const [a, b] of [
  [v(143, 39), v(143, 261)],
  [v(39, 150), v(361, 150)],
])
  for (const o of [-0.2, 0.2]) {
    const off = (p: Vec) => (a.x === b.x ? v(p.x + o, p.y) : v(p.x, p.y + o));
    for (const run of cut([off(a), off(b)], (p) => nearJunction(p, 6))) paint(run, 0.13, YELLOW);
  }
for (const run of cut(ring(38), (p) => nearJunction(p, 6))) paint(run, 0.15, PAINT_W);
for (const run of cut(ring(24), (p) => nearJunction(p, 6) || inGap(p))) paint(run, 0.15, PAINT_W);
for (const [x0, y0, x1, y1, o] of [
  [143, 39, 143, 261, 9],
  [257, 39, 257, 261, 7],
  [39, 150, 361, 150, 9],
])
  for (const s of [-o, o]) {
    const pts = x0 === x1 ? [v(x0 + s, y0), v(x1 + s, y1)] : [v(x0, y0 + s), v(x1, y1 + s)];
    for (const run of cut(pts, (p) => nearJunction(p, 6))) paint(run, 0.15, PAINT_W);
  }
for (const p of pieces) {
  const end = p.pts[p.pts.length - 1];
  const h = endHead(p.pts);
  const left = v(Math.sin(h), -Math.cos(h));
  const off = p.street === 'X1' || p.street === 'Y1' ? 4 : 3.5;
  const hw = HALF[p.street];
  paint(
    [
      v(end.x - left.x * off, end.y - left.y * off),
      v(end.x + left.x * (hw - off - 0.3), end.y + left.y * (hw - off - 0.3)),
    ],
    0.45,
    'rgba(225,225,215,0.55)',
  );
  const pp = path(p.pts);
  if (pp.len > 45) {
    const q = at(pp, pp.len - 24);
    const f = v(Math.cos(q.h), Math.sin(q.h));
    const n = v(-f.y, f.x);
    const dia = [
      v(f.x * 1.6, f.y * 1.6),
      v(n.x * 0.8, n.y * 0.8),
      v(-f.x * 1.6, -f.y * 1.6),
      v(-n.x * 0.8, -n.y * 0.8),
    ];
    paint(
      [...dia, dia[0]].map((d) => v(q.x + d.x, q.y + d.y)),
      0.15,
      PAINT_W,
    );
    const a = at(pp, pp.len - 12);
    add({ kind: 'arrow', x: a.x, y: a.y, angle: a.h });
  }
  if (rand() < 0.5) {
    const q = at(pp, pp.len - 3 - rand() * 6);
    add({ kind: 'stain', x: q.x, y: q.y, r: 0.6 + rand() * 0.6 });
  }
  for (let s = 10 + rand() * 30; s < pp.len - 10; s += 30 + rand() * 40) {
    const q = at(pp, s);
    const o = (rand() - 0.5) * 2;
    add({ kind: 'manhole', x: q.x - Math.sin(q.h) * o, y: q.y + Math.cos(q.h) * o });
  }
}
// zebras on every junction arm
for (const j of JUNCTIONS) {
  for (const s of j.streets) {
    const hw = HALF[s];
    const d = HALF[other(j, s)] + ZEBRA;
    const along = s === 'Y1' ? v(1, 0) : s === 'R' ? (j.at.y === 150 ? v(0, 1) : v(1, 0)) : v(0, 1);
    for (const side of [-1, 1]) {
      const c = v(j.at.x + along.x * d * side, j.at.y + along.y * d * side);
      // T stems only continue away from the ring
      if (s !== 'R' && j.major === 'R' && (c.x < 39 || c.x > 361 || c.y < 39 || c.y > 261))
        continue;
      const n = v(-along.y * (hw - 0.3), along.x * (hw - 0.3));
      paint(
        [v(c.x - n.x, c.y - n.y), v(c.x + n.x, c.y + n.y)],
        4,
        'rgba(225,225,215,0.55)',
        [0.45, 0.45],
      );
    }
  }
}
// the scramble: diagonal zebras too
paint([v(134.5, 141.5), v(151.5, 158.5)], 4, 'rgba(225,225,215,0.55)', [0.45, 0.45]);
paint([v(151.5, 141.5), v(134.5, 158.5)], 4, 'rgba(225,225,215,0.55)', [0.45, 0.45]);

// pockets beyond the deck: the city goes on
CORNER.forEach((o, k) => {
  const sx = k === 0 || k === 3 ? 0 : o.x;
  const sy = k < 2 ? 0 : o.y;
  add({
    kind: 'block',
    x: sx,
    y: sy,
    w: k === 0 || k === 3 ? o.x : W - o.x,
    h: k < 2 ? o.y : H - o.y,
    walk: 0,
    seed: 50 + k,
    round: { corner: (k + 2) % 4, r: rAt(k, 0), concave: true },
  });
});

// blocks: plazas at the scramble corners, lantern alleys through two blocks
const PLAZA: Rect[] = [
  { x: 115, y: 124, w: 18, h: 16 },
  { x: 153, y: 124, w: 18, h: 16 },
  { x: 153, y: 160, w: 18, h: 16 },
  { x: 115, y: 160, w: 18, h: 16 },
];
const ALLEYS: Rect[] = [
  { x: 39, y: 205, w: 94, h: 3 },
  { x: 199, y: 39, w: 3, h: 101 },
];
const openOf = (b: Block) =>
  [...PLAZA, ...ALLEYS].filter(
    (o) => o.x < b.x + b.w && b.x < o.x + o.w && o.y < b.y + b.h && b.y < o.y + o.h,
  );
BLOCKS.forEach((b, i) => add({ kind: 'block', ...b, walk: WALK, seed: i + 1, open: openOf(b) }));
const inOpen = (p: Vec, pad = 0) =>
  [...PLAZA, ...ALLEYS].some(
    (o) => p.x > o.x - pad && p.x < o.x + o.w + pad && p.y > o.y - pad && p.y < o.y + o.h + pad,
  );

// facades: shop fronts, blade and name signs, neon, vending machines, people
for (const b of BLOCKS) {
  const face = blockOutline(b, WALK);
  for (let i = 0; i < face.length; i++) {
    const a = face[i];
    const c = face[(i + 1) % face.length];
    const len = Math.hypot(c.x - a.x, c.y - a.y);
    if (len < 4) continue;
    const h = headOf(a, c);
    const f = v(Math.cos(h), Math.sin(h));
    const left = v(f.y, -f.x); // toward the street
    const pt = (s: number, o = 0) => v(a.x + f.x * s + left.x * o, a.y + f.y * s + left.y * o);
    for (let s = 1 + rand() * 2; s < len - 4;) {
      const l = Math.min(3.5 + rand() * 5.5, len - 1 - s);
      const mid = pt(s + l / 2);
      if (!inOpen(mid, 1) && !inOpen(pt(s), 0.5) && !inOpen(pt(s + l), 0.5)) {
        const color = pick(SHOP);
        add({ kind: 'front', ...pt(s), angle: h, len: l, color, seed: Math.round(s * 7 + i * 13) });
        const r = rand();
        if (r < 0.32) {
          const c2 = pt(s + l / 2, 1.7);
          add({
            kind: 'sign',
            ...c2,
            w: 2.6,
            h: 0.75,
            angle: h - PI / 2,
            color: pick(NEON),
            seed: Math.round(c2.x * 3 + c2.y),
          });
        } else if (r < 0.48) {
          const c2 = pt(s + l / 2, -0.7);
          add({
            kind: 'sign',
            ...c2,
            w: Math.min(l * 0.85, 7),
            h: 1.3,
            angle: h,
            color: pick(NEON),
            text: pick(NAMES),
            seed: 0,
          });
        }
        if (rand() < 0.22) {
          const n0 = pt(s + 0.3, 0.25);
          const n1 = pt(s + l - 0.3, 0.25);
          add({ kind: 'neon', a: n0, b: n1, color: pick(NEON), flicker: 0.2 + rand() * 0.5 });
        }
        if (rand() < 0.14) {
          const p = pt(s + rand() * l, 1.5 + rand() * 1.5);
          add({
            kind: 'crowd',
            ...p,
            angle: h + (rand() < 0.5 ? 0 : PI),
            n: 2 + Math.floor(rand() * 4),
            seed: Math.round(p.x * 7 + p.y * 13),
          });
        }
      }
      s += l;
      const gap = 0.4 + rand() * 2.2;
      if (gap > 2 && rand() < 0.5 && !inOpen(pt(s + gap / 2), 1)) {
        const p = pt(s + gap / 2, 0.5);
        add({
          kind: 'vending',
          ...p,
          angle: h - PI / 2,
          n: 2 + Math.floor(rand() * 2),
          seed: Math.round(p.x + p.y),
        });
      }
      s += gap;
    }
  }
  // rooftop billboards
  for (let k = 0; k < 2; k++) {
    const x = b.x + 14 + rand() * (b.w - 28);
    const y = b.y + 14 + rand() * (b.h - 28);
    if (inOpen(v(x, y), 8)) continue;
    add({
      kind: 'sign',
      x,
      y,
      w: 9 + rand() * 4,
      h: 2.6,
      angle: rand() < 0.5 ? 0 : PI / 2,
      color: pick(NEON),
      text: pick(NAMES),
      seed: k,
    });
  }
}

// the scramble: screens on the corner buildings, crowds waiting at every corner, white light
add({ kind: 'screen', x: 111, y: 120, w: 15, h: 6, angle: -PI / 4, seed: 1 });
add({ kind: 'screen', x: 175, y: 120, w: 15, h: 6, angle: PI / 4, seed: 2 });
add({ kind: 'screen', x: 175, y: 180, w: 13, h: 5.5, angle: -PI / 4, seed: 3 });
add({
  kind: 'sign',
  x: 111,
  y: 180,
  w: 13,
  h: 3.6,
  angle: PI / 4,
  color: '#ff2d95',
  text: 'HIKARI',
  seed: 0,
});
add({ kind: 'pool', x: 143, y: 150, r: 20, color: '#d8e4ff' });
for (const [cx, cy] of [
  [130, 137],
  [156, 137],
  [156, 163],
  [130, 163],
]) {
  const toward = Math.atan2(150 - cy, 143 - cx);
  for (let k = 0; k < 3; k++) {
    const a = toward + PI + (k - 1) * 0.9;
    const x = cx + Math.cos(a) * 3.2;
    const y = cy + Math.sin(a) * 3.2;
    add({ kind: 'crowd', x, y, angle: toward, n: 6 + k, seed: Math.round(x * 7 + y * 13) });
  }
}
// plazas: lit paving, people milling about, vending machines against the buildings
for (const p of PLAZA) {
  const c = v(p.x + p.w / 2, p.y + p.h / 2);
  add({ kind: 'pool', ...c, r: 12, color: '#7c7f8c' });
  for (const [dx, dy] of [
    [-3, -2],
    [3, 2],
  ])
    add({
      kind: 'crowd',
      x: c.x + dx,
      y: c.y + dy,
      angle: rand() * PI * 2,
      n: 5,
      seed: p.x + p.y + dx,
    });
  // the plaza's back edge, away from the crossing
  const west = p.x < 143;
  add({
    kind: 'vending',
    x: west ? p.x + 0.8 : p.x + p.w - 0.8,
    y: c.y,
    angle: west ? 0 : PI,
    n: 3,
    seed: p.x,
  });
}
// lantern alleys
for (const al of ALLEYS) {
  const wide = al.w > al.h;
  const n = Math.floor((wide ? al.w : al.h) / 4);
  for (let k = 1; k < n; k++) {
    const t = (k / n) * (wide ? al.w : al.h);
    const p = wide ? v(al.x + t, al.y + al.h / 2) : v(al.x + al.w / 2, al.y + t);
    add({ kind: 'pool', ...p, r: 2.2, color: k % 3 ? '#ff4a2a' : '#ffb03a' });
    if (k % 4 === 2)
      add({ kind: 'crowd', ...p, angle: wide ? 0 : PI / 2, n: 3, seed: k + Math.round(p.x) });
  }
  const c = wide
    ? [v(al.x + 5, al.y + 0.3), v(al.x + al.w - 5, al.y + 0.3)]
    : [v(al.x + 0.3, al.y + 5), v(al.x + 0.3, al.y + al.h - 5)];
  add({ kind: 'neon', a: c[0], b: c[1], color: '#ff4a3a', flicker: 0.6 });
}
// taxi rank
paint([v(249.3, 61), v(252.5, 61), v(252.5, 100), v(249.3, 100)], 0.18, YELLOW);
add({
  kind: 'text',
  x: 251,
  y: 104,
  angle: 0,
  text: 'TAXI',
  size: 1.4,
  color: 'rgba(225,170,40,0.7)',
});
for (const t of taxis)
  add({ kind: 'pool', x: t.x + t.w / 2, y: t.y + t.h / 2, r: 1.5, color: '#ffd060' });

// expressway tops: parapet and rails on the barrier, sound wall on the outside, works barriers
for (const run of cut(ring(21), inGap)) {
  paint(run, 4, '#3d3e44', undefined, true);
}
for (const d of [19.35, 22.65])
  for (const run of cut(ring(d), inGap)) paint(run, 0.3, '#8b949e', undefined, true);
for (const run of cut(ring(19.5), inGap)) paint(run, 0.22, '#ffb030', [0.25, 3.75], true);
paint(ring(0.5), 1.1, '#3d3e44', undefined, true);
paint(ring(1.1), 0.25, '#8b949e', undefined, true);
paint(ring(1), 0.2, '#ffb030', [0.25, 3.75], true);
for (const s of BARRIERS) {
  const horiz = s.w >= s.h;
  const a = horiz ? v(s.x, s.y + s.h / 2) : v(s.x + s.w / 2, s.y);
  const b = horiz ? v(s.x + s.w, s.y + s.h / 2) : v(s.x + s.w / 2, s.y + s.h);
  paint([a, b], horiz ? s.h : s.w, '#e8e6e0', undefined, true);
  paint([a, b], horiz ? s.h : s.w, '#c0392b', [1, 1], true);
  add({ kind: 'neon', a, b, color: '#ffb03a', flicker: 1 });
}
// overhead signs over the deck
add({
  kind: 'sign',
  x: 322,
  y: 10,
  w: 16,
  h: 1.8,
  angle: PI / 2,
  color: '#3fbf7f',
  text: 'NEON LOOP',
  seed: 0,
});
add({
  kind: 'sign',
  x: 390,
  y: 150,
  w: 16,
  h: 1.8,
  angle: 0,
  color: '#3fbf7f',
  text: 'EXIT 7',
  seed: 0,
});

const total = tokyoRoute[0].points
  .slice(1)
  .reduce((sum, b, i) => sum + Math.hypot(b.x - C.line[i].x, b.y - C.line[i].y), 0);
// same scale as B2 MEET: the old 812 m route ran medals [4500, 10000, 17500]
const OLD_LEN = 812;

export const tokyo: DecoratedMap = {
  name: 'TOKYO NIGHTS',
  parTime: Math.round(total / 17),
  medals: [4500, 10000, 17500].map((m) => Math.round((m * total) / OLD_LEN / 500) * 500) as [
    number,
    number,
    number,
  ],
  floors: [floor],
  helixes: [],
  start: { floor: 0, pos: START, angle: 0 },
  finish: { floor: 0, zone: FINISH },
  decor,
};
