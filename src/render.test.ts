import { describe, expect, it } from 'vitest';
import { angleArc } from './render';

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
