import { describe, expect, it, vi } from 'vitest';
import {
  awardFinish, chooseStarter, defaultProgress, isCarUnlocked, loadProgress, ownsCosmetic,
  positionFor, recordDailyClear, saveProgress, spendCarPick,
} from './progress';
import type { GameMap } from './types';

const map = { name: 'B2 MEET', parTime: 100, medals: [100, 200, 300] } as GameMap;
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('positionFor', () => {
  it('needs score and time', () => {
    expect(positionFor(map, 300, 100)).toBe(1);
    expect(positionFor(map, 300, 110)).toBe(2);
    expect(positionFor(map, 300, 125)).toBe(3);
    expect(positionFor(map, 300, 131)).toBeNull();
    expect(positionFor(map, 150, 100)).toBe(3);
    expect(positionFor(map, 50, 10)).toBeNull();
    expect(positionFor({ ...map, medals: undefined }, 999, 1)).toBeNull();
  });
});

describe('awardFinish', () => {
  it('unlocks paints, keeps best, car pick once per map', () => {
    const p = defaultProgress();
    expect(awardFinish(p, map, 100, 120).newPaints).toEqual(['concrete-grey']);
    expect(awardFinish(p, map, 200, 110).newPaints).toEqual(['b2-violet']);
    const a = awardFinish(p, map, 300, 90);
    expect(a).toEqual({ position: 1, newPaints: [], carPick: true });
    expect(awardFinish(p, map, 300, 90).carPick).toBe(false);
    awardFinish(p, map, 100, 120);
    expect(p.results['B2 MEET'].position).toBe(1);
    expect(p.carPicks).toBe(1);
  });
  it('1st first grants both paints', () => {
    expect(awardFinish(defaultProgress(), map, 300, 90).newPaints).toHaveLength(2);
  });
});

describe('cars and cheat', () => {
  it('starter once, picks spent', () => {
    const p = defaultProgress();
    expect(chooseStarter(p, 'supra')).toBe(false);
    expect(chooseStarter(p, 'rx8')).toBe(true);
    expect(chooseStarter(p, 'civic')).toBe(false);
    expect(spendCarPick(p, 'supra')).toBe(false);
    p.carPicks = 1;
    expect(spendCarPick(p, 'supra')).toBe(true);
    expect(isCarUnlocked(p, 'supra', false)).toBe(true);
    expect(isCarUnlocked(p, 'nsx', false)).toBe(false);
    expect(isCarUnlocked(p, 'nsx', true)).toBe(true);
    expect(ownsCosmetic(p, 'tint-dark', false)).toBe(false);
    expect(ownsCosmetic(p, 'tint-dark', true)).toBe(true);
  });
  it('cheat is not persisted', () => {
    const s = mem();
    const p = defaultProgress();
    isCarUnlocked(p, 'nsx', true);
    saveProgress(p, s);
    expect(isCarUnlocked(loadProgress(s), 'nsx', false)).toBe(false);
  });
});

describe('daily', () => {
  it('streaks, resets, repeats are no-ops, 3rd clear gives a pick', () => {
    const p = defaultProgress();
    expect(recordDailyClear(p, '2026-11-01')).toEqual({ streak: 1, carPick: false });
    expect(recordDailyClear(p, '2026-11-01').streak).toBe(1);
    expect(recordDailyClear(p, '2026-11-02').streak).toBe(2);
    expect(recordDailyClear(p, '2026-11-03')).toEqual({ streak: 3, carPick: true });
    expect(recordDailyClear(p, '2026-11-05').streak).toBe(1);
    expect(p.carPicks).toBe(1);
  });
});

describe('load', () => {
  it('falls back on corrupt, missing, or throwing storage', () => {
    expect(loadProgress({ getItem: () => '{nope' })).toEqual(defaultProgress());
    expect(loadProgress({ getItem: () => null })).toEqual(defaultProgress());
    expect(loadProgress({ getItem: () => { throw new Error('x'); } })).toEqual(defaultProgress());
  });
  it('survives blocked global localStorage', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(loadProgress()).toEqual(defaultProgress());
    expect(() => saveProgress(defaultProgress())).not.toThrow();
    vi.unstubAllGlobals();
  });
  it('round-trips', () => {
    const s = mem();
    const p = defaultProgress();
    chooseStarter(p, 'civic');
    saveProgress(p, s);
    expect(loadProgress(s)).toEqual(p);
  });
});
