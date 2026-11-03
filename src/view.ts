import type { Look } from './cosmetics';
import type { CityGraph, Traffic } from './traffic';
import type { CarState, Combo, DriftInfo, GameMap, Phase, PlayerModel, Rect, Trick } from './types';

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
  player: { model: PlayerModel; color: string; look?: Look };
  /** 0..1 wall-scrape intensity this frame (for sparks) */
  scrape: number;
  /** 0..1 hard-impact pulse, decays (for hit flash / hit-stop feel) */
  impact: number;
  /** increments on every (re)start; renderer clears skid marks + smoke when it changes */
  runId: number;
  /** clipping zone the player is drifting in, lit up */
  clip: Rect | null;
  /** live traffic and its city graph (signal heads), null on maps without traffic */
  traffic: { sim: Traffic; city: CityGraph } | null;
  /** best-run ghost pose, only set when on the shown floor */
  ghost?: {
    x: number;
    y: number;
    angle: number;
    model: PlayerModel;
    color: string;
    look?: Look;
  } | null;
  /** photo camera: world centre, view-height multiplier, rotation (rad) */
  photo?: { x: number; y: number; zoom: number; rot: number };
}

export interface Popup {
  kind: 'trick' | 'bank' | 'fail';
  text: string;
  amount: number;
  /** seconds since the event; game drops popups older than 1.5 s */
  age: number;
}

/** one of the run's best banked combos */
export interface TopDrift {
  amount: number;
  tricks: Trick[];
  /** a video clip exists and can be saved */
  clip: boolean;
  saved: boolean;
  /** still frame from the middle of the drift, if captured */
  still?: HTMLCanvasElement;
}

export interface Results {
  comboPoints: number;
  timeBonus: number;
  total: number;
  time: number;
  best: number;
  newBest: boolean;
  /** score thresholds [3rd, 2nd, 1st] of the map, if any */
  medals?: [number, number, number];
  /** finishing position on maps with positions, null = none reached */
  position: 1 | 2 | 3 | null;
  /** paint ids unlocked by this finish */
  newPaints: string[];
  /** a car pick was earned and is not yet chosen or deferred */
  carPick: boolean;
  /** car pick overlay: locked cars, then LATER at index cars.length */
  chooser: {
    cars: { model: PlayerModel; name: string; color: string; look: Look }[];
    row: number;
  } | null;
  /** best banked combos, highest first (max 3) */
  drifts: TopDrift[];
  /** selected index in drifts */
  driftRow: number;
}

/** Look and input hints for the UI. */
export interface UiContext {
  theme: 'arcade' | 'vhs';
  device: 'kb' | 'pad';
  padStyle: 'ps' | 'xbox';
}

export interface MenuRow {
  label: string;
  value?: string;
  /** 0..1 slider fill */
  bar?: number;
}

/** Title, garage and settings screens. */
export interface MenuView {
  screen: 'starter' | 'title' | 'garage' | 'settings';
  /** short notice over the menu, e.g. the cheat */
  toast?: string;
  rows: MenuRow[];
  /** settings only: tab strip drawn above rows. row 0 is the strip, row n is rows[n - 1] */
  tabs?: { names: string[]; active: number };
  ui: UiContext;
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
    tune: 'performance' | 'street';
    /** equipped cosmetics, drawn on the preview */
    look: Look;
    /** customise slots; `row` 0 is the car, row n is slots[n - 1] */
    slots: { label: string; name: string; color?: string; locked: boolean }[];
    /** how to earn the highlighted option, '' when it is owned */
    slotLock: string;
    index: number;
    count: number;
    stats: { power: number; grip: number; weight: number };
    /** locked car: null when drivable; offer = confirm again spends a car pick */
    lock?: { offer: boolean; picks: number } | null;
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
  ui: UiContext;
  /** engine rpm 0..1 (car.rpm) */
  rpm: number;
  /** normalized rpm of the limiter */
  redline: number;
  /** 'N', 'R', '1'..'4' */
  gear: string;
  /** photo mode: this frame is being saved, draw no hint */
  photoShot?: boolean;
}

export interface FrameView {
  render: RenderView;
  hud: HudView;
}
