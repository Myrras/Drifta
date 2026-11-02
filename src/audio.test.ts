import { describe, expect, it } from 'vitest';
import { pickLoopWindow } from './audio';

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
