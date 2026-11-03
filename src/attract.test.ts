import { describe, expect, it } from 'vitest';
import { createAttractDriver } from './attract';
import { bounce, createCar, stepCar } from './car';
import { collide } from './collision';
import { DT, PHYSICS_HZ } from './config';
import { docks, docksRoute } from './maps/docks';

describe('attract driver', () => {
  it('drifts along the docks route without getting stuck', () => {
    const route = docksRoute[0].points;
    const { solids, circles } = docks.floors[0];
    const car = createCar(docks.start);
    const driver = createAttractDriver(route);
    let next = 1; // next route point to pass, in order
    let slipping = 0;
    let slow = 0;
    let maxSlow = 0;
    const steps = 60 * PHYSICS_HZ;
    for (let i = 0; i < steps; i++) {
      const drift = stepCar(car, driver.input(car, DT), DT);
      const near = solids.filter(
        (o) =>
          Math.hypot(o.x + o.w / 2 - car.pos.x, o.y + o.h / 2 - car.pos.y) <
          Math.hypot(o.w, o.h) / 2 + 8,
      );
      const hit = collide(car, near, circles);
      if (hit) bounce(car, hit);
      const p = route[next];
      if (next < route.length - 1 && Math.hypot(p.x - car.pos.x, p.y - car.pos.y) < 8) next++;
      if (Math.abs(drift.slip) > (15 * Math.PI) / 180 && drift.speedKmh > 15) slipping++;
      slow = drift.speedKmh < 3.6 ? slow + DT : 0;
      maxSlow = Math.max(maxSlow, slow);
    }
    console.log(
      `attract: ${next}/${route.length} route points, ${((slipping / steps) * 100).toFixed(0)}% drifting, max stuck ${maxSlow.toFixed(1)} s`,
    );
    expect(next).toBeGreaterThan(route.length * 0.6);
    expect(slipping / steps).toBeGreaterThan(0.2);
    expect(maxSlow).toBeLessThan(3);
  });
});
