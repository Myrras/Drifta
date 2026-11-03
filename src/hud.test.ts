import { describe, expect, it } from 'vitest';
import {
  approach,
  comboString,
  easeOutBack,
  easeOutElastic,
  formatScore,
  formatTime,
  medalText,
  multColor,
  pauseHint,
  resultsHint,
} from './hud';

describe('hud formatting', () => {
  it('formatTime', () => {
    expect(formatTime(42.375)).toBe('0:42.37');
    expect(formatTime(75)).toBe('1:15.00');
    expect(formatTime(0)).toBe('0:00.00');
  });
  it('formatScore', () => {
    expect(formatScore(12345)).toBe('12,345');
    expect(formatScore(999)).toBe('999');
    expect(formatScore(1234567)).toBe('1,234,567');
  });
  it('comboString', () => {
    expect(comboString([])).toBe('');
    expect(comboString(['DRIFT', 'DRIFT', 'DRIFT'])).toBe('DRIFT ×3');
    expect(comboString(['A', 'B', 'B'])).toBe('A + B ×2');
    expect(comboString(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])).toBe('… + C + D + E + F + G + H');
  });
});

describe('hud animation helpers', () => {
  it('eases start at 0, end at 1, clamp outside, and overshoot', () => {
    for (const f of [easeOutBack, easeOutElastic]) {
      expect(f(0)).toBeCloseTo(0);
      expect(f(1)).toBeCloseTo(1);
      expect(f(-1)).toBeCloseTo(0);
      expect(f(2)).toBeCloseTo(1);
    }
    expect(Math.max(...[0.5, 0.6, 0.7, 0.8].map(easeOutBack))).toBeGreaterThan(1);
    expect(easeOutElastic(0.1)).toBeGreaterThan(1);
  });
  it('approach counts up smoothly, frame-rate independent, and lands exactly', () => {
    const a = approach(0, 1000, 0.1, 10);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1000);
    let b = 0;
    for (let i = 0; i < 6; i++) b = approach(b, 1000, 1 / 60, 10);
    expect(b).toBeCloseTo(a, 6);
    let c = 0;
    for (let i = 0; i < 200; i++) c = approach(c, 1000, 1 / 60, 10);
    expect(c).toBe(1000);
    expect(approach(5, 5, 0, 10)).toBe(5);
  });
  it('multColor heats up with the multiplier', () => {
    expect(multColor(1)).toBe('#f4f5ff');
    expect(multColor(3)).toBe('#ffd23f');
    expect(multColor(5)).toBe('#ff7a1a');
    expect(multColor(9)).toBe('#ff2b3a');
  });
});

describe('medalText', () => {
  it('shows medal and gap to next', () => {
    const m = [100, 200, 300];
    expect(medalText(50, m)).toBe('NO MEDAL · 50 to BRONZE');
    expect(medalText(250, m)).toBe('SILVER · 50 to GOLD');
    expect(medalText(300, m)).toBe('GOLD');
    expect(medalText(50)).toBe('');
  });
});

describe('hint lines', () => {
  it('shows only the active device binds', () => {
    const kb = { theme: 'arcade', device: 'kb', padStyle: 'xbox' } as const;
    expect(pauseHint(kb)).toContain('ENTER');
    expect(resultsHint(kb)).toContain('ENTER');
    const pad = { ...kb, device: 'pad', padStyle: 'ps' } as const;
    expect(pauseHint(pad)).not.toContain('ENTER');
    expect(pauseHint(pad)).toContain('SHARE');
    expect(resultsHint(pad)).not.toContain('ENTER');
  });
});
