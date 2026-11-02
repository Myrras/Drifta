import { describe, expect, it } from 'vitest';
import { bounce, createCar, stepCar, TUNING } from './car';
import { DT } from './config';
import type { CarState, DriftInfo, InputState } from './types';

const input = (o: Partial<InputState> = {}): InputState => ({
  steer: 0,
  throttle: 0,
  brake: 0,
  handbrake: false,
  pause: false,
  restart: false,
  confirm: false,
  ...o,
});
const speed = (c: CarState) => Math.hypot(c.vel.x, c.vel.y);
const run = (c: CarState, inp: InputState, seconds: number): DriftInfo[] =>
  Array.from({ length: Math.round(seconds / DT) }, () => stepCar(c, inp, DT));
const movingCar = (kmh: number) => {
  const c = createCar({ pos: { x: 0, y: 0 }, angle: 0 });
  c.vel.x = kmh / 3.6;
  return c;
};

describe('car', () => {
  it('accelerates forward along its heading', () => {
    const angle = 0.7;
    const c = createCar({ pos: { x: 5, y: 5 }, angle });
    run(c, input({ throttle: 1 }), 2);
    expect(speed(c)).toBeGreaterThan(10);
    const along = c.vel.x * Math.cos(angle) + c.vel.y * Math.sin(angle);
    expect(along).toBeGreaterThan(0.99 * speed(c));
  });

  it('coasts to a stop', () => {
    const c = createCar({ pos: { x: 0, y: 0 }, angle: 0 });
    run(c, input({ throttle: 1 }), 5);
    let last = speed(c);
    for (let s = 0; s < 40; s++) {
      run(c, input(), 1);
      expect(speed(c)).toBeLessThanOrEqual(last);
      last = speed(c);
    }
    expect(last).toBeLessThan(0.1);
  });

  it('reverses slowly when braking at a standstill', () => {
    const c = createCar({ pos: { x: 0, y: 0 }, angle: 0 });
    run(c, input({ brake: 1 }), 5);
    expect(c.vel.x).toBeLessThan(-2);
    expect(speed(c)).toBeLessThanOrEqual(TUNING.reverseTopSpeed);
  });

  it('kicks into a drift with handbrake and full steer', () => {
    const c = movingCar(60);
    const infos = run(c, input({ steer: 1, handbrake: true }), 1);
    expect(infos.some((d) => d.drifting)).toBe(true);
  });

  it('does not count a slow slide as drifting', () => {
    const c = createCar({ pos: { x: 0, y: 0 }, angle: 0 });
    c.vel = { x: 4, y: 4 }; // 45 deg slip, ~20 km/h
    const d = stepCar(c, input(), DT);
    expect(Math.abs(d.slip)).toBeGreaterThan(0.5);
    expect(d.speedKmh).toBeLessThan(30);
    expect(d.drifting).toBe(false);
  });

  it('drives straight without slip', () => {
    const c = createCar({ pos: { x: 0, y: 0 }, angle: -1.2 });
    for (const d of run(c, input({ throttle: 1 }), 4)) {
      expect(d.drifting).toBe(false);
      expect(Math.abs(d.slip)).toBeLessThan(1e-6);
    }
  });

  it('bounces off a wall head-on', () => {
    const c = movingCar(72); // 20 m/s toward +x
    c.pos = { x: 10, y: 3 };
    bounce(c, { normal: { x: -1, y: 0 }, depth: 0.25 });
    expect(c.pos).toEqual({ x: 9.75, y: 3 });
    expect(c.vel.x).toBeLessThan(0);
    expect(speed(c)).toBeLessThanOrEqual(0.6 * 20);
  });

  it('holds a drift for over 1.5 s with throttle and countersteer', () => {
    const c = movingCar(60);
    const infos = [
      ...run(c, input({ steer: 1, throttle: 0.5, handbrake: true }), 0.4),
      ...run(c, input({ steer: -0.3, throttle: 0.5 }), 4),
    ];
    const drifting = infos.filter((d) => d.drifting).length * DT;
    expect(drifting).toBeGreaterThanOrEqual(1.5);
    // still under control: never spun past 90 deg
    expect(Math.max(...infos.map((d) => Math.abs(d.slip)))).toBeLessThan(Math.PI / 2);
  });
});
