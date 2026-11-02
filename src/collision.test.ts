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
