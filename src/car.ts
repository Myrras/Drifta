import type { CarState, DriftInfo, Hit, InputState, Spawn } from './types';
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
  reverseTopSpeed: 6, // m/s (~22 km/h)
  reverseEngageSpeed: 0.5, // m/s, brake below this forward speed = reverse

  // steering
  maxSteer: 0.6, // rad at standstill
  steerSpeedFalloff: 0.06, // lock = maxSteer / (1 + falloff * speed)
  driftSteerBoost: 1, // extra lock per rad of slip while drifting, so countersteer can catch it

  // tires
  frontStiffness: 55, // m/s² per rad of front slip angle
  rearStiffness: 60, // m/s² per rad of rear slip angle
  frontMaxGrip: 9, // m/s², front lateral force cap
  rearMaxGrip: 9.5, // m/s², rear lateral force cap
  minSlipSpeed: 3, // m/s, floor on forward speed in slip-angle math (low-speed stability)

  // drift
  handbrakeGrip: 0.3, // rear grip multiplier with handbrake
  handbrakeAccel: 4, // m/s², rear braking from handbrake
  powerOversteerGrip: 0.55, // rear grip multiplier at full throttle while slipping
  powerOversteerSlip: 0.15, // rad, slip above which throttle loosens the rear
  assistSlip: 0.2, // rad, slip above which drift assist kicks in
  slipRamp: 0.15, // rad, power oversteer and assist fade in over this much extra slip
  assistYawDamp: 3.5, // 1/s, yaw damping while drifting (holds the angle)
  assistLateralKeep: 0.55, // multiplier on rear lateral grip while drifting (slow bleed)
  assistFrontKeep: 0.45, // multiplier on front grip cap while drifting; near the rear cap so the angle holds
  maxAngVel: 4.5, // rad/s cap

  // rpm: upper speed of each gear, m/s
  gearTops: [10, 18, 27, 37],
};

const T = TUNING;
const DRIFT_MIN_SLIP = (DRIFT_MIN_SLIP_DEG * Math.PI) / 180;
const DRIFT_MAX_SLIP = (135 * Math.PI) / 180;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function createCar(spawn: Spawn): CarState {
  return { pos: { ...spawn.pos }, vel: { x: 0, y: 0 }, angle: spawn.angle, angVel: 0, rpm: 0 };
}

function slipOf(vf: number, vl: number, speed: number): number {
  return speed < 0.5 ? 0 : Math.atan2(vl, vf);
}

export function stepCar(car: CarState, input: InputState, dt: number): DriftInfo {
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
  let drive = throttle * T.engineAccel;
  let stop = 0; // decel opposing vf, cannot reverse direction
  if (brake > 0) {
    if (vf > T.reverseEngageSpeed) stop += brake * T.brakeAccel;
    else drive -= brake * T.reverseAccel * Math.max(0, 1 + vf / T.reverseTopSpeed);
  }
  if (input.handbrake) stop += T.handbrakeAccel;
  stop += T.rollConst + T.rollLinear * Math.abs(vf);
  const ax = drive - T.dragCoef * vf * Math.abs(vf);

  // smooth 0..1 ramps avoid grip steps that make the yaw oscillate
  const loose = clamp((slip - T.powerOversteerSlip) / T.slipRamp, 0, 1);
  const assist = slip < DRIFT_MAX_SLIP ? clamp((slip - T.assistSlip) / T.slipRamp, 0, 1) : 0;
  let rearGrip = 1 + (T.powerOversteerGrip - 1) * throttle * loose;
  if (input.handbrake) rearGrip = T.handbrakeGrip;
  const keep = 1 + (T.assistLateralKeep - 1) * assist;

  // lateral (bicycle model)
  const lock = T.maxSteer / (1 + T.steerSpeedFalloff * speed) + T.driftSteerBoost * assist * slip;
  const steer = clamp(input.steer, -1, 1) * lock;
  const steerDir = clamp(vf / 2, -1, 1); // fades steering force to 0 at standstill, flips in reverse
  const denom = Math.max(Math.abs(vf), T.minSlipSpeed);
  const alphaF = Math.atan2(vl + car.angVel * T.cgToFront, denom) - steer * steerDir;
  const alphaR = Math.atan2(vl - car.angVel * T.cgToRear, denom);

  const capF = T.frontMaxGrip * (1 + (T.assistFrontKeep - 1) * assist);
  const capR = T.rearMaxGrip * rearGrip * keep;
  const fyF = clamp(-T.frontStiffness * alphaF, -capF, capF);
  const fyR = clamp(-T.rearStiffness * alphaR * rearGrip, -capR, capR);
  const ay = fyR + fyF * Math.cos(steer);
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
  let angVel = car.angVel + (torque / T.yawInertia) * dt;
  angVel -= (angVel - pathRate) * Math.min(1, T.assistYawDamp * assist * dt);
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
    const tangentKeep = 0.6;
    car.vel.x = tx * tangentKeep - vn * restitution * n.x;
    car.vel.y = ty * tangentKeep - vn * restitution * n.y;
  }
  car.angVel *= 0.5;
}
