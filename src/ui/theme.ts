export type ThemeId = 'arcade' | 'vhs';

export interface Theme {
  id: ThemeId;
  bg: string;
  panel: string;
  panelSel: string;
  accent: string;
  accent2: string;
  text: string;
  dim: string;
  glow: number; // shadowBlur scale, 0 = none
  font(weight: number, sizePx: number, italic?: boolean): string;
}

const fontFn =
  (family: string) =>
  (weight: number, size: number, italic = false): string =>
    `${italic ? 'italic ' : ''}${weight} ${size}px ${family}`;

export const THEMES: Record<ThemeId, Theme> = {
  arcade: {
    id: 'arcade',
    bg: '#0a0722',
    panel: 'rgba(16,10,44,0.74)',
    panelSel: 'rgba(255,36,150,0.9)',
    accent: '#ff2fb4',
    accent2: '#2ef2ff',
    text: '#f3eeff',
    dim: '#8c86c4',
    glow: 1,
    font: fontFn('"Chakra Petch", "Segoe UI", system-ui, sans-serif'),
  },
  vhs: {
    id: 'vhs',
    bg: '#1d140f',
    panel: 'rgba(38,24,16,0.76)',
    panelSel: 'rgba(214,74,40,0.92)',
    accent: '#f4b23a',
    accent2: '#e2483a',
    text: '#f5e7cc',
    dim: '#a8916f',
    glow: 0,
    font: fontFn('Archivo, "Arial Narrow", "Segoe UI", sans-serif'),
  },
};

/** Display faces used by the logo and the VHS on-screen display. */
export const DISPLAY = '"Dela Gothic One", "Arial Black", Impact, sans-serif';
export const MASTHEAD = 'Anton, Impact, "Arial Narrow", sans-serif';
export const OSD = 'VT323, "Lucida Console", monospace';

// Gradients belong to one context; cache them per context and size-dependent key.
const gradCache = new WeakMap<object, Map<string, CanvasGradient>>();
export function cachedGrad(
  ctx: CanvasRenderingContext2D,
  key: string,
  make: () => CanvasGradient,
): CanvasGradient {
  let m = gradCache.get(ctx);
  if (!m) gradCache.set(ctx, (m = new Map()));
  let g = m.get(key);
  if (!g) {
    if (m.size > 64) m.clear(); // resizes would otherwise grow it forever
    g = make();
    m.set(key, g);
  }
  return g;
}

export function linear(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stops: [number, string][],
): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

function radial(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  stops: [number, string][],
): CanvasGradient {
  const r = Math.hypot(w, h) / 2;
  const g = ctx.createRadialGradient(w / 2, h / 2, r * 0.35, w / 2, h / 2, r);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

/** Deterministic hash in [0,1). */
export function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// ---------- arcade: Shutoko loop at 2 a.m. ----------

const HORIZON = 0.7; // skyline base, fraction of h
interface Tower {
  x: number; // left edge, fraction of w
  w: number; // fraction of w
  h: number; // fraction of h
  sign: number; // -1 none, 0 accent, 1 accent2
}
const TOWERS: Tower[] = [];
for (let x = -0.02, i = 0; x < 1.02; i++) {
  const w = 0.03 + hash(i) * 0.06;
  TOWERS.push({ x, w, h: 0.06 + hash(i + 50) ** 2 * 0.3, sign: hash(i + 90) > 0.7 ? i % 2 : -1 });
  x += w + hash(i + 20) * 0.012;
}
interface Win {
  t: number; // tower index
  fx: number;
  fy: number;
  g: number; // twinkle group
  c: number; // 0 amber, 1 cyan
}
const WINDOWS: Win[] = [];
TOWERS.forEach((_, ti) => {
  for (let k = 0; k < 9; k++) {
    const r = hash(ti * 31 + k * 7.3);
    if (r < 0.35) continue;
    WINDOWS.push({
      t: ti,
      fx: hash(ti + k * 3.1),
      fy: hash(ti * 2 + k * 5.7),
      g: k % 3,
      c: r > 0.88 ? 1 : 0,
    });
  }
});
const TRAILS = Array.from({ length: 16 }, (_, i) => ({
  lane: i % 4, // 0,1 headlights going right; 2,3 tail lights going left
  speed: 0.12 + hash(i + 200) * 0.2,
  phase: hash(i + 300),
  len: 0.12 + hash(i + 400) * 0.18,
}));
const WIN_RGB = ['rgba(255,196,110,', 'rgba(120,240,255,'];

function arcadeBackdrop(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  th: Theme,
): void {
  const u = Math.min(w, h) / 100;
  const hy = h * HORIZON;
  ctx.save();
  ctx.fillStyle = cachedGrad(ctx, `a-sky|${h}`, () =>
    linear(ctx, 0, 0, 0, h, [
      [0, 'rgba(7,5,28,0.8)'],
      [0.42, 'rgba(30,10,70,0.58)'],
      [HORIZON - 0.015, 'rgba(160,24,124,0.42)'],
      [HORIZON + 0.005, 'rgba(10,6,30,0.86)'],
      [1, 'rgba(4,3,16,0.9)'],
    ]),
  );
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(6,3,20,0.92)';
  ctx.beginPath();
  for (const b of TOWERS) ctx.rect(b.x * w, hy - b.h * h, b.w * w, b.h * h + 1);
  ctx.fill();

  // three twinkle groups so the city breathes without per-window state
  for (let gi = 0; gi < 3; gi++) {
    const a = 0.3 + 0.4 * (0.5 + 0.5 * Math.sin(t * (0.6 + gi * 0.45) + gi * 2.1));
    for (let c = 0; c < 2; c++) {
      ctx.fillStyle = WIN_RGB[c] + a.toFixed(2) + ')';
      ctx.beginPath();
      for (const win of WINDOWS) {
        if (win.g !== gi || win.c !== c) continue;
        const b = TOWERS[win.t];
        ctx.rect(
          (b.x + b.w * (0.12 + win.fx * 0.7)) * w,
          hy - b.h * h * (0.1 + win.fy * 0.82),
          0.55 * u,
          0.75 * u,
        );
      }
      ctx.fill();
    }
  }

  // rooftop neon tubes, each with its own rare flicker
  ctx.shadowBlur = 1.8 * u * th.glow;
  TOWERS.forEach((b, i) => {
    if (b.sign < 0) return;
    const col = b.sign === 0 ? th.accent : th.accent2;
    ctx.shadowColor = col;
    ctx.fillStyle = col;
    ctx.globalAlpha = hash(Math.floor(t * 9) + i * 13) > 0.95 ? 0.2 : 0.85;
    const top = hy - b.h * h;
    ctx.fillRect((b.x + b.w * 0.5) * w - 0.35 * u, top - 7 * u, 0.7 * u, 6.4 * u);
  });
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;

  // elevated expressway: guard-rail line + streaming light trails
  const deck = hy + 2.4 * u;
  ctx.fillStyle = 'rgba(255,110,200,0.28)';
  ctx.fillRect(0, deck - 0.8 * u, w, 0.25 * u);
  const head = cachedGrad(ctx, 'a-head', () =>
    linear(ctx, 0, 0, 1, 0, [
      [0, 'rgba(160,220,255,0)'],
      [0.8, 'rgba(210,240,255,0.5)'],
      [1, 'rgba(255,255,255,0.95)'],
    ]),
  );
  const tail = cachedGrad(ctx, 'a-tail', () =>
    linear(ctx, 0, 0, 1, 0, [
      [0, 'rgba(255,40,70,0.95)'],
      [0.2, 'rgba(255,30,90,0.45)'],
      [1, 'rgba(255,0,90,0)'],
    ]),
  );
  ctx.globalCompositeOperation = 'lighter';
  for (const tr of TRAILS) {
    const right = tr.lane < 2;
    const len = tr.len * w;
    const p = (tr.phase + t * tr.speed) % 1;
    const x = right ? -len + p * (w + len) : w - p * (w + len);
    ctx.save();
    ctx.translate(x, deck + (tr.lane + 0.5) * 1.5 * u);
    ctx.scale(len, 0.32 * u);
    ctx.fillStyle = right ? head : tail;
    ctx.fillRect(0, -0.5, 1, 1);
    ctx.restore();
  }
  ctx.restore();
}

function arcadeOverlay(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  ctx.save();
  ctx.fillStyle = cachedGrad(ctx, `a-vig|${w}|${h}`, () =>
    radial(ctx, w, h, [
      [0, 'rgba(8,4,30,0)'],
      [1, 'rgba(8,4,30,0.62)'],
    ]),
  );
  ctx.fillRect(0, 0, w, h);
  // neon haze bleeding in from the edges, breathing slowly
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.75 + 0.25 * Math.sin(t * 0.8);
  ctx.fillStyle = cachedGrad(ctx, `a-haze|${h}`, () =>
    linear(ctx, 0, 0, 0, h, [
      [0, 'rgba(46,242,255,0.07)'],
      [0.16, 'rgba(46,242,255,0)'],
      [0.82, 'rgba(255,47,180,0)'],
      [1, 'rgba(255,47,180,0.1)'],
    ]),
  );
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

// ---------- vhs: a taped-off-TV car-magazine cover ----------

function vhsBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const u = Math.min(w, h) / 100;
  ctx.save();
  ctx.fillStyle = cachedGrad(ctx, `v-wash|${h}`, () =>
    linear(ctx, 0, 0, 0, h, [
      [0, 'rgba(34,20,14,0.82)'],
      [0.55, 'rgba(84,40,22,0.6)'],
      [1, 'rgba(26,14,10,0.88)'],
    ]),
  );
  ctx.fillRect(0, 0, w, h);

  // the cover's livery stripes: yellow / orange / red, raked like a door decal
  const rake = h * 0.55;
  const band = 5.5 * u;
  const drift = Math.sin(t * 0.35) * 3 * u;
  const cols = ['rgba(244,178,58,0.5)', 'rgba(228,112,42,0.5)', 'rgba(200,52,40,0.5)'];
  cols.forEach((c, i) => {
    const y0 = h * 0.92 - i * band * 1.25 + drift;
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(-w * 0.1, y0);
    ctx.lineTo(w * 1.1, y0 - rake);
    ctx.lineTo(w * 1.1, y0 - rake - band);
    ctx.lineTo(-w * 0.1, y0 - band);
    ctx.closePath();
    ctx.fill();
  });

  // registration-mark crosshairs in the margins, the printer's leftovers
  ctx.strokeStyle = 'rgba(245,231,204,0.18)';
  ctx.lineWidth = Math.max(1, 0.2 * u);
  ctx.beginPath();
  for (const [x, y] of [
    [5 * u, h - 5 * u],
    [w - 5 * u, 5 * u],
  ]) {
    ctx.moveTo(x - 2 * u, y);
    ctx.lineTo(x + 2 * u, y);
    ctx.moveTo(x, y - 2 * u);
    ctx.lineTo(x, y + 2 * u);
    ctx.moveTo(x + 1.2 * u, y);
    ctx.arc(x, y, 1.2 * u, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.restore();
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function vhsOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  th: Theme,
): void {
  const u = Math.min(w, h) / 100;
  const src = ctx.canvas as HTMLCanvasElement | undefined;
  const k = src && src.width ? src.width / w : 0; // canvas px per css px; 0 = no readable canvas
  ctx.save();

  // chroma bleed: a faint copy of the frame smeared right
  if (k) {
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.09;
    ctx.drawImage(src!, 0, 0, src!.width, src!.height, 0.45 * u, 0, w, h);
    ctx.globalAlpha = 1;
  }

  // faded blacks + warm cast
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = 'rgba(46,26,8,0.5)';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';

  // tracking band: rolls down slowly, displaces the strip under it and leaves noise
  const bandH = 3.2 * u;
  const by = (((t * 0.06) % 1.25) - 0.12) * h;
  if (k && by > -bandH && by < h) {
    const shift = (hash(Math.floor(t * 20)) - 0.3) * 2.4 * u;
    const y0 = Math.max(0, by);
    const sh = Math.min(h, by + bandH) - y0;
    if (sh > 0) ctx.drawImage(src!, 0, y0 * k, src!.width, sh * k, shift, y0, w, sh);
  }
  ctx.fillStyle = 'rgba(255,244,220,0.07)';
  ctx.fillRect(0, by, w, bandH);
  ctx.fillStyle = 'rgba(255,250,235,0.55)';
  ctx.beginPath();
  const seed = Math.floor(t * 24);
  for (let i = 0; i < 26; i++) {
    const r = hash(seed * 7 + i);
    ctx.rect(hash(seed + i * 3.7) * w, by + r * bandH, (2 + r * 9) * u, Math.max(1, 0.18 * u));
  }
  // head-switching noise along the bottom edge
  for (let i = 0; i < 14; i++)
    ctx.rect(hash(seed * 3 + i) * w, h - (0.4 + hash(i + seed) * 1.4) * u, 6 * u, 0.2 * u);
  ctx.fill();

  // scanlines, one path
  ctx.fillStyle = 'rgba(10,4,0,0.22)';
  ctx.beginPath();
  const step = Math.max(3, 0.6 * u);
  for (let y = 0; y < h; y += step) ctx.rect(0, y, w, step * 0.45);
  ctx.fill();

  ctx.fillStyle = cachedGrad(ctx, `v-vig|${w}|${h}`, () =>
    radial(ctx, w, h, [
      [0, 'rgba(20,8,0,0)'],
      [1, 'rgba(20,8,0,0.55)'],
    ]),
  );
  ctx.fillRect(0, 0, w, h);

  // OSD corner: PLAY ▶ and the tape counter, with a chroma fringe
  const fs = Math.max(14, 4.4 * u);
  const x = 4 * u;
  const y = 5 * u;
  const secs = Math.floor(t);
  const counter = `SP  ${Math.floor(secs / 3600)}:${pad2(Math.floor(secs / 60) % 60)}:${pad2(secs % 60)}`;
  ctx.font = `400 ${fs}px ${OSD}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const lines: [string, number][] = [
    ['PLAY ▶', y],
    [counter, y + fs * 0.95],
  ];
  for (const [s, ly] of lines) {
    ctx.fillStyle = 'rgba(255,40,40,0.55)';
    ctx.fillText(s, x - 0.25 * u, ly);
    ctx.fillStyle = 'rgba(40,220,255,0.55)';
    ctx.fillText(s, x + 0.25 * u, ly);
    ctx.fillStyle = th.text;
    ctx.fillText(s, x, ly);
  }
  ctx.restore();
}

/** Animated menu background, drawn first. Translucent so a live scene can show through. */
export function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  theme: Theme,
): void {
  if (theme.id === 'vhs') vhsBackdrop(ctx, w, h, t);
  else arcadeBackdrop(ctx, w, h, t, theme);
}

/** Post-fx drawn last over menus and HUD. */
export function drawOverlayFx(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  theme: Theme,
): void {
  if (theme.id === 'vhs') vhsOverlay(ctx, w, h, t, theme);
  else arcadeOverlay(ctx, w, h, t);
}
