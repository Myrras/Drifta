import { describe, expect, it } from 'vitest';
import { boomCars, boomGain, boomPulse, boomShake, BOOM_RANGE, pickLoopWindow } from './audio';
import type { Solid } from './types';

describe('boomGain', () => {
  it('is full when close, silent from the range on, and falls monotonically', () => {
    expect(boomGain(0)).toBe(1);
    expect(boomGain(8)).toBe(1);
    expect(boomGain(BOOM_RANGE)).toBe(0);
    expect(boomGain(200)).toBe(0);
    let prev = 1;
    for (let d = 10; d <= BOOM_RANGE; d += 5) {
      expect(boomGain(d)).toBeLessThan(prev);
      prev = boomGain(d);
    }
    expect(boomGain(34)).toBeCloseTo(0.5, 2);
  });
});

describe('boomShake', () => {
  it('is full within 8 m, none from 35 m, and falls in between', () => {
    expect(boomShake(0)).toBe(1);
    expect(boomShake(8)).toBe(1);
    expect(boomShake(35)).toBe(0);
    expect(boomShake(100)).toBe(0);
    expect(boomShake(21.5)).toBeCloseTo(0.5, 2);
    expect(boomShake(15)).toBeGreaterThan(boomShake(25));
    expect(boomShake(25)).toBeGreaterThan(boomShake(34));
  });
});

describe('boomCars', () => {
  it('picks the centers of boom solids only', () => {
    const car = (x: number, boom?: boolean): Solid => ({ kind: 'car', x, y: 10, w: 4, h: 2, boom });
    const wall: Solid = { kind: 'wall', x: 0, y: 0, w: 5, h: 5, boom: true };
    expect(boomCars([car(0), car(20, true), car(30, false), wall])).toEqual([
      { x: 22, y: 11 },
      { x: 2.5, y: 2.5 },
    ]);
  });
});

describe('boomPulse', () => {
  it('peaks on a kick and decays between kicks', () => {
    expect(boomPulse(0)).toBe(1);
    expect(boomPulse(2)).toBe(1);
    expect(boomPulse(0.4)).toBeLessThan(0.1);
    expect(boomPulse(-0.5)).toBeGreaterThanOrEqual(0);
  });
});

describe('pickLoopWindow', () => {
  it('picks a window inside the loud part', () => {
    const sr = 1000;
    const x = new Float32Array(sr * 10);
    for (let i = 0; i < x.length; i++) {
      const t = i / sr;
      x[i] = (t >= 3 && t < 8 ? 0.8 : 0.05) * Math.sin(i * 0.3);
    }
    const [a, b] = pickLoopWindow(x, sr, 2);
    expect(b - a).toBeCloseTo(2, 1);
    expect(a).toBeGreaterThanOrEqual(3);
    expect(b).toBeLessThanOrEqual(8);
  });

  it('falls back to the whole clip when too short', () => {
    expect(pickLoopWindow(new Float32Array(1000), 1000, 2)).toEqual([0, 1]);
  });
});
