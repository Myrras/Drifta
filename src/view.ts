import type { CarState, Combo, DriftInfo, GameMap, Phase, PlayerModel } from './types';

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
  /** player's car model + paint */
  player: { model: PlayerModel; color: string };
  /** 0..1 wall-scrape intensity this frame (for sparks) */
  scrape: number;
  /** 0..1 hard-impact pulse, decays (for hit flash / hit-stop feel) */
  impact: number;
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
  /** thresholds [bronze, silver, gold] of the map, if any */
  medals?: [number, number, number];
}

export interface MenuRow {
  label: string;
  value?: string;
  /** 0..1 slider fill */
  bar?: number;
}

/** Title, garage and settings screens. */
export interface MenuView {
  screen: 'title' | 'garage' | 'settings';
  rows: MenuRow[];
  /** highlighted row */
  row: number;
  /** map names and the chosen one (title) */
  items: string[];
  selected: number;
  /** garage preview; stats are 0..1 across all models */
  garage: {
    model: PlayerModel;
    name: string;
    color: string;
    colors: string[];
    index: number;
    count: number;
    stats: { power: number; grip: number; weight: number };
  } | null;
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
  /** non-null on title, garage and settings */
  menu: MenuView | null;
}

export interface FrameView {
  render: RenderView;
  hud: HudView;
}
