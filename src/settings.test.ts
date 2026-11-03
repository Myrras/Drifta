import { describe, expect, it } from 'vitest';
import { defaultSettings, loadSettings, saveSettings, SETTINGS_KEY } from './settings';

const fake = (init?: string) => {
  const m = new Map<string, string>(init === undefined ? [] : [[SETTINGS_KEY, init]]);
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
};

describe('settings', () => {
  it('defaults when empty or corrupt', () => {
    expect(loadSettings(fake())).toEqual(defaultSettings());
    expect(loadSettings(fake('{nope'))).toEqual(defaultSettings());
  });
  it('clamps volumes', () => {
    const s = loadSettings(fake(JSON.stringify({ master: 5, music: -1, sfx: 'x' })));
    expect([s.master, s.music, s.sfx]).toEqual([1, 0, 0.8]);
  });
  it('falls back on an invalid car or color', () => {
    expect(loadSettings(fake(JSON.stringify({ car: 'bogus', color: '#123456' })))).toMatchObject({
      car: 'mx5',
      color: '#d32030',
    });
    expect(loadSettings(fake(JSON.stringify({ car: 'supra', color: '#123456' }))).color).toBe(
      '#ff7a00',
    );
  });
  it('validates the track', () => {
    expect(loadSettings(fake(JSON.stringify({ track: 'eurobeat' }))).track).toBe('phonk');
    expect(loadSettings(fake(JSON.stringify({ track: 'tokyo' }))).track).toBe('phonk');
    expect(loadSettings(fake(JSON.stringify({ track: 'polka' }))).track).toBe('phonk');
  });
  it('validates the menu theme and accepts the mine track', () => {
    expect(loadSettings(fake()).menuTheme).toBe('arcade');
    expect(loadSettings(fake(JSON.stringify({ menuTheme: 'vhs' }))).menuTheme).toBe('vhs');
    expect(loadSettings(fake(JSON.stringify({ menuTheme: 'x' }))).menuTheme).toBe('arcade');
    expect(loadSettings(fake(JSON.stringify({ track: 'mine' }))).track).toBe('mine');
  });
  it('validates the tune', () => {
    expect(loadSettings(fake(JSON.stringify({ tune: 'performance' }))).tune).toBe('performance');
    expect(loadSettings(fake(JSON.stringify({ tune: 'x' }))).tune).toBe('street');
    expect(loadSettings(fake()).tune).toBe('street');
  });
  it('validates the clip quality', () => {
    expect(loadSettings(fake(JSON.stringify({ clips: 'off' }))).clips).toBe('off');
    expect(loadSettings(fake(JSON.stringify({ clips: '4k' }))).clips).toBe('medium');
  });

  it('persists', () => {
    const st = fake();
    saveSettings(
      { ...defaultSettings(), car: 'wrx', color: '#e8e8e8', shake: false, music: 0.3 },
      st,
    );
    expect(loadSettings(st)).toMatchObject({
      car: 'wrx',
      color: '#e8e8e8',
      shake: false,
      music: 0.3,
    });
  });
  it('survives missing storage', () => {
    expect(
      loadSettings({
        getItem: () => {
          throw new Error('x');
        },
        setItem: () => {},
      }),
    ).toEqual(defaultSettings());
    expect(() =>
      saveSettings(defaultSettings(), {
        getItem: () => null,
        setItem: () => {
          throw new Error('x');
        },
      }),
    ).not.toThrow();
  });
});
