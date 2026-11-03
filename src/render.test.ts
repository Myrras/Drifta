import { describe, expect, it } from 'vitest';
import { angleArc, toScreen } from './render';

describe('toScreen', () => {
  it('maps through the world transform into CSS px', () => {
    const out = { x: 0, y: 0 };
    expect(toScreen(out, 3, 4, 2, 0, 10, 20, 2)).toBe(out);
    expect(out).toEqual({ x: 8, y: 14 });
  });
  it('follows camera rotation', () => {
    // 90° rotation, scale 1: world +x is screen +y
    const p = toScreen({ x: 0, y: 0 }, 5, 0, 0, 1, 100, 100, 1);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(105);
  });
});

describe('angleArc', () => {
  it('is off when not drifting or slow', () => {
    expect(angleArc(false, 0.5, 80).alpha).toBe(0);
    expect(angleArc(true, 0.5, 10).alpha).toBe(0);
    expect(angleArc(true, 0.01, 80).alpha).toBe(0);
  });
  it('grows and shifts color with angle, sign-agnostic', () => {
    const lo = angleArc(true, 0.2, 80);
    const mid = angleArc(true, -0.5, 80);
    const hi = angleArc(true, 1, 80);
    expect(lo.alpha).toBeGreaterThan(0);
    expect(hi.alpha).toBeGreaterThan(lo.alpha);
    expect(new Set([lo.color, mid.color, hi.color]).size).toBe(3);
  });
});
