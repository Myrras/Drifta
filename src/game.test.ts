import { describe, expect, it, vi } from 'vitest';
import { createGame, type AudioLike, type BestStore } from './game';
import { garage } from './maps/garage';
import { COUNTDOWN_SECONDS, DT } from './config';
import type { GameMap, InputState } from './types';

const noop = () => {};
const audio: AudioLike = {
  resume: noop,
  update: noop,
  hit: noop,
  bank: noop,
  fail: noop,
  stop: noop,
};
const IDLE: InputState = {
  steer: 0,
  throttle: 0,
  brake: 0,
  handbrake: false,
  pause: false,
  restart: false,
  confirm: false,
};

function memBest(v = 0): BestStore {
  return { get: () => v, set: (n) => (v = n) };
}

function setup(best = memBest()) {
  const game = createGame(garage, audio, best);
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

  it('finishes on the ground floor and stores a new best', () => {
    const { game, step, toRun, best } = setup();
    toRun();
    game.debug.floorIndex = 2;
    game.debug.car.pos = { x: 134, y: 12 };
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
    game.debug.floorIndex = 2;
    game.debug.car.pos = { x: 134, y: 12 };
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
    step({ pause: true });
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
    const game = createGame(garage, { ...audio, stop }, memBest());
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
    game.debug.floorIndex = 2;
    game.debug.car.pos = { x: 134, y: 12 };
    step();
    step({ confirm: true }, 10);
    expect(game.view().hud.phase).toBe('results');
    step({}, Math.ceil(0.5 / DT));
    step({ confirm: true });
    expect(game.view().hud.phase).toBe('countdown');
  });

  it('reads best once', () => {
    const get = vi.fn(() => 0);
    const game = createGame(garage, audio, { get, set: noop });
    game.update({ ...IDLE, confirm: true }, DT);
    game.view();
    game.view();
    expect(get).toHaveBeenCalledTimes(1);
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
    const game = createGame(map, audio, memBest());
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
