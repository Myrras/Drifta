import { describe, expect, it } from 'vitest';
import { BAY_PAINT, docks, docksRoute } from './docks';
import { drawDecor, type DecorLayer } from './decor';
import { CAR_MODELS } from '../models';
import type { Rect, Solid, Vec } from '../types';

const [floor] = docks.floors;
const center = (r: Rect): Vec => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
/** Distance to a solid; rotated rects as a circle of half their diagonal (conservative). */
function gap(p: Vec, s: Solid) {
  if (s.angle !== undefined) {
    const c = center(s);
    return Math.hypot(p.x - c.x, p.y - c.y) - Math.hypot(s.w, s.h) / 2;
  }
  return Math.hypot(
    Math.max(s.x - p.x, 0, p.x - s.x - s.w),
    Math.max(s.y - p.y, 0, p.y - s.y - s.h),
  );
}
const clearance = (p: Vec) =>
  Math.min(
    ...floor.solids.map((s) => gap(p, s)),
    ...floor.circles.map((c) => Math.hypot(p.x - c.x, p.y - c.y) - c.r),
  );
function corners(s: Solid): Vec[] {
  const c = center(s);
  const a = s.angle ?? 0;
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([u, w]) => ({
    x: c.x + (u * s.w * Math.cos(a)) / 2 - (w * s.h * Math.sin(a)) / 2,
    y: c.y + (u * s.w * Math.sin(a)) / 2 + (w * s.h * Math.cos(a)) / 2,
  }));
}
const inFloor = (p: Vec) => p.x >= 0 && p.y >= 0 && p.x <= floor.w && p.y <= floor.h;
const pts = docksRoute[0].points;
const segLens = pts.slice(1).map((b, i) => Math.hypot(b.x - pts[i].x, b.y - pts[i].y));
const length = segLens.reduce((a, b) => a + b, 0);

describe('docks', () => {
  it('is WANGAN DOCKS on one floor', () => {
    expect(docks.name).toBe('WANGAN DOCKS');
    expect(docks.floors).toHaveLength(1);
    expect(docks.helixes).toHaveLength(0);
    expect(docks.start.floor).toBe(0);
    expect(docks.finish.floor).toBe(0);
    expect(docksRoute.map((r) => r.floor)).toEqual([0]);
  });

  it('keeps solids, lights and finish in bounds', () => {
    for (const s of floor.solids) for (const p of corners(s)) expect(inFloor(p)).toBe(true);
    expect(floor.lights.length).toBeGreaterThan(30);
    for (const l of floor.lights) expect(inFloor(l)).toBe(true);
    const z = docks.finish.zone;
    expect(inFloor({ x: z.x, y: z.y }) && inFloor({ x: z.x + z.w, y: z.y + z.h })).toBe(true);
  });

  it('parks all 10 models with real dims and palette colors', () => {
    const cars = floor.solids.filter((s) => s.kind === 'car');
    expect(new Set(cars.map((c) => c.model)).size).toBe(10);
    for (const c of cars) {
      const m = CAR_MODELS[c.model!];
      expect(c.w).toBeCloseTo(m.length);
      expect(c.h).toBeCloseTo(m.width);
      expect(c.angle).toBe(c.facing);
      expect(m.colors).toContain(c.color);
    }
    const on = cars.filter((c) => c.lights === 'on').length / cars.length;
    expect(on).toBeGreaterThan(0.1);
    expect(on).toBeLessThan(0.25);
    expect(cars.some((c) => c.lights === 'hazard')).toBe(true);
  });

  it('keeps start and finish 4 m clear', () => {
    expect(clearance(docks.start.pos)).toBeGreaterThanOrEqual(4);
    expect(clearance(center(docks.finish.zone))).toBeGreaterThanOrEqual(4);
  });

  it('keeps the route 5 m from every solid', () => {
    expect(pts[0]).toEqual(docks.start.pos);
    pts.slice(1).forEach((b, i) => {
      const a = pts[i];
      for (let d = 0; d <= segLens[i]; d += 0.5) {
        const t = d / segLens[i];
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        expect(clearance(p)).toBeGreaterThanOrEqual(5);
      }
    });
  });

  it('reaches the finish from the start (1 m grid, 2 m clearance)', () => {
    const cols = floor.w;
    const ok = (i: number) =>
      clearance({ x: (i % cols) + 0.5, y: Math.floor(i / cols) + 0.5 }) >= 2;
    const cell = (p: Vec) => Math.floor(p.y) * cols + Math.floor(p.x);
    const goal = cell(center(docks.finish.zone));
    const seen = new Uint8Array(cols * floor.h);
    const stack = [cell(docks.start.pos)];
    let found = false;
    while (stack.length && !found) {
      const i = stack.pop()!;
      if (seen[i] || !ok(i)) continue;
      seen[i] = 1;
      found = i === goal;
      const c = i % cols;
      if (c + 1 < cols) stack.push(i + 1);
      if (c > 0) stack.push(i - 1);
      if (i + cols < seen.length) stack.push(i + cols);
      if (i >= cols) stack.push(i - cols);
    }
    expect(found).toBe(true);
  });

  it('chains linked left and right corners', () => {
    // runs of same-sign heading change; a straight segment ends a run
    const heads = pts.slice(1).map((b, i) => Math.atan2(b.y - pts[i].y, b.x - pts[i].x));
    const turns: { sign: number; deg: number; s: number }[] = [];
    let s = segLens[0];
    let run: { sign: number; deg: number; s0: number; s1: number } | null = null;
    const close = () => {
      if (run && run.deg > 30)
        turns.push({ sign: run.sign, deg: run.deg, s: (run.s0 + run.s1) / 2 });
      run = null;
    };
    for (let i = 1; i < heads.length; i++) {
      const d = Math.atan2(Math.sin(heads[i] - heads[i - 1]), Math.cos(heads[i] - heads[i - 1]));
      const sign = Math.abs(d) < 1e-6 ? 0 : Math.sign(d);
      if (!run || sign !== run.sign) close();
      if (sign) {
        run ??= { sign, deg: 0, s0: s, s1: s };
        run.deg += (Math.abs(d) * 180) / Math.PI;
        run.s1 = s;
      }
      s += segLens[i];
    }
    close();
    expect(turns.length).toBeGreaterThanOrEqual(8);
    expect(turns.some((t) => t.sign > 0) && turns.some((t) => t.sign < 0)).toBe(true);
    const linked = turns.filter(
      (t, i) => i > 0 && t.sign !== turns[i - 1].sign && t.s - turns[i - 1].s <= 80,
    );
    expect(linked.length).toBeGreaterThanOrEqual(3);
  });

  it('sets par from the route length at 17 m/s', () => {
    expect(docks.parTime).toBe(Math.round(length / 17));
    expect(docks.parTime).toBeGreaterThanOrEqual(55);
    expect(docks.parTime).toBeLessThanOrEqual(90);
  });

  it('parks exactly one car inside every painted bay', () => {
    const cars = floor.solids.filter((s) => s.kind === 'car');
    const bays = (docks.decor ?? []).flatMap((d) =>
      d.kind === 'paint' && d.color === BAY_PAINT ? [[{ x: d.x, y: d.y }, ...d.to]] : [],
    );
    expect(bays.length).toBeGreaterThan(20);
    for (const quad of bays) {
      expect(quad).toHaveLength(4);
      const inside = (p: Vec) => {
        const cross = quad.map((a, i) => {
          const b = quad[(i + 1) % 4];
          return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
        });
        return cross.every((c) => c > 0) || cross.every((c) => c < 0);
      };
      expect(cars.filter((c) => corners(c).every(inside))).toHaveLength(1);
      expect(cars.filter((c) => corners(c).some(inside))).toHaveLength(1);
    }
  });

  it('draws every decor layer and restores the caller alpha', () => {
    for (const layer of ['sea', 'floor', 'wall', 'light', 'glow', 'over'] as DecorLayer[]) {
      const calls: string[] = [];
      const state: Record<string | symbol, unknown> = { globalAlpha: 0.5 };
      const ctx = new Proxy(state, {
        get: (t, k) =>
          k in t
            ? t[k]
            : () => {
                calls.push(String(k));
                return String(k).startsWith('create') ? { addColorStop: () => {} } : undefined;
              },
        set: (t, k, v) => ((t[k] = v), true),
      }) as unknown as CanvasRenderingContext2D;
      expect(() => drawDecor(ctx, docks.decor!, layer, 0, 0)).not.toThrow();
      expect(calls.length).toBeGreaterThan(0);
      expect(state.globalAlpha).toBe(0.5);
    }
  });
});
