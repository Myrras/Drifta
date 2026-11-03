import { PLAYER_MODELS } from './models';
import { TRACKS, type Track } from './music';
import type { PlayerModel } from './types';

export type { Tune } from './engine';
import type { Tune } from './engine';

export const CLIP_QUALITIES = ['off', 'low', 'medium', 'high'] as const;
export type ClipQuality = (typeof CLIP_QUALITIES)[number];

export const MENU_THEMES = ['arcade', 'vhs'] as const;
export type MenuTheme = (typeof MENU_THEMES)[number];

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  engine: number;
  shake: boolean;
  /** show the best-run ghost */
  ghost: boolean;
  track: Track;
  /** drift clip recording quality */
  clips: ClipQuality;
  /** title / settings look */
  menuTheme: MenuTheme;
  car: PlayerModel;
  color: string;
  tune: Tune;
  /** player name, for multiplayer name tags */
  name: string;
  /** per-map option (traffic / pillars) by map name; missing = on */
  hazards: Record<string, boolean>;
}

export const hazardsOn = (s: Settings, mapName: string): boolean => s.hazards[mapName] !== false;

export const NAME_RE = /^[A-Z0-9_]{1,12}$/;
export function cleanName(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '')
    .slice(0, 12);
}
export function guestName(rand = Math.random): string {
  return `GUEST${1000 + Math.floor(rand() * 9000)}`;
}

export const SETTINGS_KEY = 'drifta.settings';
export type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const defaultSettings = (): Settings => ({
  master: 0.8,
  music: 0.6,
  sfx: 0.8,
  engine: 0.8,
  shake: true,
  ghost: true,
  track: 'phonk', // old 'tokyo' / 'eurobeat' saves fail validation and land here
  clips: 'medium',
  menuTheme: 'arcade',
  car: 'mx5',
  color: '#d32030',
  tune: 'street',
  name: guestName(),
  hazards: {},
});

const vol = (v: unknown, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d;

const readRaw = (storage?: SettingsStorage): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse((storage ?? localStorage).getItem(SETTINGS_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return null;
  }
};

const validName = (v: unknown): v is string => typeof v === 'string' && NAME_RE.test(v);

const bools = (v: unknown): Record<string, boolean> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).filter(([, b]) => typeof b === 'boolean'))
    : {};

/** true when storage holds a valid name (else loadSettings made up a guest name) */
export const hasStoredName = (storage?: SettingsStorage): boolean =>
  validName(readRaw(storage)?.name);

export function loadSettings(storage?: SettingsStorage): Settings {
  const d = defaultSettings();
  const raw = readRaw(storage);
  if (!raw) return d;
  const car = raw.car as PlayerModel;
  const ok = typeof car === 'string' && Object.hasOwn(PLAYER_MODELS, car);
  const color = ok && PLAYER_MODELS[car].colors.includes(raw.color as string);
  return {
    master: vol(raw.master, d.master),
    music: vol(raw.music, d.music),
    sfx: vol(raw.sfx, d.sfx),
    engine: vol(raw.engine, d.engine),
    shake: typeof raw.shake === 'boolean' ? raw.shake : d.shake,
    ghost: typeof raw.ghost === 'boolean' ? raw.ghost : d.ghost,
    track: TRACKS.includes(raw.track as Track) ? (raw.track as Track) : d.track,
    clips: CLIP_QUALITIES.includes(raw.clips as ClipQuality) ? (raw.clips as ClipQuality) : d.clips,
    menuTheme: MENU_THEMES.includes(raw.menuTheme as MenuTheme)
      ? (raw.menuTheme as MenuTheme)
      : d.menuTheme,
    car: ok ? car : d.car,
    color: ok ? (color ? (raw.color as string) : PLAYER_MODELS[car].colors[0]) : d.color,
    tune: raw.tune === 'performance' || raw.tune === 'street' ? raw.tune : d.tune,
    name: validName(raw.name) ? raw.name : d.name,
    hazards: bools(raw.hazards),
  };
}

export function saveSettings(s: Settings, storage?: SettingsStorage): void {
  try {
    (storage ?? localStorage).setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* unavailable: settings last for the session only */
  }
}
