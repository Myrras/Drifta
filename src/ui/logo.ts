import { cachedGrad, DISPLAY, hash, linear, MASTHEAD, type Theme } from './theme';

const WORD = 'DRIFTA';
const KANA = ['ド', 'リ', 'フ', 'タ'];
const WIDTH = 4.4; // target wordmark width in cap heights, whatever face actually loaded

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
function easeOutBack(p: number): number {
  const c = 1.9;
  return 1 + (c + 1) * (p - 1) ** 3 + c * (p - 1) ** 2;
}

/** Horizontal scale that brings the wordmark to WIDTH * size. */
function fit(ctx: CanvasRenderingContext2D, size: number, lo: number, hi: number): number {
  const mw = ctx.measureText(WORD).width;
  if (!(mw > 0)) return 1;
  return Math.min(hi, Math.max(lo, (WIDTH * size) / mw));
}

// ---------- arcade: chrome + neon, skids in and slams down ----------

function arcadeLogo(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  t: number,
  th: Theme,
): void {
  const half = (WIDTH * size) / 2;
  const base = size / 2; // alphabetic baseline: caps span -size/2..size/2
  const p = clamp01(t / 0.55);
  const ease = 1 - (1 - p) ** 3;
  const settled = clamp01((t - 0.9) / 0.6);
  const dx = -(1 - easeOutBack(p)) * 3.2 * half;
  const bob = Math.sin(t * 1.4) * 0.035 * size * settled;
  const skew = -0.22 - (1 - ease) * 0.55;
  const flash = t > 0.5 && t < 0.95 ? 1 - (t - 0.5) / 0.45 : 0;
  const flicker = hash(Math.floor(t * 14)) > 0.975 ? 0.35 : 1;
  const breathe = 0.85 + 0.15 * Math.sin(t * 2.3);
  const fpx = size * 1.38;

  ctx.save();
  ctx.translate(cx, cy + bob);

  // tire smoke from the landing, rolling out behind the rear of the mark
  if (t > 0.42 && t < 1.8) {
    const smoke = cachedGrad(ctx, 'l-smoke', () => {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, 'rgba(225,215,255,0.55)');
      g.addColorStop(1, 'rgba(225,215,255,0)');
      return g;
    });
    const k = (t - 0.42) / 1.38;
    ctx.fillStyle = smoke;
    for (let i = 0; i < 7; i++) {
      const r = size * (0.3 + k * (0.6 + hash(i) * 0.5));
      ctx.save();
      ctx.globalAlpha = (1 - k) ** 1.5 * (0.35 + 0.3 * hash(i + 9));
      ctx.translate(
        -half * (0.3 + hash(i + 3) * 0.75) - k * size * 1.2,
        base * 0.8 - hash(i + 5) * 0.45 * size,
      );
      ctx.scale(r * 1.6, r);
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    }
  }

  ctx.save();
  ctx.translate(dx, 0);
  ctx.transform(1, 0, skew, 1, 0, 0);
  ctx.font = `400 ${fpx}px ${DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.scale(fit(ctx, size, 0.6, 1.3), 1);

  // motion ghosts while skidding in
  if (p < 1) {
    ctx.fillStyle = th.accent;
    for (let i = 1; i <= 3; i++) {
      ctx.globalAlpha = (0.3 / i) * (1 - p);
      ctx.fillText(WORD, -i * 0.45 * size * (1 - p) * 3, base);
    }
    ctx.globalAlpha = 1;
  }

  // neon outline tube
  ctx.lineWidth = 0.24 * size;
  ctx.strokeStyle = th.accent;
  ctx.shadowColor = th.accent;
  ctx.shadowBlur = size * (0.45 * breathe + flash * 0.8) * th.glow;
  ctx.globalAlpha = flicker;
  ctx.strokeText(WORD, 0, base);
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  // dark gap, then a purple extrusion for depth
  ctx.lineWidth = 0.12 * size;
  ctx.strokeStyle = '#120530';
  ctx.strokeText(WORD, 0, base);
  ctx.fillStyle = '#3a0f62';
  ctx.strokeText(WORD, 0.05 * size, base + 0.07 * size);
  ctx.fillText(WORD, 0.05 * size, base + 0.07 * size);

  // chrome: sky, hard horizon, hot magenta reflection
  ctx.fillStyle = cachedGrad(ctx, `l-chrome|${size}`, () =>
    linear(ctx, 0, -size / 2, 0, size / 2, [
      [0, '#ffffff'],
      [0.2, '#c4ecff'],
      [0.47, '#6f7fe0'],
      [0.5, '#170834'],
      [0.56, '#4a1670'],
      [0.8, '#ff40b0'],
      [1, '#ffd6f2'],
    ]),
  );
  ctx.fillText(WORD, 0, base);
  ctx.lineWidth = Math.max(1, 0.025 * size);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.strokeText(WORD, 0, base);

  // specular sweep across the chrome every few seconds
  const s = (t - 1.1) % 3.4;
  if (t > 1.1 && s < 1) {
    const sx = -half - size + s * (2 * half + 2 * size);
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(sx, 0);
    ctx.fillStyle = cachedGrad(ctx, `l-sweep|${size}`, () =>
      linear(ctx, -0.6 * size, 0, 0.6 * size, 0, [
        [0, 'rgba(255,255,255,0)'],
        [0.5, 'rgba(255,255,255,0.85)'],
        [1, 'rgba(255,255,255,0)'],
      ]),
    );
    ctx.fillText(WORD, -sx, base);
    ctx.translate(-sx, 0);
    ctx.globalCompositeOperation = 'source-over';
  }
  if (flash > 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = flash * 0.7;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(WORD, 0, base);
  }
  ctx.restore();

  // katakana sign + speed lines, ignites after the slam
  const ka = clamp01((t - 0.75) / 0.35);
  if (ka > 0) {
    const ks = 0.4 * size;
    const ky = base + 0.62 * size;
    const step = ks * 1.25;
    const kx = half - 3 * step - ks / 2;
    const ignite = ka < 1 ? (hash(Math.floor(t * 30)) > 0.4 ? 1 : 0.2) : flicker;
    ctx.globalAlpha = ka * ignite;
    ctx.transform(1, 0, -0.22, 1, 0, 0);
    ctx.font = `400 ${ks}px ${DISPLAY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.shadowColor = th.accent2;
    ctx.shadowBlur = ks * 0.6 * th.glow;
    ctx.lineWidth = Math.max(1.5, 0.07 * ks);
    ctx.strokeStyle = th.accent2;
    for (let i = 0; i < 4; i++) ctx.strokeText(KANA[i], kx + i * step + ky * 0.22, ky);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(230,255,255,0.9)';
    for (let i = 0; i < 4; i++) ctx.fillText(KANA[i], kx + i * step + ky * 0.22, ky);
    // speed lines run out of the kana toward the left edge of the wordmark
    ctx.fillStyle = th.accent;
    const lx = kx + ky * 0.22 - ks;
    for (let i = 0; i < 3; i++) {
      const len = (2 * half - 3 * step - ks) * (1 - i * 0.28) * ka;
      ctx.fillRect(lx - len, ky - ks * 0.22 + i * ks * 0.22, len, Math.max(1, 0.05 * ks));
    }
  }
  ctx.restore();
}

// ---------- vhs: magazine masthead taped off late-night TV ----------

function mast(
  ctx: CanvasRenderingContext2D,
  size: number,
  split: number,
  th: Theme,
  sx: number,
): void {
  const base = size / 2;
  ctx.save();
  ctx.transform(1, 0, -0.16, 1, 0, 0);
  ctx.scale(sx, 1);
  // block extrusion, printed in one solid ink
  ctx.fillStyle = '#1a0c06';
  for (let i = 6; i >= 1; i--) ctx.fillText(WORD, i * 0.022 * size, base + i * 0.022 * size);
  // cream keyline
  ctx.lineWidth = 0.13 * size;
  ctx.strokeStyle = th.text;
  ctx.strokeText(WORD, 0, base);
  // RGB split fringes
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = 'rgba(255,30,40,0.9)';
  ctx.fillText(WORD, -split, base);
  ctx.fillStyle = 'rgba(30,200,255,0.9)';
  ctx.fillText(WORD, split, base);
  ctx.globalCompositeOperation = 'source-over';
  // sunset ink with two stripe cuts through the lower half
  ctx.fillStyle = cachedGrad(ctx, `l-mast|${size}`, () =>
    linear(ctx, 0, -size / 2, 0, size / 2, [
      [0, '#ffe594'],
      [0.48, '#f4b23a'],
      [0.5, '#ea7a2c'],
      [0.62, '#e2602a'],
      [0.62, '#1a0c06'],
      [0.67, '#1a0c06'],
      [0.67, '#d8452e'],
      [0.8, '#d8452e'],
      [0.8, '#1a0c06'],
      [0.83, '#1a0c06'],
      [0.83, '#b8302a'],
      [1, '#a42626'],
    ]),
  );
  ctx.fillText(WORD, 0, base);
  ctx.restore();
}

function vhsLogo(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  t: number,
  th: Theme,
): void {
  const half = (WIDTH * size) / 2;
  const intro = clamp01(t / 1.2);
  const lock = (1 - intro) ** 2; // 1 = tape still locking, 0 = stable
  const tick = Math.floor(t * 12);
  const glitch = t > 1.2 && (t - 1.2) % 3.7 < 0.22;
  const split = size * (0.03 + hash(tick) * 0.025 + lock * 0.35 + (glitch ? 0.08 : 0));
  // vertical roll while the tape locks: the image slips up a few times then catches
  const roll = lock * Math.sin(intro * 14) * size * 1.4;
  const fpx = size * 1.32;

  ctx.save();
  ctx.translate(cx + (hash(tick + 7) - 0.5) * 0.02 * size, cy + roll);
  ctx.globalAlpha = intro < 1 ? (hash(tick * 3) > 0.25 ? 1 : 0.35) : 1;
  ctx.font = `400 ${fpx}px ${MASTHEAD}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'miter';
  const sx = fit(ctx, size, 0.7, 1.25);

  if (glitch) {
    // tracking tear: horizontal slices slide apart
    const n = 6;
    const top = -size * 0.7;
    const sh = (size * 1.5) / n;
    for (let i = 0; i < n; i++) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(-half * 1.6, top + i * sh, half * 3.2, sh + 1);
      ctx.clip();
      ctx.translate((hash(tick * 5 + i) - 0.5) * 0.5 * size, 0);
      mast(ctx, size, split, th, sx);
      ctx.restore();
    }
  } else {
    mast(ctx, size, split, th, sx);
  }

  // masthead furniture: rule with issue line above
  const ry = -size * 0.98;
  const fs = 0.2 * size;
  ctx.fillStyle = th.text;
  ctx.fillRect(-half, ry + fs * 0.75, 2 * half, Math.max(1, 0.03 * size));
  ctx.font = th.font(800, fs, true);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText('STREET DRIFT MONTHLY', -half, ry + fs * 0.5);
  ctx.textAlign = 'right';
  ctx.fillText('VOL. 6   ¥580', half, ry + fs * 0.5);

  // hanko-style katakana stamp, pressed slightly crooked onto the corner
  const bs = 0.26 * size;
  ctx.save();
  ctx.translate(half + bs * 1.1, -size * 0.1);
  ctx.rotate(0.07);
  ctx.fillStyle = th.accent2;
  ctx.fillRect(-bs * 0.8, -bs * 2.65, bs * 1.6, bs * 5.3);
  ctx.strokeStyle = th.text;
  ctx.lineWidth = Math.max(1, 0.06 * bs);
  ctx.strokeRect(-bs * 0.62, -bs * 2.47, bs * 1.24, bs * 4.94);
  ctx.fillStyle = th.text;
  ctx.font = `400 ${bs}px ${DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 4; i++) ctx.fillText(KANA[i], 0, (i - 1.5) * bs * 1.15);
  ctx.restore();
  ctx.restore();
}

/** DRIFTA wordmark. size is about the cap height in px, t in seconds (intro plays over ~1.2 s). */
export function drawLogo(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  t: number,
  theme: Theme,
): void {
  if (theme.id === 'vhs') vhsLogo(ctx, cx, cy, size, t, theme);
  else arcadeLogo(ctx, cx, cy, size, t, theme);
}
