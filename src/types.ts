import type { CarStats } from './models';

export type Vec = { x: number; y: number };
export type SolidKind = 'wall' | 'pillar' | 'car';
/** meters, top-left origin, axis-aligned */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type CarModel =
  'civic' | 'supra' | 'rx7' | 'r32' | 's13' | '180sx' | 'ae86' | 'nsx' | 'evo4' | 'wrx';
/** player-only cars are never parked on maps */
export type PlayerModel = CarModel | 'mx5' | 'rx8' | 'celica';
export interface Solid extends Rect {
  kind: SolidKind;
  /** rotation of the rect about its center (rad); omitted = axis-aligned */
  angle?: number;
  /** parked cars only */
  model?: CarModel;
  color?: string;
  /** heading the nose points (rad, any angle) */
  facing?: number;
  /** parked car lights: headlights on, or hazards blinking */
  lights?: 'on' | 'hazard';
  /** parked police car: light bar flashes, close drifts score COP SHOW */
  police?: boolean;
}
/** angle in radians, 0 = facing +x, positive = clockwise on screen (y down) */
export interface Spawn {
  pos: Vec;
  angle: number;
}
export interface Floor {
  name: string;
  w: number;
  h: number;
  solids: Solid[];
  bays: Rect[];
  lights: Vec[];
  /** round solids, e.g. helix cores */
  circles: Circle[];
  /** clipping zones: drifting inside scores faster; first entry per combo gives a CLIP bonus */
  clipZones?: Rect[];
  /** bonus zones: drift through every rect sharing an id within one combo to fire its trick once */
  bonusZones?: BonusZone[];
}
export interface BonusZone extends Rect {
  id: string;
  trick: Trick;
}
export interface Circle {
  x: number;
  y: number;
  r: number;
}
/**
 * Half-circle ramp around a round core joining floor `from` (upper) to `from + 1`.
 * Same world position on both floors. Polar angles use the heading convention
 * (0 = +x, positive = clockwise on screen). Progress p = (polar(car) - enterAngle) / sweep, 0..1.
 * The floor switches at p = 0.5.
 */
export interface Helix {
  from: number;
  center: Vec;
  rCore: number;
  rOuter: number;
  enterAngle: number;
  /** signed, normally +PI or -PI: direction of travel around the center */
  sweep: number;
}
export interface GameMap {
  name: string;
  parTime: number;
  /** total-score thresholds [bronze, silver, gold]; absent on free-roam maps */
  medals?: [number, number, number];
  floors: Floor[];
  helixes: Helix[];
  start: { floor: number } & Spawn;
  finish: { floor: number; zone: Rect };
}
export interface InputState {
  /** -1 left .. 1 right */ steer: number;
  /** 0..1 */ throttle: number;
  /** 0..1, also reverse when stopped */ brake: number;
  handbrake: boolean;
  /** held: drive disconnected, revs climb; release at high rpm kicks the rear out */ clutch?: boolean;
  /** edge-triggered: true for one poll on press */ pause: boolean;
  restart: boolean;
  confirm: boolean;
  /** edge-triggered: true for one poll on press */ left: boolean;
  right: boolean;
  /** edge-triggered, menu navigation (optional so car tests need no change) */ up?: boolean;
  down?: boolean;
  /** level: garage engine rev (R / right trigger) */ rev?: boolean;
  /** edge-triggered: garage tune toggle (T / pad X) */ tune?: boolean;
  /** edge-triggered: save the selected drift clip on results (S / pad X) */ save?: boolean;
  /** edge-triggered: settings tab prev / next (Q / E, pad LB / RB) */ tabPrev?: boolean;
  tabNext?: boolean;
  /** last-used device, for button prompts */ device?: 'kb' | 'pad';
  padStyle?: 'ps' | 'xbox';
}
/** rpm normalized 0..1 */
export interface CarState {
  pos: Vec;
  vel: Vec;
  angle: number;
  angVel: number;
  rpm: number;
  /** clutch state, set by stepCar */ clutchHeld?: boolean;
  clutchKick?: number; // s of rear burst left
  clutchPower?: number; // 0..1 burst strength from rpm at release
  stats?: CarStats;
}
/** slip: signed angle between heading and velocity, radians */
export interface DriftInfo {
  drifting: boolean;
  slip: number;
  speedKmh: number;
}
/** normal points out of the solid toward the car */
export interface Hit {
  normal: Vec;
  depth: number;
}
export type Trick =
  'DRIFT' | 'CLOSE CALL' | 'SWITCHBACK' | 'LONG DRIFT' | '360' | 'RAMP DRIFT' | 'CLIP' | 'NEAR MISS' | 'SCRAMBLE' | 'DRIVE-THRU' | 'COP SHOW';
/** frozen = floor fade in progress: grace timer paused, no scoring */
export interface ScoreFrame {
  drift: DriftInfo;
  yawDelta: number;
  nearDist: number;
  hit: boolean;
  rampDrift: boolean;
  frozen: boolean;
  /** clipping zone the car is in, if any */
  clip?: Rect | null;
}
export interface Combo {
  points: number;
  multiplier: number;
  tricks: Trick[];
  grace: number;
}
export interface ScoringState {
  banked: number;
  combo: Combo | null;
}
export type ScoreEvent =
  | { type: 'trick'; trick: Trick }
  | { type: 'bank'; amount: number }
  | { type: 'fail'; lost: number };
export type Phase = 'title' | 'garage' | 'settings' | 'countdown' | 'run' | 'paused' | 'results';
