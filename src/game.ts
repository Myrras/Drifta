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
const RAMP_DRIFT_MIN = 0.6; // fraction of the helix that must be drifted
const EPS = 1e-6; // absorbs float drift from summing fixed dt
const RESULTS_LOCKOUT = 0.5; // s; gamepad A is also the handbrake
const IDLE: DriftInfo = { drifting: false, slip: 0, speedKmh: 0 };

export function createGame(
  maps: GameMap[],
  audio: AudioLike,
  best: (mapName: string) => BestStore,
) {
  let sel = 0;
  let map = maps[0];
  const stores = maps.map((m) => best(m.name));
  const bests = stores.map((b) => b.get());
  const fresh = () => ({
    car: createCar(map.start),
    floorIndex: map.start.floor,
    scoring: createScoring(),
    drift: IDLE,
    time: 0,
    countdown: COUNTDOWN_SECONDS,
    popups: [] as Popup[],
    shake: 0,
    scrape: 0,
    /** active helix, unwrapped progress, drifted progress */
    helix: null as Helix | null,
    p: 0,
    drifted: 0,
    results: null as Results | null,
    resultsAge: 0,
  });
  const s = { phase: 'title' as Phase, runId: 0, handbrake: false, brake: 0, ...fresh() };

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
  function progress(h: Helix, margin: number, outer = margin): number | null {
    const dx = s.car.pos.x - h.center.x;
    const dy = s.car.pos.y - h.center.y;
    const r = Math.hypot(dx, dy);
    if (r < h.rCore - margin || r > h.rOuter + outer) return null;
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
    // wide band: a wall bounce must not end the transition
    const raw = progress(h, 2, 4);
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
    const newBest = total > bests[sel];
    if (newBest) stores[sel].set((bests[sel] = total));
    s.results = { comboPoints, timeBonus: bonus, total, time: s.time, best: bests[sel], newBest };
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
    const hit = collide(car, floor.solids, floor.circles);
    s.scrape = 0;
    if (hit) {
      const impact = -(car.vel.x * hit.normal.x + car.vel.y * hit.normal.y);
      bounce(car, hit);
      if (impact > HARD_HIT_SPEED) {
        hard = true;
        audio.hit();
        s.shake = Math.min(1, impact / 10);
      } else s.scrape = Math.max(0, Math.min(1, impact / HARD_HIT_SPEED));
    }
    const nearDist = s.drift.drifting
      ? nearestDistance(car, floor.solids, floor.circles)
      : Infinity;
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
      s.brake = input.brake;
      for (const p of s.popups) p.age += dt;
      s.popups = s.popups.filter((p) => p.age <= POPUP_LIFE);
      s.shake = Math.max(0, s.shake - SHAKE_DECAY * dt);

      const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      const toTitle = () => {
        audio.stop();
        Object.assign(s, fresh(), { phase: 'title' });
      };

      if (input.restart && s.phase !== 'title') {
        newRun();
        return;
      }
      switch (s.phase) {
        case 'title':
          if (dir) {
            sel = (sel + dir + maps.length) % maps.length;
            map = maps[sel];
            Object.assign(s, fresh());
          }
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
          if (input.pause) toTitle();
          else if (input.confirm) s.phase = 'run';
          break;
        case 'results':
          s.resultsAge += dt;
          if (input.pause) toTitle();
          else if (input.confirm && s.resultsAge >= RESULTS_LOCKOUT) newRun();
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
          brake: s.brake,
          fade: 0,
          blend,
          shake: s.shake,
          player: { model: 'mx5', color: '#d32030' },
          scrape: s.scrape,
          impact: s.shake,
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
          best: bests[sel],
          menu: s.phase === 'title' ? { items: maps.map((m) => m.name), selected: sel } : null,
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
