import type { CarState, Combo, DriftInfo, GameMap, Phase } from './types';

export interface RenderView {
  map: GameMap;
  floorIndex: number;
  car: CarState;
  drift: DriftInfo;
  handbrake: boolean;
  /** 0..1 brake input, for brake lights */
  brake: number;
  /** 0 = clear, 1 = fully black (floor transition) */
  fade: number;
  /** helix crossfade: draw floorIndex blended toward toFloor by t (0..1); null when not in a helix */
  blend: { toFloor: number; t: number } | null;
  /** 0..1 camera shake intensity, decays after a wall hit */
  shake: number;
  /** increments on every (re)start; renderer clears skid marks + smoke when it changes */
  runId: number;
}

export interface Popup {
  kind: 'trick' | 'bank' | 'fail';
  text: string;
  amount: number;
  /** seconds since the event; game drops popups older than 1.5 s */
  age: number;
}

export interface Results {
  comboPoints: number;
  timeBonus: number;
  total: number;
  time: number;
  best: number;
  newBest: boolean;
}

export interface HudView {
  phase: Phase;
  time: number;
  par: number;
  floorName: string;
  /** banked points so far */
  score: number;
  combo: Combo | null;
  /** round(points * multiplier) of the live combo, 0 if none */
  comboValue: number;
  popups: Popup[];
  speedKmh: number;
  /** seconds left while phase === 'countdown' */
  countdown: number;
  best: number;
  results: Results | null;
}

export interface FrameView {
  render: RenderView;
  hud: HudView;
}
