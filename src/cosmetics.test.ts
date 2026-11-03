import { describe, expect, it } from 'vitest';
import { cacheSet, lookKey, DEFAULT_SMOKE, itemById, paintsForMap, SKINS, smokeColor, type Look } from './cosmetics';
import { PLAYER_MODELS } from './models';
import { drawCar } from './sprites';
import type { PlayerModel } from './types';

const PLAN_IDS = [
  ...['concrete-grey', 'b2-violet', 'harbor-teal', 'crane-yellow'],
  ...['neon-pink', 'midnight-blue', 'moon-gold', 'ketchup-red'],
  ...['underglow-pink', 'underglow-cyan', 'underglow-green', 'underglow-purple'],
  ...['smoke-pink', 'smoke-cyan', 'smoke-yellow', 'smoke-purple'],
  ...['spoiler-ducktail', 'spoiler-gt', 'hood-carbon', 'tint-dark', 'tint-limo', 'fortune-orange'],
];

/** Canvas stand-in counting fills. */
function stubCtx() {
  let fills = 0;
  const ctx = new Proxy(
    {},
    {
      get: (_, k) =>
        k === 'fills' ? fills : () => void (k === 'fill' || k === 'fillRect' ? fills++ : 0),
      set: () => true,
    },
  );
  return ctx as CanvasRenderingContext2D & { fills: number };
}

describe('cosmetics', () => {
  it('has every id from the plan with a name', () => {
    for (const id of PLAN_IDS) expect(itemById(id)?.name, id).toBeTruthy();
    expect(SKINS.find((s) => s.id === 'fortune-orange')?.car).toBe('rx7');
  });

  it('maps paints per racing map as [3rd, 2nd]', () => {
    expect(paintsForMap('TOKYO NIGHTS')).toEqual(['neon-pink', 'midnight-blue']);
    expect(paintsForMap('MIDNIGHT DRIVE-THRU')).toEqual(['moon-gold', 'ketchup-red']);
    expect(paintsForMap('TEST PAD')).toBeUndefined();
  });

  it('smoke colour defaults to grey, else r,g,b of the chosen smoke', () => {
    expect(smokeColor()).toBe(DEFAULT_SMOKE);
    expect(smokeColor({ smoke: 'smoke-yellow' })).toBe('255,230,128');
  });

  const full: Look = {
    paint: 'neon-pink',
    skin: 'fortune-orange',
    underglow: 'underglow-cyan',
    smoke: 'smoke-pink',
    spoiler: 'gt',
    hood: true,
    tint: 'tint-limo',
  };
  it.each(Object.keys(PLAYER_MODELS) as PlayerModel[])('%s draws a full look', (m) => {
    const plain = stubCtx();
    drawCar(plain, m, '#fff');
    const g = stubCtx();
    drawCar(g, m, '#fff', full);
    expect(g.fills).toBeGreaterThan(plain.fills);
  });
});

describe('cache helpers', () => {
  it('lookKey ignores smoke and key order', () => {
    expect(lookKey({ paint: 'a', smoke: 'x' })).toBe(lookKey({ smoke: 'y', paint: 'a' }));
    expect(lookKey({ paint: 'a' })).not.toBe(lookKey({ paint: 'a', hood: true }));
  });
  it('cacheSet evicts the oldest', () => {
    const m = new Map<number, number>();
    for (let i = 0; i < 30; i++) cacheSet(m, i, i);
    expect(m.size).toBe(24);
    expect(m.has(5)).toBe(false);
    expect(m.has(6)).toBe(true);
  });
});
