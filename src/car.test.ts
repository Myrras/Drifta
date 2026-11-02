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

  it('backs up straight along -heading with brake held from rest', () => {
    const angle = 0.7;
    const c = createCar({ pos: { x: 0, y: 0 }, angle });
    const infos = run(c, input({ brake: 1 }), 3);
    const along = c.vel.x * Math.cos(angle) + c.vel.y * Math.sin(angle);
    expect(along).toBeLessThan(-0.99 * speed(c));
    expect(Math.abs(c.angVel)).toBeLessThan(1e-6);
    expect(infos.at(-1)!.speedKmh).toBeGreaterThan(10);
    expect(Math.max(...infos.map((d) => d.speedKmh))).toBeLessThanOrEqual(25);
  });

  it('tracks a stable circle reversing with constant steer', () => {
    const c = movingCar(-15);
    const angVels: number[] = [];
    let maxSlip = 0;
    for (const d of run(c, input({ brake: 1, steer: 0.5 }), 4)) {
      angVels.push(Math.abs(c.angVel));
      maxSlip = Math.max(maxSlip, Math.PI - Math.abs(d.slip)); // slip relative to backward motion
    }
    expect(Math.max(...angVels)).toBeLessThan(1.5);
    const last = angVels.slice(-Math.round(1 / DT));
    expect(Math.max(...last) - Math.min(...last)).toBeLessThan(0.02);
    expect(last.at(-1)!).toBeLessThanOrEqual(last[0]! + 1e-3);
    expect(maxSlip).toBeLessThan((20 * Math.PI) / 180);
  });

  it('swings the rear to the right when reversing with steer right', () => {
    // forward with steer right yaws clockwise (+); backing up the same lock yaws the other way
    const fwd = movingCar(15);
    run(fwd, input({ steer: 1 }), 0.5);
    expect(fwd.angVel).toBeGreaterThan(0.3);
    const c = movingCar(-15);
    run(c, input({ brake: 1, steer: 1 }), 1);
    expect(c.angVel).toBeLessThan(-0.3);
    expect(c.pos.y).toBeGreaterThan(0.5); // backing toward the car's right side (+y at angle 0)
  });

  it('brakes to a stop with throttle while rolling backward before driving forward', () => {
    const c = movingCar(-20);
    const vfs = Array.from({ length: Math.round(2 / DT) }, () => {
      stepCar(c, input({ throttle: 1 }), DT);
      return c.vel.x;
    });
    const firstForward = vfs.findIndex((v) => v > 0);
    expect(firstForward).toBeGreaterThan(0);
    expect(firstForward * DT).toBeLessThan(0.6); // brake-strength decel, not engine
    expect(Math.abs(vfs[firstForward - 1]!)).toBeLessThan(0.5);
    expect(vfs.at(-1)!).toBeGreaterThan(3);
  });

  it('J-turns: reversing fast with full steer rotates ~180 deg and stops rotating', () => {
    const c = createCar({ pos: { x: 0, y: 0 }, angle: 0 });
    run(c, input({ brake: 1 }), 4);
    const start = c.angle;
    run(c, input({ steer: 1 }), 6);
    expect(Math.abs(c.angle - start)).toBeGreaterThan((135 * Math.PI) / 180);
    expect(Math.abs(c.angle - start)).toBeLessThan((225 * Math.PI) / 180);
    expect(Math.abs(c.angVel)).toBeLessThan(0.1);
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

  it('holds a drift on throttle after the handbrake is released', () => {
    const c = movingCar(60);
    const infos = [...run(c, kick, 0.4), ...run(c, drift(), 4)];
    expect(infos.filter((d) => d.drifting).length * DT).toBeGreaterThanOrEqual(1.5);
    // still under control: never spun past 90 deg
    expect(Math.max(...infos.map((d) => Math.abs(d.slip)))).toBeLessThan(Math.PI / 2);
  });

  it('arcs through a tight 90 deg corner instead of sliding wide', () => {
    const c = movingCar(70);
    const track = trackRun(c, [
      [kick, 0.3],
      [drift(), 2.7],
    ]);
    expect(track.rotation).toBeGreaterThanOrEqual((80 * Math.PI) / 180);
    expect(track.drifting).toBeGreaterThanOrEqual(1);
    expect(track.maxX - track.minX).toBeLessThan(25);
    expect(track.maxY - track.minY).toBeLessThan(25);
    expect(track.minKmh).toBeGreaterThan(30);
  });

  it('turns the path faster with more steer into the drift', () => {
    const rotation = (steer: number) =>
      trackRun(movingCar(70), [
        [kick, 0.3],
        [drift(steer), 1.2],
      ]).rotation;
    expect(rotation(0.6)).toBeGreaterThan(rotation(0.3) + 0.1);
  });

  it('straightens out when lifting off and centring the wheel', () => {
    const c = movingCar(70);
    const infos = [...run(c, kick, 0.3), ...run(c, drift(), 1.2)];
    expect(infos.at(-1)!.drifting).toBe(true);
    const after = run(c, input(), 1.2);
    expect(Math.abs(after.at(-1)!.slip)).toBeLessThan((8 * Math.PI) / 180);
  });
});

const kick = input({ steer: 1, handbrake: true });
const drift = (steer = 0.5) => input({ steer, throttle: 0.7 });

/** Runs input segments; tracks unwrapped velocity rotation (clockwise +), bounding box, drift time, min speed. */
function trackRun(c: CarState, segments: [InputState, number][]) {
  const t = {
    rotation: 0,
    drifting: 0,
    minX: c.pos.x,
    maxX: c.pos.x,
    minY: c.pos.y,
    maxY: c.pos.y,
    minKmh: Infinity,
  };
  let heading = Math.atan2(c.vel.y, c.vel.x);
  for (const [inp, seconds] of segments) {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      const d = stepCar(c, inp, DT);
      const h = Math.atan2(c.vel.y, c.vel.x);
      t.rotation += Math.atan2(Math.sin(h - heading), Math.cos(h - heading));
      heading = h;
      if (d.drifting) t.drifting += DT;
      t.minX = Math.min(t.minX, c.pos.x);
      t.maxX = Math.max(t.maxX, c.pos.x);
      t.minY = Math.min(t.minY, c.pos.y);
      t.maxY = Math.max(t.maxY, c.pos.y);
      t.minKmh = Math.min(t.minKmh, d.speedKmh);
    }
  }
  return t;
}
