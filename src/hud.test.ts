import { describe, expect, it } from 'vitest';
import {
  approach,
  comboString,
  easeOutBack,
  easeOutElastic,
  formatScore,
  formatTime,
  limitState,
  multColor,
  nextTarget,
  paintName,
  pauseHint,
  positionLabel,
  resultsHint,
  rivalTotalText,
  verdict,
  verdictText,
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
    expect(
      comboString(['DRIFT', 'CLOSE CALL', 'NEAR MISS', 'CLOSE CALL', 'NEAR MISS', 'CLIP']),
    ).toBe('DRIFT + CLOSE CALL ×2 + NEAR MISS ×2 + CLIP');
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
  it('paint ids read as catalogue names, else id-derived', () => {
    expect(paintName('b2-violet')).toBe('B2 VIOLET');
    expect(paintName('fortune-orange')).toBe('FORTUNE ORANGE');
    expect(paintName('no-such-paint')).toBe('NO SUCH PAINT');
  });
});

describe('time limit readout', () => {
  it('goes amber under 15 s, red and pulsing under 5 s', () => {
    expect(limitState(0, 60, 78)).toMatchObject({ left: 78, color: '#f4f5ff', pulse: false });
    expect(limitState(64, 60, 78)).toMatchObject({ color: '#ffb21a', pulse: false });
    expect(limitState(74, 60, 78)).toMatchObject({ left: 4, color: '#ff2b3a', pulse: true });
    expect(limitState(99, 60, 78).left).toBe(0);
  });
  it('shows the latest place cutoff already passed', () => {
    expect(limitState(60, 60, 78).missed).toBe('');
    expect(limitState(61, 60, 78).missed).toBe('1ST ✗');
    expect(limitState(70, 60, 78).missed).toBe('2ND ✗');
  });
  it('TIME UP results bar is retry / menu', () => {
    const ui = { theme: 'arcade', device: 'kb', padStyle: 'xbox' } as const;
    const r = {
      carPick: false,
      chooser: null,
      drifts: [],
      driftRow: 0,
      timeUp: true,
    } as unknown as Results;
    expect(resultsHint(ui, r)).toBe('ENTER retry · ESC menu');
  });
});

describe('head-to-head', () => {
  it('verdict: higher total wins, equal draws, rival DNF loses', () => {
    expect(verdict(12000, 9000)).toBe('win');
    expect(verdict(9000, 12000)).toBe('lose');
    expect(verdict(5000, 5000)).toBe('draw');
    expect(verdict(0, null)).toBe('win');
    expect(verdict(0, 0)).toBe('draw');
  });
  it('verdict compares the totals as displayed', () => {
    expect(verdict(1000.4, 1000)).toBe('draw');
    expect(verdict(1000.6, 1000)).toBe('win');
  });
  it('verdict text names the winner', () => {
    expect(verdictText('win', 'guest1234')).toBe('YOU WIN');
    expect(verdictText('lose', 'guest1234')).toBe('GUEST1234 WINS');
    expect(verdictText('draw', 'guest1234')).toBe('DRAW');
  });
  it('rival total reads DNF when unfinished', () => {
    expect(rivalTotalText(12345)).toBe('12,345');
    expect(rivalTotalText(null)).toBe('DNF');
  });
});

describe('hint lines', () => {
  const kb = { theme: 'arcade', device: 'kb', padStyle: 'xbox' } as const;
  const ps = { ...kb, device: 'pad', padStyle: 'ps' } as const;
  const xbox = { ...kb, device: 'pad', padStyle: 'xbox' } as const;
  const drift = { amount: 100, tricks: [], clip: true, saved: false };
  const res: Results = {
    comboPoints: 0,
    timeBonus: 0,
    timeMult: 1,
    tally: { drifts: [], rest: 0, restCount: 0, combo: 0, mult: 1, total: 0, position: null },
    stage: 'summary',
    tallyT: 0,
    summaryT: 0,
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
  it('MP results bar: host rematch, guest waits, rival gone leaves', () => {
    const r = { ...res, drifts: [] };
    const host = { connected: true, role: 'host' } as const;
    const guest = { connected: true, role: 'guest' } as const;
    expect(resultsHint(kb, r, host)).toBe('ENTER rematch · ESC leave');
    expect(resultsHint(xbox, r, host)).toBe('A rematch · B leave');
    expect(resultsHint(kb, r, guest)).toBe('waiting for host · ESC leave');
    expect(resultsHint(ps, res, guest)).toBe(
      'D-PAD ←→ pick · □ save clip · waiting for host · ○ leave',
    );
    expect(resultsHint(kb, r, { ...guest, connected: false })).toBe('ESC title');
    expect(resultsHint(xbox, { ...r, carPick: true }, guest)).toBe('A choose car · B leave');
    expect(resultsHint(kb, { ...r, carPick: true }, { ...guest, connected: false })).toBe(
      'ENTER choose car · ESC title',
    );
  });
});
