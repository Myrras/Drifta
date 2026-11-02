import type { Combo, ScoreEvent, ScoreFrame, ScoringState, Trick } from './types';
import {
  CLOSE_CALL_BONUS,
  CLOSE_CALL_COOLDOWN,
  CLOSE_CALL_DIST,
  COMBO_GRACE,
  DRIFT_POINT_SCALE,
  LONG_DRIFT_BONUS,
  LONG_DRIFT_INTERVAL,
  RAMP_DRIFT_BONUS,
  SPIN_BONUS,
  SWITCHBACK_BONUS,
  TIME_BONUS_PER_SEC,
} from './config';

const SWITCHBACK_WINDOW = 0.5; // s of non-drift gap that still counts as a switchback
const TWO_PI = Math.PI * 2;

export interface Scoring extends ScoringState {
  wasDrifting: boolean;
  lastSign: number; // sign of last slip, 0 = none
  gap: number; // s since drift ended
  segTime: number; // s of current unbroken drift
  closeCooldown: number;
  yawAccum: number;
}

export function createScoring(): Scoring {
  return {
    banked: 0,
    combo: null,
    wasDrifting: false,
    lastSign: 0,
    gap: 0,
    segTime: 0,
    closeCooldown: 0,
    yawAccum: 0,
  };
}

export function comboValue(c: Combo): number {
  return Math.round(c.points * c.multiplier);
}

export function timeBonus(time: number, par: number): number {
  return Math.max(0, Math.round((par - time) * TIME_BONUS_PER_SEC));
}

function resetBook(s: Scoring): void {
  s.wasDrifting = false;
  s.lastSign = 0;
  s.gap = 0;
  s.segTime = 0;
  s.closeCooldown = 0;
  s.yawAccum = 0;
}

function addTrick(s: Scoring, ev: ScoreEvent[], trick: Trick, bonus = 0): void {
  const c = s.combo!;
  c.points += bonus;
  c.multiplier += 1;
  c.tricks.push(trick);
  ev.push({ type: 'trick', trick });
}

export function forceBank(s: Scoring): ScoreEvent[] {
  if (!s.combo) return [];
  const amount = comboValue(s.combo);
  s.banked += amount;
  s.combo = null;
  resetBook(s);
  return [{ type: 'bank', amount }];
}

export function stepScoring(s: Scoring, f: ScoreFrame, dt: number): ScoreEvent[] {
  if (f.frozen) return [];
  const ev: ScoreEvent[] = [];

  if (f.hit && s.combo) {
    ev.push({ type: 'fail', lost: comboValue(s.combo) });
    s.combo = null;
    resetBook(s);
    return ev;
  }

  s.closeCooldown = Math.max(0, s.closeCooldown - dt);
  const d = f.drift;

  if (d.drifting) {
    const sign = Math.sign(d.slip);
    const flipped = sign !== 0 && s.lastSign !== 0 && sign !== s.lastSign;
    if (!s.combo) {
      s.combo = { points: 0, multiplier: 1, tricks: ['DRIFT'], grace: COMBO_GRACE };
      ev.push({ type: 'trick', trick: 'DRIFT' });
      s.segTime = 0;
    } else if (!s.wasDrifting) {
      s.segTime = 0;
      if (flipped && s.gap < SWITCHBACK_WINDOW) addTrick(s, ev, 'SWITCHBACK', SWITCHBACK_BONUS);
      else addTrick(s, ev, 'DRIFT');
    } else if (flipped) {
      addTrick(s, ev, 'SWITCHBACK', SWITCHBACK_BONUS);
    }
    if (sign !== 0) s.lastSign = sign;

    const c = s.combo;
    c.points += Math.abs((d.slip * 180) / Math.PI) * d.speedKmh * DRIFT_POINT_SCALE * dt;
    c.grace = COMBO_GRACE;

    const before = Math.floor(s.segTime / LONG_DRIFT_INTERVAL);
    s.segTime += dt;
    const n = Math.floor(s.segTime / LONG_DRIFT_INTERVAL) - before;
    for (let i = 0; i < n; i++) addTrick(s, ev, 'LONG DRIFT', LONG_DRIFT_BONUS);

    if (f.nearDist < CLOSE_CALL_DIST && s.closeCooldown <= 0) {
      addTrick(s, ev, 'CLOSE CALL', CLOSE_CALL_BONUS);
      s.closeCooldown = CLOSE_CALL_COOLDOWN;
    }
    s.gap = 0;
  }

  if (s.combo) {
    s.yawAccum += f.yawDelta;
    while (Math.abs(s.yawAccum) >= TWO_PI) {
      s.yawAccum -= Math.sign(s.yawAccum) * TWO_PI;
      addTrick(s, ev, '360', SPIN_BONUS);
    }
    if (f.rampDrift) addTrick(s, ev, 'RAMP DRIFT', RAMP_DRIFT_BONUS);

    if (!d.drifting) {
      s.gap += dt;
      s.combo.grace -= dt;
      if (s.combo.grace <= 0) {
        const amount = comboValue(s.combo);
        s.banked += amount;
        s.combo = null;
        ev.push({ type: 'bank', amount });
        resetBook(s);
        return ev;
      }
    }
  }
  s.wasDrifting = d.drifting;
  return ev;
}
