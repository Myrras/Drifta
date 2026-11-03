import type { CarState, DriftInfo, Hit, InputState, Spawn } from './types';
import type { CarStats } from './models';
import { DRIFT_MIN_SLIP_DEG, DRIFT_MIN_SPEED_KMH } from './config';

/** All car physics tuning. Forces are per unit mass (m/s²), so there is no mass term. */
export const TUNING = {
  // geometry
  cgToFront: 1.2, // m, center of mass to front axle
  cgToRear: 1.2, // m, center of mass to rear axle
  yawInertia: 1.6, // m², yaw inertia per unit mass

  // engine / longitudinal
  engineAccel: 11, // m/s² at full throttle (RWD)
  dragCoef: 0.0065, // m/s² per (m/s)², gives ~130 km/h top speed
  rollConst: 0.4, // m/s², constant rolling resistance
  rollLinear: 0.06, // 1/s, speed-proportional rolling resistance
  brakeAccel: 14, // m/s² at full brake
  reverseAccel: 5, // m/s² at full brake while reversing
  reverseTopSpeed: 7, // m/s (~25 km/h)
  reverseEngageSpeed: 0.5, // m/s, brake below this forward speed = reverse; throttle while rolling back faster = brake
  reverseYawDamp: 2, // 1/s, pull of yaw rate toward the path's turn rate while backing up

  // steering
  maxSteer: 0.6, // rad at standstill
  steerSpeedFalloff: 0.06, // lock = maxSteer / (1 + falloff * speed)

  // tires
  frontStiffness: 55, // m/s² per rad of front slip angle
  rearStiffness: 60, // m/s² per rad of rear slip angle
  frontMaxGrip: 9, // m/s², front lateral force cap
  rearMaxGrip: 9.5, // m/s², rear lateral force cap
  minSlipSpeed: 3, // m/s, floor on forward speed in slip-angle math (low-speed stability)

  // drift. Both axles keep most of their grip, so the path arcs toward the nose instead of sliding on.
  // The angle settles where front force (set by steer) balances rear force (set by throttle and slip).
  handbrakeGrip: 0.3, // rear grip multiplier only while the handbrake is held: it kicks the drift off
  handbrakeAccel: 4, // m/s², rear braking from handbrake
  powerOversteerGrip: 0.45, // rear grip at full throttle while slipping (0.6 at 0.7): throttle adds angle, lifting restores grip
  powerOversteerSlip: 0.15, // rad, slip above which throttle loosens the rear
  assistSlip: 0.2, // rad, slip above which drift assist kicks in
  slipRamp: 0.15, // rad, power oversteer and assist fade in over this much extra slip
  selfAlign: 1, // 0..1, front wheels follow the front axle's travel while drifting (lock grows with slip),
  // so steer works relative to the path: into the turn = more angle and a tighter arc, centred = straighten
  driftFrontGrip: 0.8, // front grip cap multiplier while drifting; the rear must match it, so lower = smaller angle, wider arc
  rearBite: 0.5, // share of the throttle-lost rear grip that returns at big slip: soft wall against spinning
  rearBiteSlip: 0.3, // rad, slip where the rear starts biting back
  rearBiteRamp: 0.3, // rad, bite is full this much past rearBiteSlip
  assistYawDamp: 1, // 1/s, light pull of yaw rate toward the path's turn rate; higher = safer but slidier
  maxAngVel: 4.5, // rad/s cap

  // rpm: upper speed of each gear, m/s
  gearTops: [10, 18, 27, 37],
};

const T = TUNING;
const DRIFT_MIN_SLIP = (DRIFT_MIN_SLIP_DEG * Math.PI) / 180;
const DRIFT_MAX_SLIP = (135 * Math.PI) / 180;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const DEFAULT_STATS: CarStats = { power: 1, grip: 1, mass: 1 };

export function createCar(spawn: Spawn, stats?: CarStats): CarState {
  return {
    pos: { ...spawn.pos },
    vel: { x: 0, y: 0 },
    angle: spawn.angle,
    angVel: 0,
    rpm: 0,
    stats,
  };
}

function slipOf(vf: number, vl: number, speed: number): number {
  return speed < 0.5 ? 0 : Math.atan2(vl, vf);
}

export function stepCar(car: CarState, input: InputState, dt: number): DriftInfo {
  const { power, grip, mass } = car.stats ?? DEFAULT_STATS;
  const cos = Math.cos(car.angle);
  const sin = Math.sin(car.angle);
  // car frame: forward = (cos, sin), right = (-sin, cos)
  let vf = car.vel.x * cos + car.vel.y * sin;
  let vl = -car.vel.x * sin + car.vel.y * cos;
  const speed = Math.hypot(vf, vl);
  const slip = Math.abs(slipOf(vf, vl, speed));
  const throttle = clamp(input.throttle, 0, 1);
  const brake = clamp(input.brake, 0, 1);

  // longitudinal
  let drive = (throttle * T.engineAccel * power) / mass;
  let stop = 0; // decel opposing vf, cannot reverse direction
  if (vf < -T.reverseEngageSpeed) {
    drive = 0;
    stop += throttle * T.brakeAccel;
  }
  if (brake > 0) {
    if (vf > T.reverseEngageSpeed) stop += brake * T.brakeAccel;
    else drive -= brake * T.reverseAccel * Math.max(0, 1 + vf / T.reverseTopSpeed);
  }
  if (input.handbrake) stop += T.handbrakeAccel;
  stop += T.rollConst + T.rollLinear * Math.abs(vf);
  const ax = drive - T.dragCoef * vf * Math.abs(vf);

  // smooth 0..1 ramps avoid grip steps that make the yaw oscillate
  // backing up, slip is ~180 deg: it must not count as a drift (that loosened the rear and spun the car)
  const forward = vf > 0;
  const loose = forward ? clamp((slip - T.powerOversteerSlip) / T.slipRamp, 0, 1) : 0;
  const assist = forward ? clamp((slip - T.assistSlip) / T.slipRamp, 0, 1) : 0;
  let rearGrip = 1 + (T.powerOversteerGrip - 1) * throttle * loose;
  const bite = clamp((slip - T.rearBiteSlip) / T.rearBiteRamp, 0, 1);
  rearGrip += (1 - rearGrip) * T.rearBite * bite;
  if (input.handbrake) rearGrip = T.handbrakeGrip;

  // lateral (bicycle model)
  const lock = T.maxSteer / (1 + T.steerSpeedFalloff * speed);
  const steer = clamp(input.steer, -1, 1) * lock;
  const steerDir = clamp(vf / 2, -1, 1); // fades steering force to 0 at standstill, flips in reverse
  const denom = Math.max(Math.abs(vf), T.minSlipSpeed);
  const slipF = Math.atan2(vl + car.angVel * T.cgToFront, denom);
  const alphaF = slipF * (1 - T.selfAlign * assist) - steer * steerDir;
  const alphaR = Math.atan2(vl - car.angVel * T.cgToRear, denom);

  const capR = T.rearMaxGrip * rearGrip * grip;
  const capF = T.frontMaxGrip * grip * (1 + (T.driftFrontGrip - 1) * assist);
  const fyF = clamp(-T.frontStiffness * grip * alphaF, -capF, capF);
  const fyR = clamp(-T.rearStiffness * grip * alphaR * rearGrip, -capR, capR);
  const ay = (fyR + fyF * Math.cos(steer)) / mass;
  const torque = T.cgToFront * fyF * Math.cos(steer) - T.cgToRear * fyR;

  // integrate in car frame
  vf += ax * dt;
  const stopDv = stop * dt;
  vf = Math.abs(vf) <= stopDv ? 0 : vf - Math.sign(vf) * stopDv;
  vl += ay * dt;
  if (Math.abs(vf) < 0.3 && Math.abs(vl) < 0.3 && drive === 0) vl = 0;

  // back to world with the old heading, so the velocity does not rotate with the car
  const oldX = car.vel.x;
  const oldY = car.vel.y;
  car.vel.x = vf * cos - vl * sin;
  car.vel.y = vf * sin + vl * cos;

  // drift assist: pull yaw rate toward the velocity's turn rate, so the slip angle holds
  const pathRate =
    Math.atan2(oldX * car.vel.y - oldY * car.vel.x, oldX * car.vel.x + oldY * car.vel.y) / dt;
  let angVel = car.angVel + (torque / (T.yawInertia * mass ** 1.5)) * dt; // inertia grows faster than mass: heavy = lazier yaw
  const yawDamp = forward ? T.assistYawDamp * assist : T.reverseYawDamp;
  angVel -= (angVel - pathRate) * Math.min(1, yawDamp * dt);
  if (speed < 1) angVel *= speed; // no yaw when parked
  car.angVel = clamp(angVel, -T.maxAngVel, T.maxAngVel);
  car.angle += car.angVel * dt;

  car.pos.x += car.vel.x * dt;
  car.pos.y += car.vel.y * dt;

  // rpm: fake 4-gear sawtooth
  const fwd = Math.max(0, vf);
  let lo = 0;
  let t = 1;
  for (const hi of T.gearTops) {
    if (fwd < hi) {
      t = (fwd - lo) / (hi - lo);
      break;
    }
    lo = hi;
  }
  car.rpm = clamp(0.15 + 0.75 * t + 0.1 * throttle, 0, 1);

  return driftInfo(car);
}

function driftInfo(car: CarState): DriftInfo {
  const cos = Math.cos(car.angle);
  const sin = Math.sin(car.angle);
  const vf = car.vel.x * cos + car.vel.y * sin;
  const vl = -car.vel.x * sin + car.vel.y * cos;
  const speed = Math.hypot(vf, vl);
  const slip = slipOf(vf, vl, speed);
  const speedKmh = speed * 3.6;
  const a = Math.abs(slip);
  return {
    drifting: a > DRIFT_MIN_SLIP && a < DRIFT_MAX_SLIP && speedKmh > DRIFT_MIN_SPEED_KMH,
    slip,
    speedKmh,
  };
}

export function bounce(car: CarState, hit: Hit): void {
  const { normal: n, depth } = hit;
  car.pos.x += n.x * depth;
  car.pos.y += n.y * depth;
  const vn = car.vel.x * n.x + car.vel.y * n.y;
  if (vn < 0) {
    const tx = car.vel.x - vn * n.x;
    const ty = car.vel.y - vn * n.y;
    const restitution = 0.3;
    // wall friction scales with impact speed: a per-frame flat loss pinned the car to walls it scraped at shallow angles
    const tangentKeep = 1 - 0.4 * Math.min(1, -vn / 4);
    car.vel.x = tx * tangentKeep - vn * restitution * n.x;
    car.vel.y = ty * tangentKeep - vn * restitution * n.y;
  }
  car.angVel *= 0.5;
}
