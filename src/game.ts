import type {
  CarState,
  Combo,
  Floor,
  DriftInfo,
  GameMap,
  Helix,
  InputState,
  Phase,
  Vec,
  PlayerModel,
  Rect,
  ScoreEvent,
  Trick,
} from './types';
import type { FrameView, MenuRow, MenuView, Popup, RenderView, Results, UiContext } from './view';
import type { createAudio } from './audio';
import { TRACKS, TRACK_LABELS } from './music';
import { COUNTDOWN_SECONDS } from './config';
import { createRecorder, loadGhost, sample, saveGhost, type Ghost } from './ghost';
import { bounce, createCar, stepCar, TUNING } from './car';
import { rampToward } from './input';
import { createAttractDriver } from './attract';
import { engineProfile, engineRpm } from './engine';
import { collide, inRect, nearestDistance } from './collision';
import { garage, garageRoute } from './maps/garage';
import { docks, docksRoute } from './maps/docks';
import { tokyo, tokyoCity, tokyoRoute } from './maps/tokyo';
import { createTraffic, type CityGraph } from './traffic';
import { PLAYER_MODELS, type CarStats } from './models';
import {
  CLIP_QUALITIES,
  loadSettings,
  saveSettings,
  type ClipQuality,
  type SettingsStorage,
  type Tune,
} from './settings';
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
/** MY MUSIC library hooks (browser side, see main.ts). */
export interface MusicHost {
  /** open the file picker; must run inside a user gesture. done gets a short result */
  pick(done: (summary: string) => void): void;
  clear(): Promise<void>;
  /** e.g. '84 / 500 MB' */
  size(): Promise<string>;
}
export interface BestStore {
  get(): number;
  set(v: number): void;
}
/** Video capture of drifts, keyed by combo id. */
export interface ClipRecorder {
  /** run starts: drop old clips, start rolling capture ('off' records nothing) */
  begin(quality: ClipQuality): void;
  /** combo started: pin footage from about a second ago onward */
  mark(id: number): void;
  /** combo banked into the top drifts: finish its clip after a short tail */
  keep(id: number): void;
  /** combo failed or left the top drifts: discard its clip */
  drop(id: number): void;
  pause(on: boolean): void;
  /** run over: stop capture, keep finished clips (tails still complete) */
  stop(): void;
  /** drop everything */
  clear(): void;
  has(id: number): boolean;
  /** download the clip */
  save(id: number, filename: string): void;
}
interface Drift {
  id: number;
  amount: number;
  tricks: Trick[];
  saved: boolean;
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
  [tokyo, tokyoRoute],
]);
/** maps with live traffic */
const CITIES = new Map<GameMap, CityGraph>([[tokyo, tokyoCity]]);
const NEAR_RANGE = 8; // m
const EPS = 1e-6; // absorbs float drift from summing fixed dt
const RESULTS_LOCKOUT = 0.5; // s; gamepad A is also the handbrake
const TOP_DRIFTS = 3;
const MODEL_IDS = Object.keys(PLAYER_MODELS) as PlayerModel[];
const statRange = (k: keyof CarStats) => {
  const v = MODEL_IDS.map((m) => PLAYER_MODELS[m].stats[k]);
  return [Math.min(...v), Math.max(...v)];
};
const VOLUMES = ['master', 'music', 'sfx', 'engine'] as const;
const TITLE_ROWS = 3;
/** settings tabs and their rows (BACK is always the last row; row 0 is the tab strip) */
const TABS = [
  { name: 'AUDIO', ids: ['master', 'music', 'sfx', 'engine', 'track', 'import', 'clear'] },
  { name: 'VIDEO', ids: ['shake', 'clips', 'theme', 'ghost'] },
  { name: 'GAME', ids: ['reset'] },
] as const;
const REDLINE_BELOW_LIMIT = 200; // rpm; profiles only store the limiter (Celica 7200 -> 7000)
const ATTRACT_ROUTE = docksRoute[0].points;
const ATTRACT_END = 10; // m from the route end: loop back to the start
const pick = <T>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];
/** solids near the car: farther ones cannot matter for collide or near-miss */
const nearby = (car: CarState, floor: Floor) => {
  const near = (x: number, y: number, r: number) =>
    (x - car.pos.x) ** 2 + (y - car.pos.y) ** 2 <= (r + NEAR_RANGE) ** 2;
  return {
    solids: floor.solids.filter((o) =>
      near(o.x + o.w / 2, o.y + o.h / 2, Math.hypot(o.w, o.h) / 2),
    ),
    circles: floor.circles.filter((o) => near(o.x, o.y, o.r)),
  };
};
/** HUD gear, derived from forward speed like car.ts's rpm sawtooth (TUNING.gearTops). */
const gearOf = (vf: number): string => {
  if (vf < -0.5) return 'R';
  if (vf < 0.5) return 'N';
  const g = TUNING.gearTops.findIndex((hi) => vf < hi);
  return String(g < 0 ? TUNING.gearTops.length : g + 1);
};
/** Stats with the tune applied. */
export const tunedStats = (m: PlayerModel, tune: Tune): CarStats => {
  const st = PLAYER_MODELS[m].stats;
  // tuning values
  return tune === 'performance' ? { ...st, power: st.power * 1.05, grip: st.grip * 1.03 } : st;
};
const IDLE: DriftInfo = { drifting: false, slip: 0, speedKmh: 0 };

export function createGame(
  maps: GameMap[],
  audio: AudioLike,
  best: (mapName: string) => BestStore,
  storage?: SettingsStorage,
  clips?: ClipRecorder,
  host?: MusicHost,
) {
  const cfg = loadSettings(storage);
  const applyVolumes = () => {
    const { master, music, sfx, engine } = cfg;
    audio.setVolumes({ master, music, sfx, engine });
  };
  applyVolumes();
  audio.setTrack(cfg.track);
  audio.music(true); // menu music; audio.resume() on the first gesture actually starts it
  let row = 0;
  let confirmReset = false;
  let confirmClear = false;
  let note = ''; // transient result in the IMPORT row
  let noteT = 0;
  let usage = '';
  const afterChange = () => {
    void audio.refreshMyMusic();
    if (cfg.track === 'mine') audio.setTrack('mine'); // leave a TOKYO fallback once the library changes
    void host?.size().then((v) => (usage = v));
  };
  let tab = 0;
  let gCar = cfg.car;
  let gColor = cfg.color;
  let gTune = cfg.tune;
  const gCarState = createCar(maps[0].start); // garage engine preview; only rpm is used
  let intensity = 0;
  let sel = 0;
  let map = maps[0];
  const stores = maps.map((m) => best(m.name));
  const bests = stores.map((b) => b.get());
  let comboIds = 0;
  let rec = createRecorder();
  let ghost: Ghost | null = null;
  const ui: Pick<UiContext, 'device' | 'padStyle'> = { device: 'kb', padStyle: 'xbox' };

  /** menu background: an AI car drifting the docks. Silent, own state, never touches the run. */
  let attractLoops = 0;
  const newAttract = () => {
    const model = pick(MODEL_IDS);
    return {
      car: createCar(docks.start, PLAYER_MODELS[model].stats),
      driver: createAttractDriver(ATTRACT_ROUTE),
      player: { model, color: pick(PLAYER_MODELS[model].colors) },
      drift: IDLE,
      handbrake: false,
      brake: 0,
      runId: -++attractLoops, // never equals a real runId, so the renderer resets on every switch
    };
  };
  let attract: ReturnType<typeof newAttract> | null = newAttract();
  function stepAttract(dt: number): void {
    const end = ATTRACT_ROUTE[ATTRACT_ROUTE.length - 1];
    const at = attract?.car.pos;
    if (!attract || !at || Math.hypot(at.x - end.x, at.y - end.y) < ATTRACT_END)
      attract = newAttract(); // the docks route is open: teleport back to the start
    const a = attract;
    const input = a.driver.input(a.car, dt);
    a.drift = stepCar(a.car, input, dt);
    a.handbrake = input.handbrake;
    a.brake = input.brake;
    const { solids, circles } = nearby(a.car, docks.floors[0]);
    const hit = collide(a.car, solids, circles);
    if (hit) bounce(a.car, hit);
  }
  const fresh = () => ({
    car: createCar(map.start, tunedStats(cfg.car, cfg.tune)),
    floorIndex: map.start.floor,
    scoring: createScoring(),
    drift: IDLE,
    time: 0,
    countdown: COUNTDOWN_SECONDS,
    /** live traffic, new seed every run */
    traffic: CITIES.has(map)
      ? createTraffic(CITIES.get(map)!, (Math.random() * 2 ** 32) >>> 0)
      : null,
    popups: [] as Popup[],
    shake: 0,
    scrape: 0,
    /** active helix, unwrapped progress, drifted progress */
    helix: null as Helix | null,
    p: 0,
    drifted: 0,
    results: null as Omit<Results, 'drifts' | 'driftRow'> | null,
    resultsAge: 0,
    stuck: 0,
    clip: null as Rect | null,
    /** live combo with its clip id */
    live: null as { id: number; combo: Combo } | null,
    drifts: [] as Drift[],
    driftRow: 0,
  });
  const s = { phase: 'title' as Phase, runId: 0, handbrake: false, brake: 0, ...fresh() };

  const newRun = () => {
    attract = null;
    audio.stop();
    audio.music(true);
    audio.setIntensity((intensity = 0.15));
    Object.assign(s, fresh(), { phase: 'countdown', runId: s.runId + 1 });
    rec = createRecorder();
    ghost = loadGhost(map.name);
    clips?.begin(cfg.clips);
  };
  const popup = (kind: Popup['kind'], text: string, amount: number) =>
    s.popups.push({ kind, text, amount, age: 0 });

  /** give a newly started combo an id and start its clip */
  function track(): void {
    const c = s.scoring.combo;
    if (!c || s.live?.combo === c) return;
    s.live = { id: ++comboIds, combo: c };
    clips?.mark(s.live.id);
  }

  function bankDrift(amount: number): void {
    const live = s.live;
    s.live = null;
    if (!live) return;
    const list = [...s.drifts, { id: live.id, amount, tricks: live.combo.tricks, saved: false }];
    list.sort((a, b) => b.amount - a.amount);
    for (const d of list.splice(TOP_DRIFTS)) clips?.drop(d.id);
    s.drifts = list;
    if (list.some((d) => d.id === live.id)) clips?.keep(live.id);
  }

  function handle(events: ScoreEvent[], failText = 'BAILED'): void {
    for (const e of events) {
      if (e.type === 'trick') popup('trick', e.trick, 0);
      else if (e.type === 'bank') {
        popup('bank', `+${e.amount}`, e.amount);
        audio.bank();
        bankDrift(e.amount);
      } else {
        popup('fail', failText, e.lost);
        audio.fail();
        if (s.live) clips?.drop(s.live.id);
        s.live = null;
      }
    }
  }

  function saveDrift(): void {
    const d = s.drifts[s.driftRow];
    if (!d || !clips?.has(d.id)) return;
    const slug = map.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    clips.save(d.id, `drifta-${slug}-${d.amount}.webm`);
    d.saved = true;
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
    clips?.stop();
    const comboPoints = s.scoring.banked;
    const bonus = timeBonus(s.time, map.parTime);
    const total = comboPoints + bonus;
    const newBest = total > bests[sel];
    if (newBest) {
      stores[sel].set((bests[sel] = total));
      saveGhost(map.name, { car: cfg.car, look: { color: cfg.color }, frames: rec.frames });
    }
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
    Object.assign(car, { clutchHeld: false, clutchKick: 0 });
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
    track();
    s.time += dt;
    rec.add(s.time, s.car.pos.x, s.car.pos.y, s.car.angle, s.floorIndex);
    let hard = false;
    const car = s.car;
    const floor = map.floors[s.floorIndex];
    s.drift = stepCar(car, input, dt);
    audio.update(car, s.drift, input.throttle, cfg.car, cfg.tune);
    const want = s.scoring.combo ? Math.min(1, s.scoring.combo.multiplier / 8) : 0.15;
    if (Math.abs(want - intensity) > 0.02) audio.setIntensity((intensity = want));
    const { solids, circles } = nearby(car, floor);
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
    const tr = s.traffic;
    if (tr) {
      tr.step(dt, car);
      for (const c of tr.cars) {
        if ((c.pos.x - car.pos.x) ** 2 + (c.pos.y - car.pos.y) ** 2 > 49) continue;
        const box = { kind: 'car' as const, angle: c.heading, w: c.length, h: c.width };
        const th = collide(car, [{ ...box, x: c.pos.x - c.length / 2, y: c.pos.y - c.width / 2 }]);
        if (!th) continue;
        // bounce in the traffic car's frame: it is a moving solid
        const vx = c.speed * Math.cos(c.heading);
        const vy = c.speed * Math.sin(c.heading);
        const impact = -((car.vel.x - vx) * th.normal.x + (car.vel.y - vy) * th.normal.y);
        car.vel.x -= vx;
        car.vel.y -= vy;
        bounce(car, th);
        car.vel.x += vx;
        car.vel.y += vy;
        if (c.hazardsUntil > tr.time) continue; // already hit: just a solid now
        hard = true;
        audio.hit();
        s.shake = Math.max(s.shake, Math.min(1, Math.max(impact, HARD_HIT_SPEED) / 10));
        tr.hit(c.id, tr.time);
      }
    }
    const nearDist = s.drift.drifting ? nearestDistance(car, solids, circles) : Infinity;
    const pushing = Math.max(input.clutch ? 0 : input.throttle, input.brake) > STUCK_INPUT;
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
    track();

    if (s.floorIndex === map.finish.floor && inRect(s.car.pos, map.finish.zone)) finish();
  }

  const toTitle = () => {
    audio.stop();
    audio.music(true);
    audio.setIntensity((intensity = 0.15));
    clips?.clear();
    Object.assign(s, fresh(), { phase: 'title', runId: s.runId + 1 });
  };
  const cycle = (i: number, d: number, n: number) => (i + d + n) % n;
  const save = () => saveSettings(cfg, storage);
  const go = (phase: Phase, at = 0) => {
    row = at;
    confirmReset = confirmClear = false;
    tab = 0;
    if (phase === 'settings') afterChange();
    s.phase = phase;
  };

  function garageInput(input: InputState, dir: number, dt: number): void {
    if (input.tune) gTune = gTune === 'street' ? 'performance' : 'street';
    gCarState.rpm = rampToward(gCarState.rpm, input.rev ? 0.9 : 0, 1.5, 3, dt);
    audio.update(gCarState, IDLE, input.rev ? 1 : 0, gCar, gTune);
    const dv = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    if (dir || dv || input.tune) audio.ui('adjust');
    if (dir) {
      gCar = MODEL_IDS[cycle(MODEL_IDS.indexOf(gCar), dir, MODEL_IDS.length)];
      gColor = PLAYER_MODELS[gCar].colors[0];
    }
    if (dv) {
      const cs = PLAYER_MODELS[gCar].colors;
      gColor = cs[cycle(Math.max(0, cs.indexOf(gColor)), dv, cs.length)];
    }
    if (input.confirm) {
      Object.assign(cfg, { car: gCar, color: gColor, tune: gTune });
      save();
      Object.assign(s, fresh());
      audio.stop();
      audio.ui('confirm');
      go('title', 1);
    } else if (input.pause) {
      [gCar, gColor, gTune] = [cfg.car, cfg.color, cfg.tune];
      audio.stop();
      audio.ui('back');
      go('title', 1);
    }
  }

  function settingsInput(input: InputState, dir: number): void {
    const back = TABS[tab].ids.length + 1;
    const dv = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    if (dv) {
      row = cycle(row, dv, back + 1);
      confirmReset = confirmClear = false;
      audio.ui('move');
    }
    const td = (input.tabNext ? 1 : 0) - (input.tabPrev ? 1 : 0) || (row === 0 ? dir : 0);
    if (td) {
      const was = row === back;
      tab = cycle(tab, td, TABS.length);
      const last = TABS[tab].ids.length + 1;
      row = was ? last : Math.min(row, last - 1);
      confirmReset = confirmClear = false;
      audio.ui('tab');
      return;
    }
    const id = row > 0 && row < back ? TABS[tab].ids[row - 1] : undefined;
    const act = dir || input.confirm;
    if (id && act) audio.ui(dir ? 'adjust' : 'confirm');
    if ((id === 'master' || id === 'music' || id === 'sfx' || id === 'engine') && dir) {
      cfg[id] = Math.min(1, Math.max(0, Math.round((cfg[id] + dir * 0.1) * 10) / 10));
      applyVolumes();
      save();
    } else if (id === 'track' && act) {
      audio.setTrack(
        (cfg.track = TRACKS[cycle(TRACKS.indexOf(cfg.track), dir || 1, TRACKS.length)]),
      );
      save();
    } else if (id === 'import' && input.confirm) {
      // a pad press is no browser user gesture, so the picker would be blocked
      if (ui.device === 'pad' || !host) [note, noteT] = ['PRESS ENTER ON KEYBOARD', 3];
      else
        host.pick((m) => {
          [note, noteT] = [m, 4];
          afterChange();
        });
    } else if (id === 'clear' && input.confirm) {
      if (confirmClear) {
        confirmClear = false;
        void (host?.clear() ?? Promise.resolve()).then(afterChange);
      } else confirmClear = true;
    } else if (id === 'shake' && act) {
      cfg.shake = !cfg.shake;
      save();
    } else if (id === 'ghost' && act) {
      cfg.ghost = !cfg.ghost;
      save();
    } else if (id === 'clips' && act) {
      const n = CLIP_QUALITIES.length;
      cfg.clips = CLIP_QUALITIES[cycle(CLIP_QUALITIES.indexOf(cfg.clips), dir || 1, n)];
      save();
    } else if (id === 'theme' && act) {
      cfg.menuTheme = cfg.menuTheme === 'arcade' ? 'vhs' : 'arcade';
      save();
    } else if (id === 'reset' && input.confirm) {
      if (confirmReset) {
        stores.forEach((b, i) => b.set((bests[i] = 0)));
        confirmReset = false;
      } else confirmReset = true;
    } else if ((row === back && input.confirm) || input.pause) {
      audio.ui('back');
      go('title', 2);
    }
  }

  const medalTag = (n: number) => (n ? ` ${MEDAL_NAMES[n]}` : '');

  function menuView(): MenuView | null {
    const base = {
      ui: { theme: cfg.menuTheme, ...ui },
      row,
      items: maps.map((m) => m.name),
      selected: sel,
      garage: null,
    };
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
      const item = (id: string): MenuRow => {
        switch (id) {
          case 'shake':
            return { label: 'CAMERA SHAKE', value: cfg.shake ? 'ON' : 'OFF' };
          case 'ghost':
            return { label: 'GHOST', value: cfg.ghost ? 'ON' : 'OFF' };
          case 'track':
            return {
              label: 'MUSIC',
              value:
                cfg.track === 'mine'
                  ? `${TRACK_LABELS.mine} (${audio.myMusicCount() || 'EMPTY'})`
                  : TRACK_LABELS[cfg.track],
            };
          case 'import':
            return { label: 'IMPORT MP3', value: (noteT > 0 ? note : usage) || undefined };
          case 'clear':
            return {
              label: 'CLEAR MY MUSIC',
              value: confirmClear ? 'ENTER TO CONFIRM' : undefined,
            };
          case 'clips':
            return { label: 'CLIP QUALITY', value: cfg.clips.toUpperCase() };
          case 'theme':
            return { label: 'MENU THEME', value: cfg.menuTheme.toUpperCase() };
          case 'reset':
            return {
              label: 'RESET BEST SCORES',
              value: confirmReset ? 'ENTER TO CONFIRM' : undefined,
            };
          default: {
            const k = id as (typeof VOLUMES)[number];
            return { label: `${k.toUpperCase()} VOLUME`, value: pct(cfg[k]), bar: cfg[k] };
          }
        }
      };
      const rows: MenuRow[] = [...TABS[tab].ids.map(item), { label: 'BACK' }];
      const tabs = { names: TABS.map((t) => t.name), active: tab };
      return { ...base, screen: 'settings', rows, tabs };
    }
    if (s.phase === 'garage') {
      const m = PLAYER_MODELS[gCar];
      const n = (k: keyof CarStats) => {
        const [lo, hi] = statRange(k);
        const v = tunedStats(gCar, gTune)[k];
        return hi > lo ? Math.min(1, (v - lo) / (hi - lo)) : 0.5;
      };
      return {
        ...base,
        screen: 'garage',
        rows: [],
        garage: {
          model: gCar,
          name: m.name,
          color: gColor,
          tune: gTune,
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
    update(input: InputState & { skip?: boolean }, dt: number): void {
      noteT = Math.max(0, noteT - dt);
      if (input.device) ui.device = input.device;
      if (input.padStyle) ui.padStyle = input.padStyle;
      s.handbrake = input.handbrake;
      s.brake = input.brake;
      for (const p of s.popups) p.age += dt;
      s.popups = s.popups.filter((p) => p.age <= POPUP_LIFE);
      s.shake = Math.max(0, s.shake - SHAKE_DECAY * dt);

      const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      const dv = (input.down ? 1 : 0) - (input.up ? 1 : 0);
      const inMenu = s.phase === 'title' || s.phase === 'garage' || s.phase === 'settings';
      if (input.skip && !inMenu) audio.skipTrack(); // RB is tab-next in menus
      if (input.restart && !inMenu) {
        newRun();
        return;
      }
      if (s.phase === 'title' || s.phase === 'settings') stepAttract(dt);
      switch (s.phase) {
        case 'title':
          if (dv) audio.ui('move');
          row = cycle(row, dv, TITLE_ROWS);
          if (dir && row === 0) {
            audio.ui('adjust');
            sel = cycle(sel, dir, maps.length);
            map = maps[sel];
            Object.assign(s, fresh(), { runId: s.runId + 1 });
          }
          if (input.confirm) {
            audio.resume();
            audio.ui('confirm');
            if (row === 0) newRun();
            else {
              [gCar, gColor, gTune] = [cfg.car, cfg.color, cfg.tune];
              gCarState.rpm = 0;
              go(row === 1 ? 'garage' : 'settings');
            }
          }
          break;
        case 'garage':
          garageInput(input, dir, dt);
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
          s.traffic?.step(dt, s.car);
          if (s.countdown <= EPS) s.phase = 'run';
          break;
        case 'run':
          if (input.pause) {
            s.phase = 'paused';
            audio.stop();
            clips?.pause(true);
          } else run(input, dt);
          break;
        case 'paused':
          if (input.confirm) {
            s.phase = 'run';
            Object.assign(s.car, { clutchHeld: false, clutchKick: 0 }); // no stale kick on resume
            clips?.pause(false);
          } else if (input.pause) toTitle();
          break;
        case 'results': {
          s.resultsAge += dt;
          const ready = s.resultsAge >= RESULTS_LOCKOUT;
          if (input.pause) toTitle();
          else if (input.confirm && ready) newRun();
          else if (input.save) {
            if (ready) saveDrift(); // S also sets down: don't move
          } else if (dv && s.drifts.length) s.driftRow = cycle(s.driftRow, dv, s.drifts.length);
          break;
        }
      }
    },

    view(): FrameView {
      const ghostView = () => {
        const g = cfg.ghost && ghost && sample(ghost, s.time);
        if (!g || !ghost || g.floor !== s.floorIndex) return null;
        const model = Object.hasOwn(PLAYER_MODELS, ghost.car) ? ghost.car : cfg.car;
        const c = ghost.look?.color;
        return { ...g, model, color: typeof c === 'string' ? c : PLAYER_MODELS[model].colors[0] };
      };
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
      const a = s.phase === 'title' || s.phase === 'settings' ? attract : null;
      const prof = engineProfile(cfg.car, cfg.tune); // same mapping as the engine audio
      const render: RenderView = a
        ? {
            map: docks,
            floorIndex: 0,
            car: a.car,
            drift: a.drift,
            handbrake: a.handbrake,
            brake: a.brake,
            fade: 0,
            blend: null,
            shake: 0,
            player: a.player,
            scrape: 0,
            impact: 0,
            runId: a.runId,
            clip: null,
            traffic: null,
          }
        : {
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
            traffic: s.traffic && { sim: s.traffic, city: CITIES.get(map)! },
            ghost: ghostView(),
          };
      return {
        render,
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
          ui: { theme: cfg.menuTheme, ...ui },
          rpm: engineRpm(car.rpm, prof),
          redline: prof.limit - REDLINE_BELOW_LIMIT,
          gear: gearOf(car.vel.x * Math.cos(car.angle) + car.vel.y * Math.sin(car.angle)),
          results:
            s.phase === 'results' && s.results
              ? {
                  ...s.results,
                  drifts: s.drifts.map((d) => ({
                    amount: d.amount,
                    tricks: d.tricks,
                    clip: clips?.has(d.id) ?? false,
                    saved: d.saved,
                  })),
                  driftRow: s.driftRow,
                }
              : null,
        },
      };
    },

    pause(): void {
      if (s.phase === 'countdown') return toTitle();
      if (s.phase !== 'run') return;
      s.phase = 'paused';
      audio.stop();
      clips?.pause(true);
    },

    /** test hook: live internal state (car, floorIndex, phase, scoring, ...) */
    debug: s,
  };
}
