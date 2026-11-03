import { describe, expect, it } from 'vitest';
import { bassAt, drumsAt, leadAt, stabAt } from './music';

const steps = [...Array(16).keys()];

describe('music patterns', () => {
  it('kicks every beat, claps on 2 and 4', () => {
    expect(steps.filter((s) => drumsAt(s).kick)).toEqual([0, 4, 8, 12]);
    expect(steps.filter((s) => drumsAt(s).clap)).toEqual([4, 12]);
  });
  it('bass only on offbeats', () => {
    expect(steps.filter((s) => bassAt(0, s) !== null)).toEqual([2, 6, 10, 14]);
  });
  it('stabs need > 0.3, lead needs > 0.6', () => {
    const any = (f: (s: number) => unknown) => steps.some((s) => f(s) !== null);
    expect(any((s) => stabAt(0, s, 0.3))).toBe(false);
    expect(any((s) => stabAt(0, s, 0.31))).toBe(true);
    expect(any((s) => leadAt(0, s, 0.6))).toBe(false);
    expect(any((s) => leadAt(0, s, 0.9))).toBe(true);
  });
  it('is deterministic per bar', () => {
    const run = (bar: number) => steps.map((s) => leadAt(bar, s, 1));
    expect(run(3)).toEqual(run(3));
    expect(run(3)).not.toEqual(run(4));
  });
});
