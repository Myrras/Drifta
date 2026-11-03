import { PLAYER_MODELS } from './models';
import { TRACKS, type Track } from './music';
import type { PlayerModel } from './types';

export type { Tune } from './engine';
import type { Tune } from './engine';

export const CLIP_QUALITIES = ['off', 'low', 'medium', 'high'] as const;
export type ClipQuality = (typeof CLIP_QUALITIES)[number];

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  engine: number;
  shake: boolean;
  track: Track;
  /** drift clip recording quality */
  clips: ClipQuality;
  car: PlayerModel;
  color: string;
  tune: Tune;
}

export const SETTINGS_KEY = 'drifta.settings';
export type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const defaultSettings = (): Settings => ({
  master: 0.8,
  music: 0.6,
  sfx: 0.8,
  engine: 0.8,
  shake: true,
  track: 'tokyo',
  clips: 'medium',
  car: 'mx5',
  color: '#d32030',
  tune: 'street',
});

const vol = (v: unknown, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d;

export function loadSettings(storage?: SettingsStorage): Settings {
  const d = defaultSettings();
  let raw: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse((storage ?? localStorage).getItem(SETTINGS_KEY) ?? '{}');
    if (parsed && typeof parsed === 'object') raw = parsed;
  } catch {
    return d;
  }
  const car = raw.car as PlayerModel;
  const ok = typeof car === 'string' && Object.hasOwn(PLAYER_MODELS, car);
  const color = ok && PLAYER_MODELS[car].colors.includes(raw.color as string);
  return {
    master: vol(raw.master, d.master),
    music: vol(raw.music, d.music),
    sfx: vol(raw.sfx, d.sfx),
    engine: vol(raw.engine, d.engine),
    shake: typeof raw.shake === 'boolean' ? raw.shake : d.shake,
    track: TRACKS.includes(raw.track as Track) ? (raw.track as Track) : d.track,
    clips: CLIP_QUALITIES.includes(raw.clips as ClipQuality) ? (raw.clips as ClipQuality) : d.clips,
    car: ok ? car : d.car,
    color: ok ? (color ? (raw.color as string) : PLAYER_MODELS[car].colors[0]) : d.color,
    tune: raw.tune === 'performance' || raw.tune === 'street' ? raw.tune : d.tune,
  };
}

export function saveSettings(s: Settings, storage?: SettingsStorage): void {
  try {
    (storage ?? localStorage).setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* unavailable: settings last for the session only */
  }
}
