import { describe, expect, it } from 'vitest';
import { garage, garageRoute } from './garage';
import { CAR_MODELS } from '../models';
import type { CarModel, Floor, Helix, Rect, Solid, Vec } from '../types';

const S = 0.5;
const CLEAR = 1.4;
const DEG = Math.PI / 180;

const center = (r: Rect): Vec => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const halfDiag = (s: Solid) => Math.hypot(s.w, s.h) / 2;
const distToRect = (p: Vec, r: Rect) =>
  Math.hypot(Math.max(r.x - p.x, 0, p.x - (r.x + r.w)), Math.max(r.y - p.y, 0, p.y - (r.y + r.h)));
/** Rotated solids are approximated by the circle around them (radius = half-diagonal). */
const distToSolid = (p: Vec, s: Solid) =>
  s.angle
    ? Math.max(0, Math.hypot(p.x - center(s).x, p.y - center(s).y) - halfDiag(s))
    : distToRect(p, s);
const clearance = (p: Vec, f: Floor) =>
  Math.min(
    ...f.solids.map((s) => distToSolid(p, s)),
    ...f.circles.map((c) => Math.hypot(p.x - c.x, p.y - c.y) - c.r),
  );
const inside = (r: Rect, f: Floor) => r.x >= 0 && r.y >= 0 && r.x + r.w <= f.w && r.y + r.h <= f.h;
const inRect = (p: Vec, r: Rect) =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/** Corners of a (rotated) solid grown by `pad`. */
function cornersOf(s: Solid, pad = 0): Vec[] {
  const a = s.angle ?? 0;
  const c = center(s);
  return [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ].map(([i, j]) => {
    const u = i * (s.w / 2 + pad);
    const w = j * (s.h / 2 + pad);
    return {
      x: c.x + u * Math.cos(a) - w * Math.sin(a),
      y: c.y + u * Math.sin(a) + w * Math.cos(a),
    };
  });
}
/** Separating axis test: true if a and b, each grown by gap / 2, still don't overlap. */
function separated(a: Solid, b: Solid, gap = 0) {
  const pa = cornersOf(a, gap / 2);
  const pb = cornersOf(b, gap / 2);
  return [a.angle ?? 0, b.angle ?? 0].some((ang) =>
    [ang, ang + Math.PI / 2].some((t) => {
      const pr = (pts: Vec[]) => pts.map((p) => p.x * Math.cos(t) + p.y * Math.sin(t));
      const A = pr(pa);
      const B = pr(pb);
      return Math.max(...A) <= Math.min(...B) + 1e-9 || Math.max(...B) <= Math.min(...A) + 1e-9;
    }),
  );
}
/** Point strictly inside a (rotated) solid. */
function inSolid(p: Vec, s: Solid) {
  const a = s.angle ?? 0;
  const c = center(s);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const u = dx * Math.cos(a) + dy * Math.sin(a);
  const w = -dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(u) < s.w / 2 && Math.abs(w) < s.h / 2;
}

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

const segDist = (p: Vec, [a, b]: Vec[]) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
/** Samples every 0.5 m along a polyline. */
function samples(points: Vec[]): Vec[] {
  const out: Vec[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    for (let d = 0; d <= len; d += 0.5)
      out.push({ x: a.x + ((b.x - a.x) * d) / len, y: a.y + ((b.y - a.y) * d) / len });
  }
  return out;
}

const { floors, helixes } = garage;
/** Where the car appears on floor i, and where it must get to. */
const spawnOf = (i: number) => (i === 0 ? garage.start.pos : exitPoint(helixes[i - 1]));
const targetOf = (i: number) =>
  i < helixes.length ? entryPoint(helixes[i]) : center(garage.finish.zone);
const carsOf = (f: Floor) => f.solids.filter((s) => s.kind === 'car');

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
    const all = { x: 0, y: 0, w: 140, h: 80 };
    for (const f of floors) {
      for (const r of [...f.solids, ...f.bays]) expect(inside(r, f)).toBe(true);
      for (const s of f.solids) for (const p of cornersOf(s)) expect(inRect(p, all)).toBe(true);
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
            expect(f.solids.find((s) => inSolid(p, s))).toBeUndefined();
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

  it('route chains spawn to finish and stays 5 m from solids (10 m+ lanes)', () => {
    expect(garageRoute.map((r) => r.floor)).toEqual([0, 1, 2]);
    expect(garageRoute[0].points[0]).toEqual(garage.start.pos);
    const last = garageRoute[2].points.at(-1)!;
    expect(inRect(last, garage.finish.zone)).toBe(true);
    for (const { floor, points } of garageRoute) {
      for (const p of samples(points)) {
        // helix half circles are drawn as chords, which dip 0.1 m toward the core
        const min = helixes.some((h) => inAnnulus(p, h)) ? 4.9 : 5;
        expect(clearance(p, floors[floor])).toBeGreaterThanOrEqual(min);
      }
    }
    // each helix: the route passes its entry point on `from` and its exit point on `from + 1`
    for (const h of helixes) {
      const near = (pts: Vec[], q: Vec) => pts.some((p) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6);
      expect(near(garageRoute[h.from].points, entryPoint(h))).toBe(true);
      expect(near(garageRoute[h.from + 1].points, exitPoint(h))).toBe(true);
    }
  });

  it('links varied left and right corners on every floor', () => {
    for (const { points } of garageRoute) {
      // signed turn per vertex outside the helixes, merged into corners while the sign holds
      const corners: { turn: number; from: number; to: number }[] = [];
      let dist = 0;
      for (let i = 1; i < points.length - 1; i++) {
        const [a, b, c] = [points[i - 1], points[i], points[i + 1]];
        dist += Math.hypot(b.x - a.x, b.y - a.y);
        if (helixes.some((h) => Math.hypot(b.x - h.center.x, b.y - h.center.y) <= h.rOuter))
          continue;
        let turn = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x);
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        if (Math.abs(turn) < DEG) continue;
        const prev = corners.at(-1);
        if (prev && Math.sign(prev.turn) === Math.sign(turn)) {
          prev.turn += turn;
          prev.to = dist;
        } else corners.push({ turn, from: dist, to: dist });
      }
      const big = corners.filter((c) => Math.abs(c.turn) > 30 * DEG);
      expect(big.length).toBeGreaterThanOrEqual(4);
      const flick = corners.some(
        (c, i) =>
          i > 0 &&
          Math.abs(c.turn) > 30 * DEG &&
          Math.abs(corners[i - 1].turn) > 30 * DEG &&
          c.from - corners[i - 1].to <= 60,
      );
      expect(flick).toBe(true);
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

  it('keeps parked cars 0.3 m from every other solid and pillars off everything', () => {
    for (const f of floors) {
      expect(carsOf(f).length).toBeGreaterThan(20);
      for (const c of f.solids.filter((s) => s.kind !== 'wall')) {
        for (const s of f.solids) {
          if (s !== c) expect(separated(c, s, c.kind === 'car' ? 0.3 : 0)).toBe(true);
        }
      }
    }
  });

  it('is called JAPAN GARAGE', () => {
    expect(garage.name).toBe('JAPAN GARAGE');
  });

  it('parks every car as a JDM model with its real footprint, rotated to its heading', () => {
    const used = new Set<CarModel>();
    for (const f of floors) {
      for (const c of carsOf(f)) {
        expect(c.model && c.color && Number.isFinite(c.facing)).toBeTruthy();
        const m = CAR_MODELS[c.model!];
        used.add(c.model!);
        expect(m.colors).toContain(c.color);
        expect(c.angle).toBe(c.facing);
        expect(c.w).toBeCloseTo(m.length, 6);
        expect(c.h).toBeCloseTo(m.width, 6);
      }
    }
    expect(used.size).toBe(10);
  });

  it('lights about 1 in 5 cars, aimed down the course at open floor', () => {
    const cars = floors.flatMap(carsOf);
    const lit = cars.filter((c) => c.lights === 'on');
    expect(lit.length / cars.length).toBeGreaterThan(0.12);
    expect(lit.length / cars.length).toBeLessThan(0.3);
    expect(cars.some((c) => c.lights === 'hazard')).toBe(true);
    garageRoute.forEach(({ points }, i) => {
      const f = floors[i];
      for (const c of carsOf(f).filter((s) => s.lights === 'on')) {
        const k = center(c);
        const ahead = (d: number) => ({
          x: k.x + (c.w / 2 + d) * Math.cos(c.facing!),
          y: k.y + (c.w / 2 + d) * Math.sin(c.facing!),
        });
        expect(f.solids.find((s) => inSolid(ahead(6), s))).toBeUndefined();
        // the route segment nearest the car runs the way its nose points
        const near = points
          .slice(1)
          .map((q, j) => [points[j], q])
          .reduce((best, seg) => (segDist(k, seg) < segDist(k, best) ? seg : best));
        const dir = Math.atan2(near[1].y - near[0].y, near[1].x - near[0].x);
        expect(Math.cos(c.facing! - dir)).toBeGreaterThan(0);
      }
    });
  });
});
