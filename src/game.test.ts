import { describe, expect, it, vi } from 'vitest';
import {
  createGame,
  type AudioLike,
  type BestStore,
  type ClipRecorder,
  type MusicHost,
} from './game';
import { garage, garageRoute } from './maps/garage';
import { CAR_LENGTH, collide } from './collision';
import { testpad } from './maps/testpad';
import { COUNTDOWN_SECONDS, DT } from './config';
import type { GameMap, InputState } from './types';
import { PLAYER_MODELS } from './models';
import { SETTINGS_KEY } from './settings';
import { settingsLayout } from './ui/menu';
import { docks, docksRoute } from './maps/docks';
import { tokyo } from './maps/tokyo';
import { ENGINE_PROFILES } from './engine';

const noop = () => {};
const audio: AudioLike = {
  resume: noop,
  update: noop,
  hit: noop,
  bank: noop,
  fail: noop,
  stop: noop,
  music: noop,
  setIntensity: noop,
  setVolumes: noop,
  setTrack: noop,
  stream: () => null,
  skipTrack: () => {},
  myMusicCount: () => 0,
  refreshMyMusic: async () => 0,
};
const IDLE: InputState = {
  steer: 0,
  throttle: 0,
  brake: 0,
  handbrake: false,
  pause: false,
  restart: false,
  confirm: false,
  left: false,
  right: false,
  up: false,
  down: false,
};

function memBest(v = 0): BestStore {
  return { get: () => v, set: (n) => (v = n) };
}

function setup(best = memBest()) {
  const game = createGame([garage], audio, () => best);
  const step = (input: Partial<InputState> = {}, frames = 1) => {
    for (let i = 0; i < frames; i++) game.update({ ...IDLE, ...input }, DT);
  };
  const toRun = () => {
    step({ confirm: true });
    step({}, Math.round(COUNTDOWN_SECONDS / DT));
  };
  return { game, step, toRun, best };
}

const startCombo = (g: ReturnType<typeof createGame>) => {
  g.debug.scoring.combo = { points: 500, multiplier: 2, tricks: ['DRIFT'], grace: 1.5 };
};

describe('game', () => {
  it('goes title -> countdown -> run', () => {
    const { game, step } = setup();
    expect(game.view().hud.phase).toBe('title');
    step({ confirm: true });
    expect(game.view().hud.phase).toBe('countdown');
    expect(game.view().hud.countdown).toBeCloseTo(COUNTDOWN_SECONDS);
    step({}, Math.round(COUNTDOWN_SECONDS / DT));
    expect(game.view().hud.phase).toBe('run');
  });

  it('keeps the car frozen during countdown', () => {
    const { game, step } = setup();
    step({ confirm: true });
    step({ throttle: 1 }, 60);
    expect(game.view().hud.phase).toBe('countdown');
    expect(game.debug.car.pos).toEqual(garage.start.pos);
  });

  it('has no fade and no blend outside helixes', () => {
    const { game, step, toRun } = setup();
    toRun();
    step({}, 5);
    expect(game.view().render.fade).toBe(0);
    expect(game.view().render.blend).toBeNull();
  });

  it('finishes on the last floor and stores a new best', () => {
    const { game, step, toRun, best } = setup();
    toRun();
    game.debug.floorIndex = garage.finish.floor;
    game.debug.car.pos = { x: garage.finish.zone.x + 1, y: garage.finish.zone.y + 1 };
    step();
    const r = game.view().hud.results!;
    expect(game.view().hud.phase).toBe('results');
    expect(r.total).toBeGreaterThanOrEqual(0);
    expect(r.newBest).toBe(true);
    expect(best.get()).toBe(r.total);
  });

  it('keeps a higher best', () => {
    const { game, step, toRun, best } = setup(memBest(1e9));
    toRun();
    game.debug.floorIndex = garage.finish.floor;
    game.debug.car.pos = { x: garage.finish.zone.x + 1, y: garage.finish.zone.y + 1 };
    step();
    expect(game.view().hud.results!.newBest).toBe(false);
    expect(best.get()).toBe(1e9);
  });

  it('fails the combo on a hard hit', () => {
    const { game, step, toRun } = setup();
    toRun();
    startCombo(game);
    Object.assign(game.debug.car, { pos: { x: 136, y: 12.5 }, angle: 0, vel: { x: 20, y: 0 } });
    step({}, 10);
    expect(game.debug.scoring.combo).toBeNull();
    expect(game.view().hud.popups.some((p) => p.kind === 'fail')).toBe(true);
    expect(game.view().render.shake).toBeGreaterThan(0);
  });

  it('does not fail on a low-speed scrape', () => {
    const { game, step, toRun } = setup();
    toRun();
    startCombo(game);
    Object.assign(game.debug.car, { pos: { x: 136.9, y: 12.5 }, angle: 0, vel: { x: 1, y: 0 } });
    step({}, 30);
    expect(game.debug.car.vel.x).toBeLessThanOrEqual(0); // bounced off the wall
    expect(game.debug.scoring.combo).not.toBeNull();
    expect(game.view().hud.popups.some((p) => p.kind === 'fail')).toBe(false);
  });

  it('pauses and resumes', () => {
    const { game, step, toRun } = setup();
    toRun();
    step({ pause: true });
    expect(game.view().hud.phase).toBe('paused');
    const t = game.view().hud.time;
    step({}, 30);
    expect(game.view().hud.time).toBe(t);
    step({ confirm: true });
    expect(game.view().hud.phase).toBe('run');
    game.pause();
    expect(game.view().hud.phase).toBe('paused');
    step({ confirm: true });
    expect(game.view().hud.phase).toBe('run');
  });

  it('restarts the run', () => {
    const { game, step, toRun } = setup();
    step({ restart: true });
    expect(game.view().hud.phase).toBe('title');
    toRun();
    step({}, 30);
    game.debug.floorIndex = 1;
    game.debug.scoring.banked = 1234;
    const runId = game.view().render.runId;
    step({ restart: true });
    const v = game.view();
    expect(v.hud.phase).toBe('countdown');
    expect(v.hud.time).toBe(0);
    expect(v.render.floorIndex).toBe(0);
    expect(v.hud.score).toBe(0);
    expect(v.render.runId).toBe(runId + 1);
  });

  it('stops audio on restart', () => {
    const stop = vi.fn();
    const game = createGame([garage], { ...audio, stop }, () => memBest());
    const press = (i: Partial<InputState>) => game.update({ ...IDLE, ...i }, DT);
    press({ confirm: true });
    stop.mockClear();
    press({ restart: true });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('reports idle drift while paused', () => {
    const { game, step, toRun } = setup();
    toRun();
    game.debug.drift = { drifting: true, slip: 0.8, speedKmh: 50 };
    step({ pause: true });
    const d = game.view().render.drift;
    expect(d.drifting).toBe(false);
    expect(d.slip).toBe(0);
  });

  it('locks confirm for 0.5 s on results', () => {
    const { game, step, toRun } = setup();
    toRun();
    game.debug.floorIndex = garage.finish.floor;
    game.debug.car.pos = { x: garage.finish.zone.x + 1, y: garage.finish.zone.y + 1 };
    step();
    step({ confirm: true }, 10);
    expect(game.view().hud.phase).toBe('results');
    step({}, Math.ceil(0.5 / DT));
    step({ confirm: true });
    expect(game.view().hud.phase).toBe('countdown');
  });

  it('reads best once', () => {
    const get = vi.fn(() => 0);
    const game = createGame([garage], audio, () => ({ get, set: noop }));
    game.update({ ...IDLE, confirm: true }, DT);
    game.view();
    game.view();
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('top drift clips', () => {
  function rig() {
    const kept = new Set<number>();
    const clips: ClipRecorder = {
      begin: vi.fn(),
      mark: vi.fn((id: number) => void kept.add(id)),
      keep: vi.fn(),
      drop: vi.fn((id: number) => void kept.delete(id)),
      pause: vi.fn(),
      stop: vi.fn(),
      clear: vi.fn(() => kept.clear()),
      has: (id) => kept.has(id),
      save: vi.fn(),
    };
    const game = createGame([garage], audio, () => memBest(), undefined, clips);
    const step = (input: Partial<InputState> = {}, frames = 1) => {
      for (let i = 0; i < frames; i++) game.update({ ...IDLE, ...input }, DT);
    };
    step({ confirm: true });
    step({}, Math.round(COUNTDOWN_SECONDS / DT));
    /** bank a combo worth `points`; returns its clip id */
    const bank = (points: number) => {
      game.debug.scoring.combo = { points, multiplier: 1, tricks: ['DRIFT'], grace: 0.05 };
      step({}, 10);
      expect(game.debug.scoring.combo).toBeNull();
      return vi.mocked(clips.mark).mock.lastCall![0];
    };
    const finish = () => {
      game.debug.floorIndex = garage.finish.floor;
      game.debug.car.pos = { x: garage.finish.zone.x + 1, y: garage.finish.zone.y + 1 };
      step();
    };
    return { game, step, clips, bank, finish };
  }

  it('keeps the three best banked combos and drops the rest', () => {
    const { game, clips, bank, finish } = rig();
    expect(clips.begin).toHaveBeenCalledExactlyOnceWith('medium');
    const [a, b, c, d] = [100, 400, 200, 300].map(bank);
    expect(clips.drop).toHaveBeenCalledWith(a);
    expect(clips.keep).toHaveBeenCalledWith(b);
    expect(clips.keep).toHaveBeenCalledWith(c);
    expect(clips.keep).toHaveBeenCalledWith(d);
    bank(50); // not top 3: dropped right away
    expect(clips.drop).toHaveBeenLastCalledWith(vi.mocked(clips.mark).mock.lastCall![0]);
    finish();
    expect(clips.stop).toHaveBeenCalled();
    const r = game.view().hud.results!;
    expect(r.drifts.map((x) => x.amount)).toEqual([400, 300, 200]);
    expect(r.drifts.every((x) => x.clip && !x.saved)).toBe(true);
  });

  it('drops the clip of a failed combo', () => {
    const { game, step, clips } = rig();
    startCombo(game);
    Object.assign(game.debug.car, { pos: { x: 136, y: 12.5 }, angle: 0, vel: { x: 20, y: 0 } });
    step({}, 10);
    const id = vi.mocked(clips.mark).mock.lastCall![0];
    expect(clips.drop).toHaveBeenCalledWith(id);
    expect(clips.keep).not.toHaveBeenCalled();
  });

  it('selects and saves a drift on results after the lockout', () => {
    const { game, step, clips, bank, finish } = rig();
    bank(300);
    const second = bank(200);
    finish();
    step({ save: true });
    expect(clips.save).not.toHaveBeenCalled();
    step({}, Math.ceil(0.5 / DT));
    step({ down: true });
    expect(game.view().hud.results!.driftRow).toBe(1);
    step({ save: true, down: true }); // S also reports down
    expect(clips.save).toHaveBeenCalledWith(second, 'drifta-b2-meet-200.webm');
    const r = game.view().hud.results!;
    expect(r.driftRow).toBe(1);
    expect(r.drifts.map((x) => x.saved)).toEqual([false, true]);
  });

  it('pauses capture with the game and clears it on quit', () => {
    const { step, clips } = rig();
    step({ pause: true });
    expect(clips.pause).toHaveBeenLastCalledWith(true);
    step({ confirm: true });
    expect(clips.pause).toHaveBeenLastCalledWith(false);
    step({ pause: true });
    step({ pause: true });
    expect(clips.clear).toHaveBeenCalled();
  });
});

describe('helix', () => {
  const C = { x: 50, y: 50 };
  const floor = (name: string) => ({
    name,
    w: 100,
    h: 100,
    solids: [],
    bays: [],
    lights: [],
    circles: [],
  });
  const map: GameMap = {
    name: 'test',
    parTime: 60,
    floors: [floor('F0'), floor('F1')],
    helixes: [{ from: 0, center: C, rCore: 3, rOuter: 8, enterAngle: 0, sweep: Math.PI }],
    start: { floor: 0, pos: { x: 10, y: 10 }, angle: 0 },
    finish: { floor: 1, zone: { x: 90, y: 90, w: 5, h: 5 } },
  };

  function rig(floorIndex = 0) {
    const game = createGame([map], audio, () => memBest());
    const step = (input: Partial<InputState> = {}, n = 1) => {
      for (let i = 0; i < n; i++) game.update({ ...IDLE, ...input }, DT);
    };
    step({ confirm: true });
    step({}, Math.round(COUNTDOWN_SECONDS / DT));
    game.debug.floorIndex = floorIndex;
    // teleport onto the ring at progress p, heading along (dir 1) or against (-1) travel
    const at = (p: number, dir = 1, r = 5.5) => {
      const a = p * Math.PI;
      Object.assign(game.debug.car, {
        pos: { x: C.x + r * Math.cos(a), y: C.y + r * Math.sin(a) },
        angle: a + (dir * Math.PI) / 2,
        vel: { x: 0, y: 0 },
        angVel: 0,
      });
      step({}, 2);
    };
    return { game, at, step };
  }

  it('switches floors going down at p = 0.5 and blends', () => {
    const { game, at } = rig();
    at(0.05);
    expect(game.debug.floorIndex).toBe(0);
    expect(game.view().render.blend!.toFloor).toBe(1);
    for (const p of [0.1, 0.2, 0.3, 0.4, 0.45]) at(p);
    expect(game.debug.floorIndex).toBe(0);
    at(0.5);
    expect(game.debug.floorIndex).toBe(1);
    expect(game.view().render.blend).toEqual({ toFloor: 0, t: expect.closeTo(0.5, 5) });
    for (const p of [0.7, 0.9, 1]) at(p);
    expect(game.debug.floorIndex).toBe(1);
    at(1, 1, 20);
    expect(game.debug.floorIndex).toBe(1);
    expect(game.view().render.blend).toBeNull();
    expect(game.view().render.fade).toBe(0);
  });

  it('switches back going up', () => {
    const { game, at } = rig(1);
    for (const p of [0.95, 0.8, 0.6]) at(p, -1);
    expect(game.debug.floorIndex).toBe(1);
    for (const p of [0.45, 0.2, 0]) at(p, -1);
    expect(game.debug.floorIndex).toBe(0);
  });

  it('does not enter the helix mid-way', () => {
    const { game, at } = rig();
    at(0.6);
    expect(game.debug.helix).toBeNull();
    expect(game.debug.floorIndex).toBe(0);
    expect(game.view().render.blend).toBeNull();
  });

  const complete = (drifted: number) => {
    const r = rig();
    r.at(0.05);
    startCombo(r.game);
    r.game.debug.drifted = drifted;
    for (const p of [0.3, 0.6, 0.9, 1.1]) r.at(p);
    return r.game.view().hud.popups.some((p) => p.text === 'RAMP DRIFT');
  };

  it('awards RAMP DRIFT only when drifted >= 60%', () => {
    expect(complete(0.7)).toBe(true);
    expect(complete(0.3)).toBe(false);
  });
});

describe('helix wall bounce (garage)', () => {
  const h = garage.helixes[0];
  const mid = (h.rCore + h.rOuter) / 2;
  for (const bounceP of [0.3, 0.7]) {
    for (const wall of [h.rOuter - 0.8, h.rCore + 0.8]) {
      it(`stays in the helix after a bounce at p=${bounceP}, r=${wall}`, () => {
        const { game, step, toRun } = setup();
        toRun();
        const car = game.debug.car;
        const at = (p: number, r: number, speed = 0) => {
          const a = h.enterAngle + h.sweep * p;
          Object.assign(car, {
            pos: { x: h.center.x + r * Math.cos(a), y: h.center.y + r * Math.sin(a) },
            angle: a + (Math.sign(h.sweep) * Math.PI) / 2,
            vel: { x: Math.cos(a) * speed, y: Math.sin(a) * speed },
            angVel: 0,
          });
        };
        game.debug.floorIndex = 0;
        at(0.05, mid);
        step({}, 2);
        at(bounceP, mid);
        step({}, 2);
        at(bounceP, wall, wall > mid ? 10 : -10);
        for (let i = 0; i < 30; i++) {
          step({});
          expect(game.view().render.blend).not.toBeNull();
        }
        for (const p of [0.45, 0.55, 0.8, 1]) {
          at(p, mid);
          step({}, 2);
          expect(game.view().render.blend).not.toBeNull();
          expect(game.debug.floorIndex).toBe(p >= 0.5 ? 1 : 0);
        }
        at(1.2, mid);
        step({}, 2);
        expect(game.view().render.blend).toBeNull();
        expect(game.debug.floorIndex).toBe(1);
      });
    }
  }
});

describe('menu', () => {
  const rig = (stores: Record<string, BestStore> = {}) => {
    const game = createGame([garage, testpad], audio, (n) => (stores[n] ??= memBest()));
    const step = (input: Partial<InputState> = {}, n = 1) => {
      for (let i = 0; i < n; i++) game.update({ ...IDLE, ...input }, DT);
    };
    const tap = (dir: number) => {
      step(dir > 0 ? { right: true } : { left: true });
      step();
    };
    return { game, step, tap };
  };

  it('cycles with wrap and starts the selected map', () => {
    const { game, tap, step } = rig();
    expect(game.view().hud.menu).toMatchObject({
      items: [garage.name, testpad.name],
      selected: 0,
      screen: 'title',
    });
    tap(1);
    expect(game.view().hud.menu?.selected).toBe(1);
    tap(1);
    expect(game.view().hud.menu?.selected).toBe(0);
    tap(-1);
    expect(game.view().hud.menu?.selected).toBe(1);
    step({ confirm: true });
    const v = game.view();
    expect(v.hud.menu).toBeNull();
    expect(v.render.map).toBe(testpad);
    expect(game.debug.car.pos).toEqual(testpad.start.pos);
  });

  it('free roam never finishes', () => {
    const { game, tap, step } = rig();
    tap(1);
    step({ confirm: true });
    step({}, Math.round(COUNTDOWN_SECONDS / DT));
    step({ throttle: 1, steer: 0.3 }, Math.round(30 / DT));
    expect(game.view().hud.phase).toBe('run');
    step({ restart: true });
    expect(game.view().render.map).toBe(testpad);
  });

  it('clears clutch state on pause resume', () => {
    const { game, step } = rig();
    step({ confirm: true });
    step({}, Math.round(COUNTDOWN_SECONDS / DT));
    step({ throttle: 1, clutch: true }, 60);
    expect(game.debug.car.clutchHeld).toBe(true);
    step({ pause: true });
    step({ confirm: true });
    expect(game.debug.car.clutchHeld).toBe(false);
    expect(game.debug.car.clutchKick).toBe(0);
  });

  it('paused: enter resumes, esc goes to the title', () => {
    const { game, step } = rig();
    step({ confirm: true });
    step({}, Math.round(COUNTDOWN_SECONDS / DT));
    step({ pause: true });
    step({ confirm: true });
    expect(game.view().hud.phase).toBe('run');
    step({ pause: true });
    step({ pause: true });
    expect(game.view().hud.phase).toBe('title');
    expect(game.view().hud.menu).not.toBeNull();
  });

  it('keeps a best per map', () => {
    const stores = { [garage.name]: memBest(5), [testpad.name]: memBest(9) };
    const { game, tap } = rig(stores);
    expect(game.view().hud.best).toBe(5);
    tap(1);
    expect(game.view().hud.best).toBe(9);
  });
});

describe('main menu, garage, settings', () => {
  const rig = (saved?: object, host?: MusicHost) => {
    const mem = new Map<string, string>(saved ? [[SETTINGS_KEY, JSON.stringify(saved)]] : []);
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    const a = {
      ...audio,
      music: vi.fn(),
      setVolumes: vi.fn(),
      setIntensity: vi.fn(),
      setTrack: vi.fn(),
      skipTrack: vi.fn(),
      refreshMyMusic: vi.fn(async () => 0),
      myMusicCount: () => 0,
    };
    const stores = [memBest(50), memBest(70)];
    const game = createGame(
      [garage, testpad],
      a,
      (n) => stores[n === garage.name ? 0 : 1],
      storage,
      undefined,
      host,
    );
    const tap = (input: Partial<InputState> & { skip?: boolean }) => {
      game.update({ ...IDLE, ...input }, DT);
      game.update(IDLE, DT);
    };
    const row = () => game.view().hud.menu!.row;
    return { game, a, tap, row, storage, stores, mem };
  };

  it('up/down wrap, enter opens garage and settings', () => {
    const { game, tap, row } = rig();
    tap({ up: true });
    expect(row()).toBe(2);
    tap({ down: true });
    expect(row()).toBe(0);
    tap({ down: true });
    tap({ confirm: true });
    expect(game.view().hud.phase).toBe('garage');
    tap({ pause: true });
    expect(game.view().hud.phase).toBe('title');
    tap({ down: true });
    tap({ confirm: true });
    expect(game.view().hud.phase).toBe('settings');
  });

  it('left/right only picks the map on the PLAY row', () => {
    const { game, tap } = rig();
    tap({ down: true });
    tap({ right: true });
    expect(game.view().hud.menu?.selected).toBe(0);
  });

  it('garage: cars and paint cycle, enter persists, esc reverts', () => {
    const { game, tap, mem } = rig();
    const g = () => game.view().hud.menu!.garage!;
    tap({ down: true });
    tap({ confirm: true });
    tap({ right: true });
    expect(g().model).toBe('civic');
    expect(g().color).toBe(PLAYER_MODELS.civic.colors[0]);
    tap({ down: true });
    expect(g().color).toBe(PLAYER_MODELS.civic.colors[1]);
    tap({ up: true });
    tap({ up: true });
    expect(g().color).toBe(PLAYER_MODELS.civic.colors.at(-1));
    tap({ pause: true }); // revert
    expect(game.view().hud.menu!.rows[1].value).toBe(PLAYER_MODELS.mx5.name);
    tap({ confirm: true });
    tap({ left: true });
    expect(g().model).toBe('wrx');
    tap({ confirm: true });
    expect(game.view().hud.menu!.rows[1].value).toBe(PLAYER_MODELS.wrx.name);
    expect(JSON.parse(mem.get(SETTINGS_KEY)!)).toMatchObject({
      car: 'wrx',
      color: PLAYER_MODELS.wrx.colors[0],
    });
    expect(game.debug.car.stats).toEqual(PLAYER_MODELS.wrx.stats);
  });

  it('garage: T toggles the tune, enter saves it and applies the stat boost', () => {
    const { game, tap, mem } = rig();
    tap({ down: true });
    tap({ confirm: true });
    tap({ tune: true });
    expect(game.view().hud.menu!.garage!.tune).toBe('performance');
    tap({ confirm: true });
    expect(JSON.parse(mem.get(SETTINGS_KEY)!)).toMatchObject({ tune: 'performance' });
    const base = PLAYER_MODELS.mx5.stats;
    expect(game.debug.car.stats).toEqual({
      ...base,
      power: base.power * 1.05,
      grip: base.grip * 1.03,
    });
  });

  it('garage: rev drives the engine preview and leaving stops it', () => {
    const update = vi.fn();
    const stop = vi.fn();
    const game = createGame([garage], { ...audio, update, stop }, () => memBest());
    const step = (i: Partial<InputState>) => {
      game.update({ ...IDLE, ...i }, DT);
      game.update(IDLE, DT);
    };
    step({ down: true });
    step({ confirm: true });
    update.mockClear();
    game.update({ ...IDLE, rev: true }, 0.5);
    expect(update.mock.calls[0][2]).toBe(1);
    expect(update.mock.calls[0][0].rpm).toBeGreaterThan(0.5);
    expect(update.mock.calls[0][4]).toBe('street');
    stop.mockClear();
    step({ pause: true });
    expect(stop).toHaveBeenCalled();
  });

  it('garage stat bars are normalised 0..1', () => {
    const { game, tap } = rig();
    tap({ down: true });
    tap({ confirm: true });
    for (let i = 0; i < 11; i++) {
      tap({ right: true });
      const s = game.view().hud.menu!.garage!.stats;
      for (const v of Object.values(s)) expect(v >= 0 && v <= 1).toBe(true);
    }
  });

  it('settings change volumes, shake and persist', () => {
    const { game, a, tap, mem } = rig();
    tap({ up: true });
    tap({ confirm: true });
    tap({ down: true });
    tap({ left: true });
    expect(a.setVolumes).toHaveBeenLastCalledWith({
      master: 0.7,
      music: 0.6,
      sfx: 0.8,
      engine: 0.8,
    });
    tap({ down: true });
    tap({ right: true });
    expect(a.setVolumes).toHaveBeenLastCalledWith({
      master: 0.7,
      music: 0.7,
      sfx: 0.8,
      engine: 0.8,
    });
    expect(JSON.parse(mem.get(SETTINGS_KEY)!).music).toBe(0.7);
    tap({ tabNext: true });
    tap({ up: true });
    tap({ right: true });
    expect(game.view().hud.menu!.rows[0].value).toBe('OFF');
    game.debug.shake = 1;
    expect(game.view().render.shake).toBe(0);
    expect(game.view().render.impact).toBe(0);
  });

  it('music row toggles the track and persists', () => {
    const { game, a, tap, mem } = rig();
    expect(a.setTrack).toHaveBeenLastCalledWith('tokyo');
    tap({ up: true });
    tap({ confirm: true });
    for (let i = 0; i < 5; i++) tap({ down: true });
    tap({ right: true });
    expect(a.setTrack).toHaveBeenLastCalledWith('eurobeat');
    expect(game.view().hud.menu!.rows[4].value).toBe('EUROBEAT');
    expect(JSON.parse(mem.get(SETTINGS_KEY)!).track).toBe('eurobeat');
  });

  it('clip quality row cycles and persists', () => {
    const { game, tap, mem } = rig();
    tap({ up: true });
    tap({ confirm: true });
    tap({ right: true }); // VIDEO tab
    for (let i = 0; i < 2; i++) tap({ down: true });
    expect(game.view().hud.menu!.rows[1]).toEqual({ label: 'CLIP QUALITY', value: 'MEDIUM' });
    tap({ right: true });
    expect(game.view().hud.menu!.rows[1].value).toBe('HIGH');
    tap({ right: true });
    expect(game.view().hud.menu!.rows[1].value).toBe('OFF');
    tap({ right: true }); // wraps
    expect(JSON.parse(mem.get(SETTINGS_KEY)!).clips).toBe('low');
    tap({ left: true });
    expect(game.view().hud.menu!.rows[1].value).toBe('OFF');
  });

  it('tabs: strip left/right, Q/E from anywhere, BACK stays last', () => {
    const { game, tap, row } = rig();
    const menu = () => game.view().hud.menu!;
    const Q = { tabPrev: true };
    const E = { tabNext: true };
    tap({ up: true });
    tap({ confirm: true });
    expect(menu().tabs).toEqual({ names: ['AUDIO', 'VIDEO', 'GAME'], active: 0 });
    expect(menu().rows).toHaveLength(8);
    tap({ right: true });
    expect(menu().tabs!.active).toBe(1);
    expect(menu().rows.map((r) => r.label)).toEqual([
      'CAMERA SHAKE',
      'CLIP QUALITY',
      'MENU THEME',
      'BACK',
    ]);
    tap({ down: true });
    tap({ left: true }); // on a row: no tab change
    expect(menu().tabs!.active).toBe(1);
    tap(E);
    expect(menu().tabs!.active).toBe(2);
    expect(row()).toBe(1);
    tap({ up: true });
    tap({ up: true }); // wraps to BACK
    expect(row()).toBe(2);
    tap(Q);
    expect(menu().tabs!.active).toBe(1);
    expect(menu().rows[row() - 1].label).toBe('BACK');
  });

  it('menu theme cycles, persists and reaches the view', () => {
    const { game, tap, mem } = rig();
    tap({ up: true });
    tap({ confirm: true });
    tap({ right: true });
    tap({ down: true });
    tap({ down: true });
    tap({ down: true });
    expect(game.view().hud.menu!.rows[2]).toEqual({ label: 'MENU THEME', value: 'ARCADE' });
    tap({ right: true });
    expect(game.view().hud.menu!.rows[2].value).toBe('VHS');
    expect(game.view().hud.ui).toEqual({ theme: 'vhs', device: 'kb', padStyle: 'xbox' });
    expect(game.view().hud.menu!.ui.theme).toBe('vhs');
    expect(JSON.parse(mem.get(SETTINGS_KEY)!).menuTheme).toBe('vhs');
  });

  it('settings layout fits a tall portrait window', () => {
    for (const [w, h] of [
      [400, 1200],
      [1920, 1080],
      [300, 300],
    ]) {
      const u = Math.min(w, h) / 100;
      const { top, step } = settingsLayout(h, u, 6);
      expect(top).toBeGreaterThanOrEqual(h * 0.14);
      expect(top + 5 * step + 4 * u).toBeLessThanOrEqual(h - 5 * u);
      expect(step).toBeLessThanOrEqual(7.8 * u + 1e-9);
    }
  });

  it('MUSIC row cycles three tracks and labels an empty library', () => {
    const { game, a, tap } = rig();
    tap({ up: true });
    tap({ confirm: true });
    for (let i = 0; i < 5; i++) tap({ down: true });
    const value = () => game.view().hud.menu!.rows[4].value;
    expect(value()).toBe('TOKYO');
    tap({ right: true });
    expect(value()).toBe('EUROBEAT');
    tap({ right: true });
    expect(value()).toBe('MY MUSIC (EMPTY)');
    a.myMusicCount = () => 7;
    expect(value()).toBe('MY MUSIC (7)');
    tap({ right: true });
    expect(value()).toBe('TOKYO');
    expect(a.setTrack).toHaveBeenLastCalledWith('tokyo');
  });

  it('skip works in a run but not in settings', () => {
    const { game, a, tap } = rig();
    tap({ up: true });
    tap({ confirm: true });
    tap({ skip: true });
    expect(a.skipTrack).not.toHaveBeenCalled();
    tap({ pause: true });
    tap({ up: true });
    tap({ up: true });
    tap({ confirm: true }); // PLAY -> countdown
    tap({ skip: true });
    expect(a.skipTrack).toHaveBeenCalledTimes(1);
    expect(game.view().hud.phase).not.toBe('settings');
  });

  it('clear my music needs a second enter', async () => {
    const clear = vi.fn(async () => {});
    const { game, a, tap } = rig(undefined, {
      pick: vi.fn(),
      clear,
      size: async () => '1 / 500 MB',
    });
    tap({ up: true });
    tap({ confirm: true });
    for (let i = 0; i < 7; i++) tap({ down: true });
    tap({ confirm: true });
    expect(clear).not.toHaveBeenCalled();
    expect(game.view().hud.menu!.rows[6].value).toBe('ENTER TO CONFIRM');
    tap({ confirm: true });
    expect(clear).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(a.refreshMyMusic).toHaveBeenCalled();
  });

  it('reset best scores needs a second enter', () => {
    const { game, tap, stores } = rig();
    tap({ up: true });
    tap({ confirm: true });
    tap({ right: true });
    tap({ right: true }); // GAME tab
    tap({ down: true });
    tap({ confirm: true });
    expect(stores[0].get()).toBe(50);
    tap({ confirm: true });
    expect([stores[0].get(), stores[1].get()]).toEqual([0, 0]);
    expect(game.view().hud.best).toBe(0);
  });

  it('uses the saved car stats and toggles music with the run', () => {
    const { game, a, tap } = rig({ car: 'supra', color: '#ff7a00' });
    expect(a.music).not.toHaveBeenCalledWith(true);
    tap({ confirm: true });
    expect(a.music).toHaveBeenLastCalledWith(true);
    expect(game.debug.car.stats).toEqual(PLAYER_MODELS.supra.stats);
    for (let i = 0; i < 200; i++) game.update(IDLE, DT);
    game.debug.scoring.combo = { points: 500, multiplier: 4, tricks: ['DRIFT'], grace: 1.5 };
    game.update(IDLE, DT);
    expect(a.setIntensity).toHaveBeenLastCalledWith(0.5);
    game.update({ ...IDLE, pause: true }, DT);
    game.update({ ...IDLE, pause: true }, DT);
    expect(game.view().hud.phase).toBe('title');
    expect(a.music).toHaveBeenLastCalledWith(false);
  });

  describe('auto-recover', () => {
    const wedge = (map: GameMap, fn: (g: ReturnType<typeof setup>) => void) => {
      const f = map.floors[0];
      const n = f.solids.length;
      const g = setup();
      if (map !== garage) throw new Error('garage only');
      const { x, y } = garage.start.pos;
      f.solids.push(
        { x: x + 2, y: y - 3, w: 1, h: 6, kind: 'wall' },
        { x: x - 3, y: y - 3, w: 1, h: 6, kind: 'wall' },
      );
      try {
        g.toRun();
        Object.assign(g.game.debug.car, { pos: { x, y }, angle: 0 });
        fn(g);
      } finally {
        f.solids.length = n;
      }
    };

    it('revving with the clutch held does not count as stuck', () => {
      wedge(garage, ({ game, step }) => {
        const { x, y } = garage.start.pos;
        step({ throttle: 1, clutch: true }, Math.round(3 / DT));
        expect(Math.hypot(game.debug.car.pos.x - x, game.debug.car.pos.y - y)).toBeLessThan(0.5);
      });
    });

    it('puts a wedged car on the route, heading along it, and loses the combo', () => {
      wedge(garage, ({ game, step }) => {
        startCombo(game);
        game.debug.scoring.combo!.grace = 99;
        step({ throttle: 1 }, Math.round(2 / DT));
        expect(game.debug.scoring.combo).not.toBeNull();
        step({ throttle: 1 }, Math.round(0.55 / DT));
        const car = game.debug.car;
        const pts = garageRoute[0].points;
        const i = pts.findIndex((q, k) => {
          const b = pts[k + 1];
          return b && Math.abs(Math.atan2(b.y - q.y, b.x - q.x) - car.angle) < 1e-6;
        });
        expect(i).toBeGreaterThanOrEqual(0);
        expect(Math.hypot(car.vel.x, car.vel.y)).toBeLessThan(1);
        expect(collide(car, garage.floors[0].solids, garage.floors[0].circles)).toBeNull();
        expect(game.debug.scoring.combo).toBeNull();
        expect(game.view().hud.popups.some((p) => p.text === 'RESET')).toBe(true);
      });
    });

    it('does not trigger without input', () => {
      wedge(garage, ({ game, step }) => {
        step({}, Math.round(4 / DT));
        expect(game.debug.car.pos.x).toBeCloseTo(garage.start.pos.x, 0);
      });
    });

    it('does not trigger when pushing under 2.5 s', () => {
      wedge(garage, ({ game, step }) => {
        step({ throttle: 1 }, Math.round(2.3 / DT));
        expect(Math.abs(game.debug.car.angle)).toBeLessThan(0.2);
        expect(game.debug.car.pos.x).toBeCloseTo(garage.start.pos.x, 0);
      });
    });

    it('falls back to the start without a route', () => {
      const game = createGame([testpad], audio, () => memBest());
      const go = (input: Partial<InputState>, n: number) => {
        for (let i = 0; i < n; i++) game.update({ ...IDLE, ...input }, DT);
      };
      go({ confirm: true }, 1);
      go({}, Math.round(COUNTDOWN_SECONDS / DT));
      const f = testpad.floors[0];
      const n = f.solids.length;
      f.solids.push(
        { x: 52, y: 47, w: 1, h: 6, kind: 'wall' },
        { x: 47, y: 47, w: 1, h: 6, kind: 'wall' },
      );
      try {
        Object.assign(game.debug.car, { pos: { x: 50, y: 50 }, angle: 0 });
        go({ throttle: 1 }, Math.round(3 / DT));
        expect(Math.hypot(game.debug.car.pos.x - 100, game.debug.car.pos.y - 100)).toBeLessThan(5);
      } finally {
        f.solids.length = n;
      }
    });
  });

  describe('pause/countdown/title', () => {
    it('confirm+pause resumes from pause', () => {
      const { game, step, toRun } = setup();
      toRun();
      step({ pause: true });
      expect(game.debug.phase).toBe('paused');
      step({ pause: true, confirm: true });
      expect(game.debug.phase).toBe('run');
    });

    it('pause or blur during countdown returns to title and bumps runId', () => {
      const { game, step } = setup();
      step({ confirm: true });
      const id = game.debug.runId;
      step({ pause: true });
      expect(game.debug.phase).toBe('title');
      expect(game.debug.runId).toBeGreaterThan(id);
      step({ confirm: true });
      const id2 = game.debug.runId;
      game.pause();
      expect(game.debug.phase).toBe('title');
      expect(game.debug.runId).toBeGreaterThan(id2);
    });

    it('changing the title map bumps runId', () => {
      const game = createGame([garage, testpad], audio, () => memBest());
      const id = game.debug.runId;
      game.update({ ...IDLE, right: true }, DT);
      expect(game.debug.runId).toBeGreaterThan(id);
    });
  });
});

describe('device, rpm and attract', () => {
  it('menu and hud ui follow the polled device', () => {
    const { game, step } = setup();
    step({ device: 'pad', padStyle: 'ps' });
    expect(game.view().hud.ui).toMatchObject({ device: 'pad', padStyle: 'ps' });
    expect(game.view().hud.menu!.ui).toMatchObject({ device: 'pad', padStyle: 'ps' });
    step(); // fields absent: last device sticks
    expect(game.view().hud.ui.device).toBe('pad');
  });

  it('hud rpm is real crank rpm of the chosen car', () => {
    const { game, toRun } = setup();
    toRun();
    const p = ENGINE_PROFILES.mx5;
    game.debug.car.rpm = 0;
    expect(game.view().hud.rpm).toBe(p.idle);
    game.debug.car.rpm = 1;
    expect(game.view().hud.rpm).toBe(p.limit);
    expect(game.view().hud.redline).toBe(p.limit - 200);
  });

  it('runs a silent attract car on the docks behind the menu', () => {
    const update = vi.fn();
    const hit = vi.fn();
    const set = vi.fn();
    const game = createGame([garage], { ...audio, update, hit }, () => ({ get: () => 42, set }));
    const step = (i: Partial<InputState> = {}, n = 1) => {
      for (let k = 0; k < n; k++) game.update({ ...IDLE, ...i }, DT);
    };
    step();
    const r = game.view().render;
    expect(r.map).toBe(docks);
    const from = { ...r.car.pos };
    step({}, 120);
    const r2 = game.view().render;
    expect(Math.hypot(r2.car.pos.x - from.x, r2.car.pos.y - from.y)).toBeGreaterThan(5);
    expect(r2.runId).toBeLessThan(0);
    // settings keeps it running
    step({ up: true });
    step({ confirm: true });
    expect(game.view().hud.menu!.screen).toBe('settings');
    const before = { ...game.view().render.car.pos };
    step({}, 30);
    expect(game.view().render.car.pos).not.toEqual(before);
    // route end teleports back to the start as a new loop
    const end = docksRoute[0].points.at(-1)!;
    game.view().render.car.pos = { ...end };
    const loop = game.view().render.runId;
    step();
    expect(game.view().render.runId).toBe(loop - 1);
    expect(Math.hypot(game.view().render.car.pos.x - docks.start.pos.x)).toBeLessThan(1);
    expect(update).not.toHaveBeenCalled();
    expect(hit).not.toHaveBeenCalled();
    // starting a run: real state is clean and the attract car is gone
    step({ pause: true });
    step({ down: true }); // SETTINGS -> PLAY
    step({ confirm: true });
    const v = game.view();
    expect(v.hud.phase).toBe('countdown');
    expect(v.render.map).toBe(garage);
    expect(v.render.player.model).toBe('mx5');
    expect(v.render.runId).toBeGreaterThan(0);
    expect(game.debug.car.pos).toEqual(garage.start.pos);
    expect(game.debug.car.vel).toEqual({ x: 0, y: 0 });
    expect(game.debug.scoring).toMatchObject({ banked: 0, combo: null });
    expect(v.hud.best).toBe(42);
    expect(set).not.toHaveBeenCalled();
  });

  it('LB/RB tab presses with clutch held in settings do not reach the run', () => {
    const { game, step, toRun } = setup();
    step({ up: true });
    step({ confirm: true });
    step({ tabNext: true, clutch: true });
    step({ tabPrev: true, clutch: true });
    expect(game.view().hud.menu!.tabs!.active).toBe(0);
    step({ pause: true });
    toRun();
    step();
    expect(game.debug.car.clutchHeld).toBeFalsy();
  });
});

describe('tokyo traffic', () => {
  const rig = (hit = vi.fn()) => {
    const game = createGame([garage, tokyo], { ...audio, hit }, () => memBest());
    const step = (input: Partial<InputState> = {}, n = 1) => {
      for (let i = 0; i < n; i++) game.update({ ...IDLE, ...input }, DT);
    };
    step({ right: true });
    step({ confirm: true });
    return { game, step, hit };
  };

  it('is selectable and a run there steps traffic from the countdown on', () => {
    const { game, step } = rig();
    expect(game.view().hud.menu).toBeNull();
    expect(game.view().render.map).toBe(tokyo);
    const sim = game.view().render.traffic!.sim;
    expect(sim).toBe(game.debug.traffic);
    expect(sim.cars.length).toBeGreaterThan(0);
    step({}, Math.round(COUNTDOWN_SECONDS / DT));
    expect(game.view().hud.phase).toBe('run');
    expect(sim.time).toBeCloseTo(COUNTDOWN_SECONDS, 1);
    const at = sim.cars.map((c) => ({ ...c.pos }));
    step({}, 60);
    expect(sim.time).toBeCloseTo(COUNTDOWN_SECONDS + 60 * DT, 1);
    expect(sim.cars.some((c, i) => c.pos.x !== at[i].x || c.pos.y !== at[i].y)).toBe(true);
    // restart: fresh traffic
    step({ restart: true });
    expect(game.debug.traffic).not.toBe(sim);
    expect(game.debug.traffic!.time).toBe(0);
  });

  it('hitting a traffic car breaks the combo and puts it on hazards', () => {
    const { game, step, hit } = rig();
    step({}, Math.round(COUNTDOWN_SECONDS / DT));
    const sim = game.debug.traffic!;
    const c = sim.cars[0];
    startCombo(game);
    // nose into its tail, closing at 8 m/s
    const [ux, uy] = [Math.cos(c.heading), Math.sin(c.heading)];
    const back = c.length / 2 + CAR_LENGTH / 2 - 0.3;
    Object.assign(game.debug.car, {
      pos: { x: c.pos.x - ux * back, y: c.pos.y - uy * back },
      angle: c.heading,
      vel: { x: ux * (c.speed + 8), y: uy * (c.speed + 8) },
      angVel: 0,
    });
    step();
    expect(game.debug.scoring.combo).toBeNull();
    expect(game.view().hud.popups.some((p) => p.kind === 'fail')).toBe(true);
    expect(hit).toHaveBeenCalledTimes(1);
    expect(c.hazardsUntil).toBeGreaterThan(sim.time);
    expect(c.speed).toBe(0);
    step({}, 10); // still touching: a solid now, no second hit
    expect(hit).toHaveBeenCalledTimes(1);
  });

  it('other maps have no traffic', () => {
    const { game, toRun } = setup();
    toRun();
    expect(game.debug.traffic).toBeNull();
    expect(game.view().render.traffic).toBeNull();
    // the attract scene neither
    const g2 = createGame([tokyo], audio, () => memBest());
    g2.update(IDLE, DT);
    expect(g2.view().render.map).toBe(docks);
    expect(g2.view().render.traffic).toBeNull();
  });
});
