import { describe, expect, it } from 'vitest';
import {
  approach,
  comboString,
  easeOutBack,
  easeOutElastic,
  formatScore,
  formatTime,
  multColor,
  nextTarget,
  paintName,
  pauseHint,
  positionLabel,
  resultsHint,
} from './hud';
import type { Results } from './view';

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

describe('positions', () => {
  it('labels the position, none reached is NO PLACE', () => {
    expect([1, 2, 3, null].map((p) => positionLabel(p as 1 | 2 | 3 | null))).toEqual([
      '1ST',
      '2ND',
      '3RD',
      'NO PLACE',
    ]);
  });
  it('names the next position with its score and time limit', () => {
    const m = [1000, 2000, 3000];
    expect(nextTarget(null, m, 100)).toBe('NEXT: 3RD needs 1,000 pts & under 2:10');
    expect(nextTarget(3, m, 100)).toBe('NEXT: 2ND needs 2,000 pts & under 1:55');
    expect(nextTarget(2, m, 100)).toBe('NEXT: 1ST needs 3,000 pts & under 1:40');
    expect(nextTarget(1, m, 100)).toBe('');
    expect(nextTarget(null, undefined, 0)).toBe('');
  });
  it('paint ids read as names', () => expect(paintName('b2-violet')).toBe('B2 VIOLET'));
});

describe('hint lines', () => {
  const kb = { theme: 'arcade', device: 'kb', padStyle: 'xbox' } as const;
  const ps = { ...kb, device: 'pad', padStyle: 'ps' } as const;
  const xbox = { ...kb, device: 'pad', padStyle: 'xbox' } as const;
  const drift = { amount: 100, tricks: [], clip: true, saved: false };
  const res: Results = {
    comboPoints: 0,
    timeBonus: 0,
    total: 0,
    time: 0,
    best: 0,
    newBest: false,
    position: null,
    newPaints: [],
    carPick: false,
    chooser: null,
    drifts: [drift, { ...drift, saved: true }],
    driftRow: 0,
  };

  it('shows only the active device binds', () => {
    expect(pauseHint(kb)).toContain('ENTER');
    expect(pauseHint(ps)).not.toContain('ENTER');
    expect(pauseHint(ps)).toContain('SHARE');
  });
  it('results bar: pick, save clip, retry, menu with device glyphs', () => {
    expect(resultsHint(kb, res)).toBe('←→ pick · S save clip · ENTER retry · ESC menu');
    expect(resultsHint(xbox, res)).toBe('D-PAD ←→ pick · X save clip · A retry · B menu');
    expect(resultsHint(ps, res)).toBe('D-PAD ←→ pick · □ save clip · ✕ retry · ○ menu');
    for (const ui of [ps, xbox]) expect(resultsHint(ui, res)).not.toMatch(/ENTER|ESC|\bS\b/);
  });
  it('results bar drops save on a saved card and offers the car pick', () => {
    const r = { ...res, driftRow: 1, carPick: true };
    expect(resultsHint(xbox, r)).toBe('D-PAD ←→ pick · A choose car · B menu');
    const c = { ...r, chooser: { cars: [], row: 0 } };
    expect(resultsHint(ps, c)).toBe('D-PAD ←→ car · ✕ choose · ○ later');
  });
});
