import { CAR_MODELS } from '../models';
import type { BonusZone, CarModel, Floor, Rect, Solid, Vec } from '../types';
import type { Decor, DecoratedMap } from './decor';

// MIDNIGHT DRIVE-THRU: a night car meet in the lot of MOONBURGER, an all-night burger joint.
// Rows of meet cars with their hoods up, a coffee truck under string lights, sodium lamps and
// the pink-and-blue moon sign. The route laps the lot (long run-up, NW sweeper, an esse, a
// hairpin round the pylon sign, a double-left round the middle row, a right-left S), then loops
// the drive-thru lane round the restaurant and leaves down the exit chute to the finish.
const W = 220;
const H = 160;
const PI = Math.PI;
const v = (x: number, y: number): Vec => ({ x, y });
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const headOf = (a: Vec, b: Vec) => Math.atan2(b.y - a.y, b.x - a.x);

// --- restaurant and drive-thru lane ---
// The lane runs 11 m wide up the west face, across the north face and down the east face; its
// outer kerb is a planted island, rounded at the two corners round the building's corners.
const B: Rect = { x: 170, y: 96, w: 32, h: 30 };
const YARD: Rect = { x: 170, y: 126, w: 32, h: 33 };
const LANE = 11;
const NW = v(B.x, B.y);
const NE = v(B.x + B.w, B.y);
const ISLAND_N: Rect = { x: 152.5, y: 78.5, w: 66.5, h: B.y - LANE - 78.5 };
const ISLAND_W: Rect = { x: 152.5, y: 85, w: B.x - LANE - 152.5, h: 27 };
const ISLAND_E: Rect = { x: B.x + B.w + LANE, y: 85, w: W - 1 - (B.x + B.w + LANE), h: H - 1 - 85 };
const R_KERB = 16.5;
const T_KERB = 5;
/** Pylon sign island inside the NE hairpin. */
const PYLON: Rect = { x: 181, y: 43, w: 14, h: 14 };
const TRUCK = { x: 192, y: 17, w: 6.5, h: 2.5, angle: PI / 2 };

const wall = (x: number, y: number, w: number, h: number): Solid => ({ kind: 'wall', x, y, w, h });
const wallOf = (r: Rect) => wall(r.x, r.y, r.w, r.h);
const pillar = (c: Vec, size = 0.6): Solid => ({
  kind: 'pillar',
  x: c.x - size / 2,
  y: c.y - size / 2,
  w: size,
  h: size,
});

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
 * arc. The driving line keeps at most 45° per vertex and stays within 1.5 m of the arc.
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
      Math.ceil(Math.abs(turn) / (2 * Math.acos(r / (r + 1.5)))),
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
const LANE_W = B.x - LANE / 2; // lane centerlines: west x, north y, east x
const LANE_N = B.y - LANE / 2;
const LANE_E = B.x + B.w + LANE / 2;
const C = course([
  [START.x, START.y], // run-up north along the west edge
  [16, 18, 20], // NW sweeper
  [80, 18, 30], // esse: right...
  [104, 34, 30], // ...left
  [204, 34, 16], // hairpin right round the pylon sign
  [204, 66, 16],
  [60, 66, 18], // double left round the middle row
  [60, 100, 14],
  [110, 100, 14], // S: right...
  [110, 142, 16], // ...left
  [LANE_W, 142, 14], // left into the drive-thru
  [LANE_W, LANE_N, LANE / 2], // round the restaurant
  [LANE_E, LANE_N, LANE / 2],
  [LANE_E, 154], // down the exit chute
]);
export const drivethruCorners = C.corners.map(({ r, turn }) => ({ r, turn }));
export const drivethruRoute: { floor: number; points: Vec[] }[] = [{ floor: 0, points: C.line }];
const FINISH: Rect = { x: B.x + B.w + 0.5, y: 146, w: LANE - 1, h: 12.5 };

const segDist = (p: Vec, a: Vec, b: Vec) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
const routeDist = (p: Vec) => Math.min(...C.line.slice(1).map((b, i) => segDist(p, C.line[i], b)));

/** The lane, drifted end to end in one combo: four rects across its full width. */
const bonusZones: BonusZone[] = [
  { x: B.x - LANE, y: 98, w: LANE, h: 16 },
  { x: 172, y: B.y - LANE, w: 14, h: LANE },
  { x: 186, y: B.y - LANE, w: 14, h: LANE },
  { x: B.x + B.w, y: 98, w: LANE, h: 16 },
].map((r) => ({ ...r, id: 'drivethru', trick: 'DRIVE-THRU' }));

// --- solids ---
const fixed: Solid[] = [
  wall(0, 0, W, 1),
  wall(0, H - 1, W, 1),
  wall(0, 1, 1, H - 2),
  wall(W - 1, 1, 1, H - 2),
  wallOf(B),
  wallOf(YARD),
  wallOf(ISLAND_N),
  wallOf(ISLAND_W),
  wallOf(ISLAND_E),
  ...arcWall(NW, R_KERB, T_KERB, PI, 1.5 * PI),
  ...arcWall(NE, R_KERB, T_KERB, -PI / 2, 0),
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
const double = (horiz: boolean, a0: number, a1: number, back: number) => [
  ...row(horiz, a0, a1, back, -1),
  ...row(horiz, a0, a1, back, 1),
];
/** Back lines of the double rows: light poles stand at both ends. */
const DOUBLES: [boolean, number, number, number][] = [
  [true, 112, 180, 17.2],
  [true, 40, 172, 50],
  [false, 60, 150, 33],
  [true, 86, 150, 83],
  [true, 42, 100, 120],
  [true, 42, 104, 140],
  [true, 122, 150, 112],
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
/**
 * Meet clusters: runs of 3-7 bays with gaps of bare tarmac between (no paint there), each bay
 * off the line by 9 m (car corners stay 6.5 m clear) and clear of every fixed solid.
 */
const bays: Bay[] = [];
for (let i = 0, run = 0; i < allBays.length; i++) {
  if (run <= 0) {
    i += 8 + Math.floor(rand() * 10); // gap
    run = 3 + Math.floor(rand() * 5);
    if (i >= allBays.length) break;
  }
  run--;
  const b = allBays[i];
  if (
    routeDist(center(b)) >= 9 &&
    fixed.slice(4).every((s) => s.angle !== undefined || !overlaps(b, s, 0.5))
  )
    bays.push(b);
}

const cars: Solid[] = [];
const hoods: Decor[] = [];
for (const b of bays) {
  if (rand() < 0.1) continue; // a few empty bays
  const model = pick(MODELS);
  const { length, width, colors } = CAR_MODELS[model];
  const c = center(b);
  const color = pick(colors);
  const r = rand();
  cars.push({
    kind: 'car',
    x: c.x - length / 2,
    y: c.y - width / 2,
    w: length,
    h: width,
    angle: b.out,
    facing: b.out,
    model,
    color,
    ...(r < 0.12 ? { lights: 'on' as const } : r < 0.16 ? { lights: 'hazard' as const } : {}),
  });
  if (rand() < 0.8)
    hoods.push({
      floor: 0,
      kind: 'hood',
      ...c,
      angle: b.out,
      len: length,
      wid: width,
      color,
      seed: cars.length,
    });
}

/** Light poles at the row ends, where they stay 6 m off the line: close-call posts. */
const poles = DOUBLES.flatMap(([h, a0, a1, back]) =>
  [a0 - 0.8, a1 + 0.8].map((a) => (h ? v(a, back) : v(back, a))),
).filter((p) => routeDist(p) >= 6 && fixed.every((s) => !overlaps({ ...p, w: 0, h: 0 }, s, 1)));

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
  solids: [...fixed, ...poles.map((p) => pillar(p)), ...cars],
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
const laneLine = [
  v(LANE_W, 128),
  v(LANE_W, B.y),
  ...arcPts(NW, LANE / 2, PI, 1.5 * PI),
  v(NE.x, LANE_N),
  ...arcPts(NE, LANE / 2, -PI / 2, 0),
  v(LANE_E, H - 1),
];
paint(laneLine, LANE - 0.4, 'rgba(120,30,60,0.32)');
paint(laneLine, 0.15, 'rgba(255,200,90,0.45)', [2, 3]);
add({
  kind: 'text',
  x: LANE_W,
  y: 120,
  angle: -PI / 2,
  text: 'DRIVE THRU',
  size: 2.2,
  color: LINE,
});
add({ kind: 'text', x: LANE_W, y: 106, angle: -PI / 2, text: 'ORDER', size: 1.6, color: LINE });
add({ kind: 'text', x: LANE_E, y: 104, angle: PI / 2, text: 'PICK UP', size: 1.6, color: LINE });
add({ kind: 'text', x: LANE_E, y: 118, angle: PI / 2, text: 'PAY', size: 1.6, color: LINE });
add({ kind: 'text', x: LANE_E, y: 136, angle: PI / 2, text: 'EXIT', size: 2.2, color: LINE });
add({ kind: 'arrow', x: LANE_W, y: 112, angle: -PI / 2 });
add({ kind: 'arrow', x: 186, y: LANE_N, angle: 0 });
add({ kind: 'arrow', x: LANE_E, y: 128, angle: PI / 2 });
// lot arrows: halfway down every long straight
for (let i = 1; i < C.line.length; i++) {
  const a = C.line[i - 1];
  const b = C.line[i];
  const p = v(a.x + (b.x - a.x) * 0.45, a.y + (b.y - a.y) * 0.45);
  if (Math.hypot(b.x - a.x, b.y - a.y) > 30 && p.x < ISLAND_W.x - 4)
    add({ kind: 'arrow', ...p, angle: headOf(a, b) });
}
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
add({ kind: 'pool', x: LANE_W, y: 111, r: 9, color: '#9fdcff' });
add({ kind: 'pool', x: 186, y: LANE_N, r: 10, color: '#ffd9e8' });
add({ kind: 'pool', x: LANE_E, y: 108, r: 10, color: '#9fdcff' });

// kerbs and islands: planted, with a pale kerb edge along the lane
const capped = (r: Rect) =>
  r.w >= r.h
    ? paint([v(r.x, r.y + r.h / 2), v(r.x + r.w, r.y + r.h / 2)], r.h, PLANTER, undefined, true)
    : paint([v(r.x + r.w / 2, r.y), v(r.x + r.w / 2, r.y + r.h)], r.w, PLANTER, undefined, true);
[ISLAND_N, ISLAND_W, ISLAND_E, PYLON].forEach(capped);
paint(arcPts(NW, R_KERB - T_KERB / 2 - 0.2, PI, 1.5 * PI), T_KERB + 0.2, PLANTER, undefined, true);
paint(arcPts(NE, R_KERB - T_KERB / 2 - 0.2, -PI / 2, 0), T_KERB + 0.2, PLANTER, undefined, true);
const kerbR = LANE + 0.35;
paint(
  [
    v(ISLAND_W.x + ISLAND_W.w - 0.15, ISLAND_W.y + ISLAND_W.h),
    v(ISLAND_W.x + ISLAND_W.w - 0.15, B.y),
    ...arcPts(NW, kerbR, PI, 1.5 * PI),
    v(NE.x, ISLAND_N.y + ISLAND_N.h - 0.15),
    ...arcPts(NE, kerbR, -PI / 2, 0),
    v(ISLAND_E.x + 0.15, H - 1),
  ],
  0.35,
  KERB,
  undefined,
  true,
);
paint(
  [
    v(ISLAND_W.x, ISLAND_W.y + ISLAND_W.h - 0.15),
    v(ISLAND_W.x + ISLAND_W.w, ISLAND_W.y + ISLAND_W.h - 0.15),
  ],
  0.35,
  KERB,
  undefined,
  true,
);
{
  const { x, y, w, h } = PYLON;
  paint([v(x, y), v(x + w, y), v(x + w, y + h), v(x, y + h), v(x, y)], 0.35, KERB, undefined, true);
}
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
add({ kind: 'moon', x: B.x + 10, y: B.y + 12, r: 5.5 });
add({
  kind: 'sign',
  x: B.x + 21,
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
  x: ISLAND_W.x + ISLAND_W.w - 0.9,
  y: 104,
  w: 4.5,
  h: 0.9,
  angle: PI / 2,
  color: BLUE,
  text: 'MENU',
  seed: 0,
});
add({
  kind: 'sign',
  x: ISLAND_W.x + ISLAND_W.w - 0.6,
  y: 108.5,
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
