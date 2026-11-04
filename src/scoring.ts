import type { Combo, Rect, ScoreEvent, ScoreFrame, ScoringState, Trick, Vec } from './types';
import { inRect } from './collision';
import {
  CLIP_BONUS,
  CLIP_RATE,
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
} from './config';

const SWITCHBACK_WINDOW = 0.5; // s of non-drift gap that still counts as a switchback
const DRIFT_REENTRY_GAP = 0.3; // s; shorter gaps are slip flicker, not a new drift
const BONUS_POINTS: Partial<Record<Trick, number>> = { SCRAMBLE: 1500, 'DRIVE-THRU': 2500 };
export const COP_SHOW_DIST = 4.5; // m, car hull to police rect; Tokyo routes pass 5 m off, so a slide is needed
const COP_SHOW_BONUS = 1000;
const TWO_PI = Math.PI * 2;

export interface Scoring extends ScoringState {
  wasDrifting: boolean;
  lastSign: number; // sign of last slip, 0 = none
  gap: number; // s since drift ended
  segTime: number; // s of current unbroken drift
  closeCooldown: number;
  yawAccum: number;
  clipped: Rect[]; // zones already clipped this combo
  visited: Rect[]; // bonus rects drifted through this combo
  fired: string[]; // bonus ids / 'COP' already fired this combo
  nearMisses: number; // consecutive close calls this combo
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
    clipped: [],
    visited: [],
    fired: [],
    nearMisses: 0,
  };
}

export function comboValue(c: Combo): number {
  return Math.round(c.points * c.multiplier);
}

export const MEDAL_NAMES = ['', 'BRONZE', 'SILVER', 'GOLD'];

/** Medals earned (0 none .. 3 gold) for a total score. */
export function medalFor(total: number, medals?: readonly number[]): number {
  return medals ? medals.filter((m) => total >= m).length : 0;
}

function resetBook(s: Scoring): void {
  s.wasDrifting = false;
  s.lastSign = 0;
  s.gap = 0;
  s.segTime = 0;
  s.closeCooldown = 0;
  s.yawAccum = 0;
  s.clipped = [];
  s.visited = [];
  s.fired = [];
  s.nearMisses = 0;
}

/** Clipping zone containing p, or null. */
export function zoneAt(p: Vec, zones: readonly Rect[] = []): Rect | null {
  return zones.find((z) => inRect(p, z)) ?? null;
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
      if (flipped && s.gap < SWITCHBACK_WINDOW) {
        s.segTime = 0;
        addTrick(s, ev, 'SWITCHBACK', SWITCHBACK_BONUS);
      } else if (s.gap >= DRIFT_REENTRY_GAP) {
        s.segTime = 0;
        addTrick(s, ev, 'DRIFT');
      }
    } else if (flipped) {
      addTrick(s, ev, 'SWITCHBACK', SWITCHBACK_BONUS);
    }
    if (sign !== 0) s.lastSign = sign;

    const c = s.combo;
    const rate = f.clip ? CLIP_RATE : 1;
    c.points += Math.abs((d.slip * 180) / Math.PI) * d.speedKmh * DRIFT_POINT_SCALE * rate * dt;
    c.grace = COMBO_GRACE;
    if (f.clip && !s.clipped.includes(f.clip)) {
      s.clipped.push(f.clip);
      c.points += CLIP_BONUS; // points only, no multiplier step
      c.tricks.push('CLIP');
      ev.push({ type: 'trick', trick: 'CLIP' });
    }

    const before = Math.floor(s.segTime / LONG_DRIFT_INTERVAL);
    s.segTime += dt;
    const n = Math.floor(s.segTime / LONG_DRIFT_INTERVAL) - before;
    for (let i = 0; i < n; i++) addTrick(s, ev, 'LONG DRIFT', LONG_DRIFT_BONUS);

    if (f.nearDist < CLOSE_CALL_DIST && s.closeCooldown <= 0) {
      addTrick(s, ev, 'CLOSE CALL', CLOSE_CALL_BONUS);
      s.closeCooldown = CLOSE_CALL_COOLDOWN;
      s.nearMisses++;
      c.multiplier = Math.round((c.multiplier + Math.min(s.nearMisses, 10) * 0.1) * 10) / 10;
      c.tricks.push('NEAR MISS');
      ev.push({ type: 'trick', trick: 'NEAR MISS' });
    }

    for (const z of f.bonus ?? []) {
      if (!s.visited.includes(z)) s.visited.push(z);
      const all = (f.bonusAll ?? f.bonus!).filter((b) => b.id === z.id);
      if (!s.fired.includes(z.id) && all.every((b) => s.visited.includes(b))) {
        s.fired.push(z.id);
        c.points += BONUS_POINTS[z.trick] ?? 0;
        c.tricks.push(z.trick);
        ev.push({ type: 'trick', trick: z.trick });
      }
    }
    if ((f.nearPolice ?? Infinity) < COP_SHOW_DIST && !s.fired.includes('COP')) {
      s.fired.push('COP');
      c.points += COP_SHOW_BONUS;
      c.tricks.push('COP SHOW');
      ev.push({ type: 'trick', trick: 'COP SHOW' });
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
