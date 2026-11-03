import type {
  DriftInfo,
  GameMap,
  Helix,
  InputState,
  Phase,
  Vec,
  PlayerModel,
  Rect,
  ScoreEvent,
} from './types';
import type { FrameView, MenuRow, MenuView, Popup, Results } from './view';
import type { createAudio } from './audio';
import { COUNTDOWN_SECONDS } from './config';
import { bounce, createCar, stepCar } from './car';
import { collide, inRect, nearestDistance } from './collision';
import { garage, garageRoute } from './maps/garage';
import { docks, docksRoute } from './maps/docks';
import { PLAYER_MODELS, type CarStats } from './models';
import { loadSettings, saveSettings, type SettingsStorage } from './settings';
import {
  comboValue,
  createScoring,
  forceBank,
  MEDAL_NAMES,
  medalFor,
  stepScoring,
  timeBonus,
  zoneAt,
} from './scoring';

export type AudioLike = ReturnType<typeof createAudio>;
export interface BestStore {
  get(): number;
  set(v: number): void;
}

const HARD_HIT_SPEED = 1.5; // m/s into the wall; below this it is a scrape
const POPUP_LIFE = 1.5; // s
const SHAKE_DECAY = 3; // per s
const RAMP_DRIFT_MIN = 0.6; // fraction of the helix that must be drifted
const STUCK_SPEED = 0.8; // m/s
const STUCK_INPUT = 0.3;
const STUCK_NEAR = 0.3; // m
const STUCK_TIME = 2.5; // s
const ROUTES = new Map<GameMap, { floor: number; points: Vec[] }[]>([
  [garage, garageRoute],
  [docks, docksRoute],
]);
const NEAR_RANGE = 8; // m; solids farther than this cannot matter for collide or near-miss
const EPS = 1e-6; // absorbs float drift from summing fixed dt
const RESULTS_LOCKOUT = 0.5; // s; gamepad A is also the handbrake
const MODEL_IDS = Object.keys(PLAYER_MODELS) as PlayerModel[];
const statRange = (k: keyof CarStats) => {
  const v = MODEL_IDS.map((m) => PLAYER_MODELS[m].stats[k]);
  return [Math.min(...v), Math.max(...v)];
};
const VOLUMES = ['master', 'music', 'sfx', 'engine'] as const;
const TITLE_ROWS = 3;
const SETTINGS_ROWS = 8; // 4 volumes, shake, music, reset, back
const IDLE: DriftInfo = { drifting: false, slip: 0, speedKmh: 0 };

export function createGame(
  maps: GameMap[],
  audio: AudioLike,
  best: (mapName: string) => BestStore,
  storage?: SettingsStorage,
) {
  const cfg = loadSettings(storage);
  const applyVolumes = () => {
    const { master, music, sfx, engine } = cfg;
    audio.setVolumes({ master, music, sfx, engine });
  };
  applyVolumes();
  audio.setTrack(cfg.track);
  let row = 0;
  let confirmReset = false;
  let gCar = cfg.car;
  let gColor = cfg.color;
  let intensity = 0;
  let sel = 0;
  let map = maps[0];
  const stores = maps.map((m) => best(m.name));
  const bests = stores.map((b) => b.get());
  const fresh = () => ({
    car: createCar(map.start, PLAYER_MODELS[cfg.car].stats),
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
    stuck: 0,
    clip: null as Rect | null,
  });
  const s = { phase: 'title' as Phase, runId: 0, handbrake: false, brake: 0, ...fresh() };

  const newRun = () => {
    audio.stop();
    audio.music(true);
    audio.setIntensity((intensity = 0.15));
    Object.assign(s, fresh(), { phase: 'countdown', runId: s.runId + 1 });
  };
  const popup = (kind: Popup['kind'], text: string, amount: number) =>
    s.popups.push({ kind, text, amount, age: 0 });

  function handle(events: ScoreEvent[], failText = 'BAILED'): void {
    for (const e of events) {
      if (e.type === 'trick') popup('trick', e.trick, 0);
      else if (e.type === 'bank') {
        popup('bank', `+${e.amount}`, e.amount);
        audio.bank();
      } else {
        popup('fail', failText, e.lost);
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
    s.results = {
      comboPoints,
      timeBonus: bonus,
      total,
      time: s.time,
      best: bests[sel],
      newBest,
      medals: map.medals,
    };
    s.phase = 'results';
    audio.stop();
    audio.music(false);
  }

  /** put the car on the route (or start) nearest to it, heading along it, clear of solids */
  function recover(): void {
    const car = s.car;
    const floor = map.floors[s.floorIndex];
    const clear = () => !collide(car, floor.solids, floor.circles);
    const place = (pos: Vec, angle: number) =>
      Object.assign(car, { pos: { ...pos }, angle, vel: { x: 0, y: 0 }, angVel: 0 });
    const pts = ROUTES.get(map)?.find((r) => r.floor === s.floorIndex)?.points;
    if (pts && pts.length > 1) {
      let best = Infinity;
      let seg = 0;
      let t = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const dx = pts[i + 1].x - a.x;
        const dy = pts[i + 1].y - a.y;
        const u = Math.max(
          0,
          Math.min(1, ((car.pos.x - a.x) * dx + (car.pos.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
        );
        const d = Math.hypot(a.x + u * dx - car.pos.x, a.y + u * dy - car.pos.y);
        if (d < best) [best, seg, t] = [d, i, u];
      }
      // step forward along the route until clear
      search: for (let i = seg; i < pts.length - 1; i++, t = 0) {
        const a = pts[i];
        const b = pts[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        for (let d = t * len; d <= len; d += 0.5) {
          place({ x: a.x + ((b.x - a.x) * d) / len, y: a.y + ((b.y - a.y) * d) / len }, angle);
          if (clear()) break search;
        }
      }
    } else place(map.start.pos, map.start.angle);
    handle(
      stepScoring(
        s.scoring,
        {
          drift: IDLE,
          yawDelta: 0,
          nearDist: Infinity,
          hit: true,
          rampDrift: false,
          frozen: false,
        },
        0,
      ),
      'RESET',
    );
    s.stuck = 0;
  }

  function run(input: InputState, dt: number): void {
    s.time += dt;
    let hard = false;
    const car = s.car;
    const floor = map.floors[s.floorIndex];
    s.drift = stepCar(car, input, dt);
    audio.update(car, s.drift, input.throttle, cfg.car);
    const want = s.scoring.combo ? Math.min(1, s.scoring.combo.multiplier / 8) : 0.15;
    if (Math.abs(want - intensity) > 0.02) audio.setIntensity((intensity = want));
    const near = (x: number, y: number, r: number) =>
      (x - car.pos.x) ** 2 + (y - car.pos.y) ** 2 <= (r + NEAR_RANGE) ** 2;
    const solids = floor.solids.filter((o) =>
      near(o.x + o.w / 2, o.y + o.h / 2, Math.hypot(o.w, o.h) / 2),
    );
    const circles = floor.circles.filter((o) => near(o.x, o.y, o.r));
    const hit = collide(car, solids, circles);
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
    const nearDist = s.drift.drifting ? nearestDistance(car, solids, circles) : Infinity;
    const pushing = Math.max(input.throttle, input.brake) > STUCK_INPUT;
    const touching = hit !== null || nearestDistance(car, solids, circles) < STUCK_NEAR;
    const slow = Math.hypot(car.vel.x, car.vel.y) < STUCK_SPEED;
    s.stuck = pushing && slow && touching && !s.helix ? s.stuck + dt : 0;
    if (s.stuck >= STUCK_TIME) {
      recover();
      return;
    }
    const yawDelta = car.angVel * dt;
    const rampDrift = stepHelix();
    const clip = (s.clip = zoneAt(car.pos, map.floors[s.floorIndex].clipZones));

    handle(
      stepScoring(
        s.scoring,
        { drift: s.drift, yawDelta, nearDist, hit: hard, rampDrift, frozen: false, clip },
        dt,
      ),
    );

    if (s.floorIndex === map.finish.floor && inRect(s.car.pos, map.finish.zone)) finish();
  }

  const toTitle = () => {
    audio.stop();
    audio.music(false);
    Object.assign(s, fresh(), { phase: 'title', runId: s.runId + 1 });
  };
  const cycle = (i: number, d: number, n: number) => (i + d + n) % n;
  const save = () => saveSettings(cfg, storage);
  const go = (phase: Phase, at = 0) => {
    row = at;
    confirmReset = false;
    s.phase = phase;
  };

  function garageInput(input: InputState, dir: number): void {
    const dv = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    if (dir) {
      gCar = MODEL_IDS[cycle(MODEL_IDS.indexOf(gCar), dir, MODEL_IDS.length)];
      gColor = PLAYER_MODELS[gCar].colors[0];
    }
    if (dv) {
      const cs = PLAYER_MODELS[gCar].colors;
      gColor = cs[cycle(Math.max(0, cs.indexOf(gColor)), dv, cs.length)];
    }
    if (input.confirm) {
      Object.assign(cfg, { car: gCar, color: gColor });
      save();
      Object.assign(s, fresh());
      go('title', 1);
    } else if (input.pause) {
      [gCar, gColor] = [cfg.car, cfg.color];
      go('title', 1);
    }
  }

  function settingsInput(input: InputState, dir: number): void {
    const dv = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    if (dv) {
      row = cycle(row, dv, SETTINGS_ROWS);
      confirmReset = false;
    }
    const vol = VOLUMES[row];
    if (vol && dir) {
      cfg[vol] = Math.min(1, Math.max(0, Math.round((cfg[vol] + dir * 0.1) * 10) / 10));
      applyVolumes();
      save();
    } else if (row === 4 && (dir || input.confirm)) {
      cfg.shake = !cfg.shake;
      save();
    } else if (row === 5 && (dir || input.confirm)) {
      audio.setTrack((cfg.track = cfg.track === 'tokyo' ? 'eurobeat' : 'tokyo'));
      save();
    } else if (row === 6 && input.confirm) {
      if (confirmReset) {
        stores.forEach((b, i) => b.set((bests[i] = 0)));
        confirmReset = false;
      } else confirmReset = true;
    } else if ((row === 7 && input.confirm) || input.pause) go('title', 2);
  }

  const medalTag = (n: number) => (n ? ` ${MEDAL_NAMES[n]}` : '');

  function menuView(): MenuView | null {
    const base = { row, items: maps.map((m) => m.name), selected: sel, garage: null };
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    if (s.phase === 'title') {
      const rows: MenuRow[] = [
        { label: 'PLAY', value: `◀ ${map.name} ▶${medalTag(medalFor(bests[sel], map.medals))}` },
        { label: 'GARAGE', value: PLAYER_MODELS[cfg.car].name },
        { label: 'SETTINGS' },
      ];
      return { ...base, screen: 'title', rows };
    }
    if (s.phase === 'settings') {
      const rows: MenuRow[] = [
        ...VOLUMES.map((k) => ({
          label: `${k.toUpperCase()} VOLUME`,
          value: pct(cfg[k]),
          bar: cfg[k],
        })),
        { label: 'CAMERA SHAKE', value: cfg.shake ? 'ON' : 'OFF' },
        { label: 'MUSIC', value: cfg.track.toUpperCase() },
        { label: 'RESET BEST SCORES', value: confirmReset ? 'ENTER TO CONFIRM' : undefined },
        { label: 'BACK' },
      ];
      return { ...base, screen: 'settings', rows };
    }
    if (s.phase === 'garage') {
      const m = PLAYER_MODELS[gCar];
      const n = (k: keyof CarStats) => {
        const [lo, hi] = statRange(k);
        return hi > lo ? (m.stats[k] - lo) / (hi - lo) : 0.5;
      };
      return {
        ...base,
        screen: 'garage',
        rows: [],
        garage: {
          model: gCar,
          name: m.name,
          color: gColor,
          colors: m.colors,
          index: MODEL_IDS.indexOf(gCar),
          count: MODEL_IDS.length,
          stats: { power: n('power'), grip: n('grip'), weight: n('mass') },
        },
      };
    }
    return null;
  }

  return {
    update(input: InputState, dt: number): void {
      s.handbrake = input.handbrake;
      s.brake = input.brake;
      for (const p of s.popups) p.age += dt;
      s.popups = s.popups.filter((p) => p.age <= POPUP_LIFE);
      s.shake = Math.max(0, s.shake - SHAKE_DECAY * dt);

      const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      const inMenu = s.phase === 'title' || s.phase === 'garage' || s.phase === 'settings';
      if (input.restart && !inMenu) {
        newRun();
        return;
      }
      switch (s.phase) {
        case 'title':
          row = cycle(row, (input.down ? 1 : 0) - (input.up ? 1 : 0), TITLE_ROWS);
          if (dir && row === 0) {
            sel = cycle(sel, dir, maps.length);
            map = maps[sel];
            Object.assign(s, fresh(), { runId: s.runId + 1 });
          }
          if (input.confirm) {
            audio.resume();
            if (row === 0) newRun();
            else {
              [gCar, gColor] = [cfg.car, cfg.color];
              go(row === 1 ? 'garage' : 'settings');
            }
          }
          break;
        case 'garage':
          garageInput(input, dir);
          break;
        case 'settings':
          settingsInput(input, dir);
          break;
        case 'countdown':
          if (input.pause) {
            toTitle();
            break;
          }
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
          if (input.confirm) s.phase = 'run';
          else if (input.pause) toTitle();
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
          shake: cfg.shake ? s.shake : 0,
          player: { model: cfg.car, color: cfg.color },
          scrape: s.scrape,
          impact: cfg.shake ? s.shake : 0,
          runId: s.runId,
          clip: drift.drifting ? s.clip : null,
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
          menu: menuView(),
          results: s.phase === 'results' ? s.results : null,
        },
      };
    },

    pause(): void {
      if (s.phase === 'countdown') return toTitle();
      if (s.phase !== 'run') return;
      s.phase = 'paused';
      audio.stop();
    },

    /** test hook: live internal state (car, floorIndex, phase, scoring, ...) */
    debug: s,
  };
}
