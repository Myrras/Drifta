import { describe, expect, it } from 'vitest';
import { garage, garageRoute } from './garage';
import { CAR_MODELS } from '../models';
import type { CarModel, Floor, Helix, Rect, Solid, Vec } from '../types';

const S = 0.5;
const CLEAR = 1.4;

const distToRect = (p: Vec, r: Rect) =>
  Math.hypot(Math.max(r.x - p.x, 0, p.x - (r.x + r.w)), Math.max(r.y - p.y, 0, p.y - (r.y + r.h)));
const clearance = (p: Vec, f: Floor) =>
  Math.min(
    ...f.solids.map((s) => distToRect(p, s)),
    ...f.circles.map((c) => Math.hypot(p.x - c.x, p.y - c.y) - c.r),
  );
const inside = (r: Rect, f: Floor) => r.x >= 0 && r.y >= 0 && r.x + r.w <= f.w && r.y + r.h <= f.h;
const inRect = (p: Vec, r: Rect) =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
const strictlyIn = (p: Vec, r: Rect) =>
  p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
const overlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const center = (r: Rect): Vec => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

const rMid = (h: Helix) => (h.rCore + h.rOuter) / 2;
const onRing = (h: Helix, a: number, r = rMid(h)): Vec => ({
  x: h.center.x + r * Math.cos(a),
  y: h.center.y + r * Math.sin(a),
});
const entryPoint = (h: Helix) => onRing(h, h.enterAngle);
const exitPoint = (h: Helix) => onRing(h, h.enterAngle + h.sweep);
const inAnnulus = (p: Vec, h: Helix) => {
  const d = Math.hypot(p.x - h.center.x, p.y - h.center.y);
  return d >= h.rCore && d <= h.rOuter;
};
/** Point on the tangent lane just outside the annulus: before the entry or after the exit. */
function mouth(h: Helix, atExit: boolean): Vec {
  const a = h.enterAngle + (atExit ? h.sweep : 0);
  const heading = a + (Math.sign(h.sweep) * Math.PI) / 2;
  const L = (atExit ? 1 : -1) * (Math.sqrt(h.rOuter ** 2 - rMid(h) ** 2) + 1);
  const p = onRing(h, a);
  return { x: p.x + L * Math.cos(heading), y: p.y + L * Math.sin(heading) };
}

const free = new Map<Floor, Uint8Array>();
/** 1 where a 0.5 m cell center has ≥ 1.4 m clearance from every solid and circle. */
function freeGrid(f: Floor) {
  let g = free.get(f);
  if (!g) {
    const cols = Math.round(f.w / S);
    g = new Uint8Array(cols * Math.round(f.h / S));
    for (let i = 0; i < g.length; i++) {
      const p = { x: ((i % cols) + 0.5) * S, y: (Math.floor(i / cols) + 0.5) * S };
      g[i] = clearance(p, f) >= CLEAR ? 1 : 0;
    }
    free.set(f, g);
  }
  return g;
}

/** Flood fill over free cells (minus `blocked`) from `from`; true if the cell holding `to` is reached. */
function reaches(f: Floor, from: Vec, to: Vec, blocked = (_p: Vec) => false): boolean {
  const g = freeGrid(f);
  const cols = Math.round(f.w / S);
  const rows = Math.round(f.h / S);
  const cell = (p: Vec) => Math.floor(p.y / S) * cols + Math.floor(p.x / S);
  const goal = cell(to);
  const seen = new Uint8Array(g.length);
  const stack = [cell(from)];
  while (stack.length) {
    const i = stack.pop()!;
    if (seen[i] || !g[i]) continue;
    const c = i % cols;
    const r = Math.floor(i / cols);
    if (blocked({ x: (c + 0.5) * S, y: (r + 0.5) * S })) continue;
    seen[i] = 1;
    if (i === goal) return true;
    if (c + 1 < cols) stack.push(i + 1);
    if (c > 0) stack.push(i - 1);
    if (r + 1 < rows) stack.push(i + cols);
    if (r > 0) stack.push(i - cols);
  }
  return false;
}

const { floors, helixes } = garage;
/** Where the car appears on floor i, and where it must get to. */
const spawnOf = (i: number) => (i === 0 ? garage.start.pos : exitPoint(helixes[i - 1]));
const targetOf = (i: number) =>
  i < helixes.length ? entryPoint(helixes[i]) : center(garage.finish.zone);

describe('garage', () => {
  it('has 3 floors joined by 2 half-circle helixes', () => {
    expect(floors).toHaveLength(3);
    expect(helixes.map((h) => h.from)).toEqual([0, 1]);
    for (const h of helixes) {
      expect(Math.abs(h.sweep)).toBeCloseTo(Math.PI);
      for (const f of [floors[h.from], floors[h.from + 1]]) {
        expect(f.circles).toContainEqual({ x: h.center.x, y: h.center.y, r: h.rCore });
      }
    }
    expect(garage.start.floor).toBe(0);
    expect(garage.finish.floor).toBe(2);
  });

  it('keeps everything inside floor bounds', () => {
    for (const f of floors) {
      for (const r of [...f.solids, ...f.bays]) expect(inside(r, f)).toBe(true);
      for (const c of f.circles) {
        expect(inside({ x: c.x - c.r, y: c.y - c.r, w: 2 * c.r, h: 2 * c.r }, f)).toBe(true);
      }
      for (const l of f.lights) expect(inRect(l, { x: 0, y: 0, w: f.w, h: f.h })).toBe(true);
      expect(f.lights.length).toBeGreaterThan(0);
      expect(f.bays.length).toBeGreaterThan(0);
    }
    expect(inside(garage.finish.zone, floors[2])).toBe(true);
  });

  it('keeps the driven half of every helix ring free of solids on both floors', () => {
    for (const h of helixes) {
      for (const f of [floors[h.from], floors[h.from + 1]]) {
        for (let r = h.rCore + 0.05; r < h.rOuter; r += 0.25) {
          for (let t = 0; t <= 1; t += 0.1 / r / Math.PI) {
            const p = onRing(h, h.enterAngle + h.sweep * t, r);
            expect(f.solids.find((s) => strictlyIn(p, s))).toBeUndefined();
          }
        }
      }
    }
  });

  it('keeps start and finish clear of solids by 3 m', () => {
    expect(clearance(garage.start.pos, floors[0])).toBeGreaterThanOrEqual(3);
    expect(clearance(center(garage.finish.zone), floors[2])).toBeGreaterThanOrEqual(3);
  });

  it('reaches the next helix / the finish from every floor spawn', () => {
    floors.forEach((f, i) => expect(reaches(f, spawnOf(i), targetOf(i))).toBe(true));
  });

  it('only lets you into a helix ring from its open lane', () => {
    for (const h of helixes) {
      const ring = (p: Vec) => inAnnulus(p, h);
      const upper = floors[h.from];
      const lower = floors[h.from + 1];
      expect(reaches(upper, spawnOf(h.from), mouth(h, false), ring)).toBe(true);
      expect(reaches(upper, spawnOf(h.from), mouth(h, true), ring)).toBe(false);
      expect(reaches(lower, mouth(h, true), targetOf(h.from + 1), ring)).toBe(true);
      expect(reaches(lower, mouth(h, true), mouth(h, false), ring)).toBe(false);
    }
  });

  it('route chains spawn to finish and stays 3.5 m from solids (7 m lanes)', () => {
    expect(garageRoute.map((r) => r.floor)).toEqual([0, 1, 2]);
    expect(garageRoute[0].points[0]).toEqual(garage.start.pos);
    const last = garageRoute[2].points.at(-1)!;
    expect(inRect(last, garage.finish.zone)).toBe(true);
    for (const { floor, points } of garageRoute) {
      const f = floors[floor];
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        for (let d = 0; d <= len; d += 0.5) {
          const p = { x: a.x + ((b.x - a.x) * d) / len, y: a.y + ((b.y - a.y) * d) / len };
          expect(clearance(p, f)).toBeGreaterThanOrEqual(3.5);
        }
      }
    }
    // each helix: the route passes its entry point on `from` and its exit point on `from + 1`
    for (const h of helixes) {
      const near = (pts: Vec[], q: Vec) => pts.some((p) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6);
      expect(near(garageRoute[h.from].points, entryPoint(h))).toBe(true);
      expect(near(garageRoute[h.from + 1].points, exitPoint(h))).toBe(true);
    }
  });

  it('sets par from the route length at 17 m/s', () => {
    const len = garageRoute
      .flatMap((r) =>
        r.points.slice(1).map((b, i) => Math.hypot(b.x - r.points[i].x, b.y - r.points[i].y)),
      )
      .reduce((a, b) => a + b, 0);
    expect(garage.parTime).toBe(Math.round(len / 17));
    expect(garage.parTime).toBeGreaterThanOrEqual(45);
    expect(garage.parTime).toBeLessThanOrEqual(120);
  });

  it('parked cars and pillars do not overlap other solids', () => {
    for (const f of floors) {
      const cars = f.solids.filter((s) => s.kind === 'car');
      expect(cars.length).toBeGreaterThan(0);
      for (const c of f.solids.filter((s) => s.kind !== 'wall')) {
        for (const s of f.solids) if (s !== c) expect(overlap(c, s)).toBe(false);
      }
    }
  });

  it('is called JAPAN GARAGE', () => {
    expect(garage.name).toBe('JAPAN GARAGE');
  });

  /** Unit nose direction of a parked car. */
  const nose = (c: Solid) => ({
    x: Math.round(Math.cos(c.facing!)),
    y: Math.round(Math.sin(c.facing!)),
  });
  /** The `depth` m strip directly ahead (side 1) or behind (side -1) the car. */
  const strip = (c: Solid, side: number, depth: number): Rect => {
    const d = nose(c);
    const sx = d.x * side;
    const sy = d.y * side;
    return {
      x: sx > 0 ? c.x + c.w : sx < 0 ? c.x - depth : c.x,
      y: sy > 0 ? c.y + c.h : sy < 0 ? c.y - depth : c.y,
      w: sx ? depth : c.w,
      h: sy ? depth : c.h,
    };
  };
  const contains = (o: Rect, r: Rect) =>
    r.x >= o.x - 1e-9 &&
    r.y >= o.y - 1e-9 &&
    r.x + r.w <= o.x + o.w + 1e-9 &&
    r.y + r.h <= o.y + o.h + 1e-9;

  it('parks every car as a JDM model in a bay that opens onto an aisle', () => {
    const used = new Set<CarModel>();
    for (const f of floors) {
      for (const c of f.solids.filter((s) => s.kind === 'car')) {
        expect(c.model && c.color && c.facing !== undefined).toBeTruthy();
        const m = CAR_MODELS[c.model!];
        used.add(c.model!);
        expect(m.colors).toContain(c.color);
        const q = c.facing! / (Math.PI / 2);
        expect(Math.abs(q - Math.round(q))).toBeLessThan(1e-9);
        const along = nose(c).x !== 0;
        expect(Math.abs(c.w - (along ? m.length : m.width))).toBeLessThan(0.01);
        expect(Math.abs(c.h - (along ? m.width : m.length))).toBeLessThan(0.01);
        expect(f.bays.some((b) => contains(b, c))).toBe(true);
        const open = [1, -1].some((side) =>
          f.solids.every((s) => s === c || !overlap(strip(c, side, 1.5), s)),
        );
        expect(open).toBe(true);
      }
    }
    expect(used.size).toBe(10);
  });

  it('points lit cars at open floor and lights about 1 in 5 cars', () => {
    const cars = floors.flatMap((f) => f.solids.filter((s) => s.kind === 'car'));
    const lit = cars.filter((c) => c.lights === 'on');
    expect(lit.length / cars.length).toBeGreaterThan(0.12);
    expect(lit.length / cars.length).toBeLessThan(0.3);
    expect(cars.some((c) => c.lights === 'hazard')).toBe(true);
    for (const f of floors) {
      for (const c of f.solids.filter((s) => s.lights === 'on')) {
        const d = nose(c);
        const len = CAR_MODELS[c.model!].length;
        const p = {
          x: c.x + c.w / 2 + d.x * (len / 2 + 6),
          y: c.y + c.h / 2 + d.y * (len / 2 + 6),
        };
        expect(f.solids.find((s) => strictlyIn(p, s))).toBeUndefined();
      }
    }
  });
});
