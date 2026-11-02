import { describe, expect, it } from 'vitest';
import { createGame, type AudioLike, type BestStore } from './game';
import { garage } from './maps/garage';
import { COUNTDOWN_SECONDS, DT, FLOOR_FADE_SECONDS } from './config';
import type { InputState } from './types';

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

  it('moves to the next floor through a ramp', () => {
    const { game, step, toRun } = setup();
    toRun();
    game.debug.car.pos = { x: 7, y: 57.5 };
    step({}, 2);
    expect(game.view().render.fade).toBeGreaterThan(0);
    step({}, Math.ceil(FLOOR_FADE_SECONDS / DT));
    const spawn = garage.floors[0].ramps[0].spawn;
    expect(game.debug.floorIndex).toBe(1);
    expect(game.debug.car.pos.x).toBeCloseTo(spawn.pos.x);
    expect(game.debug.car.pos.y).toBeCloseTo(spawn.pos.y);
    expect(game.view().render.fade).toBe(0);
    expect(game.view().hud.floorName).toBe('LEVEL 2');
  });

  it('finishes on the ground floor and stores a new best', () => {
    const { game, step, toRun, best } = setup();
    toRun();
    game.debug.floorIndex = 2;
    game.debug.car.pos = { x: 7, y: 57.5 };
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
    game.debug.car.pos = { x: 7, y: 57.5 };
    step();
    expect(game.view().hud.results!.newBest).toBe(false);
    expect(best.get()).toBe(1e9);
  });

  it('fails the combo on a hard hit', () => {
    const { game, step, toRun } = setup();
    toRun();
    startCombo(game);
    Object.assign(game.debug.car, { pos: { x: 116, y: 12.5 }, angle: 0, vel: { x: 20, y: 0 } });
    step({}, 10);
    expect(game.debug.scoring.combo).toBeNull();
    expect(game.view().hud.popups.some((p) => p.kind === 'fail')).toBe(true);
    expect(game.view().render.shake).toBeGreaterThan(0);
  });

  it('does not fail on a low-speed scrape', () => {
    const { game, step, toRun } = setup();
    toRun();
    startCombo(game);
    Object.assign(game.debug.car, { pos: { x: 116.9, y: 12.5 }, angle: 0, vel: { x: 1, y: 0 } });
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
});
