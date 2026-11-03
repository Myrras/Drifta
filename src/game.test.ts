import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createGame,
  type AudioLike,
  type BestStore,
  type ClipRecorder,
  type MpHost,
  type MusicHost,
} from './game';
import type { Link, LinkState, Msg } from './net/protocol';
import { START_DELAY_MS } from './net/session';
import { ghostKey, serialize } from './ghost';
import { garage, garageRoute } from './maps/garage';
import { CAR_LENGTH, collide } from './collision';
import { testpad } from './maps/testpad';
import { COUNTDOWN_SECONDS, DT } from './config';
import type { GameMap, InputState, PlayerModel } from './types';
import {
  chooseStarter,
  defaultProgress,
  loadProgress,
  PROGRESS_KEY,
  type Progress,
} from './progress';
import { PLAYER_MODELS } from './models';
import { SETTINGS_KEY } from './settings';
import { settingsLayout } from './ui/menu';
import { docks, docksRoute } from './maps/docks';
import { tokyo } from './maps/tokyo';
import { ENGINE_PROFILES } from './engine';
import { dailyFor, isLegendDay } from './daily';

const noop = () => {};
const audio: AudioLike = {
  resume: noop,
  update: noop,
  boom: noop,
  boomPhase: () => null,
  hit: noop,
  bank: noop,
  fail: noop,
  ui: noop,
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

  it('beeps once per countdown number and once for go', () => {
    const ui = vi.fn();
    const game = createGame([garage], { ...audio, ui }, () => memBest());
    const press = (i: Partial<InputState>, n = 1) => {
      for (let k = 0; k < n; k++) game.update({ ...IDLE, ...i }, DT);
    };
    press({ confirm: true });
    ui.mockClear(); // title confirm blip
    press({}, Math.round(COUNTDOWN_SECONDS / DT) + 5);
    expect(ui.mock.calls.map((c) => c[0])).toEqual(['count', 'count', 'count', 'go']);
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

  it('photo mode: freezes, saves on confirm, returns to where it came from', () => {
    const { game, step, toRun } = setup();
    toRun();
    step({ photo: true });
    expect(game.view().hud.phase).toBe('photo');
    const t = game.view().hud.time;
    step({ photoPan: { x: 1, y: 0 } }, 10);
    expect(game.view().hud.time).toBe(t);
    expect(game.view().render.photo?.x).not.toBe(game.debug.car.pos.x);
    step({ confirm: true });
    expect(game.takeShot()).toBe(true);
    expect(game.takeShot()).toBe(false);
    step({ pause: true });
    expect(game.view().hud.phase).toBe('run');
    step({ pause: true });
    step({ photo: true });
    step({ pause: true });
    expect(game.view().hud.phase).toBe('paused');
  });

  it('boom shake only applies while driving', () => {
    const { game, step, toRun } = setup();
    toRun();
    expect(game.view().render.shakeOn).toBe(true);
    step({ photo: true });
    expect(game.view().render.shakeOn).toBe(false);
    step({ pause: true });
    step({ pause: true });
    expect(game.view().render.shakeOn).toBe(false);
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
    step({ right: true });
    expect(game.view().hud.results!.driftRow).toBe(1);
    step({ save: true, down: true }); // S also reports down
    expect(clips.save).toHaveBeenCalledWith(second, 'drifta-b2-meet-200.webm');
    const r = game.view().hud.results!;
    expect(r.driftRow).toBe(1);
    expect(r.drifts.map((x) => x.saved)).toEqual([false, true]);
  });

  it('passes each drift still to the results', () => {
    const { game, clips, bank, finish } = rig();
    const still = {} as HTMLCanvasElement;
    clips.still = vi.fn(() => still);
    const id = bank(300);
    finish();
    expect(game.view().hud.results!.drifts[0].still).toBe(still);
    expect(clips.still).toHaveBeenCalledWith(id);
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

describe('finish awards and car pick', () => {
  function rig() {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    const prog0: Progress = { ...defaultProgress(), starterChosen: true }; // nothing unlocked yet
    const game = createGame([garage], audio, () => memBest(), storage, undefined, undefined, prog0);
    const step = (input: Partial<InputState> = {}, frames = 1) => {
      for (let i = 0; i < frames; i++) game.update({ ...IDLE, ...input }, DT);
    };
    step({ confirm: true });
    step({}, Math.round(COUNTDOWN_SECONDS / DT));
    game.debug.scoring.banked = 1e6; // well past 1st, finished far under par
    game.debug.floorIndex = garage.finish.floor;
    game.debug.car.pos = { x: garage.finish.zone.x + 1, y: garage.finish.zone.y + 1 };
    step();
    step({}, Math.ceil(0.5 / DT));
    const r = () => game.view().hud.results!;
    return { game, step, r, prog: () => loadProgress(storage) };
  }

  it('1st saves both map paints and a car pick', () => {
    const { r, prog } = rig();
    expect(r().position).toBe(1);
    expect(r().newPaints).toEqual(['concrete-grey', 'b2-violet']);
    expect(r().carPick).toBe(true);
    expect(prog().carPicks).toBe(1);
  });

  it('confirm opens the chooser with locked cars; picking spends the pick', () => {
    const { game, step, r, prog } = rig();
    step({ confirm: true });
    const cars = r().chooser!.cars.map((c) => c.model);
    expect(cars).toEqual(Object.keys(PLAYER_MODELS)); // nothing unlocked yet
    for (const c of r().chooser!.cars)
      for (const v of Object.values(c.stats)) expect(v >= 0 && v <= 1).toBe(true);
    step({ right: true });
    expect(r().chooser!.row).toBe(1);
    step({ confirm: true });
    expect(r().chooser).toBeNull();
    expect(r().carPick).toBe(false);
    expect(prog().unlocked).toEqual([cars[1]]);
    expect(prog().carPicks).toBe(0);
    step({ confirm: true });
    expect(game.view().hud.phase).toBe('countdown');
  });

  it('cheat on: confirm opens no chooser and the pick is kept', () => {
    const { game, step, r, prog } = rig();
    game.debug.cheat = true;
    step({ confirm: true });
    expect(r()?.chooser ?? null).toBeNull();
    expect(prog().carPicks).toBe(1);
    expect(game.view().hud.phase).not.toBe('results'); // plain confirm retries
  });

  it('chooser cars carry a color and look for the sprite', () => {
    const { step, r } = rig();
    step({ confirm: true });
    const c = r().chooser!.cars[0];
    expect(c.color).toBeTruthy();
    expect(c.look).toBeTruthy();
  });

  it('LATER keeps the pick for the garage', () => {
    const { game, step, r, prog } = rig();
    step({ confirm: true });
    step({ left: true }); // wraps to LATER, the last stop
    expect(r().chooser!.row).toBe(r().chooser!.cars.length);
    step({ confirm: true });
    expect(r().chooser).toBeNull();
    expect(r().carPick).toBe(false);
    expect(prog().carPicks).toBe(1);
    expect(prog().unlocked).toEqual([]);
    expect(game.view().hud.phase).toBe('results');
  });

  it('back on the chooser acts as LATER and stays on results', () => {
    const { game, step, r, prog } = rig();
    step({ confirm: true });
    step({ pause: true });
    expect(r().chooser).toBeNull();
    expect(game.view().hud.phase).toBe('results');
    expect(prog().carPicks).toBe(1);
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
  const rig = (saved?: object, host?: MusicHost, progress?: object) => {
    const mem = new Map<string, string>(saved ? [[SETTINGS_KEY, JSON.stringify(saved)]] : []);
    if (progress) mem.set(PROGRESS_KEY, JSON.stringify(progress));
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    const a = {
      ...audio,
      music: vi.fn(),
      ui: vi.fn(),
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
      Object.assign(loadProgress(storage), {
        starterChosen: true,
        unlocked: Object.keys(PLAYER_MODELS) as PlayerModel[],
      }),
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
    expect(row()).toBe(6);
    expect(game.view().hud.menu!.rows.map((r) => r.label)).toEqual([
      'PLAY',
      'PILLARS',
      'DAILY',
      'MULTIPLAYER',
      'GARAGE',
      'SETTINGS',
      'USERNAME',
    ]);
    tap({ down: true });
    expect(row()).toBe(0);
    for (let i = 0; i < 4; i++) tap({ down: true });
    tap({ confirm: true });
    expect(game.view().hud.phase).toBe('garage');
    tap({ pause: true });
    expect(game.view().hud.phase).toBe('title');
    tap({ down: true });
    tap({ confirm: true });
    expect(game.view().hud.phase).toBe('settings');
  });

  it('a generated username is saved once at startup; a stored one is kept', () => {
    const { game, mem } = rig();
    expect(game.playerName()).toMatch(/^GUEST[0-9]{4}$/);
    expect(JSON.parse(mem.get(SETTINGS_KEY)!).name).toBe(game.playerName());
    const kept = rig({ name: 'TOFU' });
    expect(kept.game.playerName()).toBe('TOFU');
    expect(kept.mem.get(SETTINGS_KEY)).toBe(JSON.stringify({ name: 'TOFU' }));
  });

  it('username: type, backspace, enter commits and saves', () => {
    const { game, tap, mem } = rig({ name: 'OLD' });
    const value = () => game.view().hud.menu!.rows[6].value;
    tap({ up: true });
    expect(value()).toBe('OLD');
    tap({ confirm: true });
    expect(game.editing()).toBe(true);
    expect(value()).toBe('OLD_');
    game.update(IDLE, 0.5);
    expect(value()).toBe('OLD ');
    for (const k of ['Backspace', 'Backspace', 'Backspace', 'd', '-', ' ', 'k', '_', '9', 'Shift'])
      game.typeKey(k);
    expect(game.debug.phase).toBe('title');
    expect(value()).toMatch(/^DK_9[_ ]$/);
    for (let i = 0; i < 12; i++) game.typeKey('x');
    expect(value()).toMatch(/^DK_9X{8}[_ ]$/);
    game.typeKey('Enter');
    expect(game.editing()).toBe(false);
    expect(game.playerName()).toBe('DK_9XXXXXXXX');
    expect(JSON.parse(mem.get(SETTINGS_KEY)!).name).toBe('DK_9XXXXXXXX');
    tap({ confirm: true }); // the committing Enter, still latched: swallowed
    expect(game.editing()).toBe(false);
    expect(game.debug.phase).toBe('title');
    tap({ confirm: true });
    expect(game.editing()).toBe(true);
    for (let i = 0; i < 12; i++) game.typeKey('Backspace');
    game.typeKey('Enter'); // empty: keeps the old name
    expect(game.playerName()).toBe('DK_9XXXXXXXX');
  });

  it('username: escape cancels and menu input is ignored while editing', () => {
    const { game, tap, row, mem } = rig({ name: 'OLD' });
    tap({ up: true });
    tap({ confirm: true });
    game.typeKey('w');
    tap({ up: true });
    tap({ down: true });
    tap({ confirm: true });
    tap({ cheat: true });
    tap({ pause: true });
    expect(row()).toBe(6);
    expect(game.editing()).toBe(true);
    expect(game.debug.phase).toBe('title');
    expect(game.debug.cheat).toBe(false);
    game.typeKey('Escape');
    expect(game.editing()).toBe(false);
    expect(game.playerName()).toBe('OLD');
    expect(mem.get(SETTINGS_KEY)).toBe(JSON.stringify({ name: 'OLD' }));
    tap({ pause: true }); // the cancelling Escape's update: swallowed
    tap({ down: true });
    expect(row()).toBe(0);
  });

  it('username: a pad press shows a note instead of editing', () => {
    const { game, tap } = rig({ name: 'OLD' });
    tap({ up: true });
    tap({ confirm: true, device: 'pad' });
    expect(game.editing()).toBe(false);
    expect(game.view().hud.menu!.rows[6].value).toBe('PRESS ENTER ON KEYBOARD');
    game.update(IDLE, 3);
    expect(game.view().hud.menu!.rows[6].value).toBe('OLD');
  });

  it('left/right only picks the map on the PLAY row', () => {
    const { game, tap } = rig();
    tap({ down: true });
    tap({ down: true });
    tap({ right: true });
    expect(game.view().hud.menu?.selected).toBe(0);
  });

  it('garage: cars and paint cycle, enter persists, esc reverts', () => {
    const { game, tap, mem } = rig();
    const g = () => game.view().hud.menu!.garage!;
    for (let i = 0; i < 4; i++) tap({ down: true });
    tap({ confirm: true });
    tap({ right: true });
    expect(g().model).toBe('civic');
    expect(g().color).toBe(PLAYER_MODELS.civic.colors[0]);
    tap({ down: true }); // PAINT slot
    tap({ right: true });
    expect(g().color).toBe(PLAYER_MODELS.civic.colors[1]);
    tap({ pause: true }); // revert
    expect(game.view().hud.menu!.rows[4].value).toBe(PLAYER_MODELS.mx5.name);
    tap({ confirm: true });
    tap({ left: true });
    expect(g().model).toBe('wrx');
    tap({ confirm: true });
    expect(game.view().hud.menu!.rows[4].value).toBe(PLAYER_MODELS.wrx.name);
    expect(JSON.parse(mem.get(SETTINGS_KEY)!)).toMatchObject({
      car: 'wrx',
      color: PLAYER_MODELS.wrx.colors[0],
    });
    expect(game.debug.car.stats).toEqual(PLAYER_MODELS.wrx.stats);
  });

  it('garage customise: locked options show a hint and never equip; owned ones persist', () => {
    const progress = defaultProgress();
    progress.paints.push('harbor-teal');
    const { game, tap, mem } = rig(undefined, undefined, progress);
    const g = () => game.view().hud.menu!.garage!;
    const open = () => {
      for (let i = 0; i < 4; i++) tap({ down: true });
      tap({ confirm: true });
    };
    open();
    tap({ down: true }); // PAINT
    const n = PLAYER_MODELS.mx5.colors.length;
    for (let i = 0; i < n; i++) tap({ right: true }); // past the stock colours: CONCRETE GREY
    expect(g().slots[0]).toMatchObject({ name: 'CONCRETE GREY', locked: true });
    expect(g().slotLock).toBe('3RD on B2 MEET');
    expect(g().look.paint).toBeUndefined();
    tap({ right: true });
    tap({ right: true });
    expect(g().slots[0]).toMatchObject({ name: 'HARBOR TEAL', locked: false });
    expect(g().look.paint).toBe('harbor-teal');
    tap({ down: true }); // SKIN
    tap({ down: true }); // UNDERGLOW
    tap({ right: true });
    expect(g().slots[2].locked).toBe(true);
    expect(g().slotLock).toBe('daily challenge');
    tap({ confirm: true });
    const saved = JSON.parse(mem.get(PROGRESS_KEY)!);
    expect(saved.looks.mx5).toMatchObject({ paint: 'harbor-teal' });
    expect(saved.looks.mx5.underglow).toBeUndefined();
    tap({ confirm: true }); // title returns on the GARAGE row
    expect(g().look.paint).toBe('harbor-teal');
  });

  it('garage: T toggles the tune, enter saves it and applies the stat boost', () => {
    const { game, tap, mem } = rig();
    for (let i = 0; i < 4; i++) tap({ down: true });
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
    for (let i = 0; i < 4; i++) step({ down: true });
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
    for (let i = 0; i < 4; i++) tap({ down: true });
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
    expect(a.setTrack).toHaveBeenLastCalledWith('phonk');
    tap({ up: true });
    tap({ up: true });
    tap({ confirm: true });
    for (let i = 0; i < 5; i++) tap({ down: true });
    tap({ right: true });
    expect(a.setTrack).toHaveBeenLastCalledWith('mine');
    expect(game.view().hud.menu!.rows[4].value).toBe('MY MUSIC (EMPTY)');
    expect(JSON.parse(mem.get(SETTINGS_KEY)!).track).toBe('mine');
  });

  it('clip quality row cycles and persists', () => {
    const { game, tap, mem } = rig();
    tap({ up: true });
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
      'GHOST',
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

  it('MUSIC row cycles two tracks and labels an empty library', () => {
    const { game, a, tap } = rig();
    tap({ up: true });
    tap({ up: true });
    tap({ confirm: true });
    for (let i = 0; i < 5; i++) tap({ down: true });
    const value = () => game.view().hud.menu!.rows[4].value;
    expect(value()).toBe('PHONK');
    tap({ right: true });
    expect(value()).toBe('MY MUSIC (EMPTY)');
    a.myMusicCount = () => 7;
    expect(value()).toBe('MY MUSIC (7)');
    tap({ right: true });
    expect(value()).toBe('PHONK');
    expect(a.setTrack).toHaveBeenLastCalledWith('phonk');
  });

  it('skip works in a run but not in settings', () => {
    const { game, a, tap } = rig();
    tap({ up: true });
    tap({ up: true });
    tap({ confirm: true });
    tap({ skip: true });
    expect(a.skipTrack).not.toHaveBeenCalled();
    tap({ pause: true });
    for (let i = 0; i < 5; i++) tap({ up: true });
    tap({ confirm: true }); // PLAY -> countdown
    tap({ skip: true });
    expect(a.skipTrack).toHaveBeenCalledTimes(1);
    expect(game.view().hud.phase).not.toBe('settings');
  });

  it('esc on a volume row leaves settings', () => {
    const { game, tap } = rig();
    tap({ up: true });
    tap({ up: true });
    tap({ confirm: true });
    tap({ down: true });
    tap({ pause: true });
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

  it('menu nav blips: move, adjust, confirm, tab, back', () => {
    const { a, tap } = rig();
    tap({ down: true });
    tap({ up: true });
    tap({ right: true });
    tap({ down: true });
    tap({ down: true });
    tap({ down: true });
    tap({ down: true });
    tap({ confirm: true }); // settings
    tap({ tabNext: true });
    tap({ pause: true });
    expect(a.ui.mock.calls.map((c) => c[0])).toEqual([
      'move',
      'move',
      'adjust',
      'move',
      'move',
      'move',
      'move',
      'confirm',
      'tab',
      'back',
    ]);
  });

  it('uses the saved car stats; music plays in menus and runs', () => {
    const { game, a, tap } = rig({ car: 'supra', color: '#ff7a00' });
    expect(a.music).toHaveBeenLastCalledWith(true); // menu music from the start
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
    expect(a.music).toHaveBeenLastCalledWith(true);
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
    step({ down: true }, 2); // SETTINGS -> USERNAME -> PLAY
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

  it('the on-ramp helix lifts the car onto the deck, where it passes over traffic', () => {
    const { game, step, hit } = rig();
    step({}, Math.round(COUNTDOWN_SECONDS / DT));
    const h = tokyo.helixes[0];
    const r = (h.rCore + h.rOuter) / 2;
    for (let p = 0.02; p <= 1.1; p += 0.01) {
      const a = h.enterAngle + h.sweep * p;
      const heading = a - Math.PI / 2; // sweep < 0: counterclockwise round the core
      Object.assign(game.debug.car, {
        pos: { x: h.center.x + r * Math.cos(a), y: h.center.y + r * Math.sin(a) },
        angle: heading,
        vel: { x: 8 * Math.cos(heading), y: 8 * Math.sin(heading) },
        angVel: 0,
      });
      step();
      expect(game.debug.floorIndex).toBe(p < 0.49 ? 0 : p > 0.51 ? 1 : game.debug.floorIndex);
    }
    expect(game.view().render.floorIndex).toBe(1);
    expect(game.view().hud.floorName).toBe('EXPWY');
    // a traffic car right under the car: no hit up here
    const sim = game.debug.traffic!;
    const c = sim.cars[0];
    startCombo(game);
    Object.assign(game.debug.car, {
      pos: { ...c.pos },
      angle: c.heading,
      vel: { x: 0, y: 0 },
      angVel: 0,
    });
    step();
    expect(hit).not.toHaveBeenCalled();
    expect(game.debug.scoring.combo).not.toBeNull();
    expect(c.hazardsUntil).toBeLessThanOrEqual(sim.time);
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

describe('map options', () => {
  const rig = (maps: GameMap[], hazards?: Record<string, boolean>) => {
    const mem = new Map<string, string>(
      hazards ? [[SETTINGS_KEY, JSON.stringify({ hazards })]] : [],
    );
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    const bests: Record<string, BestStore> = {};
    const game = createGame(maps, audio, (n) => (bests[n] ??= memBest()), storage);
    const tap = (input: Partial<InputState>) => {
      game.update({ ...IDLE, ...input }, DT);
      game.update(IDLE, DT);
    };
    const toRun = () => {
      tap({ confirm: true });
      game.update(IDLE, COUNTDOWN_SECONDS + 0.1);
    };
    const menu = () => game.view().hud.menu!;
    const saved = () => JSON.parse(mem.get(SETTINGS_KEY)!).hazards;
    return { game, tap, toRun, menu, saved, bests };
  };
  const pillars = (m: GameMap) =>
    m.floors.flatMap((f) => f.solids).filter((s) => s.kind === 'pillar');

  it('the title shows TRAFFIC / PILLARS under PLAY only where the map has it; toggles and saves', () => {
    const { game, tap, menu, saved } = rig([tokyo, garage, docks, testpad]);
    expect(menu().rows[1]).toEqual({ label: 'TRAFFIC', value: 'ON' });
    tap({ right: true });
    expect(menu().rows[1]).toEqual({ label: 'PILLARS', value: 'ON' });
    tap({ right: true });
    expect(menu().rows[1]).toEqual({ label: 'PILLARS', value: 'ON' });
    tap({ right: true });
    expect(menu().rows.map((r) => r.label)).toEqual([
      'PLAY',
      'DAILY',
      'MULTIPLAYER',
      'GARAGE',
      'SETTINGS',
      'USERNAME',
    ]);
    tap({ left: true });
    tap({ down: true });
    tap({ right: true });
    expect(menu().rows[1].value).toBe('OFF');
    expect(menu().selected).toBe(2);
    expect(saved()).toEqual({ [docks.name]: false });
    tap({ confirm: true });
    expect(game.debug.phase).toBe('title');
    expect(menu().rows[1].value).toBe('ON');
    expect(saved()).toEqual({ [docks.name]: true });
    tap({ up: true });
    tap({ right: true }); // back on PLAY: the row goes with the map
    expect(menu().row).toBe(0);
    expect(menu().rows[1].label).toBe('DAILY');
  });

  it('TRAFFIC OFF: the run keeps pedestrians but has no cars', () => {
    const off = rig([tokyo], { [tokyo.name]: false });
    off.toRun();
    expect(off.game.debug.phase).toBe('run');
    expect(off.game.debug.traffic!.cars).toEqual([]);
    expect(off.game.debug.traffic!.peds.length).toBeGreaterThan(0);
    const on = rig([tokyo]);
    on.toRun();
    expect(on.game.debug.traffic!.cars.length).toBeGreaterThan(0);
  });

  it('PILLARS OFF: nothing to hit or draw, bests still count for the map', () => {
    const off = rig([garage], { [garage.name]: false });
    off.toRun();
    const view = off.game.view().render.map;
    expect(view).not.toBe(garage);
    expect(view.name).toBe(garage.name);
    expect(pillars(view)).toEqual([]);
    const car = off.game.debug.car;
    const f = view.floors[off.game.debug.floorIndex];
    const at = (p: { x: number; y: number; w: number; h: number }) =>
      Object.assign(car, { pos: { x: p.x + p.w / 2, y: p.y + p.h / 2 }, vel: { x: 0, y: 0 } });
    const p = garage.floors[off.game.debug.floorIndex].solids.find(
      (s) => s.kind === 'pillar' && !collide(at(s), f.solids, f.circles),
    )!;
    expect(p).toBeDefined();
    at(p);
    const pos = { ...car.pos };
    off.game.update(IDLE, DT);
    expect(car.pos).toEqual(pos);

    const on = rig([garage]);
    on.toRun();
    Object.assign(on.game.debug.car, { pos: { ...pos }, vel: { x: 0, y: 0 } });
    on.game.update(IDLE, DT);
    expect(on.game.debug.car.pos).not.toEqual(pos);

    off.game.debug.scoring.banked = 5000;
    off.game.debug.floorIndex = garage.finish.floor;
    car.pos = { x: garage.finish.zone.x + 1, y: garage.finish.zone.y + 1 };
    off.game.update(IDLE, DT);
    expect(off.game.view().hud.results!.newBest).toBe(true);
    expect(off.bests[garage.name].get()).toBe(off.game.view().hud.results!.total);
  });
});

describe('progression: starter, locks, car picks, cheat', () => {
  const rig = (prog = defaultProgress(), saved?: object) => {
    const mem = new Map<string, string>(saved ? [[SETTINGS_KEY, JSON.stringify(saved)]] : []);
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    const a = { ...audio, ui: vi.fn() };
    const game = createGame(
      [garage, testpad],
      a,
      () => memBest(),
      storage,
      undefined,
      undefined,
      prog,
    );
    const tap = (input: Partial<InputState>) => {
      game.update({ ...IDLE, ...input }, DT);
      game.update(IDLE, DT);
    };
    const g = () => game.view().hud.menu!.garage!;
    const toGarage = () => {
      for (let i = 0; i < 4; i++) tap({ down: true });
      tap({ confirm: true });
    };
    const reload = () =>
      createGame(
        [garage],
        audio,
        () => memBest(),
        storage,
        undefined,
        undefined,
        loadProgress(storage),
      );
    return { game, a, tap, g, toGarage, mem, reload, prog };
  };
  const started = (car: PlayerModel, more: Partial<Progress> = {}) => {
    const p = defaultProgress();
    chooseStarter(p, car);
    return Object.assign(p, more);
  };

  it('first launch shows the starter pick once, then the title', () => {
    const { game, tap, g, mem, reload } = rig();
    expect(game.view().hud.phase).toBe('starter');
    expect(g().model).toBe('civic');
    tap({ restart: true }); // no run from the starter screen
    expect(game.view().hud.phase).toBe('starter');
    tap({ right: true });
    expect(g().model).toBe('rx8');
    tap({ confirm: true });
    expect(game.view().hud.phase).toBe('title');
    expect(game.view().hud.menu!.rows[4].value).toBe(PLAYER_MODELS.rx8.name);
    expect(JSON.parse(mem.get(PROGRESS_KEY)!)).toMatchObject({
      starterChosen: true,
      unlocked: ['rx8'],
    });
    expect(reload().view().hud.phase).toBe('title');
  });

  it('a locked car is shown with a lock and refused', () => {
    const { game, a, tap, g, toGarage, mem } = rig(started('civic'));
    const saved = mem.get(SETTINGS_KEY);
    toGarage();
    expect(g().lock).toBeNull();
    tap({ right: true });
    expect(g().model).not.toBe('civic');
    expect(g().lock).toEqual({ offer: false, picks: 0 });
    a.ui.mockClear();
    tap({ confirm: true });
    expect(a.ui).toHaveBeenCalledWith('back');
    expect(game.view().hud.phase).toBe('garage');
    expect(mem.get(SETTINGS_KEY)).toBe(saved);
  });

  it('confirm on a locked car offers a car pick, confirm again spends it', () => {
    const { game, tap, g, toGarage, mem, prog } = rig(started('civic', { carPicks: 1 }));
    toGarage();
    tap({ right: true });
    const car = g().model;
    tap({ confirm: true });
    expect(g().lock).toEqual({ offer: true, picks: 1 });
    tap({ pause: true }); // back cancels the offer only
    expect(game.view().hud.phase).toBe('garage');
    expect(g().lock).toEqual({ offer: false, picks: 1 });
    tap({ confirm: true });
    tap({ confirm: true });
    expect(g().lock).toBeNull();
    expect(prog.carPicks).toBe(0);
    expect(JSON.parse(mem.get(PROGRESS_KEY)!).unlocked).toEqual(['civic', car]);
    tap({ confirm: true }); // now selectable
    expect(game.view().hud.phase).toBe('title');
    expect(JSON.parse(mem.get(SETTINGS_KEY)!).car).toBe(car);
  });

  it('a saved locked car falls back to the starter', () => {
    const { game } = rig(started('180sx'), { car: 'supra', color: '#ff7a00' });
    expect(game.view().hud.menu!.rows[4].value).toBe(PLAYER_MODELS['180sx'].name);
    expect(game.debug.car.stats).toEqual(PLAYER_MODELS['180sx'].stats);
  });

  it('cheat on the title unlocks every car for the session only', () => {
    const { game, a, tap, g, toGarage, mem, reload } = rig(started('civic'));
    tap({ cheat: true, confirm: true }); // the code's final A must not start a run
    expect(game.view().hud.phase).toBe('title');
    expect(game.view().hud.menu!.toast).toBe('ALL CARS UNLOCKED');
    expect(a.ui).toHaveBeenCalledWith('confirm');
    expect(game.debug.cheat).toBe(true);
    toGarage();
    tap({ right: true });
    expect(g().lock).toBeNull();
    tap({ confirm: true });
    expect(game.view().hud.phase).toBe('title');
    expect(JSON.parse(mem.get(PROGRESS_KEY)!).unlocked).toEqual(['civic']); // the cheat is not saved
    const next = reload();
    expect(next.debug.cheat).toBe(false);
    expect(next.debug.car.stats).toEqual(PLAYER_MODELS.civic.stats);
  });

  describe('garage look saves on pad A', () => {
    const pad = { device: 'pad' as const };
    // PAINT is row 1, UNDERGLOW row 3; one step right = first underglow (PINK)
    const equipGlow = (t: (i: Partial<InputState>) => void) => {
      t({ down: true });
      t({ down: true });
      t({ down: true });
      t({ right: true });
    };
    const raceLook = (game: ReturnType<typeof createGame>) => {
      game.update({ ...IDLE, confirm: true }, DT); // PLAY
      game.update(IDLE, DT);
      return game.view().render.player.look;
    };

    it('owned item: A saves, survives reload, used in the race', () => {
      const p = started('civic');
      p.cosmetics.push('underglow-pink');
      const { game, tap, toGarage, mem, reload } = rig(p);
      toGarage();
      equipGlow(tap);
      tap({ ...pad, confirm: true });
      expect(game.view().hud.phase).toBe('title');
      expect(JSON.parse(mem.get(PROGRESS_KEY)!).looks.civic).toMatchObject({
        underglow: 'underglow-pink',
      });
      expect(raceLook(reload())).toMatchObject({ underglow: 'underglow-pink' });
    });

    it('cheat item: A saves it as chosen, shown this session, hidden after reload while unowned', () => {
      const { game, tap, toGarage, mem, reload, g } = rig(started('civic'));
      tap({ cheat: true });
      toGarage();
      equipGlow(tap);
      expect(g().look.underglow).toBe('underglow-pink');
      tap({ ...pad, confirm: true });
      expect(JSON.parse(mem.get(PROGRESS_KEY)!).looks.civic).toMatchObject({
        underglow: 'underglow-pink',
      });
      expect(raceLook(game)).toMatchObject({ underglow: 'underglow-pink' });
      const next = reload();
      expect(next.debug.cheat).toBe(false);
      expect(raceLook(next)?.underglow).toBeUndefined();
    });

    it('a cheat look reappears once the item is owned', () => {
      const { game, tap, toGarage, prog } = rig(started('civic'));
      tap({ cheat: true });
      toGarage();
      equipGlow(tap);
      tap({ ...pad, confirm: true });
      prog.cosmetics.push('underglow-pink');
      tap({ confirm: true }); // title returns on the GARAGE row
      expect(game.view().hud.menu!.garage!.look.underglow).toBe('underglow-pink');
    });
  });

  it('the cheat edge is ignored outside the title', () => {
    const { game, tap, toGarage } = rig(started('civic'));
    toGarage();
    tap({ cheat: true });
    expect(game.debug.cheat).toBe(false);
  });

  it('TEST PAD runs with an unlocked car', () => {
    const { game, tap } = rig(started('rx8'));
    tap({ right: true });
    expect(game.view().hud.menu!.selected).toBe(1);
    tap({ confirm: true });
    expect(game.view().hud.phase).toBe('countdown');
    expect(game.view().render.player.model).toBe('rx8');
  });
});

describe('daily and legend runs', () => {
  const dates = Array.from({ length: 60 }, (_, i) =>
    new Date(Date.UTC(2026, 5, 1 + i)).toISOString().slice(0, 10),
  );
  const plain = dates.find((d) => !isLegendDay(d))!;
  const legend = dates.find(isLegendDay)!;
  const maps = [garage, tokyo];
  const rig = (date: string) => {
    const prog: Progress = { ...defaultProgress(), starterChosen: true, unlocked: ['civic'] };
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    const game = createGame(
      maps,
      audio,
      () => memBest(),
      storage,
      undefined,
      undefined,
      prog,
      () => date,
    );
    const tap = (input: Partial<InputState>) => {
      game.update({ ...IDLE, ...input }, DT);
      game.update(IDLE, DT);
    };
    const onDaily = () => {
      const m = game.view().hud.menu!;
      return ['DAILY', 'LEGEND'].includes(m.rows[m.row].label);
    };
    const start = () => {
      while (!onDaily()) tap({ down: true });
      tap({ confirm: true });
      game.update(IDLE, COUNTDOWN_SECONDS + 0.1);
    };
    const finish = (score: number) => {
      const fin = dailyFor(date, maps).map.finish;
      game.debug.scoring.banked = score;
      game.debug.floorIndex = fin.floor;
      game.debug.car.pos = { x: fin.zone.x + 1, y: fin.zone.y + 1 };
      game.update(IDLE, DT);
      return game.view().hud.results!;
    };
    return { game, tap, start, finish, prog };
  };

  it('title shows the DAILY row with map, target and streak; positions replace medals', () => {
    const { game, prog } = rig(plain);
    const d = dailyFor(plain, maps);
    const m = game.view().hud.menu!;
    expect(m.rows[2]).toEqual({
      label: 'DAILY',
      value: `${d.map.name} · ${d.target.toLocaleString('en-US')}`,
    });
    expect(m.note).toBe('STREAK 0');
    expect(m.rows[0].value).toBe('◀ B2 MEET ▶');
    prog.results['B2 MEET'] = { position: 2, score: 1, time: 1 };
    expect(game.view().hud.menu!.rows[0].value).toBe('◀ B2 MEET ▶ 2ND');
  });

  it('clearing the daily pays once, then the title says CLEARED', () => {
    const { game, tap, start, finish, prog } = rig(plain);
    const d = dailyFor(plain, maps);
    start();
    expect(game.debug.phase).toBe('run');
    const r = finish(d.target);
    expect(r.daily).toMatchObject({ kind: 'daily', cleared: true, target: d.target });
    expect(r.daily!.reward).toBeDefined();
    expect(prog.cosmetics).toEqual([r.daily!.reward]);
    expect(prog.daily).toMatchObject({ lastClear: plain, streak: 1 });
    tap({ pause: true }); // results -> title
    expect(game.view().hud.menu!.note).toBe('STREAK 1 · CLEARED');
    start();
    expect(finish(d.target).daily!.reward).toBeUndefined();
    expect(prog.cosmetics.length).toBe(1);
  });

  it('missing the target fails the daily', () => {
    const { start, finish, prog } = rig(plain);
    start();
    expect(finish(1).daily).toMatchObject({ cleared: false });
    expect(prog.daily.clears).toBe(0);
  });

  it('points banked after the time limit do not clear the daily', () => {
    const { game, start, finish, prog } = rig(plain);
    const d = dailyFor(plain, maps);
    start();
    game.debug.scoring.banked = 1;
    game.debug.time = d.map.parTime * 1.3 - DT / 2;
    game.update(IDLE, DT); // limit passes: score locks at 1
    const r = finish(d.target * 10);
    expect(r).toMatchObject({ timeUp: true, comboPoints: 1, late: d.target * 10 - 1 });
    expect(r.daily).toMatchObject({ cleared: false });
    expect(prog.daily.clears).toBe(0);
  });

  it('a legend forces its car and skin, counts wall hits, and restores the car after', () => {
    const { game, tap, start, finish, prog } = rig(legend);
    prog.pickedMaps.push('TOKYO NIGHTS'); // no car pick to interrupt the restart
    expect(game.view().hud.menu!.rows[2].label).toBe('LEGEND');
    start();
    const v = game.view().render;
    expect(v.player.model).toBe('rx7');
    expect(v.player.look).toMatchObject({ skin: 'fortune-orange' });
    game.debug.wallHits = 1;
    const bad = finish(1e6);
    expect(bad.daily).toMatchObject({ kind: 'legend', cleared: false, wallHits: 1 });
    expect(prog.skins).toEqual([]);
    game.update(IDLE, 1); // past the results lockout
    void 0;
    tap({ confirm: true }); // restart the same legend
    game.update(IDLE, COUNTDOWN_SECONDS + 0.1);
    expect(game.debug.wallHits).toBe(0);
    const ok = finish(1e6);
    expect(ok.daily).toMatchObject({ cleared: true, reward: 'fortune-orange' });
    expect(prog.skins).toEqual(['fortune-orange']);
    tap({ pause: true });
    expect(game.view().hud.menu!.rows[4].value).toBe(PLAYER_MODELS.civic.name);
  });
});

describe('multiplayer entry and lobby', () => {
  interface FakeLink extends Link {
    state: LinkState;
    peer: FakeLink;
    deliver(m: Msg): void;
  }
  /** two open ends, synchronous delivery; messages wait until the far end listens */
  const linkPair = (): [FakeLink, FakeLink] => {
    const end = (): FakeLink => {
      const subs: ((m: Msg) => void)[] = [];
      const states: ((s: LinkState) => void)[] = [];
      const inbox: Msg[] = [];
      const l: FakeLink = {
        state: 'open',
        peer: null as unknown as FakeLink,
        deliver: (m) => (subs.length ? subs.forEach((cb) => cb(m)) : void inbox.push(m)),
        send: (m) => l.state === 'open' && l.peer.deliver(m),
        onMessage: (cb) => {
          subs.push(cb);
          inbox.splice(0).forEach(cb);
        },
        onState: (cb) => void states.push(cb),
        close: () => {
          if (l.state === 'closed') return;
          l.state = 'closed';
          states.forEach((cb) => cb('closed'));
          l.peer.close();
        },
      };
      return l;
    };
    const a = end();
    const b = end();
    [a.peer, b.peer] = [b, a];
    return [a, b];
  };
  const player = (name: string, link: Link | null, role: 'host' | 'guest') => {
    const mem = new Map([[SETTINGS_KEY, JSON.stringify({ name })]]);
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    const open = vi.fn<MpHost['open']>((_mode, done) => done(link && { link, role }));
    const bests: Record<string, BestStore> = {};
    const game = createGame(
      [garage, testpad],
      audio,
      (n) => (bests[n] ??= memBest()),
      storage,
      undefined,
      undefined,
      undefined,
      undefined,
      { open },
    );
    const tap = (input: Partial<InputState>) => {
      game.update({ ...IDLE, ...input }, DT);
      game.update(IDLE, DT);
    };
    const menu = () => game.view().hud.menu!;
    /** move the cursor down to the row with this label */
    const to = (label: string) => {
      for (let i = 0; i < 10 && menu().rows[menu().row].label !== label; i++) tap({ down: true });
    };
    const enter = (mode: 'host' | 'join') => {
      to('MULTIPLAYER');
      if (mode === 'join') tap({ right: true });
      tap({ confirm: true });
    };
    return { game, tap, menu, open, enter, bests, to, mem };
  };
  const pair = () => {
    const [a, b] = linkPair();
    return { a, b, host: player('HOSTY', a, 'host'), guest: player('GUESTY', b, 'guest') };
  };
  const value = (p: ReturnType<typeof player>, label: string) =>
    p.menu().rows.find((r) => r.label === label)?.value;

  afterEach(() => vi.unstubAllGlobals());

  it('MULTIPLAYER row toggles HOST / JOIN; pad or no host shows a note', () => {
    const p = player('HOSTY', null, 'host');
    for (let i = 0; i < 3; i++) p.tap({ down: true });
    expect(p.menu().rows[3]).toEqual({ label: 'MULTIPLAYER', value: '◀ HOST ▶' });
    p.tap({ right: true });
    expect(p.menu().rows[3].value).toBe('◀ JOIN ▶');
    expect(p.menu().selected).toBe(0); // the map is untouched
    p.tap({ confirm: true, device: 'pad' });
    expect(p.open).not.toHaveBeenCalled();
    expect(p.menu().rows[3].value).toBe('USE KEYBOARD + MOUSE');
    p.tap({ confirm: true, device: 'kb' });
    expect(p.open).toHaveBeenCalledWith('join', expect.any(Function));
    expect(p.game.debug.phase).toBe('title'); // cancelled

    const solo = createGame([garage], audio, () => memBest());
    for (const i of [{ down: true }, { down: true }, { down: true }, { confirm: true }])
      solo.update({ ...IDLE, ...i }, DT);
    expect(solo.view().hud.menu!.rows[3].value).toBe('USE KEYBOARD + MOUSE');
  });

  it('host and guest meet in the lobby, pick a map, ready up and start together', () => {
    const ghost = serialize({
      car: 'civic',
      frames: [0, 5].map((t) => ({
        t,
        ...testpad.start.pos,
        angle: 0,
        floor: testpad.start.floor,
      })),
    });
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (k === ghostKey(testpad.name) ? ghost : null),
      setItem: noop,
      removeItem: noop,
    });
    const solo = createGame([testpad], audio, () => memBest());
    solo.update({ ...IDLE, confirm: true }, DT);
    expect(solo.view().render.ghost).not.toBeNull(); // control: the best ghost loads solo

    const { host, guest } = pair();
    host.enter('host');
    expect(host.open).toHaveBeenCalledWith('host', expect.any(Function));
    expect(host.game.debug.phase).toBe('mplobby');
    expect(host.menu()).toMatchObject({
      screen: 'mplobby',
      rows: [{ label: 'LEAVE' }],
      note: 'CONNECTING...',
    });
    expect(host.menu().mp).toBeUndefined();

    guest.enter('join');
    expect(guest.open).toHaveBeenCalledWith('join', expect.any(Function));
    expect(guest.menu().rows.map((r) => r.label)).toEqual(['MAP', 'READY', 'GARAGE', 'LEAVE']);
    expect(value(guest, 'MAP')).toBe('-');
    expect(guest.menu().mp).toEqual({
      role: 'guest',
      rival: 'HOSTY',
      ready: false,
      rivalReady: false,
    });

    host.tap({}); // host picks the first map on entering the lobby
    expect(host.menu().rows.map((r) => r.label)).toEqual([
      'MAP',
      'PILLARS',
      'READY',
      'GARAGE',
      'START',
      'LEAVE',
    ]);
    expect(value(guest, 'PILLARS')).toBe('ON');
    expect(value(host, 'GARAGE')).toBe(PLAYER_MODELS.mx5.name);
    expect(host.menu().note).toBe(PLAYER_MODELS.mx5.name);
    expect(host.menu().mp!.rival).toBe('GUESTY');
    expect(value(host, 'MAP')).toBe(`◀ ${garage.name} ▶`);
    expect(value(guest, 'MAP')).toBe(garage.name);
    host.tap({ right: true });
    expect(value(guest, 'MAP')).toBe(testpad.name);
    expect(guest.menu().selected).toBe(1);
    guest.tap({ right: true }); // guest cannot pick
    expect(value(guest, 'MAP')).toBe(testpad.name);

    host.tap({ down: true });
    host.tap({ confirm: true });
    expect(value(host, 'READY')).toBe('YES');
    expect(guest.menu().mp!.rivalReady).toBe(true);
    host.tap({ down: true });
    host.tap({ down: true });
    host.tap({ confirm: true }); // START: guest not ready yet
    expect(guest.menu().note).not.toBe('GET READY');
    guest.tap({ down: true });
    guest.tap({ confirm: true });
    expect(host.menu().mp!.rivalReady).toBe(true);

    host.game.update({ ...IDLE, confirm: true }, DT); // START
    expect(host.menu().note).toBe('GET READY');
    expect(guest.menu().note).toBe('GET READY');
    for (const p of [host, guest])
      expect(p.menu().rows.find((r) => r.label === 'GARAGE')).toBeUndefined();
    const n = Math.round(START_DELAY_MS / 1000 / DT);
    const lockstep = (k: number) => {
      for (let i = 0; i < k; i++) {
        guest.game.update(IDLE, DT);
        host.game.update(IDLE, DT);
      }
    };
    lockstep(n - 1);
    expect([host.game.debug.phase, guest.game.debug.phase]).toEqual(['mplobby', 'mplobby']);
    lockstep(1);
    for (const p of [host, guest]) {
      const v = p.game.view();
      expect(v.hud.phase).toBe('countdown');
      expect(v.hud.countdown).toBeCloseTo(COUNTDOWN_SECONDS);
      expect(v.render.map).toBe(testpad);
      expect(v.render.ghost).toBeNull();
      expect(p.game.debug.car.pos).toEqual(testpad.start.pos);
    }
  });

  it('leave returns both players to the title; the other sees who left', () => {
    const { host, guest } = pair();
    host.enter('host');
    guest.enter('join');
    host.tap({});
    guest.tap({ pause: true });
    expect(guest.game.debug.phase).toBe('title');
    expect(guest.menu().toast).toBeUndefined();
    expect(guest.menu().row).toBe(3);
    host.tap({});
    expect(host.game.debug.phase).toBe('title');
    expect(host.menu().toast).toBe('GUESTY LEFT');
    expect(host.menu().row).toBe(3);
  });

  describe('lobby garage', () => {
    /** both in the lobby; guest opens the GARAGE row */
    const toGarage = () => {
      const p = pair();
      p.host.enter('host');
      p.guest.enter('join');
      p.host.tap({});
      return p;
    };
    const openGarage = (guest: ReturnType<typeof player>) => {
      guest.to('GARAGE');
      guest.tap({ confirm: true });
      expect(guest.game.debug.phase).toBe('garage');
    };
    /** next unlocked car that is not the current one */
    const nextCar = (guest: ReturnType<typeof player>) => {
      const from = guest.menu().garage!.model;
      do guest.tap({ right: true });
      while (guest.menu().garage!.lock || guest.menu().garage!.model === from);
      return guest.menu().garage!.model;
    };

    it('changing car in the garage drops ready and shows the new car to the rival', () => {
      const { host, guest } = toGarage();
      guest.to('READY');
      guest.tap({ confirm: true });
      expect(host.menu().mp!.rivalReady).toBe(true);
      openGarage(guest);
      expect(host.menu().mp!.rivalReady).toBe(false);
      const car = nextCar(guest);
      guest.tap({ confirm: true });
      expect(guest.game.debug.phase).toBe('mplobby');
      expect(guest.menu().row).toBe(3);
      expect(guest.menu().rows[3]).toEqual({ label: 'GARAGE', value: PLAYER_MODELS[car].name });
      expect(host.menu().note).toBe(PLAYER_MODELS[car].name);

      guest.tap({ up: true });
      guest.tap({ confirm: true });
      host.to('READY');
      host.tap({ confirm: true });
      host.to('START');
      host.game.update({ ...IDLE, confirm: true }, DT);
      const n = Math.round((START_DELAY_MS / 1000 + COUNTDOWN_SECONDS) / DT) + 30;
      for (let i = 0; i < n; i++) {
        guest.game.update(IDLE, DT);
        host.game.update(IDLE, DT);
      }
      expect(host.game.view().render.rivals![0]).toMatchObject({ name: 'GUESTY', model: car });
    });

    it('discarding returns to the lobby without sending a change', () => {
      const { b, host, guest } = toGarage();
      openGarage(guest);
      const send = vi.spyOn(b, 'send');
      nextCar(guest);
      guest.tap({ pause: true });
      expect(guest.game.debug.phase).toBe('mplobby');
      expect(guest.menu().row).toBe(3);
      expect(send.mock.calls.filter(([m]) => m.t === 'hello')).toHaveLength(0);
      expect(host.menu().note).toBe(PLAYER_MODELS.mx5.name);
    });

    it('the rival leaving while in the garage returns to the title', () => {
      const { host, guest } = toGarage();
      openGarage(guest);
      host.tap({ pause: true });
      guest.tap({});
      expect(guest.game.debug.phase).toBe('title');
      expect(guest.menu().toast).toBe('HOSTY LEFT');
      expect(guest.menu().row).toBe(3);
    });
  });

  it('a version mismatch closes the lobby with a refresh hint', () => {
    const { b, host } = pair();
    host.enter('host');
    b.send({ t: 'hello', v: 'old', info: { name: 'OLDIE', car: 'civic', color: '#fff' } });
    host.tap({});
    expect(host.game.debug.phase).toBe('title');
    expect(host.menu().toast).toBe('VERSION MISMATCH - REFRESH');
  });

  describe('race', () => {
    type P = ReturnType<typeof player>;
    /** lobby -> START -> both in the countdown on GARAGE */
    const race = (hazards = true) => {
      const p = pair();
      const { host, guest } = p;
      host.enter('host');
      guest.enter('join');
      host.tap({});
      if (!hazards) {
        host.to('PILLARS');
        host.tap({ right: true });
      }
      host.to('READY');
      host.tap({ confirm: true });
      guest.to('READY');
      guest.tap({ confirm: true });
      host.to('START');
      host.game.update({ ...IDLE, confirm: true }, DT);
      const lockstep = (k: number, hi: Partial<InputState> = {}, gi: Partial<InputState> = {}) => {
        for (let i = 0; i < k; i++) {
          guest.game.update({ ...IDLE, ...gi }, DT);
          host.game.update({ ...IDLE, ...hi }, DT);
        }
      };
      lockstep(Math.round(START_DELAY_MS / 1000 / DT));
      const toRun = () => lockstep(Math.round(COUNTDOWN_SECONDS / DT));
      const atFinish = (q: P) => {
        q.game.debug.floorIndex = garage.finish.floor;
        q.game.debug.car.pos = { x: garage.finish.zone.x + 1, y: garage.finish.zone.y + 1 };
      };
      const lockout = () => lockstep(Math.ceil(0.5 / DT) + 1);
      expect([host.game.debug.phase, guest.game.debug.phase]).toEqual(['countdown', 'countdown']);
      return { ...p, lockstep, toRun, atFinish, lockout };
    };

    it('shows the rival on the same floor only; single player has no rivals or mp hud', () => {
      const { host, guest, lockstep, toRun } = race();
      toRun();
      lockstep(30);
      const g = guest.game.debug.car;
      const rv = host.game.view().render.rivals!;
      expect(rv).toHaveLength(1);
      expect(rv[0]).toMatchObject({ name: 'GUESTY', model: 'mx5' });
      expect(rv[0].x).toBeCloseTo(g.pos.x, 1);
      expect(rv[0].y).toBeCloseTo(g.pos.y, 1);
      expect(host.game.view().hud.mp).toMatchObject({ rival: 'GUESTY', connected: true });
      guest.game.debug.floorIndex = garage.finish.floor;
      lockstep(30);
      expect(host.game.view().render.rivals).toEqual([]);

      const { game, toRun: soloRun } = setup();
      soloRun();
      expect(game.view().render.rivals).toBeUndefined();
      expect(game.view().hud.mp).toBeUndefined();
    });

    it("sends the rival's score to the hud", () => {
      const { host, guest, lockstep, toRun } = race();
      guest.game.debug.scoring.banked = 1234;
      toRun();
      lockstep(1);
      expect(host.game.view().hud.mp).toMatchObject({ rivalScore: 1234, rivalTotal: null });
    });

    it('MP pause keeps the clock and pose sending running with the car frozen', () => {
      const { b, host, guest, lockstep, toRun } = race();
      toRun();
      lockstep(10, {}, { throttle: 1 });
      guest.tap({ pause: true });
      expect(guest.game.debug.phase).toBe('paused');
      const t = guest.game.debug.time;
      const pos = { ...guest.game.debug.car.pos };
      const send = vi.spyOn(b, 'send');
      lockstep(60, {}, { throttle: 1 });
      expect(guest.game.debug.time).toBeCloseTo(t + 60 * DT, 5);
      expect(guest.game.debug.car.pos).toEqual(pos);
      expect(send.mock.calls.filter(([m]) => m.t === 'pose').length).toBeGreaterThan(10);
      guest.tap({ confirm: true });
      expect(guest.game.debug.phase).toBe('run');

      host.game.pause(); // blur / tab hide
      expect(host.game.debug.phase).toBe('paused');
      const ht = host.game.debug.time;
      lockstep(30);
      expect(host.game.debug.time).toBeCloseTo(ht + 30 * DT, 5);
      host.tap({ pause: true }); // quit leaves MP
      expect(host.game.debug.phase).toBe('title');
      guest.tap({});
      expect(guest.game.view().hud.mp?.toast).toBe('HOSTY DISCONNECTED');
    });

    it('MP countdown ignores blur; photo mode and restart are off', () => {
      const { guest, lockstep, toRun } = race();
      guest.game.pause();
      expect(guest.game.debug.phase).toBe('countdown');
      toRun();
      lockstep(10);
      const { runId, time } = guest.game.debug;
      guest.tap({ restart: true });
      expect(guest.game.debug.runId).toBe(runId);
      expect(guest.game.debug.time).toBeGreaterThan(time);
      guest.tap({ photo: true });
      expect(guest.game.debug.phase).toBe('run');
      guest.tap({ pause: true });
      guest.tap({ photo: true });
      expect(guest.game.debug.phase).toBe('paused');
    });

    it('host finishes first and waits; both see both totals; best is saved', () => {
      const { host, guest, lockstep, toRun, atFinish } = race();
      toRun();
      lockstep(30);
      atFinish(host);
      lockstep(1);
      const hr = host.game.view().hud;
      expect(hr.phase).toBe('results');
      expect(hr.mp!.waiting).toBe(true);
      expect(hr.results!.rival).toEqual({ name: 'GUESTY', total: null, time: null });
      expect(host.bests[garage.name].get()).toBe(hr.results!.total);
      expect(guest.game.view().hud.mp!.rivalTotal).toBe(hr.results!.total);

      lockstep(30);
      atFinish(guest);
      lockstep(1);
      const h = host.game.view().hud;
      const g = guest.game.view().hud;
      expect(g.phase).toBe('results');
      expect(h.mp!.waiting).toBe(false);
      expect(h.results!.rival).toEqual({
        name: 'GUESTY',
        total: g.results!.total,
        time: g.results!.time,
      });
      expect(g.results!.rival).toMatchObject({ name: 'HOSTY', total: h.results!.total });
      expect(guest.bests[garage.name].get()).toBe(g.results!.total);
    });

    it('over the limit both runs go on and the results compare locked scores', () => {
      const { host, guest, lockstep, toRun, atFinish } = race();
      toRun();
      const limit = garage.parTime * 1.3;
      host.game.debug.scoring.banked = 5000;
      guest.game.debug.scoring.banked = 6000;
      host.game.debug.time = guest.game.debug.time = limit - DT;
      lockstep(3);
      expect(host.game.debug.phase).toBe('run');
      expect(host.game.view().hud.timeUp).toBe(true);
      host.game.debug.scoring.banked = 9000; // banked after the limit
      lockstep(3);
      expect(guest.game.view().hud.mp!.rivalScore).toBe(5000); // the rival sees the locked score
      atFinish(host);
      atFinish(guest);
      lockstep(1);
      const h = host.game.view().hud.results!;
      const g = guest.game.view().hud.results!;
      expect(h).toMatchObject({ total: 5000, late: 4000, timeUp: true, position: null });
      expect(g).toMatchObject({ total: 6000, late: 0, timeUp: true });
      expect(h.rival).toMatchObject({ total: 6000 });
      expect(g.rival).toMatchObject({ total: 5000 });
    });

    it('a disconnect mid-run toasts, drops the ghost and lets you finish solo', () => {
      const { b, host, lockstep, toRun, atFinish } = race();
      toRun();
      lockstep(30);
      expect(host.game.view().render.rivals).toHaveLength(1);
      b.close();
      const step = (i: Partial<InputState>, n = 1) => {
        for (let k = 0; k < n; k++) host.game.update({ ...IDLE, ...i }, DT);
      };
      step({});
      let v = host.game.view();
      expect(v.hud.phase).toBe('run');
      expect(v.hud.mp).toMatchObject({ toast: 'GUESTY DISCONNECTED', connected: false });
      expect(v.render.rivals).toEqual([]);
      const pos = { ...host.game.debug.car.pos };
      step({ throttle: 1 }, 200);
      expect(host.game.debug.phase).toBe('run');
      expect(host.game.debug.car.pos).not.toEqual(pos);
      expect(host.game.view().hud.mp!.toast).toBeUndefined();
      atFinish(host);
      step({});
      v = host.game.view();
      expect(v.hud.results!.rival!.total).toBeNull();
      expect(v.hud.mp!.waiting).toBe(false);
      step({}, 40);
      step({ confirm: true });
      expect(host.game.debug.phase).toBe('title');
      expect(host.menu().row).toBe(3);
    });

    it('rematch: guest confirm waits, host confirm takes both back to the lobby', () => {
      const { host, guest, lockstep, toRun, atFinish, lockout } = race();
      toRun();
      atFinish(host);
      atFinish(guest);
      lockstep(1);
      lockout();
      expect(guest.game.view().hud.results!.carPick).toBe(false);
      guest.tap({ confirm: true });
      expect(guest.game.debug.phase).toBe('results');
      host.tap({ confirm: true });
      expect(host.game.debug.phase).toBe('mplobby');
      guest.tap({});
      expect(guest.game.debug.phase).toBe('mplobby');
      for (const p of [host, guest]) {
        expect(p.menu().mp).toMatchObject({ ready: false, rivalReady: false });
        expect(p.game.debug.time).toBe(0);
      }
      expect(value(host, 'MAP')).toBe(`◀ ${garage.name} ▶`);
      expect(value(guest, 'MAP')).toBe(garage.name);
      guest.tap({ pause: true });
      expect(guest.game.debug.phase).toBe('title');
    });

    it('PILLARS OFF from the host: the guest sees it, ready drops, both race without pillars', () => {
      const { host, guest } = pair();
      host.enter('host');
      guest.enter('join');
      host.tap({});
      guest.to('READY');
      guest.tap({ confirm: true });
      host.to('PILLARS');
      host.tap({ right: true });
      expect(value(host, 'PILLARS')).toBe('OFF');
      expect(value(guest, 'PILLARS')).toBe('OFF');
      expect(guest.menu().mp!.ready).toBe(false);
      expect(JSON.parse(host.mem.get(SETTINGS_KEY)!).hazards).toEqual({ [garage.name]: false });
      guest.to('PILLARS');
      guest.tap({ right: true }); // read-only for the guest
      guest.tap({ confirm: true });
      expect(value(guest, 'PILLARS')).toBe('OFF');
      host.tap({ up: true });
      host.tap({ right: true });
      expect(guest.menu().rows.map((r) => r.label)).not.toContain('PILLARS');
      host.tap({ left: true }); // back on B2 MEET: the host's saved choice comes along
      expect(value(guest, 'PILLARS')).toBe('OFF');

      const r = race(false);
      for (const p of [r.host, r.guest]) {
        const m = p.game.view().render.map;
        expect(m.name).toBe(garage.name);
        expect(m.floors.some((f) => f.solids.some((s) => s.kind === 'pillar'))).toBe(false);
      }
    });

    it('cursors stay on their row when the PILLARS row comes and goes', () => {
      const { host, guest } = pair();
      host.enter('host');
      guest.enter('join');
      host.tap({});
      guest.to('READY');
      const at = (p: typeof host) => p.menu().rows[p.menu().row].label;
      for (const dir of [{ right: true }, { left: true }]) {
        host.tap(dir);
        expect(guest.menu().rows.some((r) => r.label === 'PILLARS')).toBe('left' in dir);
        expect(at(guest)).toBe('READY');
        guest.tap({});
        expect(at(guest)).toBe('READY');
        expect(at(host)).toBe('MAP');
      }
      guest.tap({ up: true });
      expect(at(guest)).toBe('PILLARS');
      host.tap({ right: true }); // the guest's row vanishes: on to the next one
      expect(at(guest)).toBe('READY');
      guest.tap({});
      expect(at(guest)).toBe('READY');
    });
  });

  describe('time-up edge cases (multiplayer)', () => {
    it('no last-seconds beeps while paused', () => {
      const p = pair();
      const { host, guest } = p;
      host.enter('host');
      guest.enter('join');
      host.tap({});
      host.to('READY');
      host.tap({ confirm: true });
      guest.to('READY');
      guest.tap({ confirm: true });
      host.to('START');
      host.game.update({ ...IDLE, confirm: true }, DT);
      for (let i = 0; i < Math.round((START_DELAY_MS / 1000 + COUNTDOWN_SECONDS) / DT) + 2; i++) {
        guest.game.update(IDLE, DT);
        host.game.update(IDLE, DT);
      }
      guest.tap({ pause: true });
      expect(guest.game.debug.phase).toBe('paused');
      guest.game.debug.time = garage.parTime * 1.3 - 2.5;
      const ui = vi.spyOn(audio, 'ui');
      for (let i = 0; i < Math.ceil(3 / DT); i++) guest.game.update(IDLE, DT);
      expect(ui).not.toHaveBeenCalled();
      ui.mockRestore();
    });
  });
});

describe('time limit', () => {
  const LIMIT = garage.parTime * 1.3;
  function rig(map: GameMap = garage) {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    const ghosts = vi.fn();
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: ghosts, removeItem: noop });
    const set = vi.fn();
    const ui = vi.fn();
    const prog0: Progress = { ...defaultProgress(), starterChosen: true };
    const game = createGame(
      [map],
      { ...audio, ui },
      () => ({ get: () => 0, set }),
      storage,
      undefined,
      undefined,
      prog0,
    );
    const step = (input: Partial<InputState> = {}, frames = 1) => {
      for (let i = 0; i < frames; i++) game.update({ ...IDLE, ...input }, DT);
    };
    step({ confirm: true });
    step({}, Math.round(COUNTDOWN_SECONDS / DT));
    const finishNow = () => {
      game.debug.floorIndex = map.finish.floor;
      game.debug.car.pos = { x: map.finish.zone.x + 1, y: map.finish.zone.y + 1 };
      step();
    };
    /** bank a combo worth `points` */
    const bank = (points: number) => {
      game.debug.scoring.combo = { points, multiplier: 1, tricks: ['DRIFT'], grace: 0.05 };
      step({}, 10);
    };
    /** let the limit pass with `banked` points in the bank */
    const lock = (banked: number) => {
      game.debug.scoring.banked = banked;
      game.debug.time = LIMIT - DT / 2;
      step();
    };
    return {
      game,
      step,
      ui,
      set,
      ghosts,
      finishNow,
      bank,
      lock,
      prog: () => loadProgress(storage),
    };
  }
  afterEach(() => vi.unstubAllGlobals());

  it('the HUD carries par x1.3 on maps with positions, nothing on TEST PAD', () => {
    const { game } = rig();
    expect(game.view().hud.limit).toBeCloseTo(LIMIT);
    expect(game.view().hud.timeUp).toBe(false);
    expect(rig(testpad).game.view().hud.limit).toBe(0);
  });

  it('the run goes on past the limit with the score locked', () => {
    const { game, step, lock } = rig();
    lock(5000);
    step({}, 30);
    const h = game.view().hud;
    expect(h.phase).toBe('run');
    expect(h).toMatchObject({ timeUp: true, score: 5000, late: 0 });
    expect(h.time).toBeGreaterThan(LIMIT);
  });

  it('points banked after the limit show as late and stay out of the total, best and saves', () => {
    const { game, lock, bank, finishNow, set, ghosts, prog } = rig();
    lock(5000);
    bank(3000);
    const h = game.view().hud;
    expect(h).toMatchObject({ score: 5000, late: 3000 });
    expect(h.popups.find((p) => p.kind === 'bank')!.late).toBe(true);
    finishNow();
    const r = game.view().hud.results!;
    expect(r).toMatchObject({ timeUp: true, comboPoints: 5000, late: 3000, total: 5000 });
    expect(r.timeBonus).toBe(0);
    expect(r.position).toBeNull();
    expect(r.newBest).toBe(true); // the locked score is still a best
    expect(set).toHaveBeenCalledWith(5000);
    expect(ghosts).toHaveBeenCalled();
    expect(r.drifts).toMatchObject([{ amount: 3000, late: true }]);
    expect(prog().results).toEqual({});
    expect(prog().carPicks).toBe(0);
  });

  it('a combo running at the limit does not count, even if it banks at the finish', () => {
    const { game, step, lock, finishNow } = rig();
    game.debug.scoring.combo = { points: 4000, multiplier: 2, tricks: ['DRIFT'], grace: 5 };
    step();
    lock(1000);
    step({}, 10);
    expect(game.debug.scoring.combo).not.toBeNull();
    finishNow(); // forceBank at the finish
    const r = game.view().hud.results!;
    expect(r).toMatchObject({ total: 1000, late: 8000, timeUp: true });
    expect(r.drifts).toMatchObject([{ amount: 8000, late: true }]);
  });

  it('a combo banked just before the limit counts', () => {
    const { game, step, bank, lock, finishNow } = rig();
    game.debug.time = LIMIT - 2;
    bank(3000);
    expect(game.view().hud.timeUp).toBe(false);
    lock(game.debug.scoring.banked);
    step();
    finishNow();
    expect(game.view().hud.results).toMatchObject({ total: 3000, late: 0, timeUp: true });
  });

  it('finishing just under the limit still counts and places', () => {
    const { game, finishNow, set, prog } = rig();
    game.debug.scoring.banked = 1e6;
    game.debug.time = LIMIT - 1;
    finishNow();
    const r = game.view().hud.results!;
    expect(r.timeUp).toBe(false);
    expect(r.late).toBe(0);
    expect(r.position).toBe(3); // par x1.3 is the 3rd-place time
    expect(set).toHaveBeenCalled();
    expect(prog().results[garage.name].position).toBe(3);
  });

  it('a huge score banked after the limit gets no place', () => {
    const { game, lock, bank, finishNow, prog } = rig();
    lock(10);
    bank(1e6);
    finishNow();
    expect(game.view().hud.results).toMatchObject({ total: 10, late: 1e6, position: null });
    expect(prog().results).toEqual({});
  });

  it('TEST PAD has no limit', () => {
    const { game, step } = rig(testpad);
    game.debug.time = 1e5;
    step({}, 5);
    expect(game.view().hud.phase).toBe('run');
    expect(game.view().hud.timeUp).toBe(false);
  });

  it('pause and photo mode freeze the timer', () => {
    const { game, step } = rig();
    game.debug.time = LIMIT - 1;
    step({ pause: true });
    step({}, Math.ceil(3 / DT));
    expect(game.view().hud.phase).toBe('paused');
    step({ photo: true });
    step({}, Math.ceil(3 / DT));
    step({ pause: true }); // leave photo
    step({ confirm: true }); // resume
    expect(game.view().hud.phase).toBe('run');
    expect(game.debug.time).toBeCloseTo(LIMIT - 1, 1);
    expect(game.view().hud.timeUp).toBe(false);
  });

  it('beeps once per second for the last 5 seconds, then the run goes on', () => {
    const { game, step, ui } = rig();
    game.debug.time = LIMIT - 8;
    ui.mockClear();
    step({}, Math.ceil(9 / DT)); // past the limit
    expect(ui.mock.calls.map((c) => c[0])).toEqual(['count', 'count', 'count', 'count', 'count']);
    expect(game.view().hud.phase).toBe('run');
    expect(game.view().hud.timeUp).toBe(true);
  });
});

describe('top drifts with late (not counted) drifts', () => {
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
    const step = (frames = 1, confirm = false) => {
      for (let i = 0; i < frames; i++) game.update({ ...IDLE, confirm }, DT);
    };
    step(1, true);
    step(Math.round(COUNTDOWN_SECONDS / DT));
    const bank = (points: number) => {
      game.debug.scoring.combo = { points, multiplier: 1, tricks: ['DRIFT'], grace: 0.05 };
      step(10);
      return vi.mocked(clips.mark).mock.lastCall![0];
    };
    const lock = () => {
      game.debug.time = garage.parTime * 1.3 + 1;
      step(2);
    };
    const finish = () => {
      game.debug.floorIndex = garage.finish.floor;
      game.debug.car.pos = { x: garage.finish.zone.x + 1, y: garage.finish.zone.y + 1 };
      step();
      return game.view().hud.results!.drifts.map((d) => [d.amount, d.late]);
    };
    return { clips, bank, lock, finish };
  }

  it('a bigger late drift never pushes out 3 counted ones', () => {
    const { clips, bank, lock, finish } = rig();
    bank(100);
    bank(200);
    bank(300);
    lock();
    const late = bank(900);
    expect(clips.drop).toHaveBeenCalledWith(late);
    expect(finish()).toEqual([
      [300, false],
      [200, false],
      [100, false],
    ]);
  });

  it('shows a late drift when fewer than 3 are counted', () => {
    const { bank, lock, finish } = rig();
    bank(100);
    lock();
    bank(900);
    expect(finish()).toEqual([
      [100, false],
      [900, true],
    ]);

describe('time-up edge cases', () => {
  const LIMIT = garage.parTime * 1.3;
  function rig() {
    const game = createGame([garage], audio, () => memBest());
    const step = (input: Partial<InputState> = {}, frames = 1) => {
      for (let i = 0; i < frames; i++) game.update({ ...IDLE, ...input }, DT);
    };
    step({ confirm: true });
    step({}, Math.round(COUNTDOWN_SECONDS / DT));
    return { game, step };
  }
  /** car against the north wall, driving into it */
  const slam = (game: ReturnType<typeof rig>['game']) => {
    game.debug.car.pos = { x: 70, y: 5 };
    game.debug.car.angle = -Math.PI / 2;
    game.debug.car.vel = { x: 0, y: -12 };
  };

  it('a combo that banks in the frame the time runs out counts', () => {
    const { game, step } = rig();
    game.debug.scoring.combo = { points: 3000, multiplier: 1, tricks: ['DRIFT'], grace: 0.001 };
    game.debug.time = LIMIT - DT / 2;
    step();
    expect(game.debug.scoring.banked).toBe(3000);
    expect(game.view().hud).toMatchObject({ timeUp: true, score: 3000, late: 0 });
    expect(game.view().hud.popups.find((p) => p.kind === 'bank')!.late).toBe(false);
  });

  it('wall hits after time up are not counted', () => {
    const { game, step } = rig();
    slam(game);
    step({ throttle: 1 }, 20);
    step();
    expect(game.debug.wallHits).toBeGreaterThan(0); // the setup does hit
    const n = game.debug.wallHits;
    game.debug.time = LIMIT + 1;
    step();
    slam(game);
    step({ throttle: 1 }, 20);
    step();
    expect(game.debug.wallHits).toBe(n);
  });
});
