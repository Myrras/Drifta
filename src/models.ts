import type { CarModel, PlayerModel } from './types';

export interface CarStats {
  /** engine power multiplier */
  power: number;
  /** tire grip multiplier */
  grip: number;
  /** mass multiplier */
  mass: number;
}

/** Approximate real dimensions (m) and typical period colors. No badges or logos are drawn. */
export const CAR_MODELS: Record<
  CarModel,
  { name: string; length: number; width: number; colors: string[]; stats: CarStats }
> = {
  civic: {
    name: 'Civic EG hatch',
    length: 4.07,
    width: 1.7,
    colors: ['#e8e8e8', '#c8102e', '#1d3f8f', '#202020'],
    stats: { power: 0.8, grip: 1, mass: 0.85 },
  },
  supra: {
    name: 'Supra MK4',
    length: 4.52,
    width: 1.81,
    colors: ['#ff7a00', '#e8e8e8', '#151515', '#b5121b'],
    stats: { power: 1.25, grip: 0.95, mass: 1.15 },
  },
  rx7: {
    name: 'RX-7 FD',
    length: 4.29,
    width: 1.76,
    colors: ['#d4c21a', '#b5121b', '#e8e8e8', '#151515'],
    stats: { power: 1.1, grip: 1.05, mass: 0.95 },
  },
  r32: {
    name: 'Skyline R32 GT-R',
    length: 4.55,
    width: 1.76,
    colors: ['#5b5e63', '#1a1a1a', '#e8e8e8', '#6b2d2d'],
    stats: { power: 1.15, grip: 1.1, mass: 1.1 },
  },
  s13: {
    name: 'Silvia S13',
    length: 4.47,
    width: 1.69,
    colors: ['#9fb7c9', '#e8e8e8', '#7a1f2b', '#202020'],
    stats: { power: 1, grip: 1, mass: 1 },
  },
  '180sx': {
    name: '180SX',
    length: 4.54,
    width: 1.69,
    colors: ['#e8e8e8', '#151515', '#b5121b', '#3b4f6b'],
    stats: { power: 1, grip: 1, mass: 1 },
  },
  ae86: {
    name: 'AE86 Trueno',
    length: 4.2,
    width: 1.63,
    colors: ['#e8e8e8', '#151515', '#b5121b'],
    stats: { power: 0.75, grip: 1.05, mass: 0.85 },
  },
  nsx: {
    name: 'NSX',
    length: 4.43,
    width: 1.81,
    colors: ['#c8102e', '#e8e8e8', '#151515', '#d4c21a'],
    stats: { power: 1.1, grip: 1.1, mass: 1 },
  },
  evo4: {
    name: 'Lancer Evo IV',
    length: 4.33,
    width: 1.69,
    colors: ['#e8e8e8', '#b5121b', '#1a1a1a'],
    stats: { power: 1.1, grip: 1.1, mass: 1.05 },
  },
  wrx: {
    name: 'Impreza WRX',
    length: 4.34,
    width: 1.69,
    colors: ['#1e3f8f', '#e8e8e8', '#202020'],
    stats: { power: 1.05, grip: 1.05, mass: 1.05 },
  },
};

// garage order: each new car next to its maker's
const { civic, supra, rx7, ...rest } = CAR_MODELS;
export const PLAYER_MODELS: Record<
  PlayerModel,
  {
    name: string;
    length: number;
    width: number;
    colors: string[];
    stats: CarStats;
    /** garage note under the name */
    tag?: string;
  }
> = {
  mx5: {
    name: 'MX-5 NA',
    length: 3.97,
    width: 1.68,
    colors: ['#d32030', '#e8e8e8', '#1d3f8f', '#2f5f3a', '#151515'],
    stats: { power: 0.85, grip: 1.05, mass: 0.9 },
  },
  civic,
  supra,
  celica: {
    name: 'Celica GT-Four ST205',
    tag: 'RWD CONVERSION',
    length: 4.42,
    width: 1.75,
    colors: ['#e8e8e8', '#c8102e', '#a8adb2', '#151515'],
    stats: { power: 1.05, grip: 1, mass: 1.1 },
  },
  rx7,
  rx8: {
    name: 'RX-8',
    length: 4.43,
    width: 1.77,
    colors: ['#9e1b22', '#1f4fa0', '#c0c4c8', '#e3c21a', '#151515'],
    stats: { power: 0.95, grip: 1.1, mass: 0.9 },
  },
  ...rest,
};
