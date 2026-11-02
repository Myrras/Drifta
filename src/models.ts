import type { CarModel } from './types';

/** Approximate real dimensions (m) and typical period colors. No badges or logos are drawn. */
export const CAR_MODELS: Record<
  CarModel,
  { name: string; length: number; width: number; colors: string[] }
> = {
  civic: {
    name: 'Civic EG hatch',
    length: 4.07,
    width: 1.7,
    colors: ['#e8e8e8', '#c8102e', '#1d3f8f', '#202020'],
  },
  supra: {
    name: 'Supra MK4',
    length: 4.52,
    width: 1.81,
    colors: ['#ff7a00', '#e8e8e8', '#151515', '#b5121b'],
  },
  rx7: {
    name: 'RX-7 FD',
    length: 4.29,
    width: 1.76,
    colors: ['#d4c21a', '#b5121b', '#e8e8e8', '#151515'],
  },
  r32: {
    name: 'Skyline R32 GT-R',
    length: 4.55,
    width: 1.76,
    colors: ['#5b5e63', '#1a1a1a', '#e8e8e8', '#6b2d2d'],
  },
  s13: {
    name: 'Silvia S13',
    length: 4.47,
    width: 1.69,
    colors: ['#9fb7c9', '#e8e8e8', '#7a1f2b', '#202020'],
  },
  '180sx': {
    name: '180SX',
    length: 4.54,
    width: 1.69,
    colors: ['#e8e8e8', '#151515', '#b5121b', '#3b4f6b'],
  },
  ae86: {
    name: 'AE86 Trueno',
    length: 4.2,
    width: 1.63,
    colors: ['#e8e8e8', '#151515', '#b5121b'],
  },
  nsx: {
    name: 'NSX',
    length: 4.43,
    width: 1.81,
    colors: ['#c8102e', '#e8e8e8', '#151515', '#d4c21a'],
  },
  evo4: {
    name: 'Lancer Evo IV',
    length: 4.33,
    width: 1.69,
    colors: ['#e8e8e8', '#b5121b', '#1a1a1a'],
  },
  wrx: {
    name: 'Impreza WRX',
    length: 4.34,
    width: 1.69,
    colors: ['#1e3f8f', '#e8e8e8', '#202020'],
  },
};
