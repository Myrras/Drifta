import { describe, expect, it } from 'vitest';
import { garage } from './garage';
import type { Floor, Rect, Vec } from '../types';

const distToRect = (p: Vec, r: Rect) =>
  Math.hypot(Math.max(r.x - p.x, 0, p.x - (r.x + r.w)), Math.max(r.y - p.y, 0, p.y - (r.y + r.h)));
const clearance = (p: Vec, f: Floor) => Math.min(...f.solids.map((s) => distToRect(p, s)));
const inside = (r: Rect, f: Floor) => r.x >= 0 && r.y >= 0 && r.x + r.w <= f.w && r.y + r.h <= f.h;
const inRect = (p: Vec, r: Rect) =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
const overlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const center = (r: Rect): Vec => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Spawn of each floor: start for floor 0, else incoming ramp spawn. */
const spawnOf = (i: number): Vec =>
  i === 0 ? garage.start.pos : garage.floors[i - 1].ramps[0].spawn.pos;

function reaches(f: Floor, from: Vec, target: Rect): boolean {
  const S = 0.5;
  const cols = Math.round(f.w / S);
  const rows = Math.round(f.h / S);
  const ok = (c: number, r: number) =>
    c >= 0 &&
    r >= 0 &&
    c < cols &&
    r < rows &&
    clearance({ x: (c + 0.5) * S, y: (r + 0.5) * S }, f) >= 1.5;
  const seen = new Set<number>();
  const stack = [[Math.floor(from.x / S), Math.floor(from.y / S)]];
  while (stack.length) {
    const [c, r] = stack.pop()!;
    if (!ok(c, r) || seen.has(r * cols + c)) continue;
    seen.add(r * cols + c);
    if (inRect({ x: (c + 0.5) * S, y: (r + 0.5) * S }, target)) return true;
    stack.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
  }
  return false;
}

describe('garage', () => {
  it('has 3 floors and par 60', () => {
    expect(garage.floors).toHaveLength(3);
    expect(garage.parTime).toBe(60);
  });

  it('keeps everything inside floor bounds', () => {
    for (const f of garage.floors) {
      for (const r of [...f.solids, ...f.bays, ...f.ramps.map((r) => r.zone)]) {
        expect(inside(r, f)).toBe(true);
      }
      for (const l of f.lights) expect(inRect(l, { x: 0, y: 0, w: f.w, h: f.h })).toBe(true);
    }
    expect(inside(garage.finish.zone, garage.floors[2])).toBe(true);
  });

  it('has ramps to valid next floors and finish on floor 2', () => {
    expect(garage.floors.map((f) => f.ramps.map((r) => r.toFloor))).toEqual([[1], [2], []]);
    expect(garage.finish.floor).toBe(2);
  });

  it('keeps spawns and finish clear of solids by 3 m', () => {
    const pts: [Vec, Floor][] = [
      [garage.start.pos, garage.floors[0]],
      [garage.floors[0].ramps[0].spawn.pos, garage.floors[1]],
      [garage.floors[1].ramps[0].spawn.pos, garage.floors[2]],
      [center(garage.finish.zone), garage.floors[2]],
    ];
    for (const [p, f] of pts) expect(clearance(p, f)).toBeGreaterThanOrEqual(3);
  });

  it('reaches the ramp / finish on every floor', () => {
    const targets = [
      garage.floors[0].ramps[0].zone,
      garage.floors[1].ramps[0].zone,
      garage.finish.zone,
    ];
    garage.floors.forEach((f, i) => expect(reaches(f, spawnOf(i), targets[i])).toBe(true));
  });

  it('parked cars do not overlap pillars or walls', () => {
    for (const f of garage.floors) {
      const cars = f.solids.filter((s) => s.kind === 'car');
      expect(cars.length).toBeGreaterThan(0);
      for (const c of cars)
        for (const s of f.solids) if (s.kind !== 'car') expect(overlap(c, s)).toBe(false);
    }
  });
});
