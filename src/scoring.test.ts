import { describe, expect, it } from 'vitest';
import { CLOSE_CALL_COOLDOWN, COMBO_GRACE, DRIFT_POINT_SCALE } from './config';
import { comboValue, createScoring, forceBank, stepScoring, timeBonus } from './scoring';
import type { ScoreEvent, ScoreFrame } from './types';

const DEG = Math.PI / 180;
type Opts = Partial<Omit<ScoreFrame, 'drift'>> & { slipDeg?: number; drifting?: boolean };
const F = (o: Opts = {}): ScoreFrame => {
  const drifting = o.drifting ?? false;
  return {
    drift: { drifting, slip: (o.slipDeg ?? (drifting ? 30 : 0)) * DEG, speedKmh: 60 },
    yawDelta: o.yawDelta ?? 0,
    nearDist: o.nearDist ?? 99,
    hit: o.hit ?? false,
    rampDrift: o.rampDrift ?? false,
    frozen: o.frozen ?? false,
  };
};
const run = (s: ReturnType<typeof createScoring>, f: ScoreFrame, secs: number, dt = 0.1) => {
  const evs: ScoreEvent[] = [];
  for (let t = 0; t < secs - 1e-9; t += dt) evs.push(...stepScoring(s, f, dt));
  return evs;
};
const tricks = (evs: ScoreEvent[]) => evs.flatMap((e) => (e.type === 'trick' ? [e.trick] : []));

describe('scoring', () => {
  it('starts a combo and accrues points', () => {
    const s = createScoring();
    const ev = stepScoring(s, F({ drifting: true }), 0.5);
    expect(ev).toEqual([{ type: 'trick', trick: 'DRIFT' }]);
    expect(s.combo!.multiplier).toBe(1);
    expect(s.combo!.points).toBeCloseTo(30 * 60 * DRIFT_POINT_SCALE * 0.5);
  });

  it('banks after grace', () => {
    const s = createScoring();
    stepScoring(s, F({ drifting: true }), 1);
    const pts = comboValue(s.combo!);
    run(s, F(), COMBO_GRACE - 0.2);
    expect(s.combo).not.toBeNull();
    const ev = run(s, F(), 0.3);
    expect(ev).toEqual([{ type: 'bank', amount: pts }]);
    expect(s.banked).toBe(pts);
    expect(s.combo).toBeNull();
  });

  it('new drift within grace raises multiplier', () => {
    const s = createScoring();
    stepScoring(s, F({ drifting: true }), 0.1);
    run(s, F(), 1);
    const ev = stepScoring(s, F({ drifting: true }), 0.1);
    expect(tricks(ev)).toEqual(['DRIFT']);
    expect(s.combo!.multiplier).toBe(2);
  });

  it('hit fails combo; no-op without combo', () => {
    const s = createScoring();
    expect(stepScoring(s, F({ hit: true }), 0.1)).toEqual([]);
    stepScoring(s, F({ drifting: true }), 1);
    const lost = comboValue(s.combo!);
    expect(stepScoring(s, F({ hit: true, drifting: true }), 0.1)).toEqual([{ type: 'fail', lost }]);
    expect(s.banked).toBe(0);
    expect(s.combo).toBeNull();
  });

  it('frozen frames do not tick grace', () => {
    const s = createScoring();
    stepScoring(s, F({ drifting: true }), 0.1);
    expect(run(s, F({ frozen: true }), 5)).toEqual([]);
    expect(s.combo).not.toBeNull();
  });

  it('switchback across a short gap', () => {
    const s = createScoring();
    stepScoring(s, F({ drifting: true, slipDeg: 30 }), 0.1);
    run(s, F(), 0.3);
    const ev = stepScoring(s, F({ drifting: true, slipDeg: -30 }), 0.1);
    expect(tricks(ev)).toEqual(['SWITCHBACK']);
    expect(s.combo!.multiplier).toBe(2);
  });

  it('no switchback across a long gap', () => {
    const s = createScoring();
    stepScoring(s, F({ drifting: true, slipDeg: 30 }), 0.1);
    run(s, F(), 0.7);
    expect(tricks(stepScoring(s, F({ drifting: true, slipDeg: -30 }), 0.1))).toEqual(['DRIFT']);
  });

  it('switchback on sign flip while drifting', () => {
    const s = createScoring();
    stepScoring(s, F({ drifting: true, slipDeg: 30 }), 0.1);
    const ev = stepScoring(s, F({ drifting: true, slipDeg: -30 }), 0.1);
    expect(tricks(ev)).toEqual(['SWITCHBACK']);
  });

  it('long drift at 2s and 4s', () => {
    const s = createScoring();
    const ev = run(s, F({ drifting: true }), 4.5, 0.5);
    expect(tricks(ev).filter((t) => t === 'LONG DRIFT')).toHaveLength(2);
    expect(s.combo!.multiplier).toBe(3);
  });

  it('close call respects cooldown', () => {
    const s = createScoring();
    const f = F({ drifting: true, nearDist: 0.5 });
    const ev = run(s, f, CLOSE_CALL_COOLDOWN + 0.5, 0.25);
    expect(tricks(ev).filter((t) => t === 'CLOSE CALL')).toHaveLength(2);
    expect(tricks(stepScoring(s, f, 0.1))).toEqual([]);
  });

  it('360 in both directions', () => {
    for (const sign of [1, -1]) {
      const s = createScoring();
      stepScoring(s, F({ drifting: true }), 0.1);
      const ev = run(s, F({ drifting: true, yawDelta: (sign * Math.PI) / 2 }), 1.0, 0.25);
      expect(tricks(ev)).toEqual(['360']);
    }
  });

  it('ramp drift needs a combo', () => {
    const s = createScoring();
    expect(stepScoring(s, F({ rampDrift: true }), 0.1)).toEqual([]);
    stepScoring(s, F({ drifting: true }), 0.1);
    const ev = stepScoring(s, F({ drifting: true, rampDrift: true }), 0.1);
    expect(tricks(ev)).toEqual(['RAMP DRIFT']);
  });

  it('forceBank and timeBonus', () => {
    const s = createScoring();
    expect(forceBank(s)).toEqual([]);
    stepScoring(s, F({ drifting: true }), 1);
    const v = comboValue(s.combo!);
    expect(forceBank(s)).toEqual([{ type: 'bank', amount: v }]);
    expect(s.banked).toBe(v);
    expect(timeBonus(100, 60)).toBe(0);
    expect(timeBonus(50, 60)).toBe(1000);
  });
});
