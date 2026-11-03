import { describe, expect, it } from 'vitest';
import {
  bassAt,
  drumsAt,
  leadAt,
  stabAt,
  TOKYO_BPM,
  TOKYO_SCALE,
  tokyoBassAt,
  tokyoDrumsAt,
  tokyoPadAt,
  tokyoRiffAt,
} from './music';

const steps = [...Array(16).keys()];
const bars = [...Array(16).keys()];

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

describe('tokyo patterns', () => {
  const inScale = (n: number) => TOKYO_SCALE.includes((((n - 50) % 12) + 12) % 12);
  it('is 130 BPM half-time: clap on beat 3 only', () => {
    expect(TOKYO_BPM).toBe(130);
    expect(steps.filter((s) => tokyoDrumsAt(0, s, 0).clap)).toEqual([8]);
  });
  it('keeps every note in D in-scale', () => {
    for (const b of bars)
      for (const s of steps) {
        const notes = [tokyoBassAt(b, s), tokyoRiffAt(b, s, 1), ...tokyoPadAt(b)];
        for (const n of notes) if (n !== null) expect(inScale(n)).toBe(true);
      }
  });
  it('stop bar drops to a taiko and two hey stabs', () => {
    const hits = steps.filter((s) => Object.values(tokyoDrumsAt(7, s, 1)).some(Boolean));
    expect(hits).toEqual([0, 12, 14]);
    expect(steps.some((s) => tokyoRiffAt(7, s, 1) !== null)).toBe(false);
  });
  it('layers react to intensity', () => {
    const count = (f: (s: number) => boolean) => steps.filter(f).length;
    expect(count((s) => tokyoRiffAt(0, s, 0.3) !== null)).toBe(0);
    expect(count((s) => tokyoRiffAt(0, s, 0.31) !== null)).toBeGreaterThan(0);
    expect(count((s) => tokyoDrumsAt(2, s, 1).hat)).toBeGreaterThan(
      count((s) => tokyoDrumsAt(2, s, 0).hat),
    );
  });
  it('is deterministic and loops every 8 bars', () => {
    const run = (b: number) => steps.map((s) => [tokyoBassAt(b, s), tokyoRiffAt(b, s, 1)]);
    expect(run(3)).toEqual(run(11));
    expect(run(0)).not.toEqual(run(2));
  });
});
