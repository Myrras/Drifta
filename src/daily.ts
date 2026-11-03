/** Daily challenge and LEGEND challenge: date-seeded, same for everyone. Pure. */
import type { GameMap, PlayerModel } from './types';
import { COSMETICS } from './cosmetics';
import { grantCosmetic, grantSkin, ownsCosmetic, recordDailyClear, type Progress } from './progress';

export interface Legend {
  map: string;
  car: PlayerModel;
  skin: string;
}
/** Legend days cycle through this list in order, so a missed skin comes round again. */
export const LEGENDS: Legend[] = [{ map: 'TOKYO NIGHTS', car: 'rx7', skin: 'fortune-orange' }];

export interface Daily {
  kind: 'daily' | 'legend';
  map: GameMap;
  target: number;
  car?: PlayerModel;
  skin?: string;
}

export interface DailyResult {
  kind: Daily['kind'];
  target: number;
  cleared: boolean;
  wallHits: number;
  /** cosmetic or skin id dropped by this clear */
  reward?: string;
  /** a car pick was earned */
  carPick: boolean;
}

const LEGEND_EVERY = 10;
const EPOCH = Date.UTC(2026, 0, 1) / 86400000;

/** local date as YYYY-MM-DD */
export const localDate = (d = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const dayNum = (date: string): number => Date.parse(date + 'T00:00:00Z') / 86400000;
const dayStr = (n: number): string => new Date(n * 86400000).toISOString().slice(0, 10);

/** FNV-1a with a final avalanche, so neighbouring dates look unrelated */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return h >>> 0;
}

export const isLegendDay = (date: string): boolean => hash('legend' + date) % LEGEND_EVERY === 0;

const ordinals = new Map<string, number>();
/** how many legend days came before this date since the epoch */
function legendOrdinal(date: string): number {
  let n = ordinals.get(date);
  if (n === undefined) {
    n = 0;
    for (let d = EPOCH; d < dayNum(date); d++) if (isLegendDay(dayStr(d))) n++;
    ordinals.set(date, n);
  }
  return n;
}

export function dailyFor(date: string, maps: GameMap[]): Daily {
  const racing = maps.filter((m) => m.medals); // TEST PAD has no medals
  if (isLegendDay(date)) {
    const l = LEGENDS[legendOrdinal(date) % LEGENDS.length];
    const map = racing.find((m) => m.name === l.map);
    if (map)
      return { kind: 'legend', map, target: Math.round(map.medals![2] * 1.5), car: l.car, skin: l.skin };
  }
  const map = racing[hash('map' + date) % racing.length];
  return { kind: 'daily', map, target: Math.round(map.medals![1] * 1.1) };
}

/** a random cosmetic the player does not own yet, or null when they own all */
export function rollCosmetic(p: Progress, rng: () => number = Math.random): string | null {
  const left = COSMETICS.filter((c) => !ownsCosmetic(p, c.id, false));
  return left.length ? left[Math.floor(rng() * left.length)].id : null;
}

/** Judge a finished daily run and pay out. Rewards come once per day. */
export function finishDaily(
  p: Progress,
  d: Daily,
  date: string,
  total: number,
  wallHits: number,
  rng: () => number = Math.random,
): DailyResult {
  const cleared = total >= d.target && (d.kind === 'daily' || wallHits === 0);
  const res: DailyResult = { kind: d.kind, target: d.target, cleared, wallHits, carPick: false };
  if (!cleared || p.daily.lastClear === date) return res;
  res.carPick = recordDailyClear(p, date).carPick;
  if (d.kind === 'legend' && d.skin) {
    if (grantSkin(p, d.skin)) res.reward = d.skin;
  } else {
    const id = rollCosmetic(p, rng);
    if (id && grantCosmetic(p, id)) res.reward = id;
  }
  return res;
}

/** streak still alive today: last clear was today or yesterday */
export function liveStreak(p: Progress, date: string): number {
  const last = p.daily.lastClear;
  return last && dayNum(date) - dayNum(last) <= 1 ? p.daily.streak : 0;
}
