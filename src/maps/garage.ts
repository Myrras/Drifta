import { CAR_MODELS } from '../models';
import type { CarModel, Floor, Helix, Rect, Solid, Vec } from '../types';
import type { Decor, DecoratedMap } from './decor';

// B2 MEET: underground drift meet. B1 (upper) is the technical floor, the helix drops to B2, a
// long sweeper lap around the meet with the exit gate in the SW corner.
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

// The helix (west of center): enter at its west point driving north, around the north side (cw),
// out of its east point driving south.
const helixes: Helix[] = [
  { from: 0, center: { x: 40, y: 40 }, rCore: R_CORE, rOuter: R_OUTER, enterAngle: PI, sweep: PI },
];
const [HX] = helixes;

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

// Control points [x, y, fillet radius].
// B1 (technical): pillar esse along the north, around the open donut bay on the east, a barrier
// chicane along the south, then a right-hander north into the helix.
const C0 = course([
  [8, 11],
  [58, 11, 14],
  [74, 25, 12],
  [128, 25, 14],
  [128, 68, 14],
  [104, 68, 10],
  [94, 60, 10],
  [78, 60, 10],
  [68, 70, 10],
  [29, 70, 10],
  [29, 40],
]);
// B2 (the meet): out of the helix south, then a long left-hand lap of the perimeter: a medium
// left onto the south straight, the SE left, a wide NE sweeper, an esse past the spectator deck
// along the north, the NW left and a sprint south out of the exit gate.
const C1 = course([
  [51, 40],
  [51, 72, 12],
  [132, 72, 18],
  [132, 8, 26],
  [100, 8, 12],
  [86, 20, 12],
  [70, 20, 12],
  [58, 8, 12],
  [8, 8, 16],
  [8, 76],
]);
const courses = [C0, C1];
/** Fillet radius and signed turn of every corner, per floor (see garage.test). */
export const garageCorners = courses.map((c) => c.corners.map(({ r, turn }) => ({ r, turn })));

/** Hand-tuned driving line per floor; the helix half circle switches floor at its midpoint. */
export const garageRoute: { floor: number; points: Vec[] }[] = [
  { floor: 0, points: [...C0.line.slice(0, -1), ...arc(HX, 0, 0.5)] },
  { floor: 1, points: [...arc(HX, 0.5, 1), ...C1.line.slice(1)] },
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

/** Perimeter walls; `gap` opens the south wall between x0 and x1 (exit gate). */
function perimeter(gap?: [number, number]): Solid[] {
  const south = gap
    ? [wall(0, H - 1, gap[0], 1), wall(gap[1], H - 1, W - gap[1], 1)]
    : [wall(0, H - 1, W, 1)];
  return [wall(0, 0, W, 1), ...south, wall(0, 1, 1, H - 2), wall(W - 1, 1, 1, H - 2)];
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
function furnish(idx: number, solids: Solid[], keep: Rect[], pillarShare: number, edge: number) {
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
        for (let d = edge + (usePillar ? 0.5 : half); d < edge + 3.6; d += 0.6) {
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

/** Clipping zones: 5 m squares on the outside of the 3 sharpest corners, against the outline. */
function clipZones(idx: number): Rect[] {
  return [...courses[idx].corners]
    .sort((a, b) => Math.abs(b.turn) - Math.abs(a.turn))
    .slice(0, 3)
    .map(({ turn, mid }) => {
      const g = Math.sign(turn);
      const x = mid.x + g * 4.5 * Math.sin(mid.a);
      const y = mid.y - g * 4.5 * Math.cos(mid.a);
      return { x: x - 2.5, y: y - 2.5, w: 5, h: 5 };
    });
}

/** Builds one floor: perimeter, helix guards, `extra` solids, then furnish around the route. */
function floor(
  name: string,
  idx: number,
  extra: Solid[],
  keep: Rect[],
  o: { pillarShare?: number; gap?: [number, number]; edge?: number; bays?: Rect[] } = {},
): Floor {
  const joined = helixes.filter((h) => h.from === idx || h.from + 1 === idx);
  const solids = [
    ...perimeter(o.gap),
    ...joined.flatMap((h) => helixGuards(h, h.from === idx)),
    ...extra,
  ];
  const { placed, bays } = furnish(idx, solids, [...keep, ...(o.bays ?? [])], o.pillarShare ?? 0, o.edge ?? 7.4);
  return {
    name,
    w: W,
    h: H,
    solids: [...solids, ...placed],
    bays: [...bays, ...(o.bays ?? [])],
    lights: lightsAlong(garageRoute[idx].points),
    circles: joined.map((h) => ({ ...h.center, r: h.rCore })),
    clipZones: clipZones(idx),
  };
}

/**
 * A row of painted bays along a wall face at y = `wallY` (cars on the `side` it faces: -1 north,
 * +1 south), reverse-parked nose out with hazards on: the meet line-up.
 */
function meetRow(x0: number, x1: number, wallY: number, side: number, seed: number) {
  const rand = rng(seed);
  const bays: Rect[] = [];
  const cars: Solid[] = [];
  const D = 5.2;
  for (let k = 0, x = x0; x + BAY_W <= x1 + 1e-9; k++, x += BAY_W) {
    bays.push({ x, y: side < 0 ? wallY - D : wallY, w: BAY_W, h: D });
    if (rand() < 0.15) continue; // a few gaps
    const model = MODELS[(k + seed) % MODELS.length];
    const { length, width, colors } = CAR_MODELS[model];
    const facing = (side * PI) / 2;
    const cx = x + BAY_W / 2;
    const cy = wallY + (side * D) / 2; // centred in the bay
    cars.push({
      kind: 'car',
      x: cx - length / 2,
      y: cy - width / 2,
      w: length,
      h: width,
      angle: facing,
      facing,
      model,
      color: colors[Math.floor(rand() * colors.length)],
      ...(rand() < 0.45 && { lights: 'hazard' as const }),
    });
  }
  return { bays, cars };
}

// B1: rim over the helix's north half, sealed west block (no cut from the start to the helix),
// center block, the donut bay's north barrier and post, a chicane barrier off the south wall.
const B1_BAY: Rect = { x: 89, y: 34, w: 34, h: 26 };
const b1 = floor(
  'B1',
  0,
  [
    wall(1, 21, 56.2, 1),
    wall(1, 22, 21.8, 36),
    wall(58, 31, 30, 23),
    wall(88, 32, 30, 1),
    wall(84, 67, 6, 12),
    pillar(106, 47, 1.4),
  ],
  // the bay stays open; game.test teleports to (136, 12.5) on floor 0 for wall hits
  [B1_BAY, { x: 128, y: 6, w: 11, h: 13 }],
  { pillarShare: 0.35 },
);

// B1 boom cars: the parked car nearest the route at 1/4 and 3/4 of its length (within 15 m, apart).
for (const t of [0.25, 0.75]) {
  const pts = garageRoute[0].points;
  const q = pts[Math.floor(t * pts.length)];
  const d = (c: Solid) => Math.hypot(c.x + c.w / 2 - q.x, c.y + c.h / 2 - q.y);
  b1.solids.filter((c) => c.kind === 'car').reduce((a, b) => (d(b) < d(a) ? b : a)).boom = true;
}

// B2: rim over the helix, a sealed block south of it (no cut to the exit), the meet spine with a
// line-up on both faces, the pocket's east wall, the spectator deck on the north wall.
const north = meetRow(60, 116, 41, -1, 3);
const south = meetRow(60, 116, 45, 1, 8);
/** Boom cars: the meet car nearest x (west end, where the route leaves the helix; the only spot within 15 m of the route). */
const boomAt = (cars: Solid[], x: number) => {
  const c = cars.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a));
  c.boom = true;
};
boomAt(north.cars, 60);
boomAt(south.cars, 62);
const b2 = floor(
  'B2',
  1,
  [
    wall(22.8, 21, 34.4, 1),
    wall(16, 58.5, 29, 20.5),
    wall(56.2, 41, 63.8, 4),
    wall(118, 22, 2, 19),
    wall(72, 1, 12, 9),
    ...north.cars,
    ...south.cars,
  ],
  [],
  { edge: 8.5, gap: [2, 14], bays: [...north.bays, ...south.bays] },
);

const NEON = { pink: '#ff2d95', cyan: '#2de2ff', violet: '#9b5cff', amber: '#ffb03a' };

/** Painted and lit dressing per floor, derived from its route, corners and bays. */
function dressing(idx: number, f: Floor): Decor[] {
  const rand = rng(idx * 31 + 9);
  const out: Decor[] = [];
  const floor = idx;
  const route = garageRoute[idx].points;
  const free = (p: Vec, pad: number) =>
    f.solids.every((s) => !apart({ ...p, w: 0, h: 0, kind: 'wall' }, s, 2 * pad));
  const away = (p: Vec) => !free(p, 0) || inHelix(p);
  const inHelix = (p: Vec) =>
    helixes.some((h) => Math.hypot(p.x - h.center.x, p.y - h.center.y) < h.rOuter + 1);

  // straight lane arrows halfway down every long straight
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const p = v(a.x + (b.x - a.x) * 0.45, a.y + (b.y - a.y) * 0.45);
    if (len > 24 && !inHelix(p))
      out.push({ floor, kind: 'arrow', ...p, angle: Math.atan2(b.y - a.y, b.x - a.x) });
  }
  // old tire marks on the line through every real corner, a little wide, with some wobble
  for (const c of courses[idx].corners) {
    if (Math.abs(c.turn) < PI / 6) continue;
    const g = Math.sign(c.turn);
    const points: Vec[] = [];
    for (let k = -0.2; k <= 1.25; k += 0.05) {
      const a = c.a1 + c.turn * k;
      const r = c.r + 1.2 + Math.sin(k * 7 + c.r) * 0.6;
      points.push(v(c.o.x + g * r * Math.sin(a), c.o.y - g * r * Math.cos(a)));
    }
    out.push({ floor, kind: 'skid', points });
  }
  // bay numbers and oil in some bays
  f.bays.forEach((b, k) => {
    const tall = b.h > b.w;
    out.push({
      floor,
      kind: 'text',
      x: b.x + b.w / 2,
      y: b.y + b.h / 2,
      angle: tall ? 0 : -PI / 2,
      text: `${String.fromCharCode(65 + (k % 6))}${String(k + 1).padStart(2, '0')}`,
      size: 0.75,
      color: 'rgba(220,180,60,0.5)',
    });
    if (rand() < 0.3)
      out.push({ floor, kind: 'stain', x: b.x + b.w / 2, y: b.y + b.h / 2, r: 0.8 + rand() });
  });
  // oil stains around the course edges
  for (let n = 0; n < 40; n++) {
    const q = courses[idx].poses[Math.floor(rand() * courses[idx].poses.length)];
    const d = (rand() < 0.5 ? -1 : 1) * (2 + rand() * 6);
    const p = v(q.x - d * Math.sin(q.a), q.y + d * Math.cos(q.a));
    if (!away(p)) out.push({ floor, kind: 'stain', ...p, r: 0.5 + rand() * 1.2 });
  }
  // ceiling light shafts: a few long soft beams across open floor
  for (let n = 0; n < 4; n++) {
    const q = courses[idx].poses[Math.floor(((n + 0.5) / 4) * courses[idx].poses.length)];
    if (!inHelix(q))
      out.push({ floor, kind: 'shaft', x: q.x, y: q.y, w: 14, h: 3.5, angle: q.a + 0.6 });
  }
  return out;
}

const crowd = (floor: number, x: number, y: number, angle: number, n: number): Decor => ({
  floor,
  kind: 'crowd',
  x,
  y,
  angle,
  n,
  seed: Math.round(x * 7 + y * 13),
});
const neon = (floor: number, ax: number, ay: number, bx: number, by: number, color: string) =>
  ({ floor, kind: 'neon', a: v(ax, ay), b: v(bx, by), color, flicker: 0.4 }) as Decor;

const decor: Decor[] = [
  ...dressing(0, b1),
  ...dressing(1, b2),
  // B1: level stencils, donut rings round the post, the bay lit sodium, neon on the blocks
  { floor: 0, kind: 'text', x: 16, y: 11, angle: 0, text: 'B1', size: 5 },
  { floor: 0, kind: 'text', x: 102, y: 72, angle: 0, text: 'B1', size: 4 },
  { floor: 0, kind: 'hatch', x: 2, y: 59, w: 20, h: 3 },
  { floor: 0, kind: 'hatch', x: 82, y: 64, w: 10, h: 3 },
  { floor: 0, kind: 'hatch', x: 90, y: 33, w: 26, h: 2 },
  ...[3.5, 4.5, 5.5, 6.5].map((r, i): Decor => ({
    floor: 0,
    kind: 'skid',
    points: Array.from({ length: 49 }, (_, k) => {
      const a = (k / 48) * 2 * PI;
      return v(106 + i * 0.6 + r * Math.cos(a), 47 - i * 0.4 + r * Math.sin(a));
    }),
  })),
  { floor: 0, kind: 'pool', x: 106, y: 47, r: 13 },
  { floor: 0, kind: 'pool', x: 12, y: 12, r: 8 },
  { floor: 0, kind: 'pool', x: 87, y: 72, r: 7 },
  neon(0, 59, 54.3, 87, 54.3, NEON.pink),
  neon(0, 88.5, 32.2, 117.5, 32.2, NEON.cyan),
  neon(0, 2, 58.3, 22, 58.3, NEON.violet),
  neon(0, 84.3, 67.3, 89.7, 67.3, NEON.amber),
  // murals: painted along the top of block walls, or a strip at the foot of perimeter walls
  { floor: 0, kind: 'graffiti', x: 59, y: 50.5, w: 28, h: 3.3, seed: 1, text: 'DRIFT' },
  { floor: 0, kind: 'graffiti', x: 2, y: 54.5, w: 20, h: 3.3, seed: 2 },
  { floor: 0, kind: 'graffiti', x: 30, y: 1, w: 24, h: 2.4, seed: 3, text: 'B2 MEET' },
  { floor: 0, kind: 'graffiti', x: 137, y: 40, w: 2, h: 22, seed: 4 },
  crowd(0, 104, 30.5, -PI / 2, 6),
  crowd(0, 18, 19, -PI / 2, 4),
  // B2: big stencils, the meet: neon spine, sodium over the line-up, crowd along the pocket and
  // the deck, graffiti on the blocks, the exit lit up
  { floor: 1, kind: 'text', x: 51, y: 62, angle: PI / 2, text: 'B2', size: 6 },
  { floor: 1, kind: 'text', x: 92, y: 74, angle: 0, text: 'B2 MEET', size: 3.2 },
  { floor: 1, kind: 'text', x: 8, y: 66, angle: PI / 2, text: 'EXIT', size: 2.5 },
  { floor: 1, kind: 'hatch', x: 72, y: 10, w: 12, h: 2.5 },
  { floor: 1, kind: 'hatch', x: 120, y: 22, w: 4, h: 23 },
  { floor: 1, kind: 'hatch', x: 2, y: 69, w: 12, h: 2 },
  neon(1, 57, 41.4, 119.5, 41.4, NEON.pink),
  neon(1, 57, 44.6, 119.5, 44.6, NEON.cyan),
  neon(1, 72.3, 9.7, 83.7, 9.7, NEON.pink),
  neon(1, 45.3, 60, 45.3, 78, NEON.violet),
  neon(1, 118.3, 23, 118.3, 40, NEON.pink),
  neon(1, 2, 78.6, 14, 78.6, NEON.amber),
  { floor: 1, kind: 'graffiti', x: 58, y: 41.7, w: 61, h: 2.6, seed: 5, text: 'B2 MEET' },
  { floor: 1, kind: 'graffiti', x: 41.5, y: 60, w: 3.5, h: 18, seed: 6 },
  { floor: 1, kind: 'graffiti', x: 17, y: 59, w: 23, h: 3.5, seed: 7, text: 'SLIDE' },
  { floor: 1, kind: 'graffiti', x: 137, y: 46, w: 2, h: 20, seed: 8 },
  ...[66, 78, 90, 102, 112].map((x): Decor => ({ floor: 1, kind: 'pool', x, y: 34, r: 8 })),
  ...[66, 78, 90, 102, 112].map((x): Decor => ({ floor: 1, kind: 'pool', x, y: 53, r: 7 })),
  { floor: 1, kind: 'pool', x: 8, y: 72, r: 8, color: '#ffd28a' },
  { floor: 1, kind: 'pool', x: 78, y: 8, r: 7 },
  ...[63, 72, 81, 90, 99, 108].map((x, i) =>
    crowd(1, x, 33.5 + (i % 2) * 0.6, -PI / 2, 5 + (i % 3)),
  ),
  ...[74, 78, 82].map((x) => crowd(1, x, 8.6, PI / 2, 3)),
  crowd(1, 124, 60, PI, 4),
  crowd(1, 3.5, 40, 0, 4),
];

const total = garageRoute.reduce((sum, r) => sum + routeLength(r.points), 0);
// The old 3-floor JAPAN GARAGE route ran 812 m for medals [4500, 10000, 17500]; scale by length.
const OLD_LEN = 812;

export const garage: DecoratedMap = {
  name: 'B2 MEET',
  parTime: Math.round(total / 17),
  // tuning values: total score for bronze, silver, gold
  medals: [4500, 10000, 17500].map((m) => Math.round((m * total) / OLD_LEN / 500) * 500) as [
    number,
    number,
    number,
  ],
  floors: [b1, b2],
  helixes,
  start: { floor: 0, pos: v(8, 11), angle: 0 },
  finish: { floor: 1, zone: { x: 2, y: 71, w: 12, h: 8 } },
  decor,
};
