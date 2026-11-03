import { CAR_MODELS } from '../models';
import type { CarModel, Solid, Vec } from '../types';
import { DOCK_BOXES, type Decor, type DecoratedMap } from './decor';

const W = 320;
const H = 220;
const PI = Math.PI;
const DEG = PI / 180;
const v = (x: number, y: number): Vec => ({ x, y });

/** Straight (m), or arc [radius m, turn deg] with + = right (clockwise on screen). */
type Leg = number | [number, number];

// prettier-ignore
const LEGS: Leg[] = [
  // A: quay run east. Start straight, slalom, flick, crane straight into the big sweeper.
  30, [20, -50], 10, [20, 100], 10, [20, -50], 25, [30, -40], [30, 40], 50, [35, -180],
  // B: back west. Linked chicane, flick, then a feint left into the hairpin.
  25, [18, -70], 8, [18, 140], 8, [18, -70], 25, [22, 50], [22, -50], 25, [25, -45], 10, [9, 180],
  // C: east through the yard. Chicane, flick, around the lit corner block and up the east quay.
  28, [25, 45], 25, [18, -55], 8, [18, 110], 8, [18, -55], 25, [30, 40], [30, -40], 30,
  [25, -90], 20, [18, -90],
  // D: north quay west to the finish.
  30, [30, -35], [30, 35], 25, [20, 40], [20, -40], 30,
];
const START = v(32, 196);

type Sample = { p: Vec; s: number };
/** Route samples (arcs every ≤ 10°) and the apex of every arc. */
const samples: Sample[] = [{ p: START, s: 0 }];
const apexes: { s: number; r: number; side: number; deg: number }[] = [];
/** [start, end] distance of every straight leg. */
const straights: [number, number][] = [];
{
  let p = START;
  let h = 0;
  let s = 0;
  for (const leg of LEGS) {
    if (typeof leg === 'number') {
      straights.push([s, s + leg]);
      p = v(p.x + leg * Math.cos(h), p.y + leg * Math.sin(h));
      s += leg;
      samples.push({ p, s });
      continue;
    }
    const [r, deg] = leg;
    const side = Math.sign(deg);
    const turn = deg * DEG;
    const c = v(p.x + r * Math.cos(h + (side * PI) / 2), p.y + r * Math.sin(h + (side * PI) / 2));
    const n = Math.ceil(Math.abs(deg) / 10);
    const [h0, s0] = [h, s];
    apexes.push({ s: s0 + (r * Math.abs(turn)) / 2, r, side, deg });
    for (let i = 1; i <= n; i++) {
      h = h0 + (turn * i) / n;
      s = s0 + (r * Math.abs(turn) * i) / n;
      p = v(c.x + r * Math.cos(h - (side * PI) / 2), c.y + r * Math.sin(h - (side * PI) / 2));
      samples.push({ p, s });
    }
  }
}
const LENGTH = samples[samples.length - 1].s;
const END = samples[samples.length - 1].p;
/** Polyline length of the exported route (chords, a little under the arc length). */
const ROUTE_LENGTH = samples
  .slice(1)
  .reduce((sum, q, i) => sum + Math.hypot(q.p.x - samples[i].p.x, q.p.y - samples[i].p.y), 0);

/** Suggested racing line. */
export const docksRoute: { floor: number; points: Vec[] }[] = [
  { floor: 0, points: samples.map((q) => q.p) },
];

/** Point and heading at distance s along the route. */
function at(s: number): { p: Vec; h: number } {
  const i = Math.max(
    1,
    samples.findIndex((q) => q.s >= s),
  );
  const a = samples[i - 1];
  const b = samples[i];
  const t = Math.min(1, Math.max(0, (s - a.s) / (b.s - a.s)));
  return {
    p: v(a.p.x + (b.p.x - a.p.x) * t, a.p.y + (b.p.y - a.p.y) * t),
    h: Math.atan2(b.p.y - a.p.y, b.p.x - a.p.x),
  };
}
/** Point d m to the right (d < 0: left) of the route at s. */
function off(s: number, d: number): Vec {
  const { p, h } = at(s);
  return v(p.x - d * Math.sin(h), p.y + d * Math.cos(h));
}

const rect = (kind: Solid['kind'], c: Vec, w: number, h: number, angle?: number): Solid => ({
  kind,
  x: c.x - w / 2,
  y: c.y - h / 2,
  w,
  h,
  ...(angle !== undefined && { angle }),
});
const wall = (x: number, y: number, w: number, h: number): Solid => ({ kind: 'wall', x, y, w, h });
const pillar = (c: Vec, size = 0.8) => rect('pillar', c, size, size);
/** Container, long (12.2 m) or short (6.1 m), centered on c. */
const box = (c: Vec, angle?: number, long = true) =>
  rect('wall', c, long ? 12.2 : 6.1, 2.44, angle);
// Placeholder car with the largest model dims; model, color and size are set after filtering.
const car = (c: Vec, facing: number): Solid => ({
  ...rect('car', c, 4.55, 1.81, facing),
  model: 'r32',
  facing,
});

/** Semi truck: trailer plus cab, nose along `facing`. */
function truck(c: Vec, facing: number): Solid[] {
  const d = v(Math.cos(facing), Math.sin(facing));
  return [
    rect('wall', v(c.x - d.x * 1.5, c.y - d.y * 1.5), 13.6, 2.5, facing),
    rect('wall', v(c.x + d.x * 6.8, c.y + d.y * 6.8), 2.4, 2.5, facing),
  ];
}

/** Containers stacked in a block from (x, y): cols along x, rows along y; `upright` turns them 90°. */
function stack(x: number, y: number, cols: number, rows: number, upright = false): Solid[] {
  const [w, h] = upright ? [2.44, 12.2] : [12.2, 2.44];
  return Array.from({ length: cols * rows }, (_, i) =>
    wall(x + (i % cols) * w, y + Math.floor(i / cols) * h, w, h),
  );
}
/** Block of long containers rotated by `angle` about its center (cx, cy). */
function rstack(cx: number, cy: number, cols: number, rows: number, angle: number): Solid[] {
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  return Array.from({ length: cols * rows }, (_, i) => {
    const u = ((i % cols) - (cols - 1) / 2) * 12.2;
    const w = (Math.floor(i / cols) - (rows - 1) / 2) * 2.44;
    return box(v(cx + u * c - w * s, cy + u * s + w * c), angle);
  });
}

/** Objects every `step` m (measured at the offset) along the route from s0 to s1, d m to the side. */
function along(
  s0: number,
  s1: number,
  d: number,
  step: number,
  make: (c: Vec, h: number, s: number) => Solid[],
) {
  const out: Solid[] = [];
  let last: Vec | null = null;
  for (let s = s0; s <= s1; s += 0.5) {
    const c = off(s, d);
    if (last && Math.hypot(c.x - last.x, c.y - last.y) < step) continue;
    out.push(...make(c, at(s).h, s));
    last = c;
  }
  return out;
}
/** Row and route distance of every car placed by `cars` (rows get painted bays). */
const rowOf = new Map<Solid, { row: number; s: number }>();
let rows = 0;
/** Parked cars angled `a` deg off the route heading, noses toward the line (a > 90: facing traffic). */
const cars = (s0: number, s1: number, d: number, a: number, step = 3.2) => {
  const row = rows++;
  return along(s0, s1, d, step, (c, h, s) => {
    const k = car(c, h - Math.sign(d) * a * DEG);
    rowOf.set(k, { row, s });
    return [k];
  });
};
const boxes = (s0: number, s1: number, d: number, long = true) =>
  along(s0, s1, d, long ? 12.6 : 6.5, (c, h) => [box(c, h, long)]);
const bollards = (s0: number, s1: number, d: number, step: number) =>
  along(s0, s1, d, step, (c) => [pillar(c)]);

/** Close-call bait on the inside of every corner: bollard cluster, parked car or short container. */
const apexBait = apexes.map(({ s, r, side }) => {
  const { h } = at(s);
  if (r < 12)
    return [
      pillar(off(s, side * 6)),
      pillar(off(s - 1.5, side * 6.6)),
      pillar(off(s + 1.5, side * 6.6)),
    ];
  if (r < 30) return [car(off(s, side * 7.7), h + (side * PI) / 2)];
  return [box(off(s, side * 8.6), h, false)];
});

/** Clipping zones: 5 m squares on the outside of the big turns, against the parked outline. */
const clipZones = apexes
  .filter(({ deg }) => Math.abs(deg) >= 100)
  .map(({ s, side }) => {
    const c = off(s, -side * 4.5);
    return { x: c.x - 2.5, y: c.y - 2.5, w: 5, h: 5 };
  });

const crane = (s: number) => [s, s + 14].flatMap((q) => [-12, 12].map((d) => pillar(off(q, d), 2)));

const groups: Solid[][] = [
  // landmarks
  crane(205),
  stack(231.7, 139.7, 3, 6), // lit block in the sweeper infield
  stack(244, 63.3, 2, 4), // corner block: its SE corner is the apex of the turn up the east quay
  stack(105, 142, 4, 6),
  rstack(72, 152, 2, 3, 0.35),
  rstack(36, 152, 2, 4, -0.3),
  stack(160, 88, 3, 2),
  stack(95, 34.8, 4, 1),
  stack(175, 50.8, 5, 1),
  stack(300, 25, 5, 7, true),
  stack(300, 160, 5, 4, true),
  // fuel dock: kiosk and pump islands
  [wall(26, 42, 14, 8), ...[44, 50, 56].map((x) => rect('pillar', v(x, 56), 1, 2.6))],
  truck(off(178, 14), at(178).h + 0.15),
  truck(off(500, 14), at(500).h),
  truck(off(1000, -14), at(1000).h + PI),
  ...apexBait,
  // A
  cars(0, 125, -11, 125),
  bollards(0, 240, 12, 6),
  cars(130, 200, -12, 60),
  boxes(240, 345, 13),
  // B
  boxes(347, 372, 13.5),
  cars(372, 476, -11, 120),
  cars(372, 476, 11, 120),
  cars(476, 564, -11, 60),
  cars(476, 564, 11, 125),
  bollards(564, 622, -10, 3.5),
  bollards(622, 660, 10, 4),
  // C
  cars(650, 695, -11, 120),
  cars(695, 780, -11, 60),
  cars(695, 780, 11, 120),
  cars(780, 877, 12, 60),
  cars(780, 877, -11, 120),
  cars(877, 964, 11, 125),
  // D
  bollards(964, LENGTH, 11, 6),
  cars(964, LENGTH, -11, 125),
];

const center = (s: Solid) => v(s.x + s.w / 2, s.y + s.h / 2);
const reach = (s: Solid) => Math.hypot(s.w, s.h) / 2;
/** Distance from p to a solid; rotated rects as their circumscribed circle (conservative). */
function gap(p: Vec, s: Solid) {
  if (s.angle !== undefined) {
    const c = center(s);
    return Math.hypot(p.x - c.x, p.y - c.y) - reach(s);
  }
  return Math.hypot(
    Math.max(s.x - p.x, 0, p.x - s.x - s.w),
    Math.max(s.y - p.y, 0, p.y - s.y - s.h),
  );
}
const line: Vec[] = [];
for (let s = 0; s <= LENGTH; s += 0.5) line.push(at(s).p);
const lineGap = (s: Solid) => Math.min(...line.map((p) => gap(p, s)));
const inBounds = (s: Solid) => {
  const c = center(s);
  const r = s.angle === undefined ? 0 : reach(s);
  const [hw, hh] = s.angle === undefined ? [s.w / 2, s.h / 2] : [r, r];
  return c.x - hw >= 1 && c.y - hh >= 1 && c.x + hw <= W - 1 && c.y + hh <= H - 1;
};
const clash = (a: Solid, b: Solid) => {
  const [p, q] = [center(a), center(b)];
  return Math.hypot(p.x - q.x, p.y - q.y) < reach(a) + reach(b);
};

// Keep the line 5 m wide on each side (plus margin); earlier groups win overlaps.
const kept: Solid[] = [];
for (const g of groups) {
  const ok = g.filter((s) => inBounds(s) && lineGap(s) >= 5.2 && !kept.some((k) => clash(s, k)));
  kept.push(...ok);
}

const MODELS = Object.keys(CAR_MODELS) as CarModel[];
const lineDist = (p: Vec) => Math.min(...line.map((q) => Math.hypot(p.x - q.x, p.y - q.y)));
let n = 0;
let lit = 0;
const solids = kept.map((s): Solid => {
  if (s.kind !== 'car') return s;
  const i = n++;
  const model = MODELS[i % MODELS.length];
  const { length, width, colors } = CAR_MODELS[model];
  const c = center(s);
  const f = s.facing!;
  const nose = v(c.x + 4 * Math.cos(f), c.y + 4 * Math.sin(f));
  const toward = lineDist(nose) < lineDist(c);
  const lights = toward && lit++ % 6 === 2 ? 'on' : i % 20 === 13 ? 'hazard' : undefined;
  return {
    ...rect('car', c, length, width, f),
    model,
    color: colors[(i * 7 + Math.floor(i / MODELS.length)) % colors.length],
    facing: f,
    ...(lights && { lights }),
  };
});

/** Sodium lamps every 27 m, alternating sides, plus the lit block and the fuel dock. */
const lights = [
  ...Array.from({ length: Math.floor(LENGTH / 27) + 1 }, (_, i) =>
    off(i * 27, i % 2 ? 9 : -9),
  ).filter((p) => p.x > 1 && p.y > 1 && p.x < W - 1 && p.y < H - 1),
  v(228, 136),
  v(272, 136),
  v(228, 158),
  v(272, 158),
  v(42, 54),
];

// --- decor: a container port at night ---
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(1985);
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const decor: Decor[] = [];
type Item<D = Decor> = D extends unknown ? Omit<D, 'floor'> : never;
const add = (d: Item) => decor.push({ floor: 0, ...d } as Decor);
const paint = (pts: Vec[], w: number, color: string) =>
  add({ kind: 'paint', x: pts[0].x, y: pts[0].y, to: pts.slice(1), w, color });
const PAINT_W = 'rgba(215,215,205,0.4)';
/** Bay line paint; opaque so lines shared by neighbouring bays don't double up. */
export const BAY_PAINT = '#8c8b84';

// the harbour: a ship moored off the east quay (in view along the east run), lines to bollards
// on the quay wall
const SHIP = { x: 322, y: 15, w: 28, h: 190 };
const wallBollards = Array.from({ length: 9 }, (_, i) => v(W - 0.5, 30 + i * 20));
const ropes = wallBollards.map((c, i): [Vec, Vec] => [c, v(SHIP.x, c.y + (i < 4 ? -7 : 7))]);
add({ kind: 'sea', x: 0, y: 0, w: W, h: H, ship: SHIP, ropes });

// the haul road: a smoother wet band along the line, edge lines and lane arrows on straights
paint(
  [v(START.x - 30, START.y), ...samples.map((q) => q.p)], // from the quay end behind the start
  17,
  'rgba(120,130,150,0.09)',
);
for (const [s0, s1] of straights) {
  if (s1 - s0 < 20) continue;
  for (const side of [-1, 1])
    paint([off(s0 + 2, side * 7.6), off(s1 - 2, side * 7.6)], 0.15, PAINT_W);
  const mid = (s0 + s1) / 2;
  for (const side of [-1, 1]) add({ kind: 'arrow', ...off(mid, side * 3), angle: at(mid).h });
}

// painted bays under the rows of parked cars on straights; cars on curves just park
{
  const DEPTH = 3.3; // bay half length along the car, past its corners at 55-60 deg
  const byRow = new Map<number, { c: Vec; f: number; h: number }[]>();
  kept.forEach((k, i) => {
    const r = rowOf.get(k);
    if (!r || at(r.s - 4).h !== at(r.s + 4).h) return;
    const list = byRow.get(r.row) ?? [];
    list.push({ c: center(solids[i]), f: solids[i].facing!, h: at(r.s).h });
    byRow.set(r.row, list);
  });
  const bays = (run: { c: Vec; f: number; h: number }[]) => {
    if (!run.length) return;
    const r = v(Math.cos(run[0].h), Math.sin(run[0].h));
    const f = v(Math.cos(run[0].f) * DEPTH, Math.sin(run[0].f) * DEPTH);
    const [first, last] = [run[0].c, run[run.length - 1].c];
    const ends = [
      v(first.x - r.x * 1.6, first.y - r.y * 1.6),
      ...run.slice(1).map((q, k) => v((q.c.x + run[k].c.x) / 2, (q.c.y + run[k].c.y) / 2)),
      v(last.x + r.x * 1.6, last.y + r.y * 1.6),
    ];
    for (let k = 0; k < run.length; k++) {
      const [a, b] = [ends[k], ends[k + 1]];
      paint(
        [
          v(a.x + f.x, a.y + f.y),
          v(a.x - f.x, a.y - f.y),
          v(b.x - f.x, b.y - f.y),
          v(b.x + f.x, b.y + f.y),
        ],
        0.12,
        BAY_PAINT,
      );
    }
  };
  for (const list of byRow.values()) {
    let run: typeof list = [];
    for (const q of list) {
      const p = run[run.length - 1];
      if (p && (Math.hypot(q.c.x - p.c.x, q.c.y - p.c.y) > 4 || q.h !== p.h))
        (bays(run), (run = []));
      run.push(q);
    }
    bays(run);
  }
}

// quay stencils, keep-clear hatching round the crane legs
for (const [text, x, y] of [
  ['BERTH 6', 100, 5],
  ['BERTH 7', 200, 5],
  ['BERTH 2', 120, 215],
  ['BERTH 9', 315.6, 135],
] as const)
  add({
    kind: 'text',
    x,
    y,
    angle: x > W - 10 ? PI / 2 : 0,
    text,
    size: 3,
    color: 'rgba(214,165,31,0.5)',
  });
const sts = { ...at(212).p, angle: at(212).h };
for (const s of kept.filter((s) => s.kind === 'pillar' && s.w === 2))
  add({ kind: 'hatch', x: s.x - 0.8, y: s.y - 0.8, w: 3.6, h: 3.6 });

// wet ground: puddles and sodium streaks under the lamps
lights.forEach((l, i) => {
  add({ kind: 'reflection', ...l });
  if (i % 3 === 0)
    add({
      kind: 'puddle',
      x: l.x + (rand() - 0.5) * 6,
      y: l.y + (rand() - 0.5) * 6,
      r: 1.2 + rand() * 1.5,
      seed: i,
    });
});

// containers, trucks and the fuel dock
const OWNERS = ['WGNU', 'MSKU', 'TGHU', 'CMAU', 'OOLU', 'HLXU', 'EGHU', 'NYKU', 'KKFU', 'TCLU'];
const BRANDS = ['WANGAN', 'KAIUN', 'ORIENT', 'SEALINK', 'TOKAI', 'NIPPON'];
const near = (a: number, b: number) => Math.abs(a - b) < 0.2;
for (const s of solids) {
  if (s.kind !== 'wall') continue;
  const [lo, hi] = [Math.min(s.w, s.h), Math.max(s.w, s.h)];
  const base = { ...center(s), w: s.w, h: s.h, angle: s.angle ?? 0 };
  const code = `${pick(OWNERS)} ${String(Math.floor(rand() * 1e6)).padStart(6, '0')}`;
  if (near(lo, 2.44) && (near(hi, 12.2) || near(hi, 6.1)))
    add({
      kind: 'container',
      ...base,
      color: pick(DOCK_BOXES),
      code,
      tone: rand() - 0.5,
      ...(hi > 10 && rand() < 0.3 && { brand: pick(BRANDS) }),
    });
  else if (near(hi, 13.6))
    add({ kind: 'container', ...base, color: pick(DOCK_BOXES), code, part: 'trailer' });
  else if (near(hi, 2.5))
    add({
      kind: 'container',
      ...base,
      color: pick(['#e8e6e0', '#b8382c', '#2c5aa0']),
      part: 'cab',
    });
}
add({
  kind: 'sign',
  x: 33,
  y: 46,
  w: 9,
  h: 2.4,
  angle: 0,
  color: '#ffb03a',
  text: 'FUEL',
  seed: 0,
});

// cranes: the ship-to-shore crane over the quay road, yard gantries straddling four stacks
add({ kind: 'crane', ...sts, len: 14, span: 24, boom: 22, seed: 0 });
add({ kind: 'pool', ...sts, r: 12 });
for (const [x, y, angle, span, seed] of [
  [128, 149.3, 0, 12.6, 1],
  [256, 147, 0, 12.6, 2],
  [306.1, 70, PI / 2, 10.2, 3],
  [306.1, 185, PI / 2, 10.2, 4],
])
  add({ kind: 'crane', x, y, angle, len: 6, span, boom: 0, seed });

// bollards (the 0.8 m pillars) with a rope coil on the far side from the line every few
kept
  .filter((s) => s.kind === 'pillar' && s.w < 1)
  .map(center)
  .forEach((c, i) => {
    add({ kind: 'bollard', ...c });
    if (i % 4) return;
    const n = line.reduce((a, q) =>
      Math.hypot(q.x - c.x, q.y - c.y) < Math.hypot(a.x - c.x, a.y - c.y) ? q : a,
    );
    const d = Math.hypot(c.x - n.x, c.y - n.y);
    add({
      kind: 'coil',
      x: c.x + ((c.x - n.x) / d) * 1.3,
      y: c.y + ((c.y - n.y) / d) * 1.3,
      seed: i,
    });
  });
for (const c of wallBollards) add({ kind: 'bollard', ...c });

export const docks: DecoratedMap = {
  name: 'WANGAN DOCKS',
  parTime: Math.round(ROUTE_LENGTH / 17),
  // tuning values: total score for bronze, silver, gold; ~+10% for clipping zones
  medals: [3300, 7700, 14500],
  floors: [
    {
      name: 'WANGAN DOCKS',
      w: W,
      h: H,
      solids: [
        wall(0, 0, W, 1),
        wall(0, H - 1, W, 1),
        wall(0, 1, 1, H - 2),
        wall(W - 1, 1, 1, H - 2),
        ...solids,
      ],
      bays: [],
      lights,
      circles: [],
      clipZones,
    },
  ],
  helixes: [],
  start: { floor: 0, pos: START, angle: 0 },
  finish: { floor: 0, zone: { x: END.x - 6, y: END.y - 4, w: 12, h: 8 } },
  decor,
};
