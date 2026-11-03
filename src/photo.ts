import type { InputState, Vec } from './types';

/** Photo camera: offset from the frozen car (m, screen axes at rot 0), view-height multiplier, rotation (rad). */
export interface PhotoCam {
  x: number;
  y: number;
  zoom: number;
  rot: number;
}

export const PHOTO_VIEW_H = 38; // keep equal to VIEW_H_REST in render.ts
export const PHOTO_MAX_OFFSET = 60;
export const PHOTO_ZOOM: [number, number] = [0.25, 3];
const PAN_PER_VIEW = 0.6; // view heights per second at full deflection
const ROT_RATE = 1.2; // rad/s
const ZOOM_RATE = 1.2; // e-folds/s

export const newPhotoCam = (): PhotoCam => ({ x: 0, y: 0, zoom: 1, rot: 0 });

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Pure step. Pan is in screen axes, so it is rotated into the world; `viewH` is the rest view height (m). */
export function stepPhoto(
  c: PhotoCam,
  i: Pick<InputState, 'photoPan' | 'photoRot' | 'photoZoom'>,
  dt: number,
  viewH: number,
): PhotoCam {
  const pan: Vec = i.photoPan ?? { x: 0, y: 0 };
  const rot = (c.rot + (i.photoRot ?? 0) * ROT_RATE * dt) % (2 * Math.PI);
  const zoom = clamp(c.zoom * Math.exp(-(i.photoZoom ?? 0) * ZOOM_RATE * dt), ...PHOTO_ZOOM);
  const sp = PAN_PER_VIEW * viewH * zoom * dt;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  let x = c.x + (pan.x * cr + pan.y * sr) * sp;
  let y = c.y + (-pan.x * sr + pan.y * cr) * sp;
  const d = Math.hypot(x, y);
  if (d > PHOTO_MAX_OFFSET) {
    x *= PHOTO_MAX_OFFSET / d;
    y *= PHOTO_MAX_OFFSET / d;
  }
  return { x, y, zoom, rot };
}

/** Download the canvas as drifta-<map>-<timestamp>.png. Call right after drawing, with the HUD off. */
export function savePhoto(canvas: HTMLCanvasElement, map: string): void {
  const name = `drifta-${map.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}.png`;
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
}
