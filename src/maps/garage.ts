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
/** Route clearance the outline keeps (m), see garage.test. */
const LANE = 5.3;

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
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

type Pose = Vec & { a: number };

/**
 * Course through control points [x, y, radius]: every inner point is rounded by a circular arc.
 * `line` is the driving line (polygon around each arc, at most 45° per vertex, so painted turn
 * arrows still find their bends); `poses` samples the smooth line every 0.5 m.
 */
function course(ctl: number[][]) {
  const P = ctl.map(([x, y]) => v(x, y));
  const head = (a: Vec, b: Vec) => Math.atan2(b.y - a.y, b.x - a.x);
  // per corner: arc center o, signed turn, arc start s / end e, entry heading a1, apex pose mid
  const corners: { o: Vec; r: number; turn: number; mid: Pose; s: Vec; e: Vec; a1: number }[] = [];
  for (let i = 1; i < P.length - 1; i++) {
    const a1 = head(P[i - 1], P[i]);
    const turn = wrap(head(P[i], P[i + 1]) - a1);
    const r = ctl[i][2];
    const t = r * Math.tan(Math.abs(turn) / 2);
    const g = Math.sign(turn);
    const s = v(P[i].x - t * Math.cos(a1), P[i].y - t * Math.sin(a1));
    const e = v(P[i].x + t * Math.cos(a1 + turn), P[i].y + t * Math.sin(a1 + turn));
    const o = v(s.x - g * r * Math.sin(a1), s.y + g * r * Math.cos(a1));
    const am = a1 + turn / 2;
    const mid = { x: o.x + g * r * Math.sin(am), y: o.y - g * r * Math.cos(am), a: am };
    corners.push({ o, r, turn, mid, s, e, a1 });
  }
  const line: Vec[] = [P[0]];
  const poses: Pose[] = [];
  const straight = (a: Vec, b: Vec) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    for (let d = 0; d < len; d += 0.5)
      poses.push({
        x: a.x + ((b.x - a.x) * d) / len,
        y: a.y + ((b.y - a.y) * d) / len,
        a: head(a, b),
      });
  };
  let from = P[0];
  for (const c of corners) {
    const ahead = Math.hypot(c.s.x - from.x, c.s.y - from.y);
    const back = wrap(head(from, c.s) - c.a1);
    if (ahead > 1e-6 && Math.abs(back) > 1e-3)
      throw new Error(`corner ${c.mid.x},${c.mid.y} overlaps`);
    straight(from, c.s);
    const g = Math.sign(c.turn);
    const n = Math.ceil(Math.abs(c.turn) / (PI / 4) - 1e-9);
    const step = c.turn / n;
    for (let k = 0; k < n; k++) {
      const am = c.a1 + step * (k + 0.5);
      const rr = c.r / Math.cos(step / 2);
      line.push(v(c.o.x + g * rr * Math.sin(am), c.o.y - g * rr * Math.cos(am)));
    }
    const len = Math.abs(c.turn) * c.r;
    for (let d = 0; d < len; d += 0.5) {
      const a = c.a1 + (c.turn * d) / len;
      poses.push({ x: c.o.x + g * c.r * Math.sin(a), y: c.o.y - g * c.r * Math.cos(a), a });
    }
    from = c.e;
  }
  const end = P[P.length - 1];
  straight(from, end);
  line.push(end);
  return { line, poses, corners };
}

// Control points [x, y, fillet radius]. Rhythm per floor: a technical linked section, a short
// straight, a sweeper; corners alternate left/right and open up on exit.
// ROOF: wide S-curves east along the south, a long left sweeper up the east side, then a
// right-left esse along the north into helix 0.
const C0 = course([
  [10, 58],
  [30, 58, 15],
  [46, 71, 12],
  [64, 71, 9],
  [74, 54, 15],
  [106, 54, 28],
  [124, 30, 16],
  [112, 10, 15],
  [96, 10, 12],
  [78, 22, 15],
  [60, 22, 12],
  [46, 6, 12],
  [17, 6],
]);
// LEVEL 2: out of helix 0 into a slalom down to the south aisle, a sweeper north through the
// middle, a pillar chicane along the north, then a right-hander down the east side into helix 1.
const C1 = course([
  [17, 28],
  [34, 28, 15],
  [54, 56, 12],
  [70, 50, 12],
  [98, 50, 24],
  [100, 16, 12],
  [134, 16, 12],
  [134, 40],
]);
// GROUND: up out of helix 1, tight linked corners west through the pillar forest, up the west
// side, then a straight sprint east to the exit gate.
const C2 = course([
  [112, 63],
  [112, 38, 12],
  [96, 38, 9],
  [84, 28, 12],
  [66, 40, 12],
  [50, 40, 15],
  [36, 62, 15],
  [14, 62, 12],
  [14, 26, 24],
  [40, 12, 15],
  [134, 12],
]);
const courses = [C0, C1, C2];

/** Hand-tuned driving line per floor; each helix half circle switches floor at its midpoint. */
export const garageRoute: { floor: number; points: Vec[] }[] = [
  { floor: 0, points: [...C0.line.slice(0, -1), ...arc(H0, 0, 0.5)] },
  { floor: 1, points: [...arc(H0, 0.5, 1), ...C1.line.slice(1, -1), ...arc(H1, 0, 0.5)] },
  { floor: 2, points: [...arc(H1, 0.5, 1), ...C2.line.slice(1)] },
];

const wall = (x: number, y: number, w: number, h: number): Solid => ({ kind: 'wall', x, y, w, h });
const pillar = (cx: number, cy: number, size = 1): Solid => ({
  kind: 'pillar',
  x: cx - size / 2,
  y: cy - size / 2,
  w: size,
  h: size,
});

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

/** Corner points of a (possibly rotated) solid, grown by `pad` on every side. */
function corners(s: Solid, pad = 0): Vec[] {
  const a = s.angle ?? 0;
  const c = Math.cos(a);
  const n = Math.sin(a);
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  return [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ].map(([i, j]) => {
    const u = i * (s.w / 2 + pad);
    const w = j * (s.h / 2 + pad);
    return v(cx + u * c - w * n, cy + u * n + w * c);
  });
}
/** True if two solids, each grown by gap/2, still don't overlap (separating axis test). */
function apart(a: Solid, b: Solid, gap: number): boolean {
  const pa = corners(a, gap / 2);
  const pb = corners(b, gap / 2);
  for (const ang of [
    a.angle ?? 0,
    (a.angle ?? 0) + PI / 2,
    b.angle ?? 0,
    (b.angle ?? 0) + PI / 2,
  ]) {
    const ax = Math.cos(ang);
    const ay = Math.sin(ang);
    const pr = (pts: Vec[]) => pts.map((p) => p.x * ax + p.y * ay);
    const A = pr(pa);
    const B = pr(pb);
    if (Math.max(...A) <= Math.min(...B) || Math.max(...B) <= Math.min(...A)) return true;
  }
  return false;
}
const inside = (p: Vec, s: Solid) => !apart({ ...p, w: 0, h: 0, kind: 'wall' }, s, 0);

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
const ECHELON = (35 * PI) / 180;

/**
 * Lays out one floor's furniture around its course: a Close Call bait (pillar or car) at the
 * inside apex of each real corner, both edges outlined by runs of parked cars (nose-to-tail or
 * in echelon, noses down the course, gaps between runs), painted bays along the walls with a
 * few cars in them. Everything keeps LANE + its half-diagonal from the route.
 */
function furnish(idx: number, solids: Solid[], keep: Rect[], pillarShare: number) {
  const rand = rng(idx * 101 + 7);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const { poses, corners: turns } = courses[idx];
  const route = garageRoute[idx].points;
  const placed: Solid[] = [];
  const baits: Solid[] = [];
  const ok = (s: Solid) => {
    const c = v(s.x + s.w / 2, s.y + s.h / 2);
    const pts = corners(s);
    return (
      routeDist(c, route) >= LANE + Math.hypot(s.w, s.h) / 2 &&
      pts.every((p) => p.x > 1.4 && p.x < W - 1.4 && p.y > 1.4 && p.y < H - 1.4) &&
      helixes.every((h) => Math.hypot(c.x - h.center.x, c.y - h.center.y) > R_OUTER + 3) &&
      !keep.some((k) => pts.some((p) => inside(p, { ...k, kind: 'wall' }))) &&
      [...solids, ...placed].every((o) => apart(s, o, 0.4))
    );
  };
  const car = (c: Vec, facing: number, model = pick(MODELS)): Solid => {
    const { length, width, colors } = CAR_MODELS[model];
    const x = c.x - length / 2;
    const y = c.y - width / 2;
    return {
      kind: 'car',
      x,
      y,
      w: length,
      h: width,
      angle: facing,
      facing,
      model,
      color: pick(colors),
    };
  };
  const tryPlace = (s: Solid) => ok(s) && placed.push(s) > 0;

  // apex baits: alone on the inside of the corner, just off the line
  turns.forEach((t, i) => {
    if (Math.abs(t.turn) < (30 * PI) / 180) return;
    const g = Math.sign(t.turn);
    const at = (d: number) =>
      v(t.mid.x - g * d * Math.sin(t.mid.a), t.mid.y + g * d * Math.cos(t.mid.a));
    const done =
      i % 2 === 0
        ? tryPlace(pillar(at(LANE + 0.75).x, at(LANE + 0.75).y))
        : tryPlace(car(at(LANE + 2.6), t.mid.a));
    if (done) baits.push(placed[placed.length - 1]);
  });

  // outline runs along both edges; a second pass fills what the first left open
  for (const [side, gaps] of [
    [-1, 0.1],
    [1, 0.1],
    [-1, 0],
    [1, 0],
  ]) {
    let i = Math.floor(rand() * 8);
    while (i < poses.length) {
      const style = rand();
      const n = 3 + Math.floor(rand() * 5);
      if (style < gaps) {
        i += 10 + Math.floor(rand() * 10);
        continue;
      }
      const echelon = style < 0.5;
      for (let k = 0; k < n && i < poses.length; k++) {
        const p = poses[i];
        const model = pick(MODELS);
        const { length, width } = CAR_MODELS[model];
        const facing = echelon
          ? p.a - side * ECHELON
          : p.a + (rand() < 0.2 ? PI : 0) + (rand() - 0.5) * 0.12;
        const half = echelon
          ? (length * Math.sin(ECHELON) + width * Math.cos(ECHELON)) / 2
          : width / 2;
        const usePillar = !echelon && rand() < pillarShare;
        for (let d = 7.4 + (usePillar ? 0.5 : half); d < 11; d += 0.6) {
          const c = v(p.x - side * d * Math.sin(p.a), p.y + side * d * Math.cos(p.a));
          // keep each apex bait on its own
          if (baits.some((b) => Math.hypot(b.x + b.w / 2 - c.x, b.y + b.h / 2 - c.y) < 9)) break;
          if (tryPlace(usePillar ? pillar(c.x, c.y) : car(c, facing, model))) break;
        }
        i += Math.round(
          (usePillar ? 3 : echelon ? width / Math.sin(ECHELON) + 1.2 : length + 1.2) / 0.5,
        );
      }
      i += 2;
    }
  }

  // painted bays along the walls, some with a car reverse-parked or nose-in
  const bays: Rect[] = [];
  const sides = [
    {
      n: Math.floor((W - 2) / BAY_W),
      at: (k: number) => ({ x: 1 + k * BAY_W, y: 1, w: BAY_W, h: BAY_D }),
      out: PI / 2,
    },
    {
      n: Math.floor((W - 2) / BAY_W),
      at: (k: number) => ({ x: 1 + k * BAY_W, y: H - 1 - BAY_D, w: BAY_W, h: BAY_D }),
      out: -PI / 2,
    },
    {
      n: Math.floor((H - 2) / BAY_W),
      at: (k: number) => ({ x: 1, y: 1 + k * BAY_W, w: BAY_D, h: BAY_W }),
      out: 0,
    },
    {
      n: Math.floor((H - 2) / BAY_W),
      at: (k: number) => ({ x: W - 1 - BAY_D, y: 1 + k * BAY_W, w: BAY_D, h: BAY_W }),
      out: PI,
    },
  ];
  for (const { n, at, out } of sides) {
    for (let k = 0; k < n; k++) {
      const b = at(k);
      const c = v(b.x + b.w / 2, b.y + b.h / 2);
      const s: Solid = { ...b, kind: 'wall' };
      if (routeDist(c, route) < 9 || keep.some((r) => !apart(s, { ...r, kind: 'wall' }, 0)))
        continue;
      if (helixes.some((h) => Math.hypot(c.x - h.center.x, c.y - h.center.y) < R_OUTER + 4))
        continue;
      if (![...solids, ...placed].every((o) => apart(s, o, 0))) continue;
      bays.push(b);
      if (rand() < 0.4) tryPlace(car(c, out + (rand() < 0.6 ? 0 : PI)));
    }
  }

  // ~1 in 5 cars with headlights on, nose down the course and lighting open floor; a few hazards
  for (const s of placed) {
    if (s.kind !== 'car') continue;
    const c = v(s.x + s.w / 2, s.y + s.h / 2);
    const near = poses.reduce((a, b) =>
      Math.hypot(b.x - c.x, b.y - c.y) < Math.hypot(a.x - c.x, a.y - c.y) ? b : a,
    );
    const ahead = (d: number) =>
      v(c.x + (s.w / 2 + d) * Math.cos(s.facing!), c.y + (s.w / 2 + d) * Math.sin(s.facing!));
    const clear = [2, 4, 6].every((d) => [...solids, ...placed].every((o) => !inside(ahead(d), o)));
    if (Math.cos(s.facing! - near.a) > 0.5 && clear && rand() < 0.3) s.lights = 'on';
    else if (rand() < 0.05) s.lights = 'hazard';
  }
  return { placed, bays };
}

function floor(
  name: string,
  idx: number,
  extra: Solid[],
  keep: Rect[],
  pillarShare = 0,
  gap?: [number, number],
): Floor {
  const joined = helixes.filter((h) => h.from === idx || h.from + 1 === idx);
  const solids = [
    ...perimeter(gap),
    ...joined.flatMap((h) => helixGuards(h, h.from === idx)),
    ...extra,
  ];
  const { placed, bays } = furnish(idx, solids, keep, pillarShare);
  return {
    name,
    w: W,
    h: H,
    solids: [...solids, ...placed],
    bays,
    lights: lightsAlong(garageRoute[idx].points),
    circles: joined.map((h) => ({ ...h.center, r: h.rCore })),
  };
}

// game.test teleports to (136, 12.5) on the roof for wall hits: keep that corner empty.
const roof = floor('ROOF', 0, [wall(66, 33, 8, 10)], [{ x: 128, y: 6, w: 11, h: 13 }]);
const level2 = floor('LEVEL 2', 1, [], []);
const ground = floor('GROUND', 2, [], [], 0.3, [7, 17]);

const total = garageRoute.reduce((sum, r) => sum + routeLength(r.points), 0);

export const garage: GameMap = {
  name: 'JAPAN GARAGE',
  parTime: Math.round(total / 17),
  medals: [4000, 9000, 16000], // tuning values: total score for bronze, silver, gold
  floors: [roof, level2, ground],
  helixes,
  start: { floor: 0, pos: v(10, 58), angle: 0 },
  finish: { floor: 2, zone: { x: 129, y: 8.5, w: 10, h: 7 } },
};
