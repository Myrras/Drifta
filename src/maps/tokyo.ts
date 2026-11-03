import { CAR_MODELS } from '../models';
import type { CityGraph, Lane, Signal, Walkway } from '../traffic';
import type { BonusZone, CarModel, Floor, Rect, Solid, Vec } from '../types';
import type { Decor, DecoratedMap } from './decor';

// TOKYO NIGHTS: a neon district at night inside an expressway loop. One flowing two-way street
// loops the district; the run starts on a dead-end stub off its south side and forks. Route A
// (downtown) sweeps east, up a hairpin and right over the scramble crossing; route B (canal) runs
// the canal bank under the train viaduct and flicks through a chicane under the station. Both meet
// on the frontage road under the expressway, climb the on-ramp past the parked police and lap three
// sweepers of the deck to the finish on its west side. Side streets are closed off.
const W = 400;
const H = 300;
const PI = Math.PI;
const v = (x: number, y: number): Vec => ({ x, y });
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const headOf = (a: Vec, b: Vec) => Math.atan2(b.y - a.y, b.x - a.x);
const dist = (a: Vec, b: Vec) => Math.hypot(b.x - a.x, b.y - a.y);

// --- expressway ring ---
// Deck centerline at inset 10 (deck 1..19, barrier 19..23), corner radii of that centerline:
// nw, ne, se, sw. The deck, its barrier and the canal are concentric with these corners.
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
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
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
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, h: headOf(a, b) };
}
/** Sub-polyline from s0 to s1 (s1 may pass the end of a closed path). */
function sub(p: Path, s0: number, s1: number): Vec[] {
  const out: Vec[] = [at(p, s0)];
  for (const off of p.closed ? [0, p.len] : [0])
    p.cum.forEach((c, i) => {
      if (c + off > s0 + 1e-6 && c + off < s1 - 1e-6) out.push(p.pts[i]);
    });
  out.push(at(p, s1));
  return out.filter((q, i) => !i || dist(q, out[i - 1]) > 1e-6).map((q) => v(q.x, q.y));
}
/** Resampled every `step` m, so long straights can be cut. */
function dense(pts: Vec[], step = 2): Vec[] {
  const p = path(pts);
  const n = Math.max(1, Math.ceil(p.len / step));
  return Array.from({ length: n + 1 }, (_, i) =>
    v(at(p, (p.len * i) / n).x, at(p, (p.len * i) / n).y),
  );
}
/** Extra points on segments longer than `step`; every vertex (and so every kink) kept. */
function densify(pts: Vec[], step = 2): Vec[] {
  const out: Vec[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const n = Math.ceil(dist(a, b) / step);
    for (let k = 1; k <= n; k++)
      out.push(v(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n));
  }
  return out.filter((q, i) => !i || dist(q, out[i - 1]) > 1e-6);
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
const segDist = (p: Vec, a: Vec, b: Vec) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
const polyDist = (p: Vec, pts: Vec[]) =>
  Math.min(...pts.slice(1).map((b, i) => segDist(p, pts[i], b)));
/** Parallel polyline d m to the right of travel (negative: left), mitered at the vertices. */
function offset(pts: Vec[], d: number, closed = false): Vec[] {
  const n = pts.length;
  const nrm = (i: number) => {
    const h = headOf(pts[i], pts[i + 1]);
    return v(-Math.sin(h), Math.cos(h));
  };
  return pts.map((p, i) => {
    const a = i > 0 ? nrm(i - 1) : closed ? nrm(n - 2) : null;
    const b = i < n - 1 ? nrm(i) : closed ? nrm(0) : null;
    const m = !a ? b! : !b ? a : v(a.x + b.x, a.y + b.y);
    const k = a && b ? d / (1 + a.x * b.x + a.y * b.y) : d;
    return v(p.x + m.x * k, p.y + m.y * k);
  });
}
/** Douglas-Peucker. */
function simplify(pts: Vec[], tol: number): Vec[] {
  if (pts.length < 3) return pts;
  const keep = pts.map((_, i) => i === 0 || i === pts.length - 1);
  const todo: [number, number][] = [[0, pts.length - 1]];
  while (todo.length) {
    const [i, j] = todo.pop()!;
    let [k, far] = [-1, tol];
    for (let m = i + 1; m < j; m++) {
      const d = segDist(pts[m], pts[i], pts[j]);
      if (d > far) [k, far] = [m, d];
    }
    if (k >= 0) ((keep[k] = true), todo.push([i, k], [k, j]));
  }
  return pts.filter((_, i) => keep[i]);
}
/** Crossing of polylines a and b nearest to hint, with its arc length along each. */
function cross(a: Path, b: Path, hint: Vec, reach = 40) {
  const near = (p: Path) =>
    p.pts.slice(1).flatMap((q, i) => (segDist(hint, p.pts[i], q) < reach ? [i] : []));
  const nb = near(b);
  let best: { p: Vec; sa: number; sb: number } | null = null;
  for (const i of near(a)) {
    const [p, q] = [a.pts[i], a.pts[i + 1]];
    for (const j of nb) {
      const [r, s] = [b.pts[j], b.pts[j + 1]];
      const d = (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x);
      if (Math.abs(d) < 1e-12) continue;
      const t = ((r.x - p.x) * (s.y - r.y) - (r.y - p.y) * (s.x - r.x)) / d;
      const u = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / d;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      const x = v(p.x + t * (q.x - p.x), p.y + t * (q.y - p.y));
      if (!best || dist(x, hint) < dist(best.p, hint))
        best = {
          p: x,
          sa: a.cum[i] + t * (a.cum[i + 1] - a.cum[i]),
          sb: b.cum[j] + u * (b.cum[j + 1] - b.cum[j]),
        };
    }
  }
  if (!best) throw new Error(`tokyo: no crossing near ${hint.x},${hint.y}`);
  return best;
}
const inPoly = (p: Vec, pts: Vec[]) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [a, b] = [pts[i], pts[j]];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
};
const inGap = (p: Vec) => p.y < 26 && p.x > GAP[0] && p.x < GAP[1];

// --- solids ---
const wall = (x: number, y: number, w: number, h: number): Solid => ({ kind: 'wall', x, y, w, h });
/** Rect of length len and width t centered at c, long side along angle a. */
const box = (c: Vec, len: number, t: number, a: number, kind: Solid['kind'] = 'wall'): Solid => ({
  kind,
  x: c.x - len / 2,
  y: c.y - t / 2,
  w: len,
  h: t,
  angle: a,
});

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
    return box(v(o.x + rm * Math.cos(a), o.y + rm * Math.sin(a)), len, t, a + PI / 2);
  });
}
/** Thin wall along a polyline, t m thick on its right: outer face exactly on the line. */
const curb = (pts: Vec[], t = 1.2): Solid[] =>
  pts.slice(1).map((b, i) => {
    const a = pts[i];
    const h = headOf(a, b);
    const c = v((a.x + b.x) / 2 - (Math.sin(h) * t) / 2, (a.y + b.y) / 2 + (Math.cos(h) * t) / 2);
    return box(c, dist(a, b) + 0.1, t, h);
  });
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

// --- courses ---
type Pose = Vec & { a: number };
/**
 * Course through control points [x, y, radius] (as B2 MEET): every inner point is rounded by an
 * arc (radius 0: a kink). `line` is the driving line, at most 45° per vertex and within 1.5 m of
 * the arc; `fine` follows the arcs exactly (every 3°) for road edges.
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
  const fine: Vec[] = [P[0]];
  let from = P[0];
  for (const c of corners) {
    if (Math.abs(wrap(headOf(from, c.s) - c.a1)) > 1e-3 && dist(from, c.s) > 1e-6)
      throw new Error(`corner ${c.mid.x},${c.mid.y} overlaps`);
    const g = Math.sign(c.turn);
    const arc = (am: number, rr: number) =>
      v(c.o.x + g * rr * Math.sin(am), c.o.y - g * rr * Math.cos(am));
    const n = Math.max(
      Math.ceil(Math.abs(c.turn) / (PI / 4) - 1e-9),
      Math.ceil(Math.abs(c.turn) / (2 * Math.acos(c.r / (c.r + 1.5)))),
    );
    const step = c.turn / n;
    for (let k = 0; k < n; k++) line.push(arc(c.a1 + step * (k + 0.5), c.r / Math.cos(step / 2)));
    const m = Math.ceil(Math.abs(c.turn) / (PI / 60));
    for (let k = 0; k <= m; k++) fine.push(arc(c.a1 + (c.turn * k) / m, c.r));
    from = c.e;
  }
  line.push(P[P.length - 1]);
  fine.push(P[P.length - 1]);
  return {
    line: line.filter((q, i) => !i || dist(q, line[i - 1]) > 1e-6),
    corners,
    fine: densify(fine),
  };
}

// --- roads ---
// The loop runs in route A's direction (counterclockwise on screen): its right edge faces out.
const HALF = 8;
const SIDE = 5; // closed side streets
const F = v(210, 230); // the fork: the start stub meets the loop, the scramble straight ahead
const SCRAMBLE = v(210, 125);
const J = v(210, 31); // route A turns onto the frontage road
const LOOP = [
  [F.x, F.y],
  [255, 230, 40], // S-bend...
  [283, 210, 40],
  [338, 210, 30], // SE sweeper
  [338, 165, 32], // S-bend...
  [322, 140, 32],
  [322, 72, 14], // hairpin...
  [290, 72, 15], // ...round
  [290, 125, 24], // right, west
  [SCRAMBLE.x, SCRAMBLE.y, 0], // the scramble: a plain crossing
  [J.x, J.y, 12], // frontage road, west
  [165, 31, 36], // S-bend away from the expressway...
  [140, 52, 36],
  [55, 52, 30], // NW sweeper, down the canal
  [55, 142, 12], // station chicane: jog east...
  [68, 155, 12], // ...and on south
  [68, 230, 35], // SW sweeper
  [F.x, F.y],
];
type Road = { c: Vec[]; half: number; closed?: boolean };
const road = (pts: Vec[], half = SIDE): Road => ({ c: densify(pts), half });
const ROAD = {
  loop: { c: course(LOOP).fine, half: HALF, closed: true },
  stub: road([v(F.x, 300), v(F.x, F.y - HALF)], HALF),
  ramp: road([v(J.x - 5, J.y), v(340, J.y)], HALF),
  // the scramble's other two arms, pedestrianized, then side streets
  west: road([SCRAMBLE, v(40, SCRAMBLE.y)], HALF),
  south: road([SCRAMBLE, v(SCRAMBLE.x, 245)], HALF),
  n1: road([v(100, 45), v(100, 130)]),
  s1: road([v(140, 120), v(140, 240)]),
  e1: road([v(262, 120), v(262, 240)]),
  ne1: road([v(205, 80), v(292, 80)]),
} satisfies Record<string, Road>;
/** The side streets and scramble arms: closed where they meet an open road, first end and last. */
const CLOSED: [RoadId, boolean, boolean][] = [
  ['west', true, true],
  ['south', true, true],
  ['n1', true, false],
  ['s1', false, true],
  ['e1', true, true],
  ['ne1', true, true],
];
type RoadId = keyof typeof ROAD;

// --- blocks ---
/** A block side: polyline with the block on its right; solid = curb walls; face = shop fronts. */
type Edge = { p: Path; solid: boolean | ((q: Vec) => boolean); face: boolean };
const sideOf = (id: RoadId, right: boolean): Edge => {
  const r: Road = ROAD[id];
  const pts = offset(r.c, right ? r.half : -r.half, r.closed);
  return { p: path(right ? pts : pts.reverse(), r.closed), solid: true, face: true };
};
const Rt = (id: RoadId) => sideOf(id, true);
const Lt = (id: RoadId) => sideOf(id, false);
const BAR: Edge = { p: path(ring(19.5), true), solid: false, face: false }; // under the barrier
/** Straight side between two blocks, or a dead end (solid where `solid` says). */
const cap = (pts: Vec[], solid: Edge['solid'] = false): Edge => ({
  p: path(densify(pts, 1)),
  solid,
  face: false,
});
const C322 = cap([v(322, 10), v(322, 75)], (q) => q.y < 39); // the frontage road's dead end
const CSE = cap([v(300, 166), v(370, 289)]);
const CSW = cap([v(83, 215), v(33, 265)]);
const CNW = cap([v(75, 72), v(25, 22)]);
const C170 = cap([v(170, 10), v(170, 30)]);
const rev = (e: Edge): Edge => ({ ...e, p: path([...e.p.pts].reverse()) });

type Kind = 'built' | 'quay';
/** Each entry: a side and the corner at its end (near x, y). */
// prettier-ignore
const BLOCKS: { kind: Kind; spec: [Edge, number, number][] }[] = [
  // inside the loop: north-west, north, west, south of the scramble, inside route A's hairpin
  { kind: 'built', spec: [[Lt('loop'), 95, 60], [Rt('n1'), 95, 117], [Rt('west'), 63, 117]] },
  { kind: 'built', spec: [[Lt('loop'), 202, 117], [Rt('west'), 105, 117], [Lt('n1'), 105, 60]] },
  { kind: 'built', spec: [[Lt('west'), 135, 133], [Rt('s1'), 135, 222], [Lt('loop'), 63, 133]] },
  { kind: 'built', spec: [[Lt('west'), 202, 133], [Rt('south'), 202, 222], [Lt('loop'), 145, 222], [Lt('s1'), 145, 133]] },
  { kind: 'built', spec: [[Lt('loop'), 257, 133], [Rt('e1'), 257, 220], [Lt('loop'), 218, 222], [Lt('south'), 218, 133]] },
  { kind: 'built', spec: [[Lt('loop'), 267, 218], [Lt('e1'), 267, 133]] },
  // outside: north-east of the scramble, round the hairpin, south-east, south-west, the canal
  // quay, under the expressway in the north-west
  { kind: 'built', spec: [[Rt('loop'), 218, 39], [Rt('ramp'), 322, 39], [C322, 322, 69], [Rt('loop'), 282, 75], [Lt('ne1'), 218, 75]] },
  { kind: 'built', spec: [[Rt('ne1'), 282, 85], [Rt('loop'), 218, 85]] },
  { kind: 'built', spec: [[rev(C322), 322, 19.5], [BAR, 363, 276], [rev(CSE), 327, 213], [Rt('loop'), 322, 69]] },
  { kind: 'built', spec: [[Rt('stub'), 218, 238], [Rt('loop'), 327, 213], [CSE, 363, 276], [BAR, 218, 280.5]] },
  { kind: 'built', spec: [[Rt('loop'), 202, 238], [Lt('stub'), 202, 280.5], [BAR, 38, 262], [rev(CSW), 73, 225]] },
  { kind: 'quay', spec: [[Rt('loop'), 73, 225], [CSW, 38, 262], [BAR, 34, 31], [rev(CNW), 58, 55]] },
  { kind: 'built', spec: [[BAR, 170, 19.5], [C170, 170, 24], [Rt('loop'), 58, 55], [CNW, 34, 31]] },
];

type Poly = { pts: Vec[]; solid: boolean[]; face: boolean[] }; // flags: segment i -> i + 1
/** Rounds every corner sharper than 50° with a curb of radius r. */
function roundCorners(q: Poly, r = 6): Poly {
  const n = q.pts.length;
  const cum = [0];
  for (let i = 1; i <= n; i++) cum.push(cum[i - 1] + dist(q.pts[i - 1], q.pts[i % n]));
  const L = cum[n];
  const P = path([...q.pts, q.pts[0]], true);
  const sharp = new Map<number, number>(); // vertex -> tangent length
  for (let i = 0; i < n; i++) {
    const turn = wrap(
      headOf(q.pts[i], q.pts[(i + 1) % n]) - headOf(q.pts[(i + n - 1) % n], q.pts[i]),
    );
    // curbs only: a rounded corner against a cap would open a gap into the block
    if (Math.abs(turn) > (50 * PI) / 180 && q.solid[(i + n - 1) % n] && q.solid[i])
      sharp.set(i, Math.min(10, r * Math.tan(Math.abs(turn) / 2)));
  }
  const gap = (a: number, b: number) => Math.abs(((cum[a] - cum[b] + 1.5 * L) % L) - L / 2);
  const out: Poly = { pts: [], solid: [], face: [] };
  for (let i = 0; i < n; i++) {
    if ([...sharp].some(([c, t]) => c !== i && gap(i, c) < t)) continue;
    const t = sharp.get(i);
    if (t === undefined) {
      out.pts.push(q.pts[i]);
      out.solid.push(q.solid[i]);
      out.face.push(q.face[i]);
      continue;
    }
    const [A, B, V] = [at(P, cum[i] - t), at(P, cum[i] + t), q.pts[i]];
    const k = (i + n - 1) % n;
    for (let m = 0; m < 8; m++) {
      const u = m / 8;
      const w = [(1 - u) ** 2, 2 * u * (1 - u), u * u];
      out.pts.push(v(w[0] * A.x + w[1] * V.x + w[2] * B.x, w[0] * A.y + w[1] * V.y + w[2] * B.y));
      out.solid.push(q.solid[k] && q.solid[i]);
      out.face.push(q.face[k] && q.face[i]);
    }
    out.pts.push(v(B.x, B.y));
    out.solid.push(q.solid[i]);
    out.face.push(q.face[i]);
  }
  return out;
}
/** Block outline from its sides: crossings of consecutive sides, sharp corners rounded. */
function polygon(spec: [Edge, number, number][]): Poly {
  const n = spec.length;
  const X = spec.map(([e, x, y], i) => cross(e.p, spec[(i + 1) % n][0].p, v(x, y)));
  const q: Poly = { pts: [], solid: [], face: [] };
  spec.forEach(([e], i) => {
    const s0 = X[(i + n - 1) % n].sb;
    let s1 = X[i].sa;
    if (s1 < s0) {
      if (!e.p.closed) throw new Error(`tokyo: block side runs backwards near ${spec[i][1]}`);
      s1 += e.p.len;
    }
    const piece = sub(e.p, s0, s1);
    for (let k = 0; k < piece.length - 1; k++) {
      const m = v((piece[k].x + piece[k + 1].x) / 2, (piece[k].y + piece[k + 1].y) / 2);
      if (q.pts.length && dist(piece[k], q.pts[q.pts.length - 1]) < 0.05) continue;
      q.pts.push(piece[k]);
      q.solid.push(typeof e.solid === 'function' ? e.solid(m) : e.solid);
      q.face.push(e.face);
    }
  });
  // the scramble's corners get wide curbs: room for the crowds and a sweeping line
  return roundCorners(q, q.pts.some((p) => dist(p, SCRAMBLE) < 12) ? 10 : 6);
}
/** Runs of consecutive segments with the flag set, as polylines. */
function runs(q: Poly, flag: boolean[]): Vec[][] {
  const n = q.pts.length;
  const start = flag.findIndex((f, i) => f && !flag[(i + n - 1) % n]);
  if (start < 0) return flag[0] ? [[...q.pts, q.pts[0]]] : [];
  const out: Vec[][] = [];
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (!flag[i]) continue;
    if (!flag[(i + n - 1) % n] || !out.length) out.push([q.pts[i]]);
    out[out.length - 1].push(q.pts[(i + 1) % n]);
  }
  return out;
}
const blocks = BLOCKS.map(({ kind, spec }) => {
  const q = polygon(spec);
  const xs = q.pts.map((p) => p.x);
  const ys = q.pts.map((p) => p.y);
  const bbox: Rect = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
  /** Outline grown inward by d m, with the side flags. */
  const inset = (d: number): Poly => ({
    ...q,
    pts: offset([...q.pts, q.pts[0]], d, true).slice(0, -1),
  });
  return { kind, q, bbox, inset };
});

// --- routes ---
const START = v(F.x, 268);
const DECK = [
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
];
const A = course([
  [START.x, START.y],
  [F.x, F.y, 18], // fork right
  ...LOOP.slice(1, 9), // S-bend, SE sweeper, S-bend, hairpin, right
  [SCRAMBLE.x, SCRAMBLE.y, 20], // right through the scramble
  [J.x, J.y, 16], // right onto the frontage road
  ...DECK,
]);
const B = course([
  [START.x, START.y],
  [F.x, F.y, 19], // fork left
  ...LOOP.slice(11, 17).reverse(), // SW sweeper, chicane, NW sweeper, S-bend
  ...DECK,
]);
/** Fillet radius and signed turn of every corner, per route (see tokyo.test). */
export const tokyoCorners = [A, B].map((c) => c.corners.map(({ r, turn }) => ({ r, turn })));
/** Route A (downtown, over the scramble) and route B (canal); par runs on A. */
export const tokyoRoute: { floor: number; points: Vec[] }[] = [
  { floor: 0, points: A.line },
  { floor: 0, points: B.line },
];
const FINISH: Rect = { x: 1.5, y: 184, w: 17, h: 14 };

/** Clipping zones: 5 m squares outside a corner of each route and two deck sweepers. */
const cornerNear = (c: typeof A, x: number, y: number) =>
  c.corners.reduce((a, b) => (dist(b.mid, v(x, y)) < dist(a.mid, v(x, y)) ? b : a));
const clipZones: Rect[] = [
  cornerNear(A, 330, 200), // SE sweeper
  cornerNear(A, 300, 70), // hairpin
  cornerNear(B, 75, 220), // SW sweeper
  cornerNear(B, 65, 60), // NW sweeper
  cornerNear(A, 375, 25), // NE deck sweeper
  cornerNear(A, 30, 270), // SW deck sweeper
].map(({ turn, mid }) => {
  const g = Math.sign(turn);
  const x = mid.x + g * 4.5 * Math.sin(mid.a);
  const y = mid.y - g * 4.5 * Math.cos(mid.a);
  return { x: x - 2.5, y: y - 2.5, w: 5, h: 5 };
});
/** The scramble: drift its way in and its way out in one combo. */
const bonusZones: BonusZone[] = [
  { x: 213, y: 115, w: 20, h: 18, id: 'scramble', trick: 'SCRAMBLE' },
  { x: 201, y: 100, w: 18, h: 18, id: 'scramble', trick: 'SCRAMBLE' },
];

// --- parked cars ---
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
function parked(
  c: Vec,
  facing: number,
  model: CarModel,
  color: string,
  extra: Partial<Solid> = {},
): Solid {
  const { length, width } = CAR_MODELS[model];
  return { ...box(c, length, width, facing, 'car'), facing, model, color, ...extra };
}
/** Center of a car parked `along` m from x0 on a curb running along h, the road on its left. */
const atCurb = (x0: Vec, h: number, along: number, model: CarModel) => {
  const d = 0.35 + CAR_MODELS[model].width / 2;
  return v(
    x0.x + Math.cos(h) * along + Math.sin(h) * d,
    x0.y + Math.sin(h) * along - Math.cos(h) * d,
  );
};
// police by the on-ramp: two on the frontage road's curb, one across its dead end
const police: Solid[] = [
  parked(atCurb(v(236, 39), 0, 0, 'r32'), PI, 'r32', '#16171b', { police: true }),
  parked(atCurb(v(236, 39), 0, 6.5, 'wrx'), PI, 'wrx', '#16171b', { police: true }),
  parked(v(314, 31), PI / 2 - 0.35, 'r32', '#16171b', { police: true }),
];
// taxi rank on route B's south straight, vans with hazards up route A's hairpin
const TAXI = ['#f2c230', '#f2c230', '#2e7d4f', '#1b1c20', '#f2c230'];
const taxis = TAXI.map((color, i) =>
  parked(atCurb(v(185, 238), 0, -i * 6.2, 'civic'), PI, 'civic', color),
);
const vrand = rng(77);
const vans = [122, 104].map((y) => {
  const model = MODELS[Math.floor(vrand() * MODELS.length)];
  const { colors } = CAR_MODELS[model];
  const color = colors[Math.floor(vrand() * colors.length)];
  return parked(atCurb(v(330, y), -PI / 2, 0, model), PI / 2, model, color, { lights: 'hazard' });
});

// --- closures: a barrier with cones across both ends of every side street ---
const loopPath = path(ROAD.loop.c, true);
const closures = CLOSED.flatMap(([id, first, last]) => {
  const r: Road = ROAD[id];
  const p = path(r.c);
  /** From one end (dir +1: first, -1: last): onto the loop, then 6.5 m clear of its edge. */
  const from = (dir: number) => {
    let s = dir > 0 ? 0 : p.len;
    while (polyDist(at(p, s), ROAD.loop.c) > HALF) s += dir * 0.5;
    while (polyDist(at(p, s), ROAD.loop.c) < HALF + 6.5) s += dir * 0.5;
    // out: toward the open road, where the cones stand
    return { q: at(p, s), half: r.half, out: -dir };
  };
  return [...(first ? [from(1)] : []), ...(last ? [from(-1)] : [])];
});
type Closure = (typeof closures)[number];
const along = (c: Closure, back: number, o: number) =>
  v(
    c.q.x + Math.cos(c.q.h) * back * c.out - Math.sin(c.q.h) * o,
    c.q.y + Math.sin(c.q.h) * back * c.out + Math.cos(c.q.h) * o,
  );
const conesOf = (c: Closure) =>
  [-0.75, -0.25, 0.25, 0.75].map((k, i) => along(c, 1.7 + (i % 2) * 0.6, (c.half - 1) * k));
const closureSolids = closures.flatMap((c) => [
  box(c.q, 0.8, 2 * c.half + 0.6, c.q.h),
  ...conesOf(c).map((p) => box(p, 0.5, 0.5, 0, 'pillar')),
]);

// --- the station over the chicane: a colonnade along both curbs ---
const STATION: [number, number] = [134, 166]; // y range of the concourse
const columns: Solid[] = [];
for (let s = 0, last = -Infinity; s < loopPath.len; s += 1) {
  const q = at(loopPath, s);
  if (q.x > 90 || q.y < STATION[0] || q.y > STATION[1] || s - last < 7) continue;
  last = s;
  for (const side of [-1, 1])
    columns.push(
      box(
        v(q.x - Math.sin(q.h) * 7.35 * side, q.y + Math.cos(q.h) * 7.35 * side),
        1.1,
        1.1,
        q.h,
        'pillar',
      ),
    );
}

const solids: Solid[] = [
  ...expressway,
  ...BARRIERS,
  ...blocks.flatMap((b) => runs(b.q, b.q.solid).flatMap((r) => curb(simplify(r, 0.05)))),
  ...closureSolids,
  ...columns,
  ...police,
  ...taxis,
  ...vans,
];

// --- traffic: the loop both ways (left-hand traffic); the scramble is its only signal ---
const TRAFFIC = course(LOOP.map((c) => (c[2] === 0 ? [c[0], c[1], 12] : c))).fine;
const BOX: Rect = { x: SCRAMBLE.x - 14, y: SCRAMBLE.y - 14, w: 28, h: 28 }; // box and crosswalks
const inBox = (p: Vec) => p.x > BOX.x && p.x < BOX.x + BOX.w && p.y > BOX.y && p.y < BOX.y + BOX.h;
const lanes: Lane[] = [];
for (const [id, pts] of [
  ['cw', TRAFFIC],
  ['ccw', [...TRAFFIC].reverse()],
] as const) {
  const p = path(offset(pts, -3.5, true), true);
  let sIn = -1;
  let sOut = -1;
  for (let s = 0.5; s < p.len; s += 0.25) {
    const [was, is] = [inBox(at(p, s - 0.25)), inBox(at(p, s))];
    if (!was && is) sIn = s;
    if (was && !is && sIn >= 0) sOut = s;
  }
  lanes.push(
    { id: `${id}:run`, pts: sub(p, sOut, sIn + p.len), speed: 11, next: [`${id}:box`] },
    {
      id: `${id}:box`,
      pts: sub(p, sIn, sOut),
      speed: 7,
      next: [`${id}:run`],
      light: { id: 'Sa', stopAt: 0 },
    },
  );
}

/** Two-phase program with all-red clearances, plus an all-red pedestrian scramble. */
function program(id: string, ped: number): Signal[] {
  const [ga, gb, clear] = [18, 13, 3];
  const scramble: Signal['cycle'] = [
    { car: 'red', ped: true, dur: ped },
    { car: 'red', ped: false, dur: 5 },
  ];
  return [
    {
      id: `${id}a`,
      offset: 0,
      cycle: [
        { car: 'green', ped: false, dur: ga },
        { car: 'amber', ped: false, dur: 3 },
        { car: 'red', ped: false, dur: clear + gb + 3 + clear },
        ...scramble,
      ],
    },
    {
      id: `${id}b`,
      offset: 0,
      cycle: [
        { car: 'red', ped: false, dur: ga + 3 + clear },
        { car: 'green', ped: false, dur: gb },
        { car: 'amber', ped: false, dur: 3 },
        { car: 'red', ped: false, dur: clear },
        ...scramble,
      ],
    },
  ];
}

/** Walkway with an optional kerb hint: the side of pts order (a -> b) where the road is, -1 = left. */
export type KerbWalkway = Walkway & { kerb?: -1 | 1 };
const ZEBRA = HALF + 2.5; // crosswalk centers off the scramble's center
const crossings: KerbWalkway[] = [];
{
  const { x, y } = SCRAMBLE;
  const e = HALF + 2;
  const lines: [Vec, Vec][] = [
    [v(x - e, y - ZEBRA), v(x + e, y - ZEBRA)],
    [v(x - e, y + ZEBRA), v(x + e, y + ZEBRA)],
    [v(x - ZEBRA, y - e), v(x - ZEBRA, y + e)],
    [v(x + ZEBRA, y - e), v(x + ZEBRA, y + e)],
    [v(x - e, y - e), v(x + e, y + e)],
    [v(x + e, y - e), v(x - e, y + e)],
  ];
  // three parallel files per crossing: crowds
  for (const [a, b] of lines)
    for (const o of [-1.3, 0, 1.3]) {
      const h = headOf(a, b);
      const n = v(-Math.sin(h) * o, Math.cos(h) * o);
      crossings.push({
        id: `Sx${crossings.length}`,
        pts: [v(a.x + n.x, a.y + n.y), v(b.x + n.x, b.y + n.y)],
        crossing: { signal: 'Sa' },
      });
    }
}
const sidewalks: KerbWalkway[] = blocks.map((b, i) => {
  const pts = simplify([...b.inset(2).pts, b.inset(2).pts[0]], 0.2);
  return { id: `walk${i}`, pts, kerb: -1 };
});

export const tokyoCity: CityGraph = {
  lanes,
  signals: program('S', 28),
  walkways: [...sidewalks, ...crossings],
  cars: 30,
  peds: 56,
};

// --- street lights: alternate curbs every 22 m ---
const lights: Vec[] = [];
/** Where each lamp's light lands: out over the lane. */
const lamps: Vec[] = [];
for (const r of [ROAD.loop, ROAD.ramp, ROAD.stub] as Road[]) {
  const p = path(r.c, r.closed);
  for (let s = 8, k = 0; s < p.len; s += 22, k++) {
    const q = at(p, s);
    const o = (k % 2 ? 1 : -1) * (r.half - 1.2);
    const n = v(-Math.sin(q.h), Math.cos(q.h));
    const l = v(q.x + n.x * o, q.y + n.y * o);
    if (l.x < 25 || l.y < 25 || l.x > W - 25 || l.y > H - 25 || inBox(l)) continue;
    lights.push(l);
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
  bonusZones,
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
const ZEBRA_W = 'rgba(225,225,215,0.55)';
const WALK = 4.5;
const CITY = ring(21); // inside the barrier tops
const inCity = (p: Vec) => inPoly(p, CITY);
/** Where streets meet: no lane lines. */
const MOUTHS: [Vec, number][] = [
  [SCRAMBLE, HALF + 6],
  [J, HALF + 12],
  [F, HALF + 5],
  ...closures.map((c): [Vec, number] => [along(c, HALF + 6.5, 0), c.half + 3]),
];
const nearMouth = (p: Vec, pad = 0) => MOUTHS.some(([c, r]) => dist(p, c) < r + pad);
/** Floor text facing a driver heading h. */
const say = (p: Vec, h: number, text: string, size = 2.2) =>
  add({ kind: 'text', ...p, angle: h + PI / 2, text, size, color: 'rgba(225,225,215,0.45)' });

// street lamps light the road well past the render's ceiling-lamp pools: drivable reads lighter
for (const l of lamps) add({ kind: 'pool', ...l, r: 12, color: '#1e222b' });
// ground: wet asphalt, the deck a smoother tone, the ramp up to it
add({ kind: 'asphalt', x: 0, y: 0, w: W, h: H, seed: 1 });
paint(ring(10), 18, '#34353b');
paint([v(256, 31), v(272, 31), v(302, 10), v(318, 10)], 13, '#34353b');
// shadow cast by the deck along the frontage road, with pillar shadows
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

// streets: double yellow down the loop, edge lines, dashed side streets
const loopC = ROAD.loop.c;
for (const o of [-0.2, 0.2])
  for (const run of cut(offset(loopC, o, true), (p) => nearMouth(p))) paint(run, 0.13, YELLOW);
for (const o of [1 - HALF, HALF - 1])
  for (const run of cut(offset(loopC, o, true), (p) => nearMouth(p, 2))) paint(run, 0.15, PAINT_W);
for (const id of ['stub', 'west', 'south', 'n1', 's1', 'e1', 'ne1'] as RoadId[])
  for (const run of cut(ROAD[id].c, (p) => nearMouth(p) || !inCity(p)))
    paint(run, 0.15, PAINT_W, [3, 3]);
paint([v(228, 37), v(262, 37)], 0.15, PAINT_W);
paint([v(230, 31), v(258, 31)], 0.15, PAINT_W, [3, 3]);
// lane arrows on the straighter stretches, manholes and oil stains
for (const lane of lanes.filter((l) => l.id.endsWith(':run'))) {
  const p = path(lane.pts);
  for (let s = 30; s < p.len - 10; s += 55) {
    const [a, q, b] = [at(p, s - 6), at(p, s), at(p, s + 6)];
    if (Math.abs(wrap(b.h - a.h)) < 0.08 && !nearMouth(q, 6))
      add({ kind: 'arrow', x: q.x, y: q.y, angle: q.h });
  }
}
for (let s = 15; s < loopPath.len; s += 25 + rand() * 30) {
  const q = at(loopPath, s);
  const o = (rand() - 0.5) * 9;
  const p = v(q.x - Math.sin(q.h) * o, q.y + Math.cos(q.h) * o);
  if (nearMouth(p)) continue;
  if (rand() < 0.6) add({ kind: 'manhole', ...p });
  else add({ kind: 'stain', ...p, r: 0.6 + rand() * 0.6 });
}
// the scramble: zebras on every arm, both diagonals, stop lines for the loop
{
  const { x, y } = SCRAMBLE;
  const e = HALF - 0.3;
  for (const [a, b] of [
    [v(x - e, y - ZEBRA), v(x + e, y - ZEBRA)],
    [v(x - e, y + ZEBRA), v(x + e, y + ZEBRA)],
    [v(x - ZEBRA, y - e), v(x - ZEBRA, y + e)],
    [v(x + ZEBRA, y - e), v(x + ZEBRA, y + e)],
    [v(x - e + 1.2, y - e + 1.2), v(x + e - 1.2, y + e - 1.2)],
    [v(x + e - 1.2, y - e + 1.2), v(x - e + 1.2, y + e - 1.2)],
  ])
    paint([a, b], 4, ZEBRA_W, [0.45, 0.45]);
  paint([v(x + ZEBRA + 2.6, y + 0.3), v(x + ZEBRA + 2.6, y + e)], 0.45, ZEBRA_W);
  paint([v(x + 0.3, y - ZEBRA - 2.6), v(x + e, y - ZEBRA - 2.6)], 0.45, ZEBRA_W);
}

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

// blocks: plazas at the scramble corners, the canal quay paved
const PLAZA: Rect[] = [-1, 1].flatMap((i) =>
  [-1, 1].map((j) => ({
    x: SCRAMBLE.x + (i < 0 ? -HALF - 18 : HALF),
    y: SCRAMBLE.y + (j < 0 ? -HALF - 16 : HALF),
    w: 18,
    h: 16,
  })),
);
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
blocks.forEach((b, i) =>
  add({
    kind: 'block',
    ...b.bbox,
    walk: b.kind === 'built' ? WALK : 2,
    seed: i + 1,
    pts: b.q.pts,
    open: b.kind === 'quay' ? [b.bbox] : PLAZA.filter((o) => overlaps(o, b.bbox)),
  }),
);
const inOpen = (p: Vec, pad = 0) =>
  PLAZA.some(
    (o) => p.x > o.x - pad && p.x < o.x + o.w + pad && p.y > o.y - pad && p.y < o.y + o.h + pad,
  );

// facades: shop fronts, blade and name signs, neon, vending machines, people
for (const b of blocks.filter((b) => b.kind === 'built')) {
  const face = b.inset(WALK);
  for (const run of runs(face, face.face)) {
    const pts = simplify(run, 0.35);
    for (let i = 1; i < pts.length; i++) {
      const [a, c] = [pts[i - 1], pts[i]];
      const len = dist(a, c);
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
          add({
            kind: 'front',
            ...pt(s),
            angle: h,
            len: l,
            color,
            seed: Math.round(s * 7 + i * 13),
          });
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
  }
  // rooftop billboards, well inside the block
  const outline = [...b.q.pts, b.q.pts[0]];
  for (let k = 0, tries = 0; k < 2 && tries < 40; tries++) {
    const p = v(b.bbox.x + rand() * b.bbox.w, b.bbox.y + rand() * b.bbox.h);
    if (!inPoly(p, b.q.pts) || polyDist(p, outline) < 11 || inOpen(p, 8)) continue;
    add({
      kind: 'sign',
      ...p,
      w: 9 + rand() * 4,
      h: 2.6,
      angle: rand() < 0.5 ? 0 : PI / 2,
      color: pick(NEON),
      text: pick(NAMES),
      seed: k++,
    });
  }
}

// the scramble: screens on the corner buildings, crowds waiting at every corner, white light
{
  const { x, y } = SCRAMBLE;
  add({ kind: 'screen', x: x - 30, y: y - 28, w: 15, h: 6, angle: -PI / 4, seed: 1 });
  add({ kind: 'screen', x: x + 30, y: y - 28, w: 15, h: 6, angle: PI / 4, seed: 2 });
  add({ kind: 'screen', x: x + 30, y: y + 28, w: 13, h: 5.5, angle: -PI / 4, seed: 3 });
  add({ kind: 'screen', x: x - 22, y: y - 46, w: 11, h: 4.5, angle: 0, seed: 4 });
  add({
    kind: 'sign',
    x: x - 30,
    y: y + 28,
    w: 13,
    h: 3.6,
    angle: PI / 4,
    color: '#ff2d95',
    text: 'HIKARI',
    seed: 0,
  });
  add({ kind: 'pool', x, y, r: 22, color: '#d8e4ff' });
  for (const [i, j] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    const [cx, cy] = [x + i * 13, y + j * 13];
    const toward = Math.atan2(y - cy, x - cx);
    for (let k = 0; k < 3; k++) {
      const a = toward + PI + (k - 1) * 0.9;
      const px = cx + Math.cos(a) * 3.2;
      const py = cy + Math.sin(a) * 3.2;
      add({
        kind: 'crowd',
        x: px,
        y: py,
        angle: toward,
        n: 6 + k,
        seed: Math.round(px * 7 + py * 13),
      });
    }
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
  const west = p.x < SCRAMBLE.x;
  add({
    kind: 'vending',
    x: west ? p.x + 0.8 : p.x + p.w - 0.8,
    y: c.y,
    angle: west ? 0 : PI,
    n: 3,
    seed: p.x,
  });
}
// taxi rank
paint([v(186.8, 237.7), v(186.8, 234.6), v(158, 234.6), v(158, 237.7)], 0.18, YELLOW);
add({
  kind: 'text',
  x: 154,
  y: 236.2,
  angle: PI / 2,
  text: 'TAXI',
  size: 1.4,
  color: 'rgba(225,170,40,0.7)',
});
for (const t of taxis)
  add({ kind: 'pool', x: t.x + t.w / 2, y: t.y + t.h / 2, r: 1.5, color: '#ffd060' });

// the canal under the expressway, the train viaduct along its bank, the station over route B's
// chicane, lanterns along the quay
const CANAL = course([
  [-4, 241],
  [31, 206, 40],
  [31, 95, 40],
  [-4, 60],
]).fine;
for (const run of cut(CANAL, (p) => !inCity(p))) {
  paint(run, 12, '#0a1720', undefined, true);
  for (const [o, d] of [
    [-3.4, [3, 6]],
    [-0.4, [1.5, 7]],
    [2.8, [2.5, 5]],
  ] as [number, number[]][])
    paint(offset(run, o), 0.12, 'rgba(120,170,230,0.2)', d, true);
  for (const o of [-5.8, 5.8]) paint(offset(run, o), 0.6, '#4a4c52', undefined, true);
}
const VIADUCT = offset(CANAL, 9.5);
for (const run of cut(VIADUCT, (p) => !inCity(p))) {
  paint(offset(run, 3), 9, 'rgba(0,0,0,0.3)', undefined, true); // its shadow
  paint(run, 9, '#2b2c32', undefined, true);
  for (const o of [-4.3, 4.3]) paint(offset(run, o), 0.45, '#5a5d66', undefined, true);
  for (const t of [-2, 2]) {
    paint(offset(run, t), 2.3, '#3a2f26', [0.24, 0.46], true);
    for (const r of [-0.72, 0.72]) paint(offset(run, t + r), 0.1, '#a6adb6', undefined, true);
    paint(offset(run, t), 0.05, 'rgba(160,170,185,0.5)', [6, 0.6], true);
  }
  paint(offset(run, -4.3), 0.7, '#6a6d76', [0.7, 24], true); // catenary masts
  // signal lamps along the deck, so the viaduct reads in the dark
  const p = path(run);
  for (let s = 6; s < p.len; s += 24) add({ kind: 'pool', ...at(p, s), r: 5, color: '#8fb4ff' });
}
// shimmer on the water: light caught by the ripples
{
  const p = path(CANAL);
  for (let s = 40; s < p.len - 40; s += 9) {
    const q = at(p, s);
    const o = Math.sin(s * 1.7) * 2.5;
    const c = v(q.x - Math.sin(q.h) * o, q.y + Math.cos(q.h) * o);
    if (inCity(c)) add({ kind: 'shaft', ...c, w: 4.5, h: 0.7, angle: q.h });
  }
}
{
  // platforms either side of the tracks, a concourse bridging the road to the ticket hall
  const plat = VIADUCT.filter((p) => p.y > STATION[0] && p.y < STATION[1]);
  for (const o of [-5, 5]) {
    paint(offset(plat, o), 2.4, '#55575e', undefined, true);
    paint(offset(plat, o * 0.8), 0.3, '#c9a227', undefined, true);
  }
  paint(plat, 13.2, 'rgba(120,130,150,0.28)', undefined, true); // canopy
  const y = (STATION[0] + STATION[1]) / 2;
  const [a, b] = [v(30, y), v(96, y)];
  paint([a, b], 16, 'rgba(52,56,66,0.62)', undefined, true);
  paint([a, b], 16, 'rgba(0,0,0,0.3)', [0.35, 3.65], true); // roof ribs
  for (const o of [-8, 8]) {
    paint([v(a.x, y + o), v(b.x, y + o)], 0.35, '#8b949e', undefined, true);
    add({
      kind: 'neon',
      a: v(a.x + 2, y + o * 0.9),
      b: v(b.x - 2, y + o * 0.9),
      color: '#bfefff',
      flicker: 0.1,
    });
  }
  add({
    kind: 'sign',
    x: 62,
    y,
    w: 10,
    h: 1.9,
    angle: 0,
    color: '#4dff9a',
    text: 'NEON-MAE',
    seed: 0,
  });
  add({ kind: 'sign', x: 98, y, w: 5, h: 1.2, angle: PI / 2, color: '#2de2ff', seed: 7 });
  for (const x of [48, 62, 76]) add({ kind: 'pool', x, y, r: 7, color: '#cfe6ff' });
}
// lanterns along route B's quay curb, mirrored in the canal
for (let s = 0, k = 0; s < loopPath.len; s += 5) {
  const q = at(loopPath, s);
  if (q.x > 80 || q.y < 66 || q.y > 222 || (q.y > STATION[0] - 4 && q.y < STATION[1] + 4)) continue;
  const p = v(q.x - Math.sin(q.h) * (HALF + 1.4), q.y + Math.cos(q.h) * (HALF + 1.4));
  const color = k++ % 3 ? '#e8402a' : '#ffb03a';
  add({ kind: 'lantern', ...p, color });
  if (p.x < 50 && p.y > 112 && p.y < 190) add({ kind: 'pool', x: p.x - 13, y: p.y, r: 3.5, color });
}
// the closed side streets keep a few lamps; the scramble's arms are pedestrian streets, busy
for (const id of CLOSED.map(([id]) => id)) {
  const p = path(ROAD[id].c);
  for (let s = 10; s < p.len - 10; s += 18) {
    const q = at(p, s);
    if (nearMouth(q, 4) || !inCity(q)) continue;
    add({ kind: 'pool', x: q.x, y: q.y, r: 9, color: '#1e222b' });
    if (id === 'west' || id === 'south') {
      const o = (rand() - 0.5) * 8;
      const c = v(q.x - Math.sin(q.h) * o, q.y + Math.cos(q.h) * o);
      add({
        kind: 'crowd',
        ...c,
        angle: q.h + (rand() < 0.5 ? 0 : PI),
        n: 4 + Math.floor(rand() * 4),
        seed: Math.round(c.x * 7 + c.y * 13),
      });
    }
  }
}

// closures: striped barrier with blinkers, a no-entry sign, a row of cones
for (const c of closures) {
  const e = c.half + 0.3;
  const [a, b] = [along(c, 0, -e), along(c, 0, e)];
  paint([a, b], 0.8, '#e8e6e0', undefined, true);
  paint([a, b], 0.8, '#c0392b', [0.8, 0.8], true);
  add({
    kind: 'neon',
    a: along(c, 0, -e + 0.3),
    b: along(c, 0, -e + 0.7),
    color: '#ffb03a',
    flicker: 1,
  });
  add({
    kind: 'neon',
    a: along(c, 0, e - 0.7),
    b: along(c, 0, e - 0.3),
    color: '#ffb03a',
    flicker: 1,
  });
  add({ kind: 'roadsign', ...along(c, 0.9, 0), angle: c.q.h, sign: 'closed' });
  for (const p of conesOf(c)) add({ kind: 'cone', ...p });
  paint([along(c, -0.6, -e), along(c, -0.6, e)], 0.3, 'rgba(230,80,60,0.5)');
}
// the way to the expressway: green boards, painted EXPWY, the overhead sign by the ramp
{
  const fork = closures.find((c) => c.q.y > 200 && Math.abs(c.q.x - F.x) < 1)!;
  add({ kind: 'roadsign', ...along(fork, 1, 5.2), angle: PI, sign: 'expwy' });
  add({ kind: 'roadsign', ...along(fork, 1, -5.2), angle: 0, sign: 'expwy' });
  add({ kind: 'roadsign', x: SCRAMBLE.x + 13, y: SCRAMBLE.y - 13, angle: -PI / 2, sign: 'expwy' });
  add({ kind: 'roadsign', x: J.x + 13, y: J.y + 13, angle: 0, sign: 'expwy' });
  add({ kind: 'roadsign', x: J.x - 14, y: J.y + 14, angle: 0, sign: 'expwy' });
  say(v(F.x, 254), -PI / 2, 'EXPWY');
  add({ kind: 'arrow', x: F.x - 4, y: 247, angle: -PI / 2 - 0.6 });
  add({ kind: 'arrow', x: F.x + 4, y: 247, angle: -PI / 2 + 0.6 });
  say(v(J.x, 62), -PI / 2, 'EXPWY');
  say(v(120, 52), 0, 'EXPWY');
  say(v(245, 31), 0, 'EXPWY');
  add({
    kind: 'sign',
    x: 252,
    y: J.y,
    w: 16,
    h: 1.8,
    angle: PI / 2,
    color: '#3fbf7f',
    text: 'EXPWY',
    seed: 0,
  });
}

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

const total = A.line.slice(1).reduce((sum, b, i) => sum + dist(A.line[i], b), 0);
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
  start: { floor: 0, pos: START, angle: -PI / 2 },
  finish: { floor: 0, zone: FINISH },
  decor,
};
