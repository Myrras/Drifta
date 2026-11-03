import { describe, expect, it } from 'vitest';
import { newPhotoCam, PHOTO_MAX_OFFSET, PHOTO_ZOOM, stepPhoto } from './photo';

describe('photo camera', () => {
  it('clamps zoom', () => {
    expect(stepPhoto(newPhotoCam(), { photoZoom: 1 }, 100, 20).zoom).toBe(PHOTO_ZOOM[0]);
    expect(stepPhoto(newPhotoCam(), { photoZoom: -1 }, 100, 20).zoom).toBe(PHOTO_ZOOM[1]);
  });
  it('clamps the offset to the max radius', () => {
    const c = stepPhoto(newPhotoCam(), { photoPan: { x: 1, y: 1 } }, 100, 20);
    expect(Math.hypot(c.x, c.y)).toBeCloseTo(PHOTO_MAX_OFFSET);
  });
  it('pans in screen axes, rotated into the world', () => {
    const c = stepPhoto(
      { ...newPhotoCam(), rot: Math.PI / 2 },
      { photoPan: { x: 1, y: 0 } },
      0.1,
      20,
    );
    expect(c.x).toBeCloseTo(0, 5);
    expect(c.y).toBeLessThan(0);
  });
  it('rotates and wraps', () => {
    expect(stepPhoto(newPhotoCam(), { photoRot: 1 }, 1, 20).rot).toBeCloseTo(1.2);
    expect(stepPhoto({ ...newPhotoCam(), rot: 6.2 }, { photoRot: 1 }, 1, 20).rot).toBeLessThan(
      2 * Math.PI,
    );
  });
});
