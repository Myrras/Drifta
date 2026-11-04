import { CAR_MODELS } from '../models';
import type { BonusZone, CarModel, Floor, Rect, Solid, Vec } from '../types';
import type { Decor, DecoratedMap } from './decor';

// MIDNIGHT DRIVE-THRU: a night car meet in the lot of MOONBURGER, an all-night burger joint.
// Rows of meet cars with their hoods up, a coffee truck under string lights, sodium lamps and
// the pink-and-blue moon sign. The route laps the lot (long run-up, NW sweeper, an esse, a
// hairpin round the pylon sign, a double-left round the middle row, a right), then a left half
// circle round the drive-thru island links into a right half circle round the restaurant, and
// leaves down the exit chute to the finish. Planted medians close the lot into one channel.
const W = 220;
const H = 160;
const PI = Math.PI;
const v = (x: number, y: number): Vec => ({ x, y });
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const headOf = (a: Vec, b: Vec) => Math.atan2(b.y - a.y, b.x - a.x);

// --- restaurant and drive-thru lane ---
// The lane runs 11 m wide up the west face, sweeps round the restaurant's north end in one half
// circle and runs down the east face to the exit chute. It is entered by a half circle of the
// same radius round the drive-thru island, so the two link into one flowing S.
const B: Rect = { x: 170, y: 96, w: 25, h: 30 };
const YARD: Rect = { x: 170, y: 126, w: 25, h: 33 };
const LANE = 11;
/** Lane centerline radius round the restaurant's north end, about O. */
const R_LANE = 24;
const O = v(B.x + B.w / 2, 108);
const R_IN = R_LANE - LANE / 2;
const R_OUT = R_LANE + LANE / 2;
const LANE_W = O.x - R_LANE; // lane centerlines: west and east legs
const LANE_E = O.x + R_LANE;
/** Center of the entry half circle round the drive-thru island. */
const U = v(LANE_W - R_LANE, 128);
/** Planted kerb strips and medians. */
const KERB_T = 3;
/** Planted nose between the restaurant's north end and the lane: covers its corners. */
const NOSE_T = R_IN - (O.y - B.y) + 0.5;
const ISLAND_E: Rect = {
  x: LANE_E + LANE / 2,
  y: O.y - 3,
  w: W - 1 - (LANE_E + LANE / 2),
  h: H - 1 - (O.y - 3),
};
/** Planted strips along the building's west and east faces, down to the south wall. */
const STRIPS: Rect[] = [
  { x: LANE_W + LANE / 2, y: O.y, w: B.x - (LANE_W + LANE / 2), h: H - 1 - O.y },
  { x: B.x + B.w, y: O.y, w: LANE_E - LANE / 2 - (B.x + B.w), h: H - 1 - O.y },
];
/** Pylon sign island inside the NE hairpin. */
const PYLON: Rect = { x: 181, y: 43, w: 14, h: 14 };
const TRUCK = { x: 192, y: 17, w: 6.5, h: 2.5, angle: PI / 2 };
/**
 * Planted medians that close the lot into one channel: no way to the lane but the route. Each
 * runs along a double row's back line, so the meet cars park nose out to the aisles.
 */
const MEDIANS: Rect[] = [
  { x: 31.5, y: 30, w: 52.5, h: 21.5 }, // NW island inside the sweeper and the esse
  { x: 31.5, y: 51.5, w: KERB_T, h: H - 1 - 51.5 }, // run-up | the lot
  { x: 84, y: 48.5, w: PYLON.x - 84, h: KERB_T }, // top straight | back straight, to the pylon
  { x: 100, y: 1, w: KERB_T, h: 17.7 }, // north aisle closed at the esse...
  { x: 100, y: 15.7, w: 80, h: KERB_T }, // ...along the truck row
  { x: 66, y: 81.5, w: 98, h: KERB_T }, // back straight | the S, to the lane's outer kerb
  { x: 34.5, y: 118.5, w: 70.5, h: KERB_T }, // the meet pen: north side...
  { x: 102, y: 118.5, w: KERB_T, h: H - 1 - 118.5 }, // ...and east side
  { x: 42, y: 138.5, w: 58, h: KERB_T }, // pen rows
  { x: 122, y: 110.5, w: 26, h: KERB_T },
  { x: U.x - R_IN, y: 83, w: KERB_T, h: U.y - 83 }, // drive-thru island: west...
  { x: U.x + R_IN - KERB_T, y: O.y, w: KERB_T, h: U.y - O.y }, // ...and the lane's outer kerb
];

const wall = (x: number, y: number, w: number, h: number): Solid => ({ kind: 'wall', x, y, w, h });
const wallOf = (r: Rect) => wall(r.x, r.y, r.w, r.h);

/**
 * Curved kerb t m thick inside radius r1 around o, polar angle a0 to a1: rotated rects about
 * `seg` m long whose outer corners sit on the arc (as TOKYO NIGHTS).
 */
function arcWall(o: Vec, r1: number, t: number, a0: number, a1: number, seg = 4): Solid[] {
  const n = Math.ceil((Math.abs(a1 - a0) * r1) / seg);
  const da = (a1 - a0) / n;
  const len = 2 * r1 * Math.sin(Math.abs(da) / 2) + 0.1;
  const rm = r1 * Math.cos(da / 2) - t / 2;
  return Array.from({ length: n }, (_, k) => {
    const a = a0 + da * (k + 0.5);
    const c = v(o.x + rm * Math.cos(a), o.y + rm * Math.sin(a));
    return { kind: 'wall', x: c.x - len / 2, y: c.y - t / 2, w: len, h: t, angle: a + PI / 2 };
  });
}

// --- route ---
/**
 * Course through control points [x, y, radius] (as B2 MEET): every inner point is rounded by an
 * arc. The driving line keeps at most 45° per vertex and stays within 0.5 m of the arc.
 */
function course(ctl: number[][]) {
  const P = ctl.map(([x, y]) => v(x, y));
  const corners: { o: Vec; r: number; turn: number; a1: number; mid: Vec & { a: number } }[] = [];
  const line: Vec[] = [P[0]];
  let from = P[0];
  for (let i = 1; i < P.length - 1; i++) {
    const a1 = headOf(P[i - 1], P[i]);
    const turn = wrap(headOf(P[i], P[i + 1]) - a1);
    const r = ctl[i][2];
    const t = r * Math.tan(Math.abs(turn) / 2);
    const g = Math.sign(turn);
    const s = v(P[i].x - t * Math.cos(a1), P[i].y - t * Math.sin(a1));
    if (
      Math.hypot(s.x - from.x, s.y - from.y) > 1e-6 &&
      Math.abs(wrap(headOf(from, s) - a1)) > 1e-3
    )
      throw new Error(`corner ${P[i].x},${P[i].y} overlaps`);
    const o = v(s.x - g * r * Math.sin(a1), s.y + g * r * Math.cos(a1));
    const am = a1 + turn / 2;
    corners.push({
      o,
      r,
      turn,
      a1,
      mid: { x: o.x + g * r * Math.sin(am), y: o.y - g * r * Math.cos(am), a: am },
    });
    const n = Math.max(
      Math.ceil(Math.abs(turn) / (PI / 4) - 1e-9),
      Math.ceil(Math.abs(turn) / (2 * Math.acos(r / (r + 0.5)))),
    );
    const step = turn / n;
    for (let k = 0; k < n; k++) {
      const a = a1 + step * (k + 0.5);
      const rr = r / Math.cos(step / 2);
      line.push(v(o.x + g * rr * Math.sin(a), o.y - g * rr * Math.cos(a)));
    }
    from = v(P[i].x + t * Math.cos(a1 + turn), P[i].y + t * Math.sin(a1 + turn));
  }
  line.push(P[P.length - 1]);
  return { line, corners };
}

const START = v(16, 148);
const C = course([
  [START.x, START.y], // run-up north along the west edge
  [16, 18, 20], // NW sweeper
  [80, 18, 30], // esse: right...
  [104, 34, 30], // ...left
  [204, 34, 16], // hairpin right round the pylon sign
  [204, 66, 16],
  [60, 66, 18], // double left round the middle row
  [60, 100, 14],
  [U.x - R_LANE, 100, 22], // right toward the drive-thru...
  [U.x - R_LANE, U.y + R_LANE, R_LANE], // ...left half circle round the island into the lane...
  [LANE_W, U.y + R_LANE, R_LANE],
  [LANE_W, O.y - R_LANE, R_LANE], // ...right half circle round the restaurant
  [LANE_E, O.y - R_LANE, R_LANE],
  [LANE_E, 154], // down the exit chute
]);
export const drivethruCorners = C.corners.map(({ r, turn }) => ({ r, turn }));
export const drivethruRoute: { floor: number; points: Vec[] }[] = [{ floor: 0, points: C.line }];
const FINISH: Rect = { x: LANE_E - LANE / 2 + 0.5, y: 146, w: LANE - 1, h: 12.5 };

const segDist = (p: Vec, a: Vec, b: Vec) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
const routeDist = (p: Vec) => Math.min(...C.line.slice(1).map((b, i) => segDist(p, C.line[i], b)));

/** The lane, drifted end to end in one combo: west leg, the top of the half circle, east leg. */
const bonusZones: BonusZone[] = [
  { x: LANE_W - LANE / 2, y: O.y - 10, w: LANE, h: U.y - (O.y - 10) },
  { x: LANE_W - LANE / 2, y: O.y - R_OUT, w: LANE_E - LANE_W + LANE, h: LANE },
  { x: LANE_E - LANE / 2, y: O.y - 10, w: LANE, h: U.y + 2 - (O.y - 10) },
].map((r) => ({ ...r, id: 'drivethru', trick: 'DRIVE-THRU' }));

// --- solids ---
const fixed: Solid[] = [
  wall(0, 0, W, 1),
  wall(0, H - 1, W, 1),
  wall(0, 1, 1, H - 2),
  wall(W - 1, 1, 1, H - 2),
  wallOf(B),
  wallOf(YARD),
  wallOf(ISLAND_E),
  ...STRIPS.map(wallOf),
  ...MEDIANS.map(wallOf),
  ...arcWall(O, R_IN, NOSE_T, PI, 2 * PI),
  ...arcWall(O, R_OUT + 0.2 + KERB_T, KERB_T, PI, 2 * PI), // 0.2 m out: the line's chords bulge out
  ...arcWall(U, R_IN, KERB_T, 0, PI),
  wallOf(PYLON),
  wall(TRUCK.x - TRUCK.h / 2, TRUCK.y - TRUCK.w / 2, TRUCK.h, TRUCK.w), // long side along y
];

// --- meet rows: painted bays, cars reversed in nose out, most hoods up ---
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const MODELS = Object.keys(CAR_MODELS) as CarModel[];
const BAY_W = 2.5;
const BAY_D = 5.2;
/** Bay rect with the heading its car's nose points (out of the bay, away from the back line). */
type Bay = Rect & { out: number };
/** Bays along a back line: horizontal at y = `back` (x0..x1) or vertical at x = `back` (y0..y1). */
function row(horiz: boolean, a0: number, a1: number, back: number, side: -1 | 1): Bay[] {
  const out: Bay[] = [];
  for (let a = a0; a + BAY_W <= a1 + 1e-9; a += BAY_W) {
    const d = side < 0 ? back - BAY_D : back;
    out.push(
      horiz
        ? { x: a, y: d, w: BAY_W, h: BAY_D, out: (side * PI) / 2 }
        : { x: d, y: a, w: BAY_D, h: BAY_W, out: side < 0 ? PI : 0 },
    );
  }
  return out;
}
/** Two rows back to back either side of a median centered on `back`. */
const double = (horiz: boolean, a0: number, a1: number, back: number) => [
  ...row(horiz, a0, a1, back - KERB_T / 2 - 0.6, -1),
  ...row(horiz, a0, a1, back + KERB_T / 2 + 0.6, 1),
];
/** Median center lines of the double rows: lamps light both ends. */
const DOUBLES: [boolean, number, number, number][] = [
  [true, 102, 180, 17.2],
  [true, 40, 172, 50],
  [false, 60, 150, 33],
  [true, 86, 150, 83],
  [true, 42, 100, 120],
  [true, 42, 100, 140],
  [true, 122, 148, 112],
];
const overlaps = (a: Rect, b: Rect, pad = 0) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
const allBays: Bay[] = [
  ...DOUBLES.flatMap(([h, a0, a1, back]) => double(h, a0, a1, back)),
  ...row(true, 24, 200, 1, 1), // north wall
  ...row(true, 24, 150, H - 1, -1), // south wall
  ...row(false, 8, 76, W - 1, -1), // east wall
];
const center = (r: Rect) => v(r.x + r.w / 2, r.y + r.h / 2);
const rand = rng(1985);
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const cornersOf = (s: Solid): Vec[] => {
  const a = s.angle ?? 0;
  const c = center(s);
  const u = v((Math.cos(a) * s.w) / 2, (Math.sin(a) * s.w) / 2);
  const n = v((-Math.sin(a) * s.h) / 2, (Math.cos(a) * s.h) / 2);
  return [1, -1].flatMap((i) =>
    [1, -1].map((j) => v(c.x + i * u.x + j * n.x, c.y + i * u.y + j * n.y)),
  );
};
/** Axis-aligned box round a (rotated) solid. */
const box = (s: Solid): Rect => {
  const p = cornersOf(s);
  const x = Math.min(...p.map((q) => q.x));
  const y = Math.min(...p.map((q) => q.y));
  return { x, y, w: Math.max(...p.map((q) => q.x)) - x, h: Math.max(...p.map((q) => q.y)) - y };
};
const inRect = (p: Vec, r: Rect) =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
/**
 * Painted runs of 3-6 bays with gaps of bare tarmac between, each bay off the line by 9 m
 * (car corners stay 6.5 m clear) and clear of every fixed solid.
 */
const bays: Bay[] = [];
for (let i = 0, run = 0; i < allBays.length; i++) {
  if (run <= 0) {
    i += 10 + Math.floor(rand() * 10); // gap
    run = 3 + Math.floor(rand() * 4);
    if (i >= allBays.length) break;
  }
  run--;
  const b = allBays[i];
  if (routeDist(center(b)) >= 9 && fixed.slice(4).every((s) => !overlaps(b, box(s), 0.5)))
    bays.push(b);
}

const cars: Solid[] = [];
const hoods: Decor[] = [];
/**
 * Parks a random car centered at c, nose along `facing`. A loose car (no bay) only goes where
 * its center stays 8 m off the line, clear of walls and cars, and never squarely in a bay.
 */
function park(c: Vec, facing: number, loose: boolean, hood = 0.8, lit = 0.16) {
  const model = pick(MODELS);
  const { length, width, colors } = CAR_MODELS[model];
  const color = pick(colors);
  const s: Solid = {
    kind: 'car',
    x: c.x - length / 2,
    y: c.y - width / 2,
    w: length,
    h: width,
    angle: facing,
    facing,
    model,
    color,
  };
  if (loose) {
    const b = box(s);
    if (
      b.x < 1.5 ||
      b.y < 1.5 ||
      b.x + b.w > W - 1.5 ||
      b.y + b.h > H - 1.5 ||
      routeDist(c) < 8 ||
      [...fixed, ...cars].some((t) => overlaps(b, box(t), 0.5)) ||
      bays.some((bay) => cornersOf(s).every((p) => inRect(p, bay)))
    )
      return undefined;
  }
  const r = rand();
  if (r < lit) s.lights = r < lit * 0.75 ? 'on' : 'hazard';
  cars.push(s);
  if (rand() < hood)
    hoods.push({
      floor: 0,
      kind: 'hood',
      ...c,
      angle: facing,
      len: length,
      wid: width,
      color,
      seed: cars.length,
    });
  return s;
}
for (const b of bays) if (rand() >= 0.1) park(center(b), b.out, false); // a few empty bays
// show row: backed against the west wall without paint, noses at the run-up, lights on
for (let y = 24; y < 146; y += 2.9)
  if (rand() > 0.12)
    park(v(4 + rand() * 0.6, y + rand() * 0.3), (rand() - 0.5) * 0.25, true, 0.4, 0.5);
/** Loose crowd of n cars within r of o, at casual angles, most noses in toward o. */
function crowd(o: Vec, r: number, n: number) {
  for (let k = 0, got = 0; k < n * 40 && got < n; k++) {
    const a = rand() * 2 * PI;
    const d = r * Math.sqrt(rand());
    const c = v(o.x + d * Math.cos(a), o.y + d * Math.sin(a));
    const face = headOf(c, o) + (rand() < 0.25 ? PI : 0) + (rand() - 0.5) * 1.4;
    if (park(c, face, true, 0.6)) got++;
  }
}
/** Two cars nose to nose, hoods up, along heading a. */
function pair(c: Vec, a: number) {
  const u = v(Math.cos(a) * 2.8, Math.sin(a) * 2.8);
  const n = cars.length;
  const h = hoods.length;
  if (
    !park(v(c.x - u.x, c.y - u.y), a, true, 1) ||
    !park(v(c.x + u.x, c.y + u.y), a + PI, true, 1)
  ) {
    cars.length = n;
    hoods.length = h;
  }
}
crowd(v(TRUCK.x - 2, TRUCK.y + 2), 13, 14); // round the coffee truck
crowd(v(176, 50), 8, 8); // under the pylon sign
crowd(v(138, 126), 11, 12); // by the drive-thru entry
crowd(v(70, 130), 14, 14); // the meet's middle
for (const [x, y, a] of [
  [76, 76, 0],
  [80, 90, 0.1],
  [46, 82, PI / 2],
  [60, 150, 0],
  [86, 150, -0.1],
  [134, 136, 0.05],
  [200, 28, PI / 2],
  [150, 40, 0],
])
  pair(v(x, y), a);
// stragglers: anywhere on the lot, any angle
for (let k = 0, got = 0; k < 600 && got < 18; k++)
  if (park(v(4 + rand() * (W - 8), 4 + rand() * (H - 8)), rand() * 2 * PI, true, 0.4)) got++;
/** Two boom cars, lit, where the line passes them: the show row and the truck crowd. */
for (const o of [v(4, 96), v(196, 26)]) {
  const near = cars.reduce((a, b) =>
    Math.hypot(center(b).x - o.x, center(b).y - o.y) <
    Math.hypot(center(a).x - o.x, center(a).y - o.y)
      ? b
      : a,
  );
  near.boom = true;
  near.lights = 'on';
}

/** Lamp heads at the row ends (light only: no posts to hit). */
const poles = DOUBLES.flatMap(([h, a0, a1, back]) =>
  [a0 - 0.8, a1 + 0.8].map((a) => (h ? v(a, back) : v(back, a))),
);

/** Clean-line lamps every 22 m, so the driving line reads under the sodium. */
const lights: Vec[] = [];
for (let i = 1, d = 8; i < C.line.length; i++) {
  const a = C.line[i - 1];
  const b = C.line[i];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  for (; d <= len; d += 22)
    lights.push(v(a.x + ((b.x - a.x) * d) / len, a.y + ((b.y - a.y) * d) / len));
  d -= len;
}

const floor: Floor = {
  name: 'MOONBURGER',
  w: W,
  h: H,
  solids: [...fixed, ...cars],
  bays: bays.map(({ x, y, w, h }) => ({ x, y, w, h })),
  lights,
  circles: [],
  bonusZones,
};

// --- decor ---
const decor: Decor[] = [];
type Item<D = Decor> = D extends unknown ? Omit<D, 'floor'> : never;
const add = (d: Item) => decor.push({ floor: 0, ...d } as Decor);
const paint = (pts: Vec[], w: number, color?: string, dash?: number[], top?: boolean) =>
  add({ kind: 'paint', x: pts[0].x, y: pts[0].y, to: pts.slice(1), w, color, dash, top });
const arcPts = (o: Vec, r: number, a0: number, a1: number, n = 12) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return v(o.x + r * Math.cos(a), o.y + r * Math.sin(a));
  });
const LINE = 'rgba(225,225,212,0.55)';
const KERB = '#a9a59a';
const PLANTER = '#1c2a1e';
const PINK = '#ff3fb0';
const BLUE = '#3ad7ff';
const drand = rng(77);

// ground: dry tarmac; the lane tinted like a bus lane so the bonus reads
add({ kind: 'tarmac', x: 0, y: 0, w: W, h: H, seed: 3 });
const laneLine = [v(LANE_W, U.y), ...arcPts(O, R_LANE, PI, 2 * PI, 24), v(LANE_E, H - 1)];
paint(laneLine, LANE - 0.4, 'rgba(120,30,60,0.32)');
paint(laneLine, 0.15, 'rgba(255,200,90,0.45)', [2, 3]);
add({
  kind: 'text',
  x: LANE_W,
  y: 125,
  angle: -PI / 2,
  text: 'DRIVE THRU',
  size: 2.2,
  color: LINE,
});
add({ kind: 'text', x: LANE_W, y: 110, angle: -PI / 2, text: 'ORDER', size: 1.6, color: LINE });
add({ kind: 'text', x: LANE_E, y: 106, angle: PI / 2, text: 'PICK UP', size: 1.6, color: LINE });
add({ kind: 'text', x: LANE_E, y: 120, angle: PI / 2, text: 'PAY', size: 1.6, color: LINE });
add({ kind: 'text', x: LANE_E, y: 138, angle: PI / 2, text: 'EXIT', size: 2.2, color: LINE });
add({ kind: 'arrow', x: LANE_W, y: 116, angle: -PI / 2 });
add({ kind: 'arrow', x: O.x, y: O.y - R_LANE, angle: 0 });
add({ kind: 'arrow', x: LANE_E, y: 129, angle: PI / 2 });
// lot arrows: halfway down every long straight, and at the apex of every big corner
for (let i = 1; i < C.line.length; i++) {
  const a = C.line[i - 1];
  const b = C.line[i];
  const p = v(a.x + (b.x - a.x) * 0.45, a.y + (b.y - a.y) * 0.45);
  if (Math.hypot(b.x - a.x, b.y - a.y) > 30 && p.x < LANE_W - LANE)
    add({ kind: 'arrow', ...p, angle: headOf(a, b) });
}
for (const { mid, turn } of C.corners)
  if (Math.abs(turn) >= PI / 3 && Math.hypot(mid.x - O.x, mid.y - O.y) > R_OUT)
    add({ kind: 'arrow', x: mid.x, y: mid.y, angle: mid.a });
// bay paint (the tarmac covers the renderer's): sides, back line, wheel stop; oil under some
for (const b of bays) {
  const u = v(Math.cos(b.out), Math.sin(b.out)); // toward the open end
  const n = v(-u.y, u.x);
  const c = center(b);
  const at = (du: number, dn: number) => v(c.x + u.x * du + n.x * dn, c.y + u.y * du + n.y * dn);
  const d = BAY_D / 2;
  const w = BAY_W / 2;
  paint([at(d, -w), at(-d, -w), at(-d, w), at(d, w)], 0.12, LINE);
  paint([at(-d + 0.7, -0.75), at(-d + 0.7, 0.75)], 0.22, 'rgba(225,180,40,0.8)');
  if (drand() < 0.35) add({ kind: 'stain', ...at(drand() - 0.2, 0), r: 0.6 + drand() * 0.8 });
}
// tyre marks through every real corner, a little wide, with some wobble; donut marks on the lot
for (const c of C.corners) {
  if (Math.abs(c.turn) < PI / 6) continue;
  const g = Math.sign(c.turn);
  for (const dr of [-1.5, 1.2]) {
    const points: Vec[] = [];
    for (let k = -0.15; k <= 1.2; k += 0.05) {
      const a = c.a1 + c.turn * k;
      const r = c.r + dr + Math.sin(k * 7 + c.r) * 0.6;
      points.push(v(c.o.x + g * r * Math.sin(a), c.o.y - g * r * Math.cos(a)));
    }
    add({ kind: 'skid', points });
  }
}
for (const [x, y] of [
  [200, 24],
  [130, 128],
  [44, 30],
])
  for (const r of [3.5, 4.6])
    add({ kind: 'skid', points: arcPts(v(x + r * 0.2, y - r * 0.15), r, 0, 2 * PI, 40) });
// oil stains on the aisles
for (let k = 0; k < 70; k++) {
  const p = v(4 + drand() * (W - 8), 4 + drand() * (H - 8));
  const blocked = floor.solids.some((s) => overlaps({ ...p, w: 0, h: 0 }, s, 1.2));
  if (!blocked && !overlaps({ ...p, w: 0, h: 0 }, B, 6))
    add({ kind: 'stain', ...p, r: 0.5 + drand() * 1.3 });
}
// finish: a checker line across the chute where it is entered
const fy = FINISH.y + 0.5;
paint([v(FINISH.x - 0.4, fy), v(FINISH.x + FINISH.w + 0.4, fy)], 1, '#e8e8e2');
paint(
  [v(FINISH.x - 0.4, fy - 0.25), v(FINISH.x + FINISH.w + 0.4, fy - 0.25)],
  0.5,
  '#111',
  [0.5, 0.5],
);
paint(
  [v(FINISH.x - 0.4, fy + 0.25), v(FINISH.x + FINISH.w + 0.4, fy + 0.25)],
  0.5,
  '#111',
  [0, 0.5, 0.5, 0],
);

// light: sodium poles over the lot, cool white under the restaurant's canopy edge
for (let x = 14; x < W; x += 26)
  for (let y = 12, j = 0; y < H; y += 26, j++) {
    const p = v(x + (j % 2 ? 13 : 0), y);
    if (
      p.x < W - 2 &&
      !overlaps({ ...p, w: 0, h: 0 }, B, 4) &&
      !overlaps({ ...p, w: 0, h: 0 }, YARD, 0)
    )
      add({ kind: 'pool', ...p, r: 13 });
  }
for (const p of poles) add({ kind: 'pool', ...p, r: 9, color: '#ffb066' });
add({ kind: 'pool', x: LANE_W, y: 116, r: 9, color: '#9fdcff' });
add({ kind: 'pool', x: O.x, y: O.y - R_LANE, r: 10, color: '#ffd9e8' });
add({ kind: 'pool', x: LANE_E, y: 112, r: 10, color: '#9fdcff' });

// kerbs and islands: planted, ringed by a pale kerb edge
const capped = (r: Rect) =>
  r.w >= r.h
    ? paint([v(r.x, r.y + r.h / 2), v(r.x + r.w, r.y + r.h / 2)], r.h, PLANTER, undefined, true)
    : paint([v(r.x + r.w / 2, r.y), v(r.x + r.w / 2, r.y + r.h)], r.w, PLANTER, undefined, true);
const ring = (o: Vec, r: number, t: number, a0: number, a1: number) =>
  paint(arcPts(o, r - t / 2, a0, a1, 24), t + 0.2, PLANTER, undefined, true);
ring(O, R_IN, NOSE_T, PI, 2 * PI);
ring(O, R_OUT + 0.2 + KERB_T, KERB_T, PI, 2 * PI);
ring(U, R_IN, KERB_T, 0, PI);
for (const r of [ISLAND_E, PYLON, ...STRIPS, ...MEDIANS]) {
  capped(r);
  const { x, y, w, h } = r;
  paint([v(x, y), v(x + w, y), v(x + w, y + h), v(x, y + h), v(x, y)], 0.35, KERB, undefined, true);
}
// lane kerbs: outer round the drive-thru island and the outer kerb, inner along the restaurant
paint(
  [
    v(U.x - R_IN + 0.15, 83),
    ...arcPts(U, R_IN - 0.15, PI, 0, 24),
    ...arcPts(O, R_OUT + 0.35, PI, 2 * PI, 24),
    v(ISLAND_E.x + 0.15, H - 1),
  ],
  0.35,
  KERB,
  undefined,
  true,
);
paint(
  [
    v(STRIPS[0].x + 0.15, H - 1),
    ...arcPts(O, R_IN - 0.15, PI, 2 * PI, 24),
    v(LANE_E - LANE / 2 - 0.15, H - 1),
  ],
  0.35,
  KERB,
  undefined,
  true,
);
// perimeter: a hedge over the boundary wall
paint(
  [v(0.5, 0.5), v(W - 0.5, 0.5), v(W - 0.5, H - 0.5), v(0.5, H - 0.5), v(0.5, 0.5)],
  1,
  '#18231a',
  undefined,
  true,
);

// restaurant: roof with the moon sign, kitchen annex, lit fronts and fascia neon on three faces
add({ kind: 'roof', ...B, color: PINK, seed: 1 });
add({ kind: 'roof', ...YARD, color: BLUE, seed: 2 });
add({
  kind: 'front',
  x: B.x,
  y: B.y + B.h - 2,
  angle: -PI / 2,
  len: B.h - 4,
  color: '#ffe8c4',
  seed: 1,
});
add({ kind: 'front', x: B.x + 2, y: B.y, angle: 0, len: B.w - 4, color: '#ffd9a0', seed: 2 });
add({ kind: 'front', x: B.x + B.w, y: 100, angle: PI / 2, len: 7, color: '#ffe8c4', seed: 3 });
add({ kind: 'front', x: B.x + B.w, y: 115, angle: PI / 2, len: 5, color: '#ffd9a0', seed: 4 });
add({
  kind: 'neon',
  a: v(B.x + 0.3, B.y + 0.3),
  b: v(B.x + B.w - 0.3, B.y + 0.3),
  color: PINK,
  flicker: 0.3,
});
add({
  kind: 'neon',
  a: v(B.x + 0.3, B.y + 0.3),
  b: v(B.x + 0.3, YARD.y),
  color: BLUE,
  flicker: 0.2,
});
add({
  kind: 'neon',
  a: v(B.x + B.w - 0.3, B.y + 0.3),
  b: v(B.x + B.w - 0.3, YARD.y),
  color: BLUE,
  flicker: 0.2,
});
add({ kind: 'moon', x: B.x + 9, y: B.y + 11, r: 5.5 });
add({
  kind: 'sign',
  x: B.x + B.w / 2,
  y: B.y + 22,
  w: 17,
  h: 3,
  angle: 0,
  color: PINK,
  text: 'MOONBURGER',
  seed: 0,
});
// order point: menu board and speaker post on the island facing the lane
add({
  kind: 'sign',
  x: LANE_W - LANE / 2 - 0.9,
  y: 110,
  w: 4.5,
  h: 0.9,
  angle: PI / 2,
  color: BLUE,
  text: 'MENU',
  seed: 0,
});
add({
  kind: 'sign',
  x: LANE_W - LANE / 2 - 0.6,
  y: 114.5,
  w: 0.7,
  h: 0.5,
  angle: PI / 2,
  color: '#ffd23a',
  seed: 1,
});
// pylon sign in the hairpin
add({ kind: 'moon', x: PYLON.x + PYLON.w / 2, y: PYLON.y + 6, r: 4.2 });
add({
  kind: 'sign',
  x: PYLON.x + PYLON.w / 2,
  y: PYLON.y + 11.8,
  w: 12,
  h: 2.2,
  angle: 0,
  color: BLUE,
  text: 'MOONBURGER',
  seed: 0,
});
add({
  kind: 'text',
  x: 71,
  y: 130,
  angle: 0,
  text: 'MIDNIGHT MEET',
  size: 3,
  color: 'rgba(255,90,190,0.5)',
});

// the meet: coffee truck with string lights over the rows, hoods up
const bulbs = (pts: Vec[]) => add({ kind: 'bulbs', x: pts[0].x, y: pts[0].y, to: pts.slice(1) });
add({ kind: 'truck', ...TRUCK });
for (const [h, a0, a1, back] of DOUBLES.slice(0, 2)) {
  if (!h) continue;
  const pts: Vec[] = [];
  for (let x = a0, k = 0; x <= a1; x += 8, k++) pts.push(v(x, back + (k % 2 ? 3.2 : -3.2)));
  bulbs(pts);
}
bulbs([v(TRUCK.x - 1.4, TRUCK.y - 3), v(180.8, 14), v(180.8, 20.4), v(TRUCK.x - 1.4, TRUCK.y + 3)]);
decor.push(...hoods);

const total = C.line
  .slice(1)
  .reduce((s, b, i) => s + Math.hypot(b.x - C.line[i].x, b.y - C.line[i].y), 0);
// same scale as B2 MEET: the old 812 m route ran medals [4500, 10000, 17500]
const OLD_LEN = 812;

export const drivethru: DecoratedMap = {
  name: 'MIDNIGHT DRIVE-THRU',
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
