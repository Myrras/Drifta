import type { GameMap, PlayerModel } from './types';

export type Position = 1 | 2 | 3;
/** opaque to this module: the garage owns its shape */
export type Look = Record<string, unknown>;

export interface Progress {
  v: 1;
  starterChosen: boolean;
  unlocked: PlayerModel[];
  carPicks: number;
  results: Record<string, { position: Position; score: number; time: number }>;
  pickedMaps: string[];
  paints: string[];
  cosmetics: string[];
  skins: string[];
  looks: Record<string, Look>;
  daily: { lastClear: string; streak: number; clears: number };
}

export const PROGRESS_KEY = 'drifta.progress';
export const STARTERS: PlayerModel[] = ['civic', 'rx8', '180sx'];
/** paints per map: [3rd, 2nd] */
export const MAP_PAINTS: Record<string, [string, string]> = {
  'B2 MEET': ['concrete-grey', 'b2-violet'],
  'WANGAN DOCKS': ['harbor-teal', 'crane-yellow'],
  'TOKYO NIGHTS': ['neon-pink', 'midnight-blue'],
  'MIDNIGHT DRIVE-THRU': ['moon-gold', 'ketchup-red'],
};

export function defaultProgress(): Progress {
  return {
    v: 1, starterChosen: false, unlocked: [], carPicks: 0, results: {}, pickedMaps: [],
    paints: [], cosmetics: [], skins: [], looks: {},
    daily: { lastClear: '', streak: 0, clears: 0 },
  };
}

export function positionFor(map: GameMap, score: number, time: number): Position | null {
  const m = map.medals;
  if (!m) return null;
  if (score >= m[2] && time <= map.parTime) return 1;
  if (score >= m[1] && time <= map.parTime * 1.15) return 2;
  if (score >= m[0] && time <= map.parTime * 1.3) return 3;
  return null;
}

function add(list: string[], id: string): boolean {
  if (list.includes(id)) return false;
  list.push(id);
  return true;
}

export function awardFinish(
  p: Progress, map: GameMap, score: number, time: number,
): { position: Position | null; newPaints: string[]; carPick: boolean } {
  const position = positionFor(map, score, time);
  const newPaints: string[] = [];
  let carPick = false;
  if (!position) return { position, newPaints, carPick };
  const best = p.results[map.name];
  if (!best || position < best.position) p.results[map.name] = { position, score, time };
  const paints = MAP_PAINTS[map.name];
  if (paints) {
    // 3rd -> first paint, 2nd -> second; 1st grants both if missing
    const got = position === 1 ? paints : position === 2 ? [paints[1]] : [paints[0]];
    for (const id of got) if (add(p.paints, id)) newPaints.push(id);
  }
  if (position === 1 && add(p.pickedMaps, map.name)) {
    p.carPicks++;
    carPick = true;
  }
  return { position, newPaints, carPick };
}

export function chooseStarter(p: Progress, car: PlayerModel): boolean {
  if (p.starterChosen || !STARTERS.includes(car)) return false;
  p.starterChosen = true;
  p.unlocked.push(car);
  return true;
}

export function spendCarPick(p: Progress, car: PlayerModel): boolean {
  if (p.carPicks < 1 || p.unlocked.includes(car)) return false;
  p.carPicks--;
  p.unlocked.push(car);
  return true;
}

/** cheat is session-only and never saved */
export const isCarUnlocked = (p: Progress, car: PlayerModel, cheat: boolean): boolean =>
  cheat || p.unlocked.includes(car);

export const ownsCosmetic = (p: Progress, id: string, cheat: boolean): boolean =>
  cheat || p.paints.includes(id) || p.cosmetics.includes(id) || p.skins.includes(id);

export const grantCosmetic = (p: Progress, id: string): boolean => add(p.cosmetics, id);
export const grantSkin = (p: Progress, id: string): boolean => add(p.skins, id);
export const setLook = (p: Progress, car: PlayerModel, look: Look): void => { p.looks[car] = look; };
export const getLook = (p: Progress, car: PlayerModel): Look => p.looks[car] ?? {};

const dayNum = (d: string): number => Date.parse(d + 'T00:00:00Z') / 86400000;

export function recordDailyClear(p: Progress, date: string): { streak: number; carPick: boolean } {
  const d = p.daily;
  if (d.lastClear === date) return { streak: d.streak, carPick: false };
  d.streak = d.lastClear && dayNum(date) - dayNum(d.lastClear) === 1 ? d.streak + 1 : 1;
  d.lastClear = date;
  d.clears++;
  const carPick = d.clears % 3 === 0;
  if (carPick) p.carPicks++;
  return { streak: d.streak, carPick };
}

export function loadProgress(storage?: Pick<Storage, 'getItem'>): Progress {
  const base = defaultProgress();
  try {
    storage ??= localStorage;
    const raw = storage.getItem(PROGRESS_KEY);
    const o = raw ? JSON.parse(raw) : null;
    if (!o || typeof o !== 'object' || o.v !== 1) return base;
    return { ...base, ...o, daily: { ...base.daily, ...o.daily } };
  } catch {
    return base;
  }
}

export function saveProgress(p: Progress, storage?: Pick<Storage, 'setItem'>): void {
  try {
    storage ??= localStorage;
    storage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch { /* storage full or blocked: progress stays in memory */ }
}
