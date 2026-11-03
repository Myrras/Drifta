import type { CarState, InputState, Vec } from './types';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

const DRIFT_SLIP = 0.2; // rad, above this the car counts as sliding
const HOLD_SLIP = 0.65; // rad (~37°), slip angle the throttle aims for mid-corner
const CORNER = 0.5; // rad of route turn in the next 30 m that makes it a drift corner
const STUCK_TIME = 2; // s below 1 m/s before backing out
const BACK_TIME = 1.2; // s of reversing to get out

/**
 * AI drifter for the attract scene. Drives the route, then back along it (ping-pong), forever.
 * Stuck recovery: below 1 m/s for 2 s it reverses out with the wheel turned, no caller help needed.
 */
export function createAttractDriver(route: Vec[]): {
  input(car: CarState, dt: number): InputState;
} {
  // there and back as one closed loop, so progress just wraps
  const path = [...route, ...route.slice(1, -1).reverse()];
  const n = path.length;
  const pt = (i: number) => path[((i % n) + n) % n];
  const segLen = (i: number) => Math.hypot(pt(i + 1).x - pt(i).x, pt(i + 1).y - pt(i).y) || 1e-6;
  let seg = 0;
  let stuck = 0;
  let back = 0;
  let kick = 0; // s of handbrake tap left

  /** Projection of p on segment i: t along it (0..1 inside) and distance. */
  function project(p: Vec, i: number) {
    const a = pt(i);
    const b = pt(i + 1);
    const L = segLen(i);
    const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (L * L);
    const u = clamp(t, 0, 1);
    return { t, d: Math.hypot(a.x + (b.x - a.x) * u - p.x, a.y + (b.y - a.y) * u - p.y) };
  }
  /** Point and direction `dist` m past (seg, t) along the path. */
  function ahead(t: number, dist: number) {
    let i = seg;
    let d = t * segLen(i) + dist;
    while (d > segLen(i)) d -= segLen(i++);
    const a = pt(i);
    const b = pt(i + 1);
    const f = d / segLen(i);
    return {
      p: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f },
      h: Math.atan2(b.y - a.y, b.x - a.x),
    };
  }

  return {
    input(car, dt) {
      const idle = { pause: false, restart: false, confirm: false, left: false, right: false };
      // advance past finished segments; a short forward window so the return leg is not grabbed early
      let pr = project(car.pos, seg);
      for (let k = 0; k < 4; k++) {
        const next = project(car.pos, seg + 1);
        if (pr.t < 1 && next.d >= pr.d) break;
        seg = (seg + 1) % n;
        pr = next;
      }
      const t = clamp(pr.t, 0, 1);

      const cos = Math.cos(car.angle);
      const sin = Math.sin(car.angle);
      const vf = car.vel.x * cos + car.vel.y * sin;
      const vl = -car.vel.x * sin + car.vel.y * cos;
      const speed = Math.hypot(vf, vl);
      const slip = speed < 2 ? 0 : Math.atan2(vl, vf); // < 0: nose right of travel
      const course = speed < 2 ? car.angle : Math.atan2(car.vel.y, car.vel.x);

      const look = ahead(t, clamp(4 + 0.45 * speed, 6, 16));
      const err = wrap(Math.atan2(look.p.y - car.pos.y, look.p.x - car.pos.x) - course);
      const turn = wrap(ahead(t, 30).h - ahead(t, 0).h); // signed route turn coming up

      stuck = speed < 1 ? stuck + dt : 0;
      if (stuck > STUCK_TIME) [back, stuck] = [BACK_TIME, 0];
      if (back > 0) {
        back -= dt;
        const toTarget = wrap(Math.atan2(look.p.y - car.pos.y, look.p.x - car.pos.x) - car.angle);
        // reversing flips steering: wheel away from the target swings the nose toward it
        return {
          ...idle,
          steer: -Math.sign(toTarget),
          throttle: 0,
          brake: 1,
          handbrake: false,
        };
      }

      const sliding = Math.abs(slip) > DRIFT_SLIP && vf > 0;
      const corner = Math.abs(turn) > CORNER;
      // into a corner at speed: tap the handbrake with the wheel turned in to kick the rear out
      if (corner && !sliding && kick <= 0 && speed > 9 && Math.sign(err) === Math.sign(turn))
        kick = 0.25;
      kick -= dt;

      // selfAlign makes steer relative to travel, so steering at the target holds the line in a slide
      const steer = clamp(err * (sliding ? 2 : 2.5), -1, 1);
      let throttle: number;
      let brake = 0;
      if (corner || sliding) {
        // nose into the turn: throttle sets the angle; wrong-way slide: lift to regain grip
        const into = -Math.sign(slip) === Math.sign(turn) || !corner;
        throttle = into ? clamp(0.55 + 2.5 * (HOLD_SLIP - Math.abs(slip)), 0, 1) : 0.2;
        if (!corner) throttle = Math.min(throttle, 0.3); // straight ahead: ease off, straighten
        if (speed < 7) throttle = 1;
        if (!sliding && speed > 17) [throttle, brake] = [0, 0.5];
      } else {
        throttle = speed < 26 ? 1 : 0.4;
      }
      return { ...idle, steer, throttle, brake, handbrake: kick > 0 };
    },
  };
}
