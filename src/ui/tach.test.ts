import { describe, expect, it } from 'vitest';
import { blendHot, createTach, dialMax, litLeds, rpmAngle, type TachState } from './tach';

/** 2D context stand-in: every method is a no-op that rejects non-finite numbers, props are stored. */
function mockCtx() {
  const props: Record<string | symbol, unknown> = {};
  const calls: string[] = [];
  const ctx = new Proxy(props, {
    get(t, k) {
      if (k in t) return t[k];
      return (...args: unknown[]) => {
        for (const a of args)
          if (typeof a === 'number' && !Number.isFinite(a)) throw new Error(`${String(k)}(${a})`);
        calls.push(String(k));
        return { width: 10 };
      };
    },
    set(t, k, val) {
      if (typeof val === 'number' && !Number.isFinite(val)) throw new Error(`${String(k)}=${val}`);
      t[k] = val;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, props };
}

const PAL = { accent: '#ff2b3a', accent2: '#2bf58c', text: '#f4f5ff', dim: '#a3abc8', glow: 1 };

describe('tach helpers', () => {
  it('dialMax rounds up one thousand past redline', () => {
    expect(dialMax(7000)).toBe(8000);
    expect(dialMax(7500)).toBe(9000);
    expect(dialMax(0)).toBe(2000);
  });
  it('rpmAngle spans 240 deg and clamps', () => {
    expect(rpmAngle(0, 8000)).toBeCloseTo((Math.PI * 5) / 6);
    expect(rpmAngle(8000, 8000) - rpmAngle(0, 8000)).toBeCloseTo((Math.PI * 4) / 3);
    expect(rpmAngle(-500, 8000)).toBe(rpmAngle(0, 8000));
    expect(rpmAngle(9e9, 8000)).toBe(rpmAngle(8000, 8000));
  });
  it('litLeds: none until 75% of redline, all at 97%', () => {
    expect(litLeds(0, 7000)).toBe(0);
    expect(litLeds(0.75 * 7000, 7000)).toBe(0);
    expect(litLeds(0.86 * 7000, 7000)).toBe(5);
    expect(litLeds(0.97 * 7000, 7000)).toBe(10);
    expect(litLeds(9000, 7000)).toBe(10);
  });
  it('blendHot keeps full brightness and falls back on non-hex', () => {
    expect(blendHot('#ff0000', '#00ff00')).toBe('#ffff00');
    expect(blendHot('#f00', '#ff0000')).toBe('#ff0000');
    expect(blendHot('red', '#00ff00')).toBe('red');
  });
});

describe('tach draw', () => {
  it('runs sweep, revs, limiter and gear changes without throwing', () => {
    const { ctx, calls } = mockCtx();
    const tach = createTach();
    const seq: TachState[] = [
      { rpm: 900, redline: 7000, gear: 'N', speedKmh: 0 },
      { rpm: 5000, redline: 7000, gear: '1', speedKmh: 30 },
      { rpm: 6900, redline: 7000, gear: '1', speedKmh: 55 }, // flash + limiter
      { rpm: 7100, redline: 7000, gear: '2', speedKmh: 60 },
      { rpm: 3000, redline: 7000, gear: '3', speedKmh: 80 },
      { rpm: 1200, redline: 7000, gear: 'R', speedKmh: 5 },
      { rpm: 0, redline: 0, gear: '', speedKmh: 0 }, // degenerate input
    ];
    for (const s of seq) for (let i = 0; i < 90; i++) tach.draw(ctx, 200, 200, 90, s, PAL, 1 / 60);
    tach.reset();
    for (let i = 0; i < 60; i++) tach.draw(ctx, 200, 200, 90, seq[2], PAL, i % 7 ? 1 / 60 : 0);
    tach.draw(ctx, 200, 200, 90, seq[2], PAL, 5); // long hitch clamps
    expect(calls.filter((c) => c === 'save').length).toBe(
      calls.filter((c) => c === 'restore').length,
    );
    expect(calls).toContain('fillText');
  });
});
