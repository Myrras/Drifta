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
import type {
  FrameView,
  MenuRow,
  MenuView,
  MpHud,
  Popup,
  RenderView,
  Results,
  RivalView,
  UiContext,
} from './view';
import { boomCars, type createAudio } from './audio';
import { TRACKS, TRACK_LABELS } from './music';
import { COUNTDOWN_SECONDS } from './config';
import { createRecorder, loadGhost, sample, saveGhost, type Ghost } from './ghost';
import { getLook, setLook } from './progress';
import type { Look } from './cosmetics';
import {
  currentIndex,
  equip,
  ownedLook,
  SLOT_LABELS,
  SLOTS,
  slotOptions,
  type Slot,
} from './ui/garage';
import { bounce, createCar, stepCar, TUNING } from './car';
import { rampToward } from './input';
import { newPhotoCam, PHOTO_VIEW_H, stepPhoto } from './photo';
import { createAttractDriver } from './attract';
import { engineProfile, engineRpm } from './engine';
import { collide, inRect, nearestDistance } from './collision';
import { garage, garageRoute } from './maps/garage';
import { docks, docksRoute } from './maps/docks';
import { tokyo, tokyoCity, tokyoRoute } from './maps/tokyo';
import { drivethru, drivethruRoute } from './maps/drivethru';
import { mapOption, OPTION_LABEL, withoutPillars } from './maps/options';
import { dailyFor, finishDaily, liveStreak, localDate, type Daily } from './daily';
import { createTraffic, type CityGraph } from './traffic';
import { PLAYER_MODELS, type CarStats } from './models';
import {
  awardFinish,
  chooseStarter,
  defaultProgress,
  isCarUnlocked,
  saveProgress,
  spendCarPick,
  STARTERS,
  type Progress,
} from './progress';
import {
  CLIP_QUALITIES,
  cleanName,
  hasStoredName,
  hazardsOn,
  loadSettings,
  saveSettings,
  type ClipQuality,
  type SettingsStorage,
  type Tune,
} from './settings';
import { comboValue, createScoring, forceBank, stepScoring, timeBonus, zoneAt } from './scoring';
import type { Link, PlayerInfo } from './net/protocol';
import { createSession, type Session } from './net/session';

export type AudioLike = ReturnType<typeof createAudio>;
/** MY MUSIC library hooks (browser side, see main.ts). */
export interface MusicHost {
  /** open the file picker; must run inside a user gesture. done gets a short result */
  pick(done: (summary: string) => void): void;
  clear(): Promise<void>;
  /** e.g. '84 / 500 MB' */
  size(): Promise<string>;
}
/** Multiplayer connect flow (browser side, see main.ts); done(null) = cancelled. */
export interface MpHost {
  open(
    mode: 'host' | 'join',
    done: (r: { link: Link; role: 'host' | 'guest' } | null) => void,
  ): void;
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
  still?(id: number): HTMLCanvasElement | undefined;
  /** download the clip */
  save(id: number, filename: string): void;
}
interface Drift {
  id: number;
  amount: number;
  tricks: Trick[];
  saved: boolean;
  /** banked after the time limit: does not count */
  late: boolean;
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
  [drivethru, drivethruRoute],
]);
/** maps with live traffic */
const CITIES = new Map<GameMap, CityGraph>([[tokyo, tokyoCity]]);
const AWAY = { pos: { x: 1e9, y: 1e9 }, vel: { x: 0, y: 0 } }; // a player peds never dodge
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
type TitleId = 'play' | 'option' | 'daily' | 'mp' | 'garage' | 'settings' | 'username';
type LobbyId = 'map' | 'option' | 'ready' | 'garage' | 'start' | 'leave';
const ORD = ['', '1ST', '2ND', '3RD'];
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
  /** progression store; omitted = progression off (no starter pick, every car unlocked) */
  prog: Progress = { ...defaultProgress(), starterChosen: true, unlocked: [...MODEL_IDS] },
  /** local date, YYYY-MM-DD; injectable for tests */
  today: () => string = localDate,
  mpHost?: MpHost,
) {
  const cfg = loadSettings(storage);
  if (!hasStoredName(storage)) saveSettings(cfg, storage);
  const pStore = storage ?? {
    getItem: (k: string) => localStorage.getItem(k),
    setItem: (k: string, v: string) => localStorage.setItem(k, v),
  };
  const persist = () => saveProgress(prog, pStore);
  // never drive a locked car, e.g. one picked during a cheat session
  if (!isCarUnlocked(prog, cfg.car, false)) {
    cfg.car = prog.unlocked[0] ?? STARTERS[0];
    cfg.color = PLAYER_MODELS[cfg.car].colors[0];
  }
  let starter = 0; // index into STARTERS on the first-launch screen
  let offerPick = false; // garage: confirm again spends a car pick on the locked car
  let toastT = 0;
  let toastMsg = '';
  // multiplayer session; mpWait = s until the synced countdown (< 0: none)
  let mp: Session | null = null;
  let mpMode: 'host' | 'join' = 'host';
  let mpWait = -1;
  let mpHazards = true; // agreed at race start
  let mpOpen = false; // connect overlay is up: title ignores input
  let garageFromMp = false; // garage opened from the lobby: exits back to it
  const inMp = () => mp !== null;
  let mpGone = false; // rival dropped during the race: toast shown once
  let mpToast = '';
  let mpToastT = 0;
  let boomFloor: Floor | null = null; // floor whose boom cars boomList holds
  let boomList: Vec[] = [];
  // daily / legend run in progress; a legend swaps in its car until the title
  let daily: Daily | null = null;
  let dailyDate = '';
  let carBackup: { car: PlayerModel; color: string } | null = null;
  const applyVolumes = () => {
    const { master, music, sfx, engine } = cfg;
    audio.setVolumes({ master, music, sfx, engine });
  };
  applyVolumes();
  audio.setTrack(cfg.track);
  audio.music(true); // menu music; audio.resume() on the first gesture actually starts it
  let row = 0;
  /** lobby rows the cursor was last placed in */
  let lobbyAt: LobbyId[] = [];
  let confirmReset = false;
  let confirmClear = false;
  let note = ''; // transient result in the IMPORT row
  let noteT = 0;
  let usage = '';
  let draft: string | null = null; // username being edited
  let caretT = 0;
  let editEnded = false; // swallows the update that still carries the committing Enter
  const afterChange = () => {
    void audio.refreshMyMusic();
    if (cfg.track === 'mine') audio.setTrack('mine'); // leave a PHONK fallback once the library changes
    void host?.size().then((v) => (usage = v));
  };
  let tab = 0;
  let gCar = cfg.car;
  let gColor = cfg.color;
  let gTune = cfg.tune;
  const gCarState = createCar(maps[0].start); // garage engine preview; only rpm is used
  // customise: look per car lives in progress; the garage edits a draft until ENTER
  let savedLooks = structuredClone(prog.looks);
  let gLook: Look = {};
  let gCur: number[] = []; // option cursor per slot (may rest on a locked option)
  const gOpts = (sl: Slot) => slotOptions(sl, gCar, PLAYER_MODELS[gCar].colors, prog, s.cheat);
  // the explicit cheat arg is for the initial call, which runs before `s` exists
  const lookOf = (car: PlayerModel, cheat = s.cheat): Look =>
    ownedLook(getLook(prog, car) as Look, car, PLAYER_MODELS[car].colors, prog, cheat);
  let raceLook = lookOf(cfg.car, false);
  function gLoad(car: PlayerModel, color?: string): void {
    gCar = car;
    gLook = lookOf(car);
    const cs = PLAYER_MODELS[car].colors;
    gColor = color ?? cs.find((c) => c === (gLook as { color?: string }).color) ?? cs[0];
    gCur = SLOTS.map((s) => currentIndex(s, gOpts(s), gLook, gColor));
  }
  // store the look as chosen; ownership is applied on use (lookOf), so cheat picks reappear once owned
  const gDraft = () =>
    setLook(prog, gCar, { ...gLook, color: gColor } as Parameters<typeof setLook>[2]);
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
  /** the map's option (traffic / pillars) for this run: MP uses the host's choice */
  const hazards = () => !mapOption(map) || (mp ? mpHazards : hazardsOn(cfg, map.name));
  /** geometry the run drives on; `map` stays the identity for bests, routes, cities */
  const geo = () => (mapOption(map) === 'pillars' && !hazards() ? withoutPillars(map) : map);
  const titleIds = (): TitleId[] => [
    'play',
    ...(mapOption(map) ? (['option'] as const) : []),
    'daily',
    'mp',
    'garage',
    'settings',
    'username',
  ];
  const titleRow = (id: TitleId) => titleIds().indexOf(id);
  const fresh = () => ({
    car: createCar(map.start, tunedStats(cfg.car, cfg.tune)),
    floorIndex: map.start.floor,
    scoring: createScoring(),
    drift: IDLE,
    time: 0,
    countdown: COUNTDOWN_SECONDS,
    /** live traffic, new seed every run */
    traffic: CITIES.has(map)
      ? createTraffic(CITIES.get(map)!, (Math.random() * 2 ** 32) >>> 0, { cars: hazards() })
      : null,
    popups: [] as Popup[],
    shake: 0,
    scrape: 0,
    /** active helix, unwrapped progress, drifted progress */
    helix: null as Helix | null,
    p: 0,
    drifted: 0,
    wallHits: 0,
    results: null as Omit<Results, 'drifts' | 'driftRow' | 'carPick' | 'chooser'> | null,
    /** progress loaded at finish (null: no storage), pending car pick, open chooser */
    prog: null as Progress | null,
    carPick: false,
    chooser: null as { cars: PlayerModel[]; row: number } | null,
    resultsAge: 0,
    stuck: 0,
    clip: null as Rect | null,
    /** live combo with its clip id */
    live: null as { id: number; combo: Combo } | null,
    drifts: [] as Drift[],
    driftRow: 0,
    /** banked score at the time limit, null while time is left; later banks do not count */
    locked: null as number | null,
  });
  const s = {
    phase: (prog.starterChosen ? 'title' : 'starter') as Phase,
    runId: 0,
    handbrake: false,
    brake: 0,
    /** Konami cheat: every car and cosmetic usable this session; never saved */
    cheat: false,
    ...fresh(),
  };

  // photo mode: frozen car, free camera. Enter from run or paused; leave back to the same one.
  let photoCam = newPhotoCam();
  let photoFrom: 'run' | 'paused' = 'run';
  let shot = false; // a save was requested; main.ts takes it after drawing the HUD-less frame
  const enterPhoto = () => {
    photoFrom = s.phase === 'paused' ? 'paused' : 'run';
    photoCam = newPhotoCam();
    if (s.phase === 'run') {
      audio.stop();
      clips?.pause(true);
    }
    s.phase = 'photo';
  };
  const leavePhoto = () => {
    s.phase = photoFrom;
    if (photoFrom === 'run') {
      Object.assign(s.car, { clutchHeld: false, clutchKick: 0 });
      clips?.pause(false);
    }
  };

  const newRun = () => {
    attract = null;
    audio.stop();
    audio.music(true);
    audio.setIntensity((intensity = 0.15));
    Object.assign(s, fresh(), { phase: 'countdown', runId: s.runId + 1 });
    rec = createRecorder();
    ghost = inMp() ? null : loadGhost(map.name);
    clips?.begin(cfg.clips);
  };
  function startDaily(): void {
    dailyDate = today();
    daily = dailyFor(dailyDate, maps);
    sel = maps.indexOf(daily.map);
    map = daily.map;
    row = titleRow('daily');
    if (daily.car && !carBackup) {
      carBackup = { car: cfg.car, color: cfg.color };
      cfg.car = daily.car;
      cfg.color = PLAYER_MODELS[daily.car].colors[0];
      raceLook = { skin: daily.skin };
    }
    newRun();
  }
  const popup = (kind: Popup['kind'], text: string, amount: number) =>
    s.popups.push({ kind, text, amount, age: 0, late: s.locked !== null });

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
    const list = [
      ...s.drifts,
      { id: live.id, amount, tricks: live.combo.tricks, saved: false, late: s.locked !== null },
    ];
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

  /** par x1.3 (the 3rd-place time) on maps with positions, in MP too */
  const limitOf = () => (map.medals ? map.parTime * 1.3 : 0);

  /** advance the run clock, beep the last 5 s, lock the score at the limit */
  function clock(dt: number, lock = true): void {
    const was = s.time;
    s.time += dt;
    const limit = limitOf();
    if (!limit) return;
    const n = Math.ceil(limit - s.time - 1e-6); // whole seconds left, as in hud
    if (n > 0 && n <= 5 && n < Math.ceil(limit - was - 1e-6) && s.phase !== 'paused')
      audio.ui('count');
    if (lock) lockAtLimit();
  }
  /** `run` locks after scoring, so a combo banking in the frame time runs out still counts */
  function lockAtLimit(): void {
    const limit = limitOf();
    if (limit && s.time >= limit - 1e-6 && s.locked === null) s.locked = s.scoring.banked;
  }

  /** the run goes on past the limit, but only what was banked before it counts */
  function finish(): void {
    handle(forceBank(s.scoring));
    clips?.stop();
    const timeUp = s.locked !== null;
    const comboPoints = s.locked ?? s.scoring.banked;
    const late = s.scoring.banked - comboPoints;
    const bonus = timeBonus(s.time, map.parTime);
    const total = comboPoints + bonus;
    const newBest = total > bests[sel];
    if (newBest) {
      stores[sel].set((bests[sel] = total));
      saveGhost(map.name, {
        car: cfg.car,
        look: { ...raceLook, color: cfg.color },
        frames: rec.frames,
      });
    }
    s.prog = prog;
    const award = awardFinish(prog, map, total, s.time); // no place past par x1.3
    const dr = daily ? finishDaily(prog, daily, dailyDate, total, s.wallHits) : undefined;
    persist();
    s.carPick = award.carPick || !!dr?.carPick;
    s.results = {
      comboPoints,
      timeBonus: bonus,
      total,
      time: s.time,
      best: bests[sel],
      newBest,
      timeUp,
      late,
      medals: map.medals,
      position: award.position,
      newPaints: award.newPaints,
      daily: dr,
    };
    s.phase = 'results';
    audio.stop();
    audio.music(false);
    mp?.finish(total, s.time);
  }

  /** an MP race in progress (or its results) */
  const mpRace = () =>
    mp !== null &&
    (s.phase === 'countdown' || s.phase === 'run' || s.phase === 'paused' || s.phase === 'results');
  function mpSend(): void {
    const { car, scoring } = s;
    mp?.sendPose(s.time, car.pos.x, car.pos.y, car.angle, s.floorIndex);
    const open = s.locked === null ? scoring.combo : null;
    mp?.sendScore(s.locked ?? scoring.banked, open ? comboValue(open) : 0);
  }
  /** MP pause: the clock runs on with the car frozen */
  function mpHold(dt: number): void {
    clock(dt);
    rec.add(s.time, s.car.pos.x, s.car.pos.y, s.car.angle, s.floorIndex);
    mpSend();
  }

  /** put the car on the route (or start) nearest to it, heading along it, clear of solids */
  function recover(): void {
    const car = s.car;
    Object.assign(car, { clutchHeld: false, clutchKick: 0 });
    const floor = geo().floors[s.floorIndex];
    const clear = () => !collide(car, floor.solids, floor.circles);
    const place = (pos: Vec, angle: number) =>
      Object.assign(car, { pos: { ...pos }, angle, vel: { x: 0, y: 0 }, angVel: 0 });
    // a floor may carry several routes (TOKYO NIGHTS): recover onto the nearest
    const routes = (ROUTES.get(map) ?? []).filter((r) => r.floor === s.floorIndex);
    let pts = routes[0]?.points;
    if (pts && pts.length > 1) {
      let best = Infinity;
      let seg = 0;
      let t = 0;
      for (const r of routes)
        for (let i = 0; i < r.points.length - 1; i++) {
          const a = r.points[i];
          const dx = r.points[i + 1].x - a.x;
          const dy = r.points[i + 1].y - a.y;
          const u = Math.max(
            0,
            Math.min(
              1,
              ((car.pos.x - a.x) * dx + (car.pos.y - a.y) * dy) / (dx * dx + dy * dy || 1),
            ),
          );
          const d = Math.hypot(a.x + u * dx - car.pos.x, a.y + u * dy - car.pos.y);
          if (d < best) [best, seg, t, pts] = [d, i, u, r.points];
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
    clock(dt, false);
    rec.add(s.time, s.car.pos.x, s.car.pos.y, s.car.angle, s.floorIndex);
    let hard = false;
    const car = s.car;
    const floor = geo().floors[s.floorIndex];
    s.drift = stepCar(car, input, dt);
    audio.update(car, s.drift, input.throttle, cfg.car, cfg.tune);
    if (floor !== boomFloor) boomList = boomCars((boomFloor = floor).solids);
    if (boomList.length) audio.boom(car.pos, boomList);
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
        if (s.locked === null) s.wallHits++; // after time up the run only drives to the finish
        audio.hit();
        s.shake = Math.min(1, impact / 10);
      } else s.scrape = Math.max(0, Math.min(1, impact / HARD_HIT_SPEED));
    }
    const tr = s.traffic;
    // traffic drives the start floor; up on an elevated deck the car passes over it
    const street = s.floorIndex === map.start.floor;
    if (tr) {
      tr.step(dt, street ? car : AWAY);
      for (const c of street ? tr.cars : []) {
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
      lockAtLimit();
      recover();
      return;
    }
    const yawDelta = car.angVel * dt;
    const rampDrift = stepHelix();
    const here = geo().floors[s.floorIndex];
    const clip = (s.clip = zoneAt(car.pos, here.clipZones));
    const bonusAll = here.bonusZones ?? [];
    const bonus = bonusAll.filter((z) => inRect(car.pos, z));
    const nearPolice = s.drift.drifting
      ? nearestDistance(
          car,
          solids.filter((o) => o.police),
        )
      : Infinity;

    handle(
      stepScoring(
        s.scoring,
        {
          drift: s.drift,
          yawDelta,
          nearDist,
          hit: hard,
          rampDrift,
          frozen: false,
          clip,
          bonus,
          bonusAll,
          nearPolice,
        },
        dt,
      ),
    );
    lockAtLimit();
    track();

    if (s.floorIndex === map.finish.floor && inRect(s.car.pos, map.finish.zone)) finish();
  }

  const toTitle = () => {
    audio.stop();
    audio.music(true);
    audio.setIntensity((intensity = 0.15));
    clips?.clear();
    if (carBackup) {
      cfg.car = carBackup.car;
      cfg.color = carBackup.color;
      carBackup = null;
      raceLook = lookOf(cfg.car);
    }
    daily = null;
    mp?.leave();
    mp = null;
    mpWait = -1;
    garageFromMp = false;
    Object.assign(s, fresh(), { phase: 'title', runId: s.runId + 1 });
  };
  const cycle = (i: number, d: number, n: number) => (i + d + n) % n;
  const save = () => saveSettings(cfg, storage);
  const go = (phase: Phase, at = 0) => {
    row = at;
    lobbyAt = [];
    confirmReset = confirmClear = offerPick = false;
    tab = 0;
    if (phase === 'settings') afterChange();
    s.phase = phase;
  };

  /** back to the title on the MULTIPLAYER row, with an optional toast */
  function exitMp(msg = ''): void {
    if (s.phase === 'garage') prog.looks = structuredClone(savedLooks); // drop the draft
    toTitle();
    go('title', titleRow('mp'));
    if (msg) [toastMsg, toastT] = [msg, 3];
  }
  /** rematch: back to the lobby with a fresh run; the session keeps the map */
  function toLobby(): void {
    audio.stop();
    audio.music(true);
    audio.setIntensity((intensity = 0.15));
    clips?.clear();
    mpWait = -1;
    Object.assign(s, fresh(), { runId: s.runId + 1 });
    go('mplobby');
  }
  const meInfo = (): PlayerInfo => ({
    name: cfg.name,
    car: cfg.car,
    color: cfg.color,
    look: { ...raceLook, color: cfg.color } as Record<string, unknown>,
  });
  function joinMp(r: { link: Link; role: 'host' | 'guest' } | null): void {
    mpOpen = false;
    editEnded = true; // the key that closed the overlay may still be latched
    if (!r) return;
    [mpGone, mpToastT] = [false, 0];
    const m = (mp = createSession(r.link, r.role, meInfo()));
    m.onStart((name, inMs, hz) => {
      if (mp !== m) return;
      const i = maps.findIndex((x) => x.name === name);
      if (i < 0) return exitMp();
      map = maps[(sel = i)];
      mpHazards = hz;
      mpWait = inMs / 1000;
    });
    go('mplobby');
  }
  const lobbyOption = (m: Session) => {
    const x = maps.find((x) => x.name === m.map);
    return x ? mapOption(x) : null;
  };
  const lobbyIds = (m: Session): LobbyId[] =>
    m.phase === 'handshake'
      ? ['leave']
      : [
          'map',
          ...(lobbyOption(m) ? (['option'] as const) : []),
          'ready',
          ...(m.phase === 'lobby' && mpWait < 0 ? (['garage'] as const) : []),
          ...(m.role === 'host' ? (['start'] as const) : []),
          'leave',
        ];
  /** the cursor follows its row id as rows come and go; a vanished row hands over to the next */
  const lobbyRow = (m: Session, ids = lobbyIds(m)) => {
    if (lobbyAt.length > 1) {
      const i = ids.indexOf(lobbyAt[row]);
      if (i >= 0) return i;
      const next = lobbyAt.slice(row + 1).find((id) => ids.includes(id));
      if (next) return ids.indexOf(next);
    }
    return Math.min(row, ids.length - 1);
  };

  function mpLobbyInput(m: Session, input: InputState, dir: number, dv: number, dt: number): void {
    if (mpWait >= 0) {
      if (input.pause) return exitMp();
      mpWait -= dt;
      if (mpWait <= EPS) {
        mpWait = -1;
        newRun();
      }
      return;
    }
    if (m.role === 'host' && m.phase === 'lobby' && m.map === null)
      m.pickMap(maps[0].name, hazardsOn(cfg, maps[0].name));
    const ids = lobbyIds(m);
    row = lobbyRow(m, ids);
    lobbyAt = ids;
    if (dv) {
      row = cycle(row, dv, ids.length);
      audio.ui('move');
    }
    const id = ids[row];
    if (input.pause || (id === 'leave' && input.confirm)) {
      audio.ui('back');
      exitMp();
    } else if (id === 'map' && dir && m.role === 'host') {
      audio.ui('adjust');
      const i = maps.findIndex((x) => x.name === m.map);
      const name = maps[cycle(Math.max(0, i), dir, maps.length)].name;
      m.pickMap(name, hazardsOn(cfg, name));
    } else if (id === 'option' && m.map !== null && (input.confirm || dir) && m.role === 'host') {
      audio.ui(dir ? 'adjust' : 'confirm');
      m.setHazards((cfg.hazards[m.map] = !m.hazards));
      save();
    } else if (id === 'ready' && (input.confirm || dir)) {
      audio.ui('confirm');
      m.setReady(!m.ready);
    } else if (id === 'garage' && input.confirm) {
      audio.ui('confirm');
      if (m.ready) m.setReady(false);
      openGarage();
      garageFromMp = true;
      go('garage');
    } else if (id === 'start' && input.confirm) {
      audio.ui(m.canStart() ? 'confirm' : 'back');
      m.start();
    }
  }

  function openGarage(): void {
    gTune = cfg.tune;
    gLoad(cfg.car, cfg.color);
    gCarState.rpm = 0;
  }
  /** back to where the garage was opened from */
  function leaveGarage(): void {
    if (garageFromMp && mp) go('mplobby', Math.max(0, lobbyIds(mp).indexOf('garage')));
    else go('title', titleRow('garage'));
    garageFromMp = false;
  }
  function garageInput(input: InputState, dir: number, dt: number): void {
    if (input.tune) gTune = gTune === 'street' ? 'performance' : 'street';
    gCarState.rpm = rampToward(gCarState.rpm, input.rev ? 0.9 : 0, 1.5, 3, dt);
    audio.update(gCarState, IDLE, input.rev ? 1 : 0, gCar, gTune);
    const dv = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    if (dv) row = cycle(row, dv, SLOTS.length + 1); // 0 = car, n = SLOTS[n - 1]
    if (dir || dv || input.tune) audio.ui(dv ? 'move' : 'adjust');
    if (dir && row === 0) {
      gDraft();
      gLoad(MODEL_IDS[cycle(MODEL_IDS.indexOf(gCar), dir, MODEL_IDS.length)]);
      offerPick = false;
    } else if (dir) {
      const slot = SLOTS[row - 1];
      const opts = gOpts(slot);
      gCur[row - 1] = cycle(gCur[row - 1], dir, opts.length);
      ({ look: gLook, color: gColor } = equip(slot, opts[gCur[row - 1]], gLook, gColor));
    }
    const locked = !isCarUnlocked(prog, gCar, s.cheat);
    if (locked && input.confirm) {
      if (offerPick && spendCarPick(prog, gCar)) {
        // persist without the open look draft
        const draft = prog.looks;
        prog.looks = savedLooks;
        persist();
        prog.looks = draft;
        offerPick = false;
        audio.ui('confirm');
      } else if (prog.carPicks > 0) {
        offerPick = true;
        audio.ui('move');
      } else audio.ui('back'); // refused
    } else if (offerPick && input.pause) {
      offerPick = false;
      audio.ui('back');
    } else if (input.confirm) {
      Object.assign(cfg, { car: gCar, color: gColor, tune: gTune });
      save();
      gDraft();
      persist();
      savedLooks = structuredClone(prog.looks);
      raceLook = lookOf(cfg.car);
      Object.assign(s, fresh());
      audio.stop();
      audio.ui('confirm');
      if (garageFromMp) mp?.setInfo(meInfo());
      leaveGarage();
    } else if (input.pause) {
      prog.looks = structuredClone(savedLooks); // drop the draft
      gTune = cfg.tune;
      gLoad(cfg.car, cfg.color);
      audio.stop();
      audio.ui('back');
      leaveGarage();
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
      go('title', titleRow('settings'));
    }
  }

  const posTag = (name: string) => {
    const n = prog.results[name]?.position;
    return n ? ` ${ORD[n]}` : '';
  };

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
      const date = today();
      const dl = dailyFor(date, maps);
      const done = prog.daily.lastClear === date;
      const ids = titleIds();
      const noted = (id: TitleId) => ids[row] === id && noteT > 0 && note;
      const opt = mapOption(map);
      const rows = ids.map((id): MenuRow => {
        switch (id) {
          case 'play':
            return { label: 'PLAY', value: `◀ ${map.name} ▶${posTag(map.name)}` };
          case 'option':
            return { label: OPTION_LABEL[opt!], value: hazardsOn(cfg, map.name) ? 'ON' : 'OFF' };
          case 'daily':
            return {
              label: dl.kind === 'legend' ? 'LEGEND' : 'DAILY',
              value: `${dl.map.name} · ${dl.target.toLocaleString('en-US')}`,
            };
          case 'mp':
            return { label: 'MULTIPLAYER', value: noted('mp') || `◀ ${mpMode.toUpperCase()} ▶` };
          case 'garage':
            return { label: 'GARAGE', value: PLAYER_MODELS[cfg.car].name };
          case 'settings':
            return { label: 'SETTINGS' };
          case 'username':
            return {
              label: 'USERNAME',
              value:
                draft !== null
                  ? draft + (caretT % 1 < 0.5 ? '_' : ' ')
                  : noted('username') || cfg.name,
            };
        }
      });
      return {
        ...base,
        screen: 'title',
        rows,
        note: `STREAK ${liveStreak(prog, date)}${done ? ' · CLEARED' : ''}`,
        toast: toastT > 0 ? toastMsg : undefined,
      };
    }
    if (s.phase === 'mplobby' && mp) {
      const m = mp;
      const info = m.rival.info;
      const rows = lobbyIds(m).map((id): MenuRow => {
        if (id === 'map')
          return {
            label: 'MAP',
            value: m.map === null ? '-' : m.role === 'host' ? `◀ ${m.map} ▶` : m.map,
          };
        if (id === 'option')
          return { label: OPTION_LABEL[lobbyOption(m)!], value: m.hazards ? 'ON' : 'OFF' };
        if (id === 'ready') return { label: 'READY', value: m.ready ? 'YES' : 'NO' };
        if (id === 'garage') return { label: 'GARAGE', value: PLAYER_MODELS[cfg.car].name };
        return { label: id.toUpperCase() };
      });
      const i = maps.findIndex((x) => x.name === m.map);
      return {
        ...base,
        screen: 'mplobby',
        row: lobbyRow(m),
        rows,
        selected: i < 0 ? sel : i,
        note: mpWait >= 0 ? 'GET READY' : info ? PLAYER_MODELS[info.car].name : 'CONNECTING...',
        mp: info
          ? { role: m.role, rival: info.name, ready: m.ready, rivalReady: m.rival.ready }
          : undefined,
      };
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
    if (s.phase === 'garage' || s.phase === 'starter') {
      const first = s.phase === 'starter';
      const car = first ? STARTERS[starter] : gCar;
      const ids = first ? STARTERS : MODEL_IDS;
      const m = PLAYER_MODELS[car];
      const n = (k: keyof CarStats) => {
        const [lo, hi] = statRange(k);
        const v = tunedStats(car, first ? 'street' : gTune)[k];
        return hi > lo ? Math.min(1, (v - lo) / (hi - lo)) : 0.5;
      };
      return {
        ...base,
        screen: first ? 'starter' : 'garage',
        rows: [],
        garage: {
          model: car,
          name: m.name,
          color: first ? m.colors[0] : gColor,
          tune: first ? 'street' : gTune,
          look: first ? {} : gLook,
          // the starter pick has no customise rows
          slots: first
            ? []
            : SLOTS.map((sl, i) => {
                const o = gOpts(sl)[gCur[i]];
                return { label: SLOT_LABELS[sl], name: o.name, color: o.color, locked: !!o.lock };
              }),
          slotLock: (!first && row > 0 && gOpts(SLOTS[row - 1])[gCur[row - 1]].lock) || '',
          colors: m.colors,
          index: ids.indexOf(car),
          count: ids.length,
          stats: { power: n('power'), grip: n('grip'), weight: n('mass') },
          lock:
            first || isCarUnlocked(prog, car, s.cheat)
              ? null
              : { offer: offerPick, picks: prog.carPicks },
        },
      };
    }
    return null;
  }

  return {
    update(input: InputState & { skip?: boolean }, dt: number): void {
      const swallow = editEnded;
      editEnded = false;
      caretT += dt;
      noteT = Math.max(0, noteT - dt);
      toastT = Math.max(0, toastT - dt);
      mpToastT = Math.max(0, mpToastT - dt);
      if (input.device) ui.device = input.device;
      if (input.padStyle) ui.padStyle = input.padStyle;
      s.handbrake = input.handbrake;
      s.brake = input.brake;
      for (const p of s.popups) p.age += dt;
      s.popups = s.popups.filter((p) => p.age <= POPUP_LIFE);
      s.shake = Math.max(0, s.shake - SHAKE_DECAY * dt);

      const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      const dv = (input.down ? 1 : 0) - (input.up ? 1 : 0);
      const inMenu =
        s.phase === 'title' ||
        s.phase === 'garage' ||
        s.phase === 'settings' ||
        s.phase === 'starter' ||
        s.phase === 'mplobby';
      if (input.skip && !inMenu) audio.skipTrack(); // RB is tab-next in menus
      if (input.restart && !inMenu && s.phase !== 'photo' && !inMp()) {
        newRun();
        return;
      }
      if (mp) {
        mp.tick();
        const name = mp.rival.info?.name ?? 'RIVAL';
        if (
          mp.phase === 'closed' &&
          (s.phase === 'mplobby' || (s.phase === 'garage' && garageFromMp))
        )
          exitMp(mp.error === 'version' ? 'VERSION MISMATCH - REFRESH' : `${name} LEFT`);
        else if (mp.phase === 'closed' && mpRace() && !mpGone) {
          mpGone = true;
          [mpToast, mpToastT] = [`${name} DISCONNECTED`, 3];
        } else if (mp.phase === 'lobby' && mpRace()) toLobby(); // host chose rematch
      }
      if (s.phase === 'title' || s.phase === 'settings' || s.phase === 'mplobby') stepAttract(dt);
      switch (s.phase) {
        case 'starter':
          if (dir) {
            audio.ui('adjust');
            starter = cycle(starter, dir, STARTERS.length);
          }
          if (input.confirm) {
            audio.resume();
            audio.ui('confirm');
            chooseStarter(prog, STARTERS[starter]);
            persist();
            cfg.car = STARTERS[starter];
            cfg.color = PLAYER_MODELS[cfg.car].colors[0];
            save();
            Object.assign(s, fresh());
            go('title');
          }
          break;
        case 'title': {
          if (draft !== null || swallow || mpOpen) break;
          if (input.cheat) {
            // pad Konami code; its final A must not also pick the row
            s.cheat = true;
            [toastMsg, toastT] = ['ALL CARS UNLOCKED', 2.5];
            audio.ui('confirm');
            break;
          }
          const ids = titleIds();
          if (dv) audio.ui('move');
          row = cycle(Math.min(row, ids.length - 1), dv, ids.length);
          const id = ids[row];
          if (id === 'option' && (dir || input.confirm)) {
            audio.ui(dir ? 'adjust' : 'confirm');
            cfg.hazards[map.name] = !hazardsOn(cfg, map.name);
            save();
            break;
          }
          if (dir && id === 'play') {
            audio.ui('adjust');
            sel = cycle(sel, dir, maps.length);
            map = maps[sel];
            Object.assign(s, fresh(), { runId: s.runId + 1 });
          } else if (dir && id === 'mp') {
            audio.ui('adjust');
            mpMode = mpMode === 'host' ? 'join' : 'host';
          }
          if (input.confirm) {
            audio.resume();
            audio.ui('confirm');
            if (id === 'play') newRun();
            else if (id === 'daily') startDaily();
            else if (id === 'mp') {
              if (ui.device === 'pad' || !mpHost) [note, noteT] = ['USE KEYBOARD + MOUSE', 3];
              else {
                mpOpen = true;
                mpHost.open(mpMode, joinMp);
              }
            } else if (id === 'username') {
              if (ui.device === 'pad') [note, noteT] = ['PRESS ENTER ON KEYBOARD', 3];
              else [draft, caretT, noteT] = [cfg.name, 0, 0];
            } else {
              openGarage();
              go(id === 'garage' ? 'garage' : 'settings');
            }
          }
          break;
        }
        case 'mplobby':
          if (mp) mpLobbyInput(mp, input, dir, dv, dt);
          else go('title', titleRow('mp'));
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
          {
            const was = s.countdown;
            s.countdown -= dt;
            const n = Math.ceil(s.countdown - 1e-6); // displayed number, as in hud
            if (was === COUNTDOWN_SECONDS) audio.ui('count');
            if (n < Math.ceil(was - 1e-6)) audio.ui(n > 0 && s.countdown > EPS ? 'count' : 'go');
          }
          s.traffic?.step(dt, s.car);
          if (s.countdown <= EPS) s.phase = 'run';
          break;
        case 'run':
          if (input.photo && !inMp()) enterPhoto();
          else if (input.pause) {
            s.phase = 'paused';
            audio.stop();
            clips?.pause(true);
            if (inMp()) mpHold(dt);
          } else {
            run(input, dt);
            if (inMp()) mpSend();
          }
          break;
        case 'photo':
          if (input.pause) leavePhoto();
          else if (input.confirm) shot = true;
          else photoCam = stepPhoto(photoCam, input, dt, PHOTO_VIEW_H);
          break;
        case 'paused':
          if (inMp()) mpHold(dt);
          if (input.photo && !inMp()) enterPhoto();
          else if (input.confirm) {
            s.phase = 'run';
            Object.assign(s.car, { clutchHeld: false, clutchKick: 0 }); // no stale kick on resume
            clips?.pause(false);
          } else if (input.pause) {
            if (inMp()) exitMp();
            else toTitle();
          }
          break;
        case 'results': {
          s.resultsAge += dt;
          const ready = s.resultsAge >= RESULTS_LOCKOUT;
          const ch = s.chooser;
          if (ch) {
            // car pick overlay: LATER or ESC / B keep the pick for the garage
            if (dir) ch.row = cycle(ch.row, dir, ch.cars.length + 1);
            if (input.confirm || input.pause) {
              const car = input.confirm ? ch.cars[ch.row] : undefined;
              if (car && s.prog && spendCarPick(s.prog, car)) persist();
              s.chooser = null;
              s.carPick = false;
            }
          } else if (input.pause) {
            if (mp) exitMp();
            else toTitle();
          } else if (input.confirm && ready && s.carPick && s.prog && !s.cheat) {
            const p = s.prog;
            const cars = MODEL_IDS.filter((m) => !isCarUnlocked(p, m, s.cheat));
            if (cars.length) s.chooser = { cars, row: 0 };
            else s.carPick = false; // everything owned: the pick stays banked
            // cheat on: no chooser (everything reads unlocked), the pick is kept; confirm retries
          } else if (input.confirm && ready && mp) {
            // host: rematch; guest waits for the host; rival gone: leave
            if (mp.phase === 'closed') exitMp();
            else if (mp.role === 'host') {
              audio.ui('confirm');
              mp.backToLobby();
              toLobby();
            }
          } else if (input.confirm && ready) newRun();
          else if (input.save) {
            if (ready) saveDrift();
          } else if (dir && s.drifts.length) s.driftRow = cycle(s.driftRow, dir, s.drifts.length);
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
        const color = typeof c === 'string' ? c : PLAYER_MODELS[model].colors[0];
        return { ...g, model, color, look: ghost.look as Look | undefined };
      };
      const m = mpRace() ? mp : null;
      const rivalsView = (): RivalView[] => {
        const info = m?.rival.info;
        const p = m?.rivalPose(s.time);
        if (!m || !info || !p || !m.rival.connected || p.floor !== s.floorIndex) return [];
        const model = Object.hasOwn(PLAYER_MODELS, info.car) ? info.car : cfg.car;
        const look = info.look as Look | undefined;
        return [
          { x: p.x, y: p.y, angle: p.angle, model, color: info.color, look, name: info.name },
        ];
      };
      const mpHud = (): MpHud | undefined => {
        if (!m) return undefined;
        const r = m.rival;
        return {
          rival: r.info?.name ?? 'RIVAL',
          rivalScore: r.total ?? r.banked + r.combo,
          rivalTotal: r.total,
          connected: r.connected,
          waiting: s.phase === 'results' && r.total === null && r.connected,
          toast: mpToastT > 0 ? mpToast : undefined,
          role: m.role,
        };
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
      const a =
        s.phase === 'title' || s.phase === 'settings' || s.phase === 'mplobby' ? attract : null;
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
            map: geo(),
            floorIndex: s.floorIndex,
            car,
            drift,
            handbrake: s.handbrake,
            brake: s.brake,
            fade: 0,
            blend,
            shake: cfg.shake ? s.shake : 0,
            player: { model: cfg.car, color: cfg.color, look: raceLook },
            scrape: s.scrape,
            impact: cfg.shake ? s.shake : 0,
            runId: s.runId,
            boomPhase: audio.boomPhase(),
            shakeOn: cfg.shake && s.phase === 'run', // boom shake only while driving
            clip: drift.drifting ? s.clip : null,
            traffic: s.traffic && { sim: s.traffic, city: CITIES.get(map)! },
            ghost: ghostView(),
            rivals: m ? rivalsView() : undefined,
            photo:
              s.phase === 'photo'
                ? {
                    x: car.pos.x + photoCam.x,
                    y: car.pos.y + photoCam.y,
                    zoom: photoCam.zoom,
                    rot: photoCam.rot,
                  }
                : undefined,
          };
      return {
        render,
        hud: {
          phase: s.phase,
          time: s.time,
          par: map.parTime,
          limit: limitOf(),
          floorName: map.floors[s.floorIndex].name,
          score: s.locked ?? scoring.banked,
          late: s.locked === null ? 0 : scoring.banked - s.locked,
          timeUp: s.locked !== null,
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
          photoShot: shot,
          gear: gearOf(car.vel.x * Math.cos(car.angle) + car.vel.y * Math.sin(car.angle)),
          mp: mpHud(),
          results:
            s.phase === 'results' && s.results
              ? {
                  ...s.results,
                  drifts: s.drifts.map((d) => ({
                    amount: d.amount,
                    tricks: d.tricks,
                    clip: clips?.has(d.id) ?? false,
                    saved: d.saved,
                    late: d.late,
                    still: clips?.still?.(d.id),
                  })),
                  driftRow: s.driftRow,
                  carPick: s.carPick && !s.cheat, // cheat skips the chooser: no hint or toast
                  chooser: s.chooser && {
                    cars: s.chooser.cars.map((m) => {
                      const look = lookOf(m);
                      return {
                        model: m,
                        name: PLAYER_MODELS[m].name,
                        color: (look as { color?: string }).color ?? PLAYER_MODELS[m].colors[0],
                        look,
                      };
                    }),
                    row: s.chooser.row,
                  },
                  rival: m
                    ? {
                        name: m.rival.info?.name ?? 'RIVAL',
                        total: m.rival.total,
                        time: m.rival.time,
                      }
                    : undefined,
                }
              : null,
        },
      };
    },

    /** true once per save request; the caller then saves the HUD-less frame (see main.ts) */
    takeShot(): boolean {
      const r = shot;
      shot = false;
      return r;
    },

    /** current map name, for the photo file name */
    mapName: () => map.name,

    playerName: () => cfg.name,

    /** username edit mode: main.ts routes raw keys to typeKey while true */
    editing: () => draft !== null,

    /** KeyboardEvent.key while editing */
    typeKey(key: string): void {
      if (draft === null) return;
      if (key === 'Enter') {
        if (draft) cfg.name = draft;
        save();
        [draft, editEnded] = [null, true];
        audio.ui('confirm');
      } else if (key === 'Escape') {
        [draft, editEnded] = [null, true];
        audio.ui('back');
      } else if (key === 'Backspace') draft = draft.slice(0, -1);
      else if (key.length === 1 && cleanName(key).length === 1 && draft.length < 12)
        draft += cleanName(key);
    },

    pause(): void {
      if (s.phase === 'countdown' && !inMp()) return toTitle();
      if (s.phase !== 'run') return;
      s.phase = 'paused';
      audio.stop();
      clips?.pause(true);
    },

    /** test hook: live internal state (car, floorIndex, phase, scoring, ...) */
    debug: s,
  };
}
