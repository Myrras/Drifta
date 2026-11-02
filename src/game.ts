import type { DriftInfo, GameMap, InputState, Phase, Ramp, ScoreEvent } from './types';
import type { FrameView, Popup, Results } from './view';
import type { createAudio } from './audio';
import { COUNTDOWN_SECONDS, FLOOR_FADE_SECONDS } from './config';
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
const HALF_FADE = FLOOR_FADE_SECONDS / 2;
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
    fade: 0,
    /** active floor transition */
    ramp: null as Ramp | null,
    rampT: 0,
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

  function enterFloor(r: Ramp): void {
    const c = s.car;
    const speed = Math.hypot(c.vel.x, c.vel.y);
    s.floorIndex = r.toFloor;
    c.pos = { ...r.spawn.pos };
    c.angle = r.spawn.angle;
    c.vel = { x: speed * Math.cos(c.angle), y: speed * Math.sin(c.angle) };
    c.angVel = 0;
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
    const fadingOut = s.ramp !== null && s.rampT < HALF_FADE - EPS;
    const frozen = s.ramp !== null;
    if (s.ramp) {
      s.rampT += dt;
      if (fadingOut) {
        s.fade = Math.min(1, s.rampT / HALF_FADE);
        if (s.rampT >= HALF_FADE - EPS) enterFloor(s.ramp);
      } else if (s.rampT >= FLOOR_FADE_SECONDS - EPS) {
        s.ramp = null;
        s.fade = 0;
      } else s.fade = Math.max(0, 2 - s.rampT / HALF_FADE);
    }

    let hard = false;
    let rampDrift = false;
    let nearDist = Infinity;
    let yawDelta = 0;
    if (!fadingOut) {
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
      nearDist = s.drift.drifting ? nearestDistance(car, floor.solids) : Infinity;
      yawDelta = car.angVel * dt;
      if (!s.ramp) {
        const ramp = floor.ramps.find((r) => inRect(car.pos, r.zone));
        if (ramp) {
          s.ramp = ramp;
          s.rampT = 0;
          rampDrift = s.drift.drifting;
        }
      }
    }

    handle(
      stepScoring(
        s.scoring,
        { drift: s.drift, yawDelta, nearDist, hit: hard, rampDrift, frozen },
        dt,
      ),
    );

    if (s.ramp && s.rampT < HALF_FADE - EPS) s.drift = IDLE;

    if (!fadingOut && s.floorIndex === map.finish.floor && inRect(s.car.pos, map.finish.zone)) {
      finish();
    }
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
      const fading = s.ramp !== null && s.rampT < HALF_FADE - EPS;
      const drift =
        s.phase !== 'run' || fading ? { drifting: false, slip: 0, speedKmh: speed * 3.6 } : s.drift;
      return {
        render: {
          map,
          floorIndex: s.floorIndex,
          car,
          drift,
          handbrake: s.handbrake,
          fade: s.fade,
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
