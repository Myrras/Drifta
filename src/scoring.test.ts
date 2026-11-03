import { describe, expect, it } from 'vitest';
import {
  CLIP_BONUS,
  CLIP_RATE,
  CLOSE_CALL_COOLDOWN,
  COMBO_GRACE,
  DRIFT_POINT_SCALE,
} from './config';
import {
  comboValue,
  createScoring,
  forceBank,
  medalFor,
  stepScoring,
  timeBonus,
  zoneAt,
} from './scoring';
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
    clip: o.clip ?? null,
    bonus: o.bonus,
    bonusAll: o.bonusAll,
    nearPolice: o.nearPolice,
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

  it('drift flicker adds no trick or multiplier', () => {
    const s = createScoring();
    run(s, F({ drifting: true }), 0.5);
    const m = s.combo!.multiplier;
    const n = s.combo!.tricks.length;
    run(s, F(), 0.1);
    const ev = run(s, F({ drifting: true }), 0.1);
    expect(tricks(ev)).not.toContain('DRIFT');
    expect(s.combo!.multiplier).toBe(m);
    expect(s.combo!.tricks.length).toBe(n);
  });

  it('0.4 s gap same sign adds DRIFT', () => {
    const s = createScoring();
    run(s, F({ drifting: true }), 0.5);
    run(s, F(), 0.4);
    const ev = stepScoring(s, F({ drifting: true }), 0.1);
    expect(tricks(ev)).toContain('DRIFT');
  });

  it('long drift survives a short flicker', () => {
    const s = createScoring();
    const a = run(s, F({ drifting: true }), 1.5, 0.5);
    run(s, F(), 0.1);
    const b = run(s, F({ drifting: true }), 1.0, 0.5);
    expect(tricks([...a, ...b]).filter((t) => t === 'LONG DRIFT')).toHaveLength(1);
    expect(tricks(b)).not.toContain('DRIFT');
  });
});

describe('clipping zones', () => {
  const A = { x: 0, y: 0, w: 5, h: 5 };
  const B = { x: 10, y: 0, w: 5, h: 5 };

  it('zoneAt finds the zone containing a point', () => {
    expect(zoneAt({ x: 2, y: 5 }, [A, B])).toBe(A);
    expect(zoneAt({ x: 12, y: 1 }, [A, B])).toBe(B);
    expect(zoneAt({ x: 7, y: 1 }, [A, B])).toBeNull();
    expect(zoneAt({ x: 1, y: 1 })).toBeNull();
  });

  it('multiplies drift points only while drifting inside', () => {
    const base = createScoring();
    const clip = createScoring();
    stepScoring(base, F({ drifting: true }), 0.5);
    stepScoring(clip, F({ drifting: true, clip: A }), 0.5);
    expect(clip.combo!.points - CLIP_BONUS).toBeCloseTo(base.combo!.points * CLIP_RATE);
    const before = clip.combo!.points;
    stepScoring(clip, F({ clip: A }), 0.5); // inside but not drifting
    expect(clip.combo!.points).toBe(before);
  });

  it('gives the clip bonus once per zone per combo', () => {
    const s = createScoring();
    const a = run(s, F({ drifting: true, clip: A }), 1);
    expect(s.combo!.multiplier).toBe(1); // bonus points only
    const b = run(s, F({ drifting: true }), 0.5);
    const c = run(s, F({ drifting: true, clip: A }), 0.5);
    const d = run(s, F({ drifting: true, clip: B }), 0.5);
    expect([a, b, c, d].map((e) => tricks(e).filter((t) => t === 'CLIP').length)).toEqual([
      1, 0, 0, 1,
    ]);
    forceBank(s);
    expect(tricks(stepScoring(s, F({ drifting: true, clip: A }), 0.1))).toContain('CLIP');
  });
});

describe('medalFor', () => {
  it('counts thresholds reached', () => {
    const m = [100, 200, 300];
    expect([0, 99, 100, 250, 300, 999].map((t) => medalFor(t, m))).toEqual([0, 0, 1, 2, 3, 3]);
    expect(medalFor(500)).toBe(0);
  });
});

describe('v0.9 bonus tricks', () => {
  const z = (x: number) => ({ x, y: 0, w: 1, h: 1, id: 'a', trick: 'SCRAMBLE' as const });
  const [z1, z2] = [z(0), z(5)];
  it('fires a bonus zone once after every rect of its id', () => {
    const s = createScoring();
    const at = (b: (typeof z1)[]) => F({ drifting: true, bonus: b, bonusAll: [z1, z2] });
    expect(tricks(stepScoring(s, at([z1]), 0.1))).not.toContain('SCRAMBLE');
    const p = s.combo!.points;
    const ev = stepScoring(s, at([z2]), 0.1);
    expect(tricks(ev)).toContain('SCRAMBLE');
    expect(s.combo!.points - p).toBeGreaterThan(1500);
    expect(tricks(run(s, at([z1, z2]), 0.5))).not.toContain('SCRAMBLE');
  });
  it('COP SHOW once per combo under 4.5 m', () => {
    const s = createScoring();
    expect(tricks(stepScoring(s, F({ drifting: true, nearPolice: 5 }), 0.1))).not.toContain(
      'COP SHOW',
    );
    expect(tricks(stepScoring(s, F({ drifting: true, nearPolice: 4 }), 0.1))).toContain('COP SHOW');
    expect(tricks(stepScoring(s, F({ drifting: true, nearPolice: 4 }), 0.1))).not.toContain(
      'COP SHOW',
    );
  });
  it('NEAR MISS chain adds n*0.1 and resets on a hit', () => {
    const s = createScoring();
    const cc = F({ drifting: true, nearDist: 0.1 });
    stepScoring(s, cc, 0.1);
    expect(s.combo!.multiplier).toBeCloseTo(1 + 1 + 0.1);
    run(s, F({ drifting: true }), CLOSE_CALL_COOLDOWN);
    stepScoring(s, cc, 0.1);
    expect(s.combo!.multiplier).toBeCloseTo(1 + 2 + 0.3);
    stepScoring(s, F({ hit: true }), 0.1);
    stepScoring(s, cc, 0.1);
    expect(s.combo!.multiplier).toBeCloseTo(1 + 1 + 0.1);
  });
  it('NEAR MISS chain is capped at 0.1*10 per step and has no float noise', () => {
    const s = createScoring();
    const cc = F({ drifting: true, nearDist: 0.1 });
    for (let i = 0; i < 14; i++) {
      stepScoring(s, cc, 0.1);
      run(s, F({ drifting: true }), CLOSE_CALL_COOLDOWN);
      const m = s.combo!.multiplier;
      expect(m).toBe(Math.round(m * 10) / 10);
    }
    const before = s.combo!.multiplier;
    stepScoring(s, cc, 0.1);
    expect(s.combo!.multiplier).toBe(Math.round((before + 1 + 1) * 10) / 10); // CLOSE CALL +1, near miss +1.0
  });
});
