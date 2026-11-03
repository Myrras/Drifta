import { describe, expect, it } from 'vitest';
import { ENGINE_PROFILES } from './engine';
import { PLAYER_MODELS } from './models';
import { drawCar } from './sprites';
import type { PlayerModel } from './types';

/** Canvas stand-in: every method is a no-op that counts fills. */
function stubCtx() {
  let fills = 0;
  const ctx = new Proxy(
    {},
    {
      get: (_, k) =>
        k === 'fills'
          ? fills
          : () => {
              if (k === 'fill' || k === 'fillRect') fills++;
            },
      set: () => true,
    },
  );
  return ctx as CanvasRenderingContext2D & { fills: number };
}

describe('player models', () => {
  const ids = Object.keys(PLAYER_MODELS) as PlayerModel[];

  it.each(ids)('%s has an engine profile and a sprite', (m) => {
    expect(ENGINE_PROFILES[m]).toBeDefined();
    const g = stubCtx();
    drawCar(g, m, PLAYER_MODELS[m].colors[0]);
    expect(g.fills).toBeGreaterThan(5);
  });

  it('Celica carries its RWD conversion tag', () => {
    expect(PLAYER_MODELS.celica.tag).toBe('RWD CONVERSION');
    expect(PLAYER_MODELS.rx8.tag).toBeUndefined();
  });
});
