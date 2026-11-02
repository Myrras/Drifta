import type { DriftInfo, GameMap, Helix, InputState, Phase, ScoreEvent } from './types';
import type { FrameView, Popup, Results } from './view';
import type { createAudio } from './audio';
import { COUNTDOWN_SECONDS } from './config';
import { bounce, createCar, stepCar } from './car';
import { collide, inRect, nearestDistance } from './collision';
import { comboValue, createScoring, forceBank, stepScoring, timeBonus } from './scoring';

export type AudioLike = ReturnType<typeof createAudio>;
export interface BestStore {
  get(): number;
  set(v: number): void;
}

const HARD_HIT_SPEED = 1.5; // m/s into the wall; below this it is a scrape
const POPUP_LIFE = 1.5; // s
const SHAKE_DECAY = 3; // per s
const RING_MARGIN = 0.5; // m beyond the ring still counted as inside
const RAMP_DRIFT_MIN = 0.6; // fraction of the helix that must be drifted
const EPS = 1e-6; // absorbs float drift from summing fixed dt
const RESULTS_LOCKOUT = 0.5; // s; gamepad A is also the handbrake
const IDLE: DriftInfo = { drifting: false, slip: 0, speedKmh: 0 };

export function createGame(map: GameMap, audio: AudioLike, best: BestStore) {
  const fresh = () => ({
    car: createCar(map.start),
    floorIndex: map.start.floor,
    scoring: createScoring(),
    drift: IDLE,
    time: 0,
    countdown: COUNTDOWN_SECONDS,
    popups: [] as Popup[],
    shake: 0,
    /** active helix, unwrapped progress, drifted progress */
    helix: null as Helix | null,
    p: 0,
    drifted: 0,
    results: null as Results | null,
    resultsAge: 0,
  });
  let bestScore = best.get();
  const s = { phase: 'title' as Phase, runId: 0, handbrake: false, ...fresh() };

  const newRun = () => {
    audio.stop();
    Object.assign(s, fresh(), { phase: 'countdown', runId: s.runId + 1 });
  };
  const popup = (kind: Popup['kind'], text: string, amount: number) =>
    s.popups.push({ kind, text, amount, age: 0 });

  function handle(events: ScoreEvent[]): void {
    for (const e of events) {
      if (e.type === 'trick') popup('trick', e.trick, 0);
      else if (e.type === 'bank') {
        popup('bank', `+${e.amount}`, e.amount);
        audio.bank();
      } else {
        popup('fail', 'BAILED', e.lost);
        audio.fail();
      }
    }
  }

  const smooth = (x: number) => x * x * (3 - 2 * x);

  /** progress along a helix; null if the car is outside the ring (with margin) */
  function progress(h: Helix, margin: number): number | null {
    const dx = s.car.pos.x - h.center.x;
    const dy = s.car.pos.y - h.center.y;
    const r = Math.hypot(dx, dy);
    if (r < h.rCore - margin || r > h.rOuter + margin) return null;
    let d = Math.atan2(dy, dx) - h.enterAngle;
    d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
    return d / h.sweep;
  }

  /** returns true when a completed downward helix was drifted enough */
  function stepHelix(): boolean {
    if (!s.helix) {
      for (const h of map.helixes) {
        const p = progress(h, 0);
        if (p === null) continue;
        const down = h.from === s.floorIndex && p >= 0 && p <= 0.25;
        const up = h.from + 1 === s.floorIndex && p >= 0.75 && p <= 1;
        if (down || up) {
          Object.assign(s, { helix: h, p, drifted: 0 });
          break;
        }
      }
      return false;
    }
    const h = s.helix;
    const raw = progress(h, RING_MARGIN);
    const period = (2 * Math.PI) / Math.abs(h.sweep); // p wraps every period
    let p = s.p;
    if (raw !== null) p = raw + Math.round((s.p - raw) / period) * period;
    if (s.drift.drifting) s.drifted += Math.abs(p - s.p);
    s.p = p;
    s.floorIndex = p >= 0.5 ? h.from + 1 : h.from;
    if (raw === null || p < -0.05 || p > 1.05) {
      s.helix = null;
      return p > 1 && s.drifted >= RAMP_DRIFT_MIN;
    }
    return false;
  }

  function finish(): void {
    handle(forceBank(s.scoring));
    const comboPoints = s.scoring.banked;
    const bonus = timeBonus(s.time, map.parTime);
    const total = comboPoints + bonus;
    const newBest = total > bestScore;
    if (newBest) best.set((bestScore = total));
    s.results = { comboPoints, timeBonus: bonus, total, time: s.time, best: bestScore, newBest };
    s.phase = 'results';
    audio.stop();
  }

  function run(input: InputState, dt: number): void {
    s.time += dt;
    let hard = false;
    const car = s.car;
    const floor = map.floors[s.floorIndex];
    s.drift = stepCar(car, input, dt);
    audio.update(car, s.drift, input.throttle);
    const hit = collide(car, floor.solids);
    if (hit) {
      const impact = -(car.vel.x * hit.normal.x + car.vel.y * hit.normal.y);
      bounce(car, hit);
      if (impact > HARD_HIT_SPEED) {
        hard = true;
        audio.hit();
        s.shake = Math.min(1, impact / 10);
      }
    }
    const nearDist = s.drift.drifting ? nearestDistance(car, floor.solids) : Infinity;
    const yawDelta = car.angVel * dt;
    const rampDrift = stepHelix();

    handle(
      stepScoring(
        s.scoring,
        { drift: s.drift, yawDelta, nearDist, hit: hard, rampDrift, frozen: false },
        dt,
      ),
    );

    if (s.floorIndex === map.finish.floor && inRect(s.car.pos, map.finish.zone)) finish();
  }

  return {
    update(input: InputState, dt: number): void {
      s.handbrake = input.handbrake;
      for (const p of s.popups) p.age += dt;
      s.popups = s.popups.filter((p) => p.age <= POPUP_LIFE);
      s.shake = Math.max(0, s.shake - SHAKE_DECAY * dt);

      if (input.restart && s.phase !== 'title') {
        newRun();
        return;
      }
      switch (s.phase) {
        case 'title':
          if (input.confirm) {
            audio.resume();
            newRun();
          }
          break;
        case 'countdown':
          s.countdown -= dt;
          if (s.countdown <= EPS) s.phase = 'run';
          break;
        case 'run':
          if (input.pause) {
            s.phase = 'paused';
            audio.stop();
          } else run(input, dt);
          break;
        case 'paused':
          if (input.pause || input.confirm) s.phase = 'run';
          break;
        case 'results':
          s.resultsAge += dt;
          if (input.confirm && s.resultsAge >= RESULTS_LOCKOUT) newRun();
          break;
      }
    },

    view(): FrameView {
      const { car, scoring } = s;
      const speed = Math.hypot(car.vel.x, car.vel.y);
      const drift =
        s.phase !== 'run' ? { drifting: false, slip: 0, speedKmh: speed * 3.6 } : s.drift;
      const h = s.helix;
      const t = smooth(Math.min(1, Math.max(0, (s.p - 0.15) / 0.7)));
      const blend = h
        ? s.floorIndex === h.from
          ? { toFloor: h.from + 1, t }
          : { toFloor: h.from, t: 1 - t }
        : null;
      return {
        render: {
          map,
          floorIndex: s.floorIndex,
          car,
          drift,
          handbrake: s.handbrake,
          fade: 0,
          blend,
          shake: s.shake,
          runId: s.runId,
        },
        hud: {
          phase: s.phase,
          time: s.time,
          par: map.parTime,
          floorName: map.floors[s.floorIndex].name,
          score: scoring.banked,
          combo: scoring.combo,
          comboValue: scoring.combo ? comboValue(scoring.combo) : 0,
          popups: s.popups,
          speedKmh: speed * 3.6,
          countdown: s.phase === 'countdown' ? Math.max(0, s.countdown) : 0,
          best: bestScore,
          results: s.phase === 'results' ? s.results : null,
        },
      };
    },

    pause(): void {
      if (s.phase !== 'run') return;
      s.phase = 'paused';
      audio.stop();
    },

    /** test hook: live internal state (car, floorIndex, phase, scoring, ...) */
    debug: s,
  };
}
