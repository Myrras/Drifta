import { describe, expect, it } from 'vitest';
import { drivethru, drivethruRoute } from './drivethru';
import { drawDecor, type DecorLayer } from './decor';
import { CAR_MODELS } from '../models';
import type { Rect, Solid, Vec } from '../types';

const f = drivethru.floors[0];
const MAP = { x: 0, y: 0, w: f.w, h: f.h };
const inRect = (p: Vec, r: Rect, eps = 1e-6) =>
  p.x >= r.x - eps && p.x <= r.x + r.w + eps && p.y >= r.y - eps && p.y <= r.y + r.h + eps;
const center = (r: Rect): Vec => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Exact distance from p to a (rotated) solid; 0 inside. */
function distToSolid(p: Vec, s: Solid) {
  const a = s.angle ?? 0;
  const c = center(s);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const u = Math.abs(dx * Math.cos(a) + dy * Math.sin(a)) - s.w / 2;
  const w = Math.abs(-dx * Math.sin(a) + dy * Math.cos(a)) - s.h / 2;
  return Math.hypot(Math.max(u, 0), Math.max(w, 0));
}
const clearance = (p: Vec) => Math.min(...f.solids.map((s) => distToSolid(p, s)));
function cornersOf(s: Solid): Vec[] {
  const a = s.angle ?? 0;
  const c = center(s);
  return [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ].map(([i, j]) => ({
    x: c.x + ((i * s.w) / 2) * Math.cos(a) - ((j * s.h) / 2) * Math.sin(a),
    y: c.y + ((i * s.w) / 2) * Math.sin(a) + ((j * s.h) / 2) * Math.cos(a),
  }));
}
const route = drivethruRoute[0].points;
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
const length = route
  .slice(1)
  .reduce((s, b, i) => s + Math.hypot(b.x - route[i].x, b.y - route[i].y), 0);

/** Flood fill on a 1 m grid with 2 m clearance; `skip` cells are treated as solid. */
function reaches(from: Vec, to: Vec, skip: (p: Vec) => boolean = () => false) {
  const cols = f.w;
  const ok = (i: number) => {
    const p = { x: (i % cols) + 0.5, y: Math.floor(i / cols) + 0.5 };
    return !skip(p) && clearance(p) >= 2;
  };
  const cell = (p: Vec) => Math.floor(p.y) * cols + Math.floor(p.x);
  const goal = cell(to);
  const seen = new Uint8Array(cols * f.h);
  const stack = [cell(from)];
  while (stack.length) {
    const i = stack.pop()!;
    if (seen[i] || !ok(i)) continue;
    if (i === goal) return true;
    seen[i] = 1;
    const c = i % cols;
    if (c + 1 < cols) stack.push(i + 1);
    if (c > 0) stack.push(i - 1);
    if (i + cols < seen.length) stack.push(i + cols);
    if (i >= cols) stack.push(i - cols);
  }
  return false;
}

describe('drivethru (MIDNIGHT DRIVE-THRU)', () => {
  it('is one floor, no helixes', () => {
    expect(drivethru.name).toBe('MIDNIGHT DRIVE-THRU');
    expect(drivethru.floors).toHaveLength(1);
    expect(drivethru.helixes).toEqual([]);
    expect(route[0]).toEqual(drivethru.start.pos);
  });

  it('keeps solids, lights, bays, zones and the finish inside the map', () => {
    for (const s of f.solids) for (const p of cornersOf(s)) expect(inRect(p, MAP)).toBe(true);
    for (const l of f.lights) expect(inRect(l, MAP)).toBe(true);
    for (const z of [...f.bays, ...f.bonusZones!, drivethru.finish.zone])
      expect(inRect(z, MAP) && inRect({ x: z.x + z.w, y: z.y + z.h }, MAP)).toBe(true);
  });

  it('keeps the route 5 m and the start and finish 4 m from every solid', () => {
    for (const p of samples(route)) expect(clearance(p)).toBeGreaterThanOrEqual(5);
    expect(clearance(drivethru.start.pos)).toBeGreaterThanOrEqual(4);
    expect(clearance(center(drivethru.finish.zone))).toBeGreaterThanOrEqual(4);
  });

  it('reaches the finish only through the drive-thru lane', () => {
    const finish = center(drivethru.finish.zone);
    expect(reaches(drivethru.start.pos, finish)).toBe(true);
    const lane = f.bonusZones!;
    expect(reaches(drivethru.start.pos, finish, (p) => lane.some((z) => inRect(p, z)))).toBe(false);
  });

  it('drifts the lane: the route crosses every DRIVE-THRU zone', () => {
    const zones = f.bonusZones!;
    expect(zones.length).toBeGreaterThanOrEqual(3);
    const pts = samples(route);
    for (const z of zones) {
      expect(z.id).toBe('drivethru');
      expect(z.trick).toBe('DRIVE-THRU');
      expect(pts.some((p) => inRect(p, z))).toBe(true);
    }
  });

  it('holds a live meet: rows in painted bays, loose cars at casual angles', () => {
    const cars = f.solids.filter((s) => s.kind === 'car');
    expect(cars.length).toBeGreaterThanOrEqual(200);
    expect(cars.length).toBeLessThanOrEqual(240);
    expect(f.bays.length).toBeLessThan(cars.length * 1.25); // few empty outlines
    let loose = 0;
    for (const c of cars) {
      const m = CAR_MODELS[c.model!];
      expect(c.w).toBeCloseTo(m.length);
      expect(c.h).toBeCloseTo(m.width);
      expect(m.colors).toContain(c.color);
      // a car squarely in a bay is parked properly: centered and square to it
      const bay = f.bays.find((b) => cornersOf(c).every((p) => inRect(p, b)));
      if (!bay) {
        loose++;
        continue;
      }
      expect(center(c).x).toBeCloseTo(center(bay).x);
      expect(center(c).y).toBeCloseTo(center(bay).y);
      expect(Math.abs(Math.sin(2 * c.angle!))).toBeCloseTo(0);
    }
    expect(loose).toBeGreaterThanOrEqual(60);
    // no car touches another solid
    for (const c of cars) {
      const pts = cornersOf(c);
      const probes = [
        ...pts,
        ...pts.map((p, i) => ({
          x: (p.x + pts[(i + 1) % 4].x) / 2,
          y: (p.y + pts[(i + 1) % 4].y) / 2,
        })),
      ];
      for (const s of f.solids)
        if (s !== c) for (const p of probes) expect(distToSolid(p, s)).toBeGreaterThan(0.1);
    }
    // bays never overlap
    f.bays.forEach((a, i) =>
      f.bays.slice(i + 1).forEach((b) => {
        const lap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const lapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(lap > 1e-6 && lapY > 1e-6).toBe(false);
      }),
    );
    expect(drivethru.decor!.filter((d) => d.kind === 'hood').length).toBeGreaterThan(
      cars.length / 2,
    );
  });

  it('parks exactly 2 boom cars on the line, and no posts', () => {
    const boom = f.solids.filter((s) => s.boom);
    expect(boom).toHaveLength(2);
    const pts = samples(route);
    for (const b of boom) {
      expect(b.kind).toBe('car');
      const c = center(b);
      expect(Math.min(...pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y)))).toBeLessThan(14);
    }
    expect(f.solids.some((s) => s.kind === 'pillar')).toBe(false);
  });

  it('sets par and positions on the shared scale', () => {
    expect(drivethru.parTime).toBe(Math.round(length / 17));
    expect(drivethru.parTime).toBeGreaterThanOrEqual(40);
    expect(drivethru.parTime).toBeLessThanOrEqual(70);
    const [a, b, c] = drivethru.medals!;
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });

  it('draws every decor layer and restores the caller alpha', () => {
    for (const layer of ['floor', 'wall', 'light', 'glow', 'over'] as DecorLayer[]) {
      const calls: string[] = [];
      const state: Record<string | symbol, unknown> = { globalAlpha: 0.5 };
      const ctx = new Proxy(state, {
        get: (t, k) =>
          k in t
            ? t[k]
            : (...args: unknown[]) => {
                calls.push(String(k));
                void args;
                return String(k).startsWith('create') ? { addColorStop: () => {} } : undefined;
              },
        set: (t, k, v) => ((t[k] = v), true),
      }) as unknown as CanvasRenderingContext2D;
      expect(() => drawDecor(ctx, drivethru.decor!, layer, 0, 3.3)).not.toThrow();
      expect(calls.length).toBeGreaterThan(0);
      expect(state.globalAlpha).toBe(0.5);
    }
    const kinds = new Set(drivethru.decor!.map((d) => d.kind));
    for (const k of ['tarmac', 'hood', 'moon', 'truck', 'bulbs', 'roof'] as const)
      expect(kinds.has(k)).toBe(true);
  });
});
