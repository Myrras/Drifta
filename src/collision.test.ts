import { describe, expect, it } from 'vitest';
import { CAR_LENGTH, CAR_WIDTH, collide, inRect, nearestDistance } from './collision';
import type { CarState, Solid } from './types';

const car = (x: number, y: number, angle = 0): CarState => ({
  pos: { x, y },
  vel: { x: 0, y: 0 },
  angle,
  angVel: 0,
  rpm: 0,
});
const wall = (x: number, y: number, w: number, h: number): Solid => ({ x, y, w, h, kind: 'wall' });

describe('collision', () => {
  it('far: no hit, exact gap', () => {
    const s = [wall(10, -5, 2, 10)];
    expect(collide(car(0, 0), s)).toBeNull();
    expect(nearestDistance(car(0, 0), s)).toBeCloseTo(10 - CAR_LENGTH / 2);
  });
  it('from the left', () => {
    const h = collide(car(10 - CAR_LENGTH / 2 + 0.3, 0), [wall(10, -5, 2, 10)])!;
    expect(h.normal.x).toBeCloseTo(-1);
    expect(h.normal.y).toBeCloseTo(0);
    expect(h.depth).toBeCloseTo(0.3);
  });
  it('from above', () => {
    const h = collide(car(0, 10 - CAR_WIDTH / 2 + 0.2, 0), [wall(-5, 10, 10, 2)])!;
    expect(h.normal.x).toBeCloseTo(0);
    expect(h.normal.y).toBeCloseTo(-1);
    expect(h.depth).toBeCloseTo(0.2);
  });
  it('rotated corner poke', () => {
    const h = collide(car(0, 0, Math.PI / 4), [wall(2, -5, 2, 10)])!;
    expect(h).not.toBeNull();
    expect(Math.hypot(h.normal.x, h.normal.y)).toBeCloseTo(1);
  });
  it('touching is no hit', () => {
    expect(collide(car(0, 0), [wall(CAR_LENGTH / 2, -5, 2, 10)])).toBeNull();
  });
  it('deepest wins', () => {
    const h = collide(car(0, 0), [wall(1.5, -5, 2, 10), wall(1, -5, 2, 10)])!;
    expect(h.depth).toBeCloseTo(1);
  });
  it('nearestDistance overlap / empty', () => {
    expect(nearestDistance(car(0, 0), [wall(1, -5, 2, 10)])).toBe(0);
    expect(nearestDistance(car(0, 0), [])).toBe(Infinity);
  });
  it('inRect inclusive', () => {
    const r = { x: 0, y: 0, w: 2, h: 2 };
    expect(inRect({ x: 0, y: 0 }, r)).toBe(true);
    expect(inRect({ x: 2, y: 2 }, r)).toBe(true);
    expect(inRect({ x: 2.01, y: 1 }, r)).toBe(false);
  });
});

describe('circle solids', () => {
  const circ = (x: number, y: number, r: number) => ({ x, y, r });
  it('beside: no hit, exact gap', () => {
    expect(collide(car(0, 0), [], [circ(10, 0, 2)])).toBeNull();
    expect(nearestDistance(car(0, 0), [], [circ(10, 0, 2)])).toBeCloseTo(10 - 2 - CAR_LENGTH / 2);
  });
  it('from the left', () => {
    const h = collide(car(0, 0), [], [circ(CAR_LENGTH / 2 + 2 - 0.3, 0, 2)])!;
    expect(h.normal.x).toBeCloseTo(-1);
    expect(h.normal.y).toBeCloseTo(0);
    expect(h.depth).toBeCloseTo(0.3);
  });
  it('rotated corner into circle', () => {
    // front-left corner of a 45deg car, circle just past it along the diagonal
    const a = Math.PI / 4;
    const hw = CAR_WIDTH / 2;
    const hl = CAR_LENGTH / 2;
    const kx = hl * Math.cos(a) - hw * Math.sin(a);
    const ky = hl * Math.sin(a) + hw * Math.cos(a);
    const h = collide(car(0, 0, a), [], [circ(kx + 0.5, ky + 0.5, 1)])!;
    expect(h).not.toBeNull();
    expect(h.normal.x).toBeLessThan(0);
    expect(h.normal.y).toBeLessThan(0);
    expect(Math.hypot(h.normal.x, h.normal.y)).toBeCloseTo(1);
    expect(h.depth).toBeCloseTo(1 - Math.SQRT2 / 2);
  });
  it('center inside box', () => {
    const h = collide(car(0, 0), [], [circ(0.5, 0, 1)])!;
    expect(h.normal.x).toBeCloseTo(-1);
    expect(h.depth).toBeCloseTo(1 + (CAR_LENGTH / 2 + 0.5));
  });
  it('deepest of rect and circle wins', () => {
    const w = [wall(CAR_LENGTH / 2 - 0.1, -5, 2, 10)];
    expect(collide(car(0, 0), w, [circ(CAR_LENGTH / 2 + 2 - 0.5, 0, 2)])!.depth).toBeCloseTo(0.5);
    expect(collide(car(0, 0), w, [circ(CAR_LENGTH / 2 + 2 - 0.05, 0, 2)])!.depth).toBeCloseTo(0.1);
  });
  it('nearestDistance picks the closest circle', () => {
    const d = nearestDistance(car(0, 0), [wall(20, -5, 2, 10)], [circ(10, 0, 2), circ(0, 6, 1)]);
    expect(d).toBeCloseTo(6 - 1 - CAR_WIDTH / 2);
  });
  describe('rotated solids', () => {
    const rot = (x: number, y: number, w: number, h: number, angle: number): Solid => ({
      ...wall(x, y, w, h),
      angle,
    });
    // 2x2 square centered (10,0) rotated 45deg: left vertex at x = 10 - sqrt2
    const diamond = [rot(9, -1, 2, 2, Math.PI / 4)];
    it('45deg hit from the left: unit normal toward car, depth', () => {
      const h = collide(car(10 - Math.SQRT2 - CAR_LENGTH / 2 + 0.2, 0), diamond)!;
      expect(h).not.toBeNull();
      expect(Math.hypot(h.normal.x, h.normal.y)).toBeCloseTo(1);
      expect(h.normal.x).toBeLessThan(0);
      expect(h.depth).toBeGreaterThan(0);
    });
    it('no hit when separated diagonally; gap hand-computed', () => {
      expect(collide(car(5, 0), diamond)).toBeNull();
      expect(nearestDistance(car(5, 0), diamond)).toBeCloseTo(10 - Math.SQRT2 - 5 - CAR_LENGTH / 2);
      expect(collide(car(10, 4.5), diamond)).toBeNull();
    });
    it('angle 0 equals AABB', () => {
      const a = collide(car(7.8, 0.3), [wall(10, -5, 2, 10)])!;
      expect(collide(car(7.8, 0.3), [rot(10, -5, 2, 10, 0)])).toEqual(a);
    });
    it('mixed: deepest wins', () => {
      const h = collide(car(7, 0), [...diamond, wall(8.5, -5, 2, 10)])!;
      expect(h.depth).toBeCloseTo(0.5);
      expect(h.normal.x).toBeCloseTo(-1);
    });
  });
});
