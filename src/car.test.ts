import { describe, expect, it } from 'vitest';
import { bounce, createCar, stepCar, TUNING } from './car';
import { DT } from './config';
import { PLAYER_MODELS, type CarStats } from './models';
import { collide } from './collision';
import type { CarState, DriftInfo, InputState, Solid } from './types';

const input = (o: Partial<InputState> = {}): InputState => ({
  steer: 0,
  throttle: 0,
  brake: 0,
  handbrake: false,
  pause: false,
  restart: false,
  confirm: false,
  left: false,
  right: false,
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

describe('clutch kick', () => {
  const peakSlip = (c: CarState, revSeconds: number) => {
    run(c, input({ throttle: 1, clutch: true, steer: 1 }), revSeconds);
    return Math.max(...run(c, input({ throttle: 1, steer: 1 }), 0.8).map((d) => Math.abs(d.slip)));
  };

  it('holding the clutch gives no drive and revs climb', () => {
    const c = createCar({ pos: { x: 0, y: 0 }, angle: 0 });
    run(c, input({ throttle: 1, clutch: true }), 1);
    expect(speed(c)).toBe(0);
    expect(c.rpm).toBeGreaterThan(0.95);
  });

  it('releasing at high rpm kicks the rear out more than no clutch', () => {
    const plain = movingCar(60);
    const plainSlip = Math.max(
      ...run(plain, input({ throttle: 1, steer: 1 }), 0.8).map((d) => Math.abs(d.slip)),
    );
    const clutched = movingCar(60);
    expect(peakSlip(clutched, 0.8)).toBeGreaterThan(plainSlip + 0.1);
  });

  it('releasing at low rpm does almost nothing', () => {
    const plain = movingCar(60);
    run(plain, input({ throttle: 1, steer: 1 }), 0.1);
    const c = movingCar(60);
    c.rpm = 0.3;
    run(c, input({ throttle: 1, clutch: true, steer: 1 }), 0.05); // rpm stays under clutchMinRpm
    run(c, input({ throttle: 1, steer: 1 }), 0.05);
    expect(Math.abs(c.angle - plain.angle)).toBeLessThan(0.02);
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

describe('model stats', () => {
  const kmh100 = (stats?: CarStats) => {
    const c = createCar({ pos: { x: 0, y: 0 }, angle: 0 }, stats);
    let t = 0;
    while (c.vel.x < 100 / 3.6 && t < 60) {
      stepCar(c, input({ throttle: 1 }), DT);
      t += DT;
    }
    return t;
  };
  it('default stats match no stats', () => {
    const a = createCar({ pos: { x: 0, y: 0 }, angle: 0 });
    const b = createCar({ pos: { x: 0, y: 0 }, angle: 0 }, { power: 1, grip: 1, mass: 1 });
    run(a, drift(), 2);
    run(b, drift(), 2);
    expect(b.pos).toEqual(a.pos);
  });
  it('Supra accelerates faster than AE86', () => {
    expect(kmh100(PLAYER_MODELS.supra.stats)).toBeLessThan(kmh100(PLAYER_MODELS.ae86.stats));
  });
  for (const [key, m] of Object.entries(PLAYER_MODELS)) {
    it(`${key}: accelerates, drifts through a corner, reverses stable`, () => {
      const a = createCar({ pos: { x: 0, y: 0 }, angle: 0 }, m.stats);
      run(a, input({ throttle: 1 }), 2.5);
      expect(speed(a)).toBeGreaterThan(10);

      const c = movingCar(70);
      c.stats = m.stats;
      const track = trackRun(c, [
        [kick, 0.3],
        [drift(), 2.7],
      ]);
      expect(track.drifting).toBeGreaterThanOrEqual(1);
      expect(track.rotation).toBeGreaterThanOrEqual((70 * Math.PI) / 180);

      const r = movingCar(-15);
      r.stats = m.stats;
      let maxAng = 0;
      for (let i = 0; i < Math.round(4 / DT); i++) {
        stepCar(r, input({ brake: 1, steer: 0.5 }), DT);
        maxAng = Math.max(maxAng, Math.abs(r.angVel));
      }
      expect(maxAng).toBeLessThan(1.5);
    });
  }
});

const box = (cx: number, cy: number, w: number, h: number, angle: number): Solid => ({
  x: cx - w / 2,
  y: cy - h / 2,
  w,
  h,
  angle,
  kind: 'wall',
});
function runSolids(car: CarState, solids: Solid[], inp: InputState, secs: number): number {
  let maxDepth = 0;
  for (let i = 0; i < secs * 60; i++) {
    stepCar(car, inp, DT);
    const hit = collide(car, solids);
    if (hit) bounce(car, hit);
    maxDepth = Math.max(maxDepth, collide(car, solids)?.depth ?? 0);
  }
  return maxDepth;
}
const dist = (c: CarState, s: Solid) =>
  Math.hypot(c.pos.x - (s.x + s.w / 2), c.pos.y - (s.y + s.h / 2));

describe('stuck recovery on rotated solids', () => {
  for (const ang of [0.3, 0.8])
    for (const approach of [0, Math.PI / 6, Math.PI / 3])
      for (const v of [10, 25]) {
        it(`rot ${ang} approach ${approach.toFixed(2)} v ${v}`, () => {
          const s = box(0, 0, 6, 2.5, ang);
          const heading = ang + Math.PI / 2 + approach; // toward the solid's long face
          const car = createCar({
            pos: { x: -Math.cos(heading) * 15, y: -Math.sin(heading) * 15 },
            angle: heading,
          });
          car.vel = { x: Math.cos(heading) * v, y: Math.sin(heading) * v };
          const d = runSolids(car, [s], input({ throttle: 1 }), 3);
          expect(d).toBeLessThan(0.2);
          expect(collide(car, [s])?.depth ?? 0).toBeLessThan(0.2);
          const d0 = dist(car, s);
          runSolids(car, [s], input({ brake: 1 }), 2);
          expect(dist(car, s) - d0).toBeGreaterThan(2);
          runSolids(car, [s], input({ throttle: 1, steer: 1 }), 3);
          expect(collide(car, [s])?.depth ?? 0).toBeLessThan(0.2);
        });
      }
  it('wedged in a corner reverses out', () => {
    const a = box(0, -3, 8, 2, 0.4);
    const b = box(4, 2, 8, 2, 0.4 + Math.PI / 2);
    for (const hd of [0.4 + 1, 0.4 + 1.4, 2.2]) {
      const car = createCar({ pos: { x: 0, y: 0 }, angle: hd });
      runSolids(car, [a, b], input({ throttle: 1 }), 3);
      const p = { ...car.pos };
      runSolids(car, [a, b], input({ brake: 1 }), 2);
      expect(Math.hypot(car.pos.x - p.x, car.pos.y - p.y)).toBeGreaterThan(1);
    }
  });
});

describe('wall scrape', () => {
  it('shallow scrape with throttle keeps sliding along the wall', () => {
    const wall: Solid = { x: -100, y: 0, w: 200, h: 2, angle: 0.5, kind: 'wall' };
    const hd = 0.5 + (8 * Math.PI) / 180;
    const car = createCar({ pos: { x: 0, y: -6 }, angle: hd });
    car.vel = { x: Math.cos(hd) * 15, y: Math.sin(hd) * 15 };
    runSolids(car, [wall], input({ throttle: 1 }), 5);
    expect(Math.hypot(car.vel.x, car.vel.y)).toBeGreaterThan(5);
  });
});
