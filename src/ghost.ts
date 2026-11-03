import type { PlayerModel } from './types';

export interface GhostFrame {
  t: number;
  x: number;
  y: number;
  angle: number;
  floor: number;
}
export interface Ghost {
  car: PlayerModel;
  look?: Record<string, unknown>;
  frames: GhostFrame[];
}

export const GHOST_HZ = 20;
export const GHOST_MAX_BYTES = 200_000;
export const ghostKey = (map: string) => `drifta.ghost.${map}`;
const TAU = Math.PI * 2;

/** Records at ~GHOST_HZ of run time. */
export function createRecorder() {
  const frames: GhostFrame[] = [];
  return {
    frames,
    add(t: number, x: number, y: number, angle: number, floor: number): void {
      if (frames.length && t - frames[frames.length - 1].t < 1 / GHOST_HZ - 1e-9) return;
      frames.push({ t, x, y, angle, floor });
    },
  };
}

/** Flat delta-encoded ints: t in cs, x/y in cm, angle in mrad (unwrapped), floor. */
export function serialize(g: Ghost): string {
  let frames = g.frames;
  const enc = () => {
    const d: number[] = [];
    let p = [0, 0, 0, 0];
    let a = 0;
    for (const f of frames) {
      a += Math.atan2(Math.sin(f.angle - a), Math.cos(f.angle - a)); // unwrapped, continuous
      const q = [Math.round(f.t * 100), Math.round(f.x * 100), Math.round(f.y * 100), Math.round(a * 1000)];
      d.push(q[0] - p[0], q[1] - p[1], q[2] - p[2], q[3] - p[3], f.floor);
      p = q;
      a = q[3] / 1000;
    }
    return JSON.stringify({ car: g.car, look: g.look, d });
  };
  let out = enc();
  // shortcut: thin by halves to fit the cap; interpolation hides it
  while (out.length > GHOST_MAX_BYTES && frames.length > 2) {
    frames = frames.filter((_, i) => i % 2 === 0);
    out = enc();
  }
  return out;
}

export function deserialize(raw: string | null): Ghost | null {
  try {
    const o = JSON.parse(raw ?? '');
    if (!o || typeof o.car !== 'string' || !Array.isArray(o.d) || o.d.length % 5) return null;
    const frames: GhostFrame[] = [];
    let [t, x, y, a] = [0, 0, 0, 0];
    for (let i = 0; i < o.d.length; i += 5) {
      const v = o.d.slice(i, i + 5) as number[];
      if (!v.every(Number.isFinite)) return null;
      t += v[0];
      x += v[1];
      y += v[2];
      a += v[3];
      frames.push({ t: t / 100, x: x / 100, y: y / 100, angle: a / 1000, floor: v[4] });
    }
    return frames.length ? { car: o.car, look: o.look ?? undefined, frames } : null;
  } catch {
    return null;
  }
}

export function saveGhost(map: string, g: Ghost): void {
  try {
    localStorage.setItem(ghostKey(map), serialize(g));
  } catch {
    /* storage full or unavailable: no ghost */
  }
}

export function loadGhost(map: string): Ghost | null {
  try {
    return deserialize(localStorage.getItem(ghostKey(map)));
  } catch {
    return null;
  }
}

/** Pose at time t, interpolated; null after the last frame. Floor snaps to the earlier frame. */
export function sample(g: Ghost, t: number): GhostFrame | null {
  const f = g.frames;
  if (!f.length || t > f[f.length - 1].t) return null;
  if (t <= f[0].t) return f[0];
  let lo = 0;
  let hi = f.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (f[m].t <= t) lo = m;
    else hi = m;
  }
  const a = f[lo];
  const b = f[hi];
  const k = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  let da = (b.angle - a.angle) % TAU;
  if (da > Math.PI) da -= TAU;
  else if (da < -Math.PI) da += TAU;
  return { t, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, angle: a.angle + da * k, floor: a.floor };
}
