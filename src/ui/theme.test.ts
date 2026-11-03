import { describe, expect, it } from 'vitest';
import { drawBackdrop, drawOverlayFx, THEMES, type ThemeId } from './theme';
import { drawLogo } from './logo';

/** 2D context stub: every method is a no-op that returns a gradient/metrics-like object. */
function mockCtx(): { ctx: CanvasRenderingContext2D; calls: { n: number } } {
  const calls = { n: 0 };
  const stub = { addColorStop() {}, width: 120 };
  const props: Record<string | symbol, unknown> = { canvas: { width: 1600, height: 900 } };
  const ctx = new Proxy(props, {
    get: (o, k) =>
      k in o
        ? o[k]
        : () => {
            calls.n++;
            return stub;
          },
    set: (o, k, v) => {
      o[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe('themes', () => {
  for (const id of Object.keys(THEMES) as ThemeId[]) {
    it(`${id} draws backdrop, logo and overlay without throwing`, () => {
      const { ctx, calls } = mockCtx();
      const th = THEMES[id];
      for (const t of [0, 0.3, 0.6, 1, 1.25, 2.5, 4.95, 37.1, 3600.4]) {
        drawBackdrop(ctx, 800, 450, t, th);
        drawBackdrop(ctx, 800, 450, t, th, true); // live attract variant
        drawLogo(ctx, 400, 100, 60, t, th);
        drawOverlayFx(ctx, 800, 450, t, th);
      }
      expect(calls.n).toBeGreaterThan(100);
      expect(th.font(800, 20, true)).toMatch(/^italic 800 20px /);
    });
  }
});
