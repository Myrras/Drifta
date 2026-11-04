import { describe, expect, it } from 'vitest';
import { eventsBetween, planTally, tallyAt, timeMult, type TallyInput } from './tally';

const base: TallyInput = {
  drifts: [3000, 2000, 1000],
  rest: 1500,
  restCount: 4,
  combo: 7500,
  mult: 1.33,
  total: 9975,
  medals: [3000, 6000, 9000],
  position: 1,
};

describe('timeMult', () => {
  it('rounds and floors at 1', () => {
    expect(timeMult(41.8, 62)).toBe(1.33);
    expect(timeMult(62, 62)).toBe(1);
    expect(timeMult(80, 62)).toBe(1);
    expect(timeMult(31, 62)).toBe(1.5);
  });
});

describe('tally', () => {
  const p = planTally(base);
  it('orders the plan', () => {
    expect(p.rows).toBe(4);
    expect(p.rowStart[0]).toBe(0.35);
    expect(p.rowStart[1]).toBeGreaterThan(p.rowLand[0]);
    expect(p.multStart).toBeGreaterThan(p.rowLand[3]);
    expect(p.multEnd).toBeGreaterThan(p.multStart);
    expect(p.buildStart).toBeGreaterThan(p.multEnd);
    expect(p.duration).toBeCloseTo(p.buildEnd + 0.6);
  });
  it('frames at start, middle and end', () => {
    const f0 = tallyAt(base, p, 0);
    expect([f0.rowsShown, f0.combo, f0.mult, f0.total, f0.tier, f0.done]).toEqual([
      0,
      0,
      1,
      0,
      -1,
      false,
    ]);
    const fm = tallyAt(base, p, (p.buildStart + p.buildEnd) / 2);
    expect(fm.total).toBeGreaterThan(base.combo);
    expect(fm.total).toBeLessThan(base.total);
    const fe = tallyAt(base, p, p.duration);
    expect([fe.combo, fe.mult, fe.total, fe.done, fe.tier]).toEqual([7500, 1.33, 9975, true, 2]);
  });
  it('emits every event exactly once across windows', () => {
    const seen: unknown[] = [];
    for (let t = -0.1; t < p.duration + 0.5; t += 0.07) seen.push(...eventsBetween(p, t, t + 0.07));
    expect(seen.length).toBe(p.events.length);
    expect(new Set(seen).size).toBe(p.events.length);
  });
  it('place events respect position', () => {
    const q = planTally({ ...base, position: 2 });
    const tiers = q.events.filter((e) => e.kind === 'place').map((e) => e.index);
    expect(tiers).toEqual([0, 1]);
    expect(tallyAt({ ...base, position: 2 }, q, q.duration).tier).toBe(1);
    const n = planTally({ ...base, position: null });
    expect(n.events.some((e) => e.kind === 'place')).toBe(false);
  });
  it('tier crossed during build fires inside the build window', () => {
    const q = planTally({ ...base, medals: [3000, 6000, 9500] });
    const e = q.events.find((x) => x.kind === 'place' && x.index === 2)!;
    expect(e.t).toBeGreaterThan(q.buildStart);
    expect(e.t).toBeLessThan(q.buildEnd);
  });
  it('works with zero rows', () => {
    const z: TallyInput = {
      drifts: [],
      rest: 0,
      restCount: 0,
      combo: 0,
      mult: 1,
      total: 0,
      position: null,
    };
    const q = planTally(z);
    expect(q.rows).toBe(0);
    expect(q.events.map((e) => e.kind)).toEqual(['slam', 'build', 'final']);
    const f = tallyAt(z, q, q.duration);
    expect([f.total, f.mult, f.done]).toEqual([0, 1, true]);
  });
});
