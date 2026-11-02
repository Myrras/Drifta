export type Vec = { x: number; y: number };
export type SolidKind = 'wall' | 'pillar' | 'car';
/** meters, top-left origin, axis-aligned */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Solid extends Rect {
  kind: SolidKind;
}
/** angle in radians, 0 = facing +x, positive = clockwise on screen (y down) */
export interface Spawn {
  pos: Vec;
  angle: number;
}
export interface Ramp {
  zone: Rect;
  toFloor: number;
  spawn: Spawn;
}
export interface Floor {
  name: string;
  w: number;
  h: number;
  solids: Solid[];
  bays: Rect[];
  lights: Vec[];
  ramps: Ramp[];
}
export interface GameMap {
  name: string;
  parTime: number;
  floors: Floor[];
  start: { floor: number } & Spawn;
  finish: { floor: number; zone: Rect };
}
export interface InputState {
  /** -1 left .. 1 right */ steer: number;
  /** 0..1 */ throttle: number;
  /** 0..1, also reverse when stopped */ brake: number;
  handbrake: boolean;
  /** edge-triggered: true for one poll on press */ pause: boolean;
  restart: boolean;
  confirm: boolean;
}
/** rpm normalized 0..1 */
export interface CarState {
  pos: Vec;
  vel: Vec;
  angle: number;
  angVel: number;
  rpm: number;
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
export type Trick = 'DRIFT' | 'CLOSE CALL' | 'SWITCHBACK' | 'LONG DRIFT' | '360' | 'RAMP DRIFT';
/** frozen = floor fade in progress: grace timer paused, no scoring */
export interface ScoreFrame {
  drift: DriftInfo;
  yawDelta: number;
  nearDist: number;
  hit: boolean;
  rampDrift: boolean;
  frozen: boolean;
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
export type Phase = 'title' | 'countdown' | 'run' | 'paused' | 'results';
