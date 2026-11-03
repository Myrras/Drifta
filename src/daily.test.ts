import { describe, expect, it } from 'vitest';
import { dailyFor, finishDaily, isLegendDay, liveStreak, LEGENDS, rollCosmetic } from './daily';
import { COSMETICS } from './cosmetics';
import { defaultProgress } from './progress';
import { garage } from './maps/garage';
import { docks } from './maps/docks';
import { tokyo } from './maps/tokyo';
import { drivethru } from './maps/drivethru';
import { testpad } from './maps/testpad';

const maps = [garage, docks, tokyo, drivethru, testpad];
const days = (n: number) =>
  Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));
const legendDay = days(400).find(isLegendDay)!;
const plainDay = days(400).find((d) => !isLegendDay(d))!;

describe('dailyFor', () => {
  it('is deterministic and only picks racing maps', () => {
    for (const d of days(200)) {
      const a = dailyFor(d, maps);
      expect(a).toEqual(dailyFor(d, maps));
      expect(a.map.medals).toBeDefined();
      expect(a.map).not.toBe(testpad);
    }
  });

  it('visits every racing map over time', () => {
    const seen = new Set(days(200).filter((d) => !isLegendDay(d)).map((d) => dailyFor(d, maps).map.name));
    expect(seen.size).toBe(4);
  });

  it('daily target is the 2nd-place score x1.1', () => {
    const d = dailyFor(plainDay, maps);
    expect(d.kind).toBe('daily');
    expect(d.target).toBe(Math.round(d.map.medals![1] * 1.1));
    expect(d.car).toBeUndefined();
  });

  it('about 1 day in 10 is a legend', () => {
    const n = days(1000).filter(isLegendDay).length;
    expect(n).toBeGreaterThan(70);
    expect(n).toBeLessThan(130);
  });

  it('legend: first entry, 1st-place score x1.5, fixed car and skin', () => {
    const d = dailyFor(legendDay, maps);
    expect(d.kind).toBe('legend');
    expect(d.map.name).toBe('TOKYO NIGHTS');
    expect(d.target).toBe(Math.round(tokyo.medals![2] * 1.5));
    expect(d.car).toBe('rx7');
    expect(d.skin).toBe('fortune-orange');
  });

  it('legend days cycle through the table', () => {
    LEGENDS.push({ map: 'WANGAN DOCKS', car: 'civic', skin: 'x' });
    try {
      const picks = days(400).filter(isLegendDay).slice(0, 4).map((d) => dailyFor(d, maps).map.name);
      const first = picks[0];
      expect(picks.filter((n) => n === first).length).toBe(2);
      expect(picks[0]).not.toBe(picks[1]);
      expect(picks[0]).toBe(picks[2]);
    } finally {
      LEGENDS.pop();
    }
  });
});

describe('finishDaily', () => {
  const daily = () => dailyFor(plainDay, maps);

  it('fails below the target and pays nothing', () => {
    const p = defaultProgress();
    const r = finishDaily(p, daily(), plainDay, daily().target - 1, 0);
    expect(r.cleared).toBe(false);
    expect(p.daily.clears).toBe(0);
    expect(p.cosmetics).toEqual([]);
  });

  it('clears once per day: streak, one cosmetic, nothing more on a repeat', () => {
    const p = defaultProgress();
    const d = daily();
    const a = finishDaily(p, d, plainDay, d.target, 3);
    expect(a.cleared).toBe(true);
    expect(a.reward).toBeDefined();
    expect(p.cosmetics).toEqual([a.reward]);
    expect(p.daily).toMatchObject({ streak: 1, clears: 1, lastClear: plainDay });
    const b = finishDaily(p, d, plainDay, d.target * 2, 0);
    expect(b.cleared).toBe(true);
    expect(b.reward).toBeUndefined();
    expect(p.cosmetics.length).toBe(1);
    expect(p.daily.clears).toBe(1);
  });

  it('streak grows on consecutive days and resets after a gap; every 3rd clear is a car pick', () => {
    const p = defaultProgress();
    const d = daily();
    const [a, b, c, e] = ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-10'];
    finishDaily(p, d, a, d.target, 0);
    finishDaily(p, d, b, d.target, 0);
    expect(p.carPicks).toBe(0);
    expect(finishDaily(p, d, c, d.target, 0).carPick).toBe(true);
    expect([p.daily.streak, p.carPicks]).toEqual([3, 1]);
    expect(liveStreak(p, '2026-03-04')).toBe(3);
    expect(liveStreak(p, '2026-03-05')).toBe(0);
    finishDaily(p, d, e, d.target, 0);
    expect(p.daily.streak).toBe(1);
  });

  it('legend needs zero wall hits and grants the skin', () => {
    const p = defaultProgress();
    const d = dailyFor(legendDay, maps);
    const bad = finishDaily(p, d, legendDay, d.target + 1, 1);
    expect(bad.cleared).toBe(false);
    expect(p.skins).toEqual([]);
    const ok = finishDaily(p, d, legendDay, d.target, 0);
    expect(ok.cleared).toBe(true);
    expect(ok.reward).toBe('fortune-orange');
    expect(p.skins).toEqual(['fortune-orange']);
    expect(p.cosmetics).toEqual([]);
  });
});

describe('rollCosmetic', () => {
  it('only picks unowned cosmetics, null when all owned', () => {
    const p = defaultProgress();
    p.cosmetics = COSMETICS.slice(1).map((c) => c.id);
    for (const r of [0, 0.5, 0.99]) expect(rollCosmetic(p, () => r)).toBe(COSMETICS[0].id);
    p.cosmetics.push(COSMETICS[0].id);
    expect(rollCosmetic(p)).toBeNull();
  });
});
