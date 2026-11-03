import { COMBO_GRACE } from './config';
import type { HudView, Popup } from './view';
import { drawMenu } from './ui/menu';
import { createTach } from './ui/tach';
import { THEMES, drawOverlayFx, type Theme } from './ui/theme';
import { hintLine, type Action } from './ui/prompts';

// Night garage under sodium lamps: amber light, signal red, start-light green on blue-black ink.
const DISPLAY = 'Impact, Haettenschweiler, "Arial Black", sans-serif';
const LABEL = '"Segoe UI", system-ui, sans-serif';
const SKEW = -0.22; // racing slant for display type and plates
const WHITE = '#f4f5ff';
const AMBER = '#ffb21a';
const RED = '#ff2b3a';
const GREEN = '#2bf58c';
const STEEL = '#a3abc8';
const INK = 'rgba(7,9,20,0.78)';
const OUTLINE = 'rgba(4,5,12,0.9)';

export function formatTime(seconds: number): string {
  const cs = Math.floor(Math.max(0, seconds) * 100 + 1e-6);
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

export function formatScore(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function comboString(tricks: string[]): string {
  const groups: string[] = [];
  for (let i = 0; i < tricks.length;) {
    let j = i;
    while (j < tricks.length && tricks[j] === tricks[i]) j++;
    groups.push(j - i > 1 ? `${tricks[i]} ×${j - i}` : tricks[i]);
    i = j;
  }
  if (groups.length > 6) return '… + ' + groups.slice(-6).join(' + ');
  return groups.join(' + ');
}

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 0→1 with a ~10% overshoot past 1 before settling. */
export function easeOutBack(t: number): number {
  const x = clamp01(t) - 1;
  return 1 + 2.70158 * x * x * x + 1.70158 * x * x;
}

/** 0→1 with a decaying spring wobble around 1. */
export function easeOutElastic(t: number): number {
  const x = clamp01(t);
  if (x === 0 || x === 1) return x;
  return 2 ** (-10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
}

export const easeOutCubic = (t: number) => 1 - (1 - clamp01(t)) ** 3;
export const easeInCubic = (t: number) => clamp01(t) ** 3;

/** Frame-rate independent exponential approach; snaps when within half a unit. */
export function approach(cur: number, target: number, dt: number, rate: number): number {
  const next = target + (cur - target) * Math.exp(-rate * dt);
  return Math.abs(next - target) < 0.5 ? target : next;
}

/** Multiplier heat: white → yellow → orange → red. */
export function multColor(m: number): string {
  if (m >= 8) return RED;
  if (m >= 5) return '#ff7a1a';
  if (m >= 3) return '#ffd23f';
  return WHITE;
}

interface TextOpts {
  align?: CanvasTextAlign;
  /** 'display' = slanted Impact numerals/headlines, 'label' = small italic Segoe UI */
  font?: 'display' | 'label';
  stroke?: string | null;
  alpha?: number;
  scale?: number;
  rot?: number;
  glow?: string;
  /** full CSS font (themed overlays); skips the racing slant */
  css?: string;
}

function setFont(ctx: CanvasRenderingContext2D, size: number, font: TextOpts['font']): void {
  ctx.font = font === 'label' ? `italic 800 ${size}px ${LABEL}` : `${size}px ${DISPLAY}`;
}

function measure(ctx: CanvasRenderingContext2D, s: string, size: number, font?: TextOpts['font']) {
  ctx.save();
  setFont(ctx, size, font);
  const w = ctx.measureText(s).width;
  ctx.restore();
  return w;
}

function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  o: TextOpts = {},
): void {
  ctx.save();
  ctx.globalAlpha = clamp01(o.alpha ?? 1);
  ctx.translate(x, y);
  if (o.rot) ctx.rotate(o.rot);
  if (o.scale !== undefined) ctx.scale(o.scale, o.scale);
  if (o.font !== 'label' && !o.css) ctx.transform(1, 0, SKEW, 1, 0, 0);
  setFont(ctx, size, o.font);
  if (o.css) ctx.font = o.css;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  if (o.stroke !== null) {
    ctx.lineWidth = Math.max(2, size * 0.14);
    ctx.strokeStyle = o.stroke ?? OUTLINE;
    ctx.strokeText(s, 0, 0);
  }
  if (o.glow) {
    ctx.shadowColor = o.glow;
    ctx.shadowBlur = size * 0.6;
  }
  ctx.fillStyle = fill;
  ctx.fillText(s, 0, 0);
  ctx.restore();
}

/** Parallelogram backing plate leaning with the type, optional accent stripe on the left edge. */
function plate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  accent?: string,
  accentW = h * 0.12,
): void {
  const s = -SKEW * h;
  ctx.save();
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x + s, y);
  ctx.lineTo(x + w + s, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fill();
  if (accent) {
    const a = accentW;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(x + s, y);
    ctx.lineTo(x + s + a, y);
    ctx.lineTo(x + a, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function overlay(ctx: CanvasRenderingContext2D, w: number, h: number, a: number): void {
  ctx.fillStyle = `rgba(4,5,12,${a})`;
  ctx.fillRect(0, 0, w, h);
}

/** Radial streaks bursting out from (x, y); t 0..1 drives travel and fade. */
function streaks(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r0: number,
  r1: number,
  t: number,
  n: number,
  color: string,
  width: number,
): void {
  if (t >= 1) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.globalAlpha = 1 - t;
  ctx.lineWidth = width * (1 - t * 0.7);
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (i % 2) * 0.15;
    const len = i % 3 === 0 ? 1 : 0.6;
    const ra = lerp(r0, r1, easeOutCubic(t));
    const rb = ra + (r1 - r0) * 0.25 * len * (1 - t);
    ctx.moveTo(x + Math.cos(a) * ra, y + Math.sin(a) * ra * 0.8);
    ctx.lineTo(x + Math.cos(a) * rb, y + Math.sin(a) * rb * 0.8);
  }
  ctx.stroke();
  ctx.restore();
}

function ring(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha: number,
  width: number,
): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Start-light gantry hanging from the garage ceiling: three lamps, `lit` of them red, or all green. */
function gantry(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  u: number,
  lit: number,
  green: boolean,
  litAge: number,
  alpha: number,
): void {
  const w = 40 * u;
  const h = 13 * u;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#1a1d2a';
  for (const dx of [-13 * u, 13 * u]) ctx.fillRect(cx + dx - 0.6 * u, 0, 1.2 * u, y);
  ctx.fillStyle = '#0b0d16';
  ctx.strokeStyle = '#2c3146';
  ctx.lineWidth = 0.5 * u;
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, y - h / 2, w, h, 2.5 * u);
  ctx.fill();
  ctx.stroke();
  for (let i = 0; i < 3; i++) {
    const lx = cx + (i - 1) * 12.5 * u;
    const r = 4.6 * u;
    const on = green || i < lit;
    const col = green ? GREEN : RED;
    ctx.fillStyle = '#05060b';
    ctx.beginPath();
    ctx.arc(lx, y, r + 0.7 * u, 0, Math.PI * 2);
    ctx.fill();
    if (on) {
      // newest lamp flares white-hot for a beat
      const flare = !green && i === lit - 1 ? Math.max(0, 1 - litAge * 5) : 0;
      const g = ctx.createRadialGradient(lx - r * 0.3, y - r * 0.3, 0, lx, y, r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.35 - flare * 0.2, col);
      g.addColorStop(1, green ? '#067a3f' : '#7a0710');
      ctx.save();
      ctx.shadowColor = col;
      ctx.shadowBlur = (4 + flare * 8) * u;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(lx, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = '#2a0b10';
      ctx.beginPath();
      ctx.arc(lx, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// Animation state, keyed on HudView changes. Real time so it keeps moving at any frame rate.
const anim = {
  last: 0,
  tricks: 0,
  trickAt: -99,
  mult: 0,
  multAt: -99,
  combo: 0,
  score: 0,
  resultsAt: 0,
};

let tachInst: ReturnType<typeof createTach> | undefined; // lazy: tach.ts imports hud.ts (cycle)
let lastPhase = '';
let lastTime = 0;

export const pauseHint = (ui: HudView['ui']): string =>
  hintLine(
    [
      ['confirm', 'resume'],
      ['restart', 'restart'],
      ['back', 'menu'],
    ],
    ui.device,
    ui.padStyle,
  );

function tachPalette(th: Theme) {
  const vhs = th.id === 'vhs';
  return {
    accent: vhs ? '#e2483a' : '#ff2f6a',
    accent2: vhs ? '#e0a82e' : '#2ef2c8',
    text: th.text,
    dim: th.dim,
    glow: th.glow,
  };
}

const BANK_FLY = 0.55; // s for banked points to reach the total

function drawCountdown(ctx: CanvasRenderingContext2D, v: HudView, cx: number, u: number): void {
  const n = Math.max(1, Math.ceil(v.countdown - 1e-6));
  const el = clamp01(n - v.countdown); // 0..1 within this second
  const y = 32 * u;
  gantry(ctx, cx, 12 * u, u, 4 - n, false, el, 1);

  ring(ctx, cx, y, lerp(8, 34, easeOutCubic(el)) * u, RED, 0.7 * (1 - el / 0.6), 1.2 * u);
  streaks(ctx, cx, y, 10 * u, 34 * u, el / 0.35, 14, WHITE, 0.6 * u);

  const slam = el / 0.2;
  const scaleAt = (t: number) => lerp(2.6, 1, easeOutBack(t / 0.2));
  const k = slam < 1 ? scaleAt(el) : 1 + 0.04 * Math.exp(-(el - 0.2) * 8);
  const exit = clamp01((el - 0.85) / 0.15);
  const rot = -0.18 * (1 - easeOutCubic(slam));
  // zoom-blur ghosts trailing the slam
  if (slam < 1)
    for (let g = 3; g >= 1; g--)
      text(ctx, String(n), cx, y, 22 * u, RED, {
        align: 'center',
        scale: scaleAt(Math.max(0, el - g * 0.035)),
        rot,
        alpha: 0.22 / g,
        stroke: null,
      });
  text(ctx, String(n), cx, y, 22 * u, WHITE, {
    align: 'center',
    scale: k * (1 - exit * 0.2),
    rot,
    alpha: 1 - exit,
    glow: RED,
  });
}

function drawGo(ctx: CanvasRenderingContext2D, t: number, w: number, h: number, u: number) {
  const cx = w / 2;
  const y = 32 * u;
  if (t < 0.15) {
    ctx.save();
    ctx.globalAlpha = 0.28 * (1 - t / 0.15);
    ctx.fillStyle = GREEN;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  const out = clamp01((t - 0.45) / 0.35);
  gantry(ctx, cx, 12 * u - easeInCubic(t / 0.6) * 26 * u, u, 3, true, 1, 1 - t / 0.7);
  ring(ctx, cx, y, lerp(6, 60, easeOutCubic(t / 0.6)) * u, GREEN, 1 - t / 0.6, 1.6 * u);
  streaks(ctx, cx, y, 8 * u, 55 * u, t / 0.6, 22, GREEN, 0.8 * u);
  const k = t < 0.18 ? lerp(0.4, 1.15, easeOutBack(t / 0.18)) : 1.15 + (t - 0.18) * 0.4;
  text(ctx, 'GO!', cx, y, 20 * u, GREEN, {
    align: 'center',
    scale: k,
    alpha: 1 - out,
    glow: GREEN,
    stroke: '#032614',
  });
}

function drawPopup(
  ctx: CanvasRenderingContext2D,
  p: Popup,
  slot: number,
  cx: number,
  baseY: number,
  scoreX: number,
  scoreY: number,
  w: number,
  h: number,
  u: number,
): void {
  const a = p.age;
  if (p.kind === 'trick') {
    const rise = easeOutCubic(a / 1.2) * 4 * u;
    text(ctx, `+ ${p.text}`, cx, baseY - 9 * u - slot * 4 * u - rise, 3 * u, AMBER, {
      align: 'center',
      scale: lerp(0.5, 1, easeOutBack(a / 0.15)),
      alpha: 1 - clamp01((a - 0.8) / 0.6),
    });
    return;
  }
  if (p.kind === 'bank') {
    const y0 = baseY + 5 * u;
    // label + burst left behind at the combo spot
    ring(ctx, cx, y0, lerp(4, 22, easeOutCubic(a / 0.5)) * u, AMBER, 1 - a / 0.5, 0.8 * u);
    text(ctx, 'BANKED', cx, baseY - 5 * u - easeOutCubic(a) * 4 * u, 3.4 * u, AMBER, {
      align: 'center',
      font: 'label',
      alpha: 1 - clamp01((a - 0.5) / 0.5),
    });
    if (a > BANK_FLY) return;
    const t = easeInCubic((a - 0.12) / (BANK_FLY - 0.12));
    const pop = a < 0.12 ? lerp(0.6, 1.5, easeOutBack(a / 0.12)) : lerp(1.5, 0.55, t);
    const s = `+${formatScore(p.amount)}`;
    for (let g = 3; g >= 0; g--) {
      const tg = easeInCubic((a - 0.12 - g * 0.03) / (BANK_FLY - 0.12));
      const x = lerp(cx, scoreX, tg);
      const y = lerp(y0, scoreY, tg) - Math.sin(tg * Math.PI) * 10 * u;
      text(ctx, s, x, y, 6 * u, g ? AMBER : WHITE, {
        align: 'center',
        scale: pop,
        alpha: g ? 0.3 / g : 1,
        stroke: g ? null : undefined,
        glow: g ? undefined : AMBER,
      });
    }
    return;
  }
  // fail: red edge flash, BAILED slams in shaking, lost points crumble away
  if (a < 0.5) {
    ctx.save();
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, w * 0.7);
    g.addColorStop(0, 'rgba(255,43,58,0)');
    g.addColorStop(1, `rgba(255,43,58,${0.55 * (1 - a / 0.5)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  const amp = 1.8 * u * Math.exp(-a * 7);
  const fade = 1 - clamp01((a - 1.0) / 0.5);
  text(
    ctx,
    'BAILED',
    cx + amp * Math.sin(a * 95),
    baseY - 9 * u + amp * 0.5 * Math.cos(a * 77),
    9 * u,
    RED,
    {
      align: 'center',
      scale: a < 0.16 ? lerp(3, 1, easeOutBack(a / 0.16)) : 1,
      rot: 0.06 * Math.sin(a * 60) * Math.exp(-a * 6),
      alpha: fade * clamp01(a / 0.05),
      glow: RED,
    },
  );
  const s = `-${formatScore(p.amount)}`;
  const size = 4.2 * u;
  let x = cx - measure(ctx, s, size) / 2;
  const c0 = Math.max(0, a - 0.35);
  for (let i = 0; i < s.length; i++) {
    const cw = measure(ctx, s[i], size);
    const r = (Math.sin(i * 12.9898 + 4.1) * 43758.5453) % 1; // stable per-char jitter
    text(
      ctx,
      s[i],
      x + cw / 2 + r * 10 * u * c0,
      baseY - 0.5 * u + 3 * u * c0 + 45 * u * c0 * c0,
      size,
      '#ff8a92',
      {
        align: 'center',
        rot: r * 4 * c0,
        alpha: (1 - c0 / 0.9) * clamp01((a - 0.08) / 0.1),
      },
    );
    x += cw;
  }
}

export function drawHud(
  ctx: CanvasRenderingContext2D,
  v: HudView,
  width: number,
  height: number,
): void {
  if (drawMenu(ctx, v, width, height)) return;
  const u = Math.min(width, height) / 100; // 1 unit = 1% of short side
  const nowS = performance.now() / 1000;
  const dt = Math.min(0.1, Math.max(0, nowS - anim.last));
  anim.last = nowS;
  const cx = width / 2;
  const pad = 3 * u;
  const th = THEMES[v.ui.theme];

  if (v.phase === 'countdown') {
    anim.score = v.score;
    lastPhase = v.phase;
    drawCountdown(ctx, v, cx, u);
    return;
  }

  if (v.phase === 'run' || v.phase === 'paused') {
    // ---- top-left: timer
    plate(ctx, pad, pad, 27 * u, 11.5 * u, INK, v.par > 0 && v.time > v.par ? RED : AMBER);
    text(
      ctx,
      formatTime(v.time),
      pad + 6 * u,
      pad + 4.4 * u,
      6.2 * u,
      v.par > 0 && v.time > v.par ? RED : WHITE,
    );
    if (v.par > 0)
      text(ctx, `PAR ${formatTime(v.par)}`, pad + 4.5 * u, pad + 9 * u, 2.2 * u, STEEL, {
        font: 'label',
        stroke: null,
      });

    // ---- top-center: floor
    // hidden while the start gantry is still on screen
    if (!(v.phase === 'run' && v.time < 0.8)) {
      const fw = measure(ctx, v.floorName, 3 * u, 'label') + 6 * u;
      plate(ctx, cx - fw / 2 - 1 * u, pad, fw, 5.5 * u, INK);
      text(ctx, v.floorName, cx, pad + 2.75 * u, 3 * u, WHITE, {
        align: 'center',
        font: 'label',
        stroke: null,
      });
    }

    // ---- top-right: total score, ticks up once banked points land
    let pending = 0;
    let flash = 0;
    for (const p of v.popups)
      if (p.kind === 'bank') {
        if (p.age < BANK_FLY) pending += p.amount;
        else flash = Math.max(flash, 1 - (p.age - BANK_FLY) / 0.35);
      }
    const target = v.score - pending;
    anim.score = target < anim.score ? target : approach(anim.score, target, dt, 9);
    const sw = 30 * u;
    const sxR = width - pad - 2.5 * u;
    plate(
      ctx,
      width - pad - sw - 2.6 * u,
      pad,
      sw,
      11.5 * u,
      flash > 0 ? `rgba(255,178,26,${0.25 + 0.6 * flash})` : INK,
      AMBER,
    );
    text(ctx, formatScore(anim.score), sxR, pad + 4.4 * u, 6.2 * u, WHITE, {
      align: 'right',
      scale: 1 + 0.18 * Math.max(0, flash) ** 2,
      glow: flash > 0 ? AMBER : undefined,
    });
    if (v.par > 0)
      text(ctx, `BEST ${formatScore(v.best)}`, sxR - 1.5 * u, pad + 9 * u, 2.2 * u, STEEL, {
        align: 'right',
        font: 'label',
        stroke: null,
      });

    // ---- combo
    const baseY = height - 16 * u;
    const c = v.combo;
    // on a fail the old plate is hidden at once so BAILED and the lost amount read cleanly
    const failed = v.popups.some((p) => p.kind === 'fail');
    if (!c) {
      anim.tricks = 0;
      anim.mult = 0;
      anim.combo = 0;
    } else {
      if (c.tricks.length > anim.tricks) anim.trickAt = nowS;
      if (c.multiplier > anim.mult) anim.multAt = nowS;
      anim.tricks = c.tricks.length;
      anim.mult = c.multiplier;
      anim.combo = approach(anim.combo, v.comboValue, dt, 10);

      if (!failed) {
        const str = comboString(c.tricks);
        const tk = nowS - anim.trickAt;
        const mk = nowS - anim.multAt;
        const m = c.multiplier;
        const col = multColor(m);
        // shrink long chains to stay clear of the speedometer
        const maxW = Math.max(40 * u, Math.min(90 * u, width - 64 * u));
        const strSize = 3.6 * u * Math.min(1, maxW / measure(ctx, str, 3.6 * u, 'label'));
        const pw = Math.max(measure(ctx, str, strSize, 'label'), 30 * u) + 12 * u;
        plate(ctx, cx - pw / 2 - 2 * u, baseY - 4.5 * u, pw, 17.5 * u, INK, col);
        text(ctx, str, cx, baseY, strSize, AMBER, {
          align: 'center',
          font: 'label',
          scale: 1 + 0.3 * (1 - easeOutElastic(tk / 0.7)),
          stroke: OUTLINE,
        });

        const shake = 0.9 * u * Math.exp(-mk * 9);
        const multSize = 6.5 * u * (1 + Math.min(m - 1, 12) * 0.06);
        text(
          ctx,
          `×${m}`,
          cx - 2 * u + shake * Math.sin(mk * 90),
          baseY + 6.5 * u + shake * Math.cos(mk * 70),
          multSize,
          col,
          {
            align: 'right',
            scale: 1 + 0.6 * Math.exp(-mk * 10),
            glow: m >= 3 ? col : undefined,
          },
        );
        text(ctx, formatScore(anim.combo), cx + 2 * u, baseY + 6.5 * u, 5.4 * u, WHITE, {});

        const bw = 28 * u;
        const bh = 1.1 * u;
        const g = clamp01(c.grace / COMBO_GRACE);
        const low = g < 0.35 ? 0.5 + 0.5 * Math.sin(nowS * 28) : 0;
        plate(ctx, cx - bw / 2 - u, baseY + 11 * u, bw, bh, 'rgba(0,0,0,0.6)');
        plate(ctx, cx - bw / 2 - u, baseY + 11 * u, bw * g, bh, low > 0.5 ? RED : col);
        if (low) {
          ctx.save();
          ctx.globalAlpha = low * 0.6;
          plate(
            ctx,
            cx - bw / 2 - 1.6 * u,
            baseY + 10.4 * u,
            bw + 1.2 * u,
            bh + 1.2 * u,
            'rgba(255,43,58,0.35)',
          );
          ctx.restore();
        }
      }
    }

    // popups are appended oldest-first; keep the 3 newest tricks, newest lowest
    const live = v.popups
      .filter((p) => p.kind !== 'trick')
      .concat(failed ? [] : v.popups.filter((p) => p.kind === 'trick').slice(-3));
    const tricks = live.filter((p) => p.kind === 'trick');
    live.forEach((p) =>
      drawPopup(
        ctx,
        p,
        tricks.length - 1 - tricks.indexOf(p),
        cx,
        baseY,
        sxR - 8 * u,
        pad + 4.4 * u,
        width,
        height,
        u,
      ),
    );

    // ---- tach; reset on run start/restart (phase enters run, or the run clock jumps back)
    if ((v.phase === 'run' && lastPhase !== 'run' && lastPhase !== 'paused') || v.time < lastTime)
      (tachInst ??= createTach()).reset();
    const tach = (tachInst ??= createTach());
    const tr = 9 * u;
    tach.draw(
      ctx,
      width - pad - 1.25 * tr,
      height - pad - 1.2 * tr,
      tr,
      { rpm: v.rpm, redline: v.redline, gear: v.gear, speedKmh: v.speedKmh },
      tachPalette(th),
      dt,
    );
    lastPhase = v.phase;
    lastTime = v.time;

    if (v.phase === 'run' && v.time < 0.8) drawGo(ctx, v.time, width, height, u);
    if (v.phase === 'paused') {
      overlay(ctx, width, height, 0.6);
      text(ctx, 'PAUSED', cx, height * 0.45, 13 * u, th.text, {
        align: 'center',
        css: th.font(800, 13 * u, true),
        glow: th.glow ? th.accent : undefined,
      });
      text(ctx, pauseHint(v.ui), cx, height * 0.55, 3 * u, th.dim, {
        align: 'center',
        css: th.font(600, 3 * u),
        stroke: null,
      });
      drawOverlayFx(ctx, width, height, nowS, th, { osd: false });
    }
    return;
  }

  if (lastPhase !== 'results') anim.resultsAt = nowS;
  lastPhase = v.phase;
  const r = v.results;
  if (!r) return;
  drawResults(ctx, v, r, width, height, u, th, nowS);
  drawOverlayFx(ctx, width, height, nowS, th, { osd: false });
}

// ---------- results ----------

const ORD = ['', '1ST', '2ND', '3RD'];
const POS_COL = ['', '#ffd23f', '#dfe6ff', '#ff9a4a'];
/** time limit factor per position, mirrors progress.positionFor */
const POS_TIME = [0, 1, 1.15, 1.3];

/** "NEXT: 2ND needs 10,000 pts & under 1:23"; '' at 1st or on maps without positions. */
export function nextTarget(
  position: 1 | 2 | 3 | null,
  medals: readonly number[] | undefined,
  par: number,
): string {
  if (!medals || position === 1) return '';
  const n = position ? position - 1 : 3;
  const t = Math.floor(par * POS_TIME[n] + 1e-6); // 100 * 1.15 is 114.999…
  const mss = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  return `NEXT: ${ORD[n]} needs ${formatScore(medals[3 - n])} pts & under ${mss}`;
}

export const positionLabel = (p: 1 | 2 | 3 | null): string => (p ? ORD[p] : 'NO PLACE');
export const paintName = (id: string): string => id.replace(/-/g, ' ').toUpperCase();

export function resultsHint(ui: HudView['ui'], r: NonNullable<HudView['results']>): string {
  if (r.chooser)
    return hintLine(
      [
        ['pick', 'car'],
        ['confirm', 'choose'],
        ['back', 'later'],
      ],
      ui.device,
      ui.padStyle,
    );
  const items: [Action, string][] = [];
  if (r.drifts.length > 1) items.push(['pick', 'pick']);
  const d = r.drifts[r.driftRow];
  if (d?.clip && !d.saved) items.push(['save', 'save clip']);
  items.push(['confirm', r.carPick ? 'choose car' : 'retry'], ['back', 'menu']);
  return hintLine(items, ui.device, ui.padStyle);
}

function cssWidth(ctx: CanvasRenderingContext2D, s: string, font: string): number {
  ctx.save();
  ctx.font = font;
  const w = ctx.measureText(s).width;
  ctx.restore();
  return w;
}

/** Font px that fits s into maxW, at most px. */
function fitPx(
  ctx: CanvasRenderingContext2D,
  s: string,
  font: (px: number) => string,
  px: number,
  maxW: number,
): number {
  const w = cssWidth(ctx, s, font(px));
  return w > maxW ? (px * maxW) / w : px;
}

/** s cut with an ellipsis to fit maxW in font. */
function ellipsize(ctx: CanvasRenderingContext2D, s: string, font: string, maxW: number): string {
  if (cssWidth(ctx, s, font) <= maxW) return s;
  let t = s;
  while (t.length > 1 && cssWidth(ctx, t + '…', font) > maxW) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}

/** Rounded box, filled and optionally stroked (glowing when glow is set). */
function box(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rad: number,
  fill: string,
  stroke?: string,
  lw = 1,
  glow?: string,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, rad);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    if (glow) {
      ctx.shadowColor = glow;
      ctx.shadowBlur = lw * 4;
    }
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
  ctx.restore();
}

/** Full-width hint band along the bottom edge, like the menus. */
function hintBar(
  ctx: CanvasRenderingContext2D,
  s: string,
  w: number,
  h: number,
  u: number,
  th: Theme,
): void {
  const bandH = 5.4 * u;
  ctx.fillStyle = th.panel;
  ctx.fillRect(0, h - bandH, w, bandH);
  ctx.fillStyle = th.id === 'vhs' ? 'rgba(245,231,204,0.45)' : 'rgba(46,242,255,0.4)';
  ctx.fillRect(0, h - bandH, w, Math.max(1, 0.2 * u));
  const px = fitPx(ctx, s, (p) => th.font(600, p), 2.4 * u, w - 4 * u);
  text(ctx, s, w / 2, h - 2.7 * u, px, th.text, {
    align: 'center',
    css: th.font(600, px),
    stroke: null,
  });
}

function drawResults(
  ctx: CanvasRenderingContext2D,
  v: HudView,
  r: NonNullable<HudView['results']>,
  width: number,
  height: number,
  u: number,
  th: Theme,
  now: number,
): void {
  const age = now - anim.resultsAt;
  const glow = th.glow ? th.accent : undefined;
  const pulse = 0.5 + 0.5 * Math.sin(now * 4.2);
  overlay(ctx, width, height, 0.82);
  const cx = width / 2;
  const cw = Math.min(width - 6 * u, 150 * u);
  const x0 = cx - cw / 2;

  // ---- headline: FINISHED, big total
  text(ctx, 'FINISHED', cx, 6 * u, 3.2 * u, th.dim, {
    align: 'center',
    css: th.font(700, 3.2 * u, true),
    stroke: null,
  });
  const total = formatScore(r.total);
  const totalPx = fitPx(ctx, total, (p) => th.font(800, p, true), 12 * u, cw);
  text(ctx, total, cx, 16 * u, totalPx, th.text, {
    align: 'center',
    css: th.font(800, totalPx, true),
    scale: lerp(1.25, 1, easeOutBack(age / 0.4)),
    glow,
  });

  // ---- position badge + NEW BEST + next target
  const by = 27 * u;
  const bh = 6 * u;
  const flash = r.newBest && Math.floor(now * 3) % 2 === 0;
  const nbFont = th.font(800, 3.4 * u, true);
  if (r.medals) {
    const label = positionLabel(r.position);
    const col = r.position ? POS_COL[r.position] : th.dim;
    const font = th.font(800, 4.2 * u, true);
    const bw = cssWidth(ctx, label, font) + 7 * u;
    const nbW = r.newBest ? cssWidth(ctx, 'NEW BEST!', nbFont) + 3 * u : 0;
    const bx = cx - (bw + nbW) / 2;
    plate(ctx, bx, by - bh / 2, bw, bh, th.panel, col, 1 * u);
    text(ctx, label, bx + 1.5 * u + (bw - 1 * u) / 2, by, 4.2 * u, col, {
      align: 'center',
      css: font,
      stroke: null,
      glow: th.glow && r.position ? col : undefined,
      scale: lerp(1.6, 1, easeOutBack((age - 0.25) / 0.35)),
      alpha: clamp01((age - 0.25) / 0.1),
    });
    if (flash)
      text(ctx, 'NEW BEST!', bx + bw + 3 * u, by, 3.4 * u, GREEN, { css: nbFont, glow: GREEN });
    const next = nextTarget(r.position, r.medals, v.par);
    if (next) {
      const px = fitPx(ctx, next, (p) => th.font(600, p), 2.4 * u, cw);
      text(ctx, next, cx, 33 * u, px, th.dim, {
        align: 'center',
        css: th.font(600, px),
        stroke: null,
      });
    }
  } else if (flash)
    text(ctx, 'NEW BEST!', cx, by, 3.4 * u, GREEN, { align: 'center', css: nbFont, glow: GREEN });

  // ---- stat chips
  const chips: [string, string][] = [
    ['COMBO', formatScore(r.comboPoints)],
    ['TIME', formatTime(r.time)],
    ['TIME BONUS', `+${formatScore(r.timeBonus)}`],
    ['BEST', formatScore(r.best)],
  ];
  const gap = 2 * u;
  const hair = Math.max(1, 0.15 * u);
  const chipW = (cw - gap * (chips.length - 1)) / chips.length;
  chips.forEach(([k, val], i) => {
    const x = x0 + i * (chipW + gap);
    box(ctx, x, 37 * u, chipW, 7 * u, 1 * u, th.panel, 'rgba(255,255,255,0.12)', hair);
    const kp = fitPx(ctx, k, (p) => th.font(700, p), 1.7 * u, chipW - 2 * u);
    text(ctx, k, x + chipW / 2, 39.1 * u, kp, th.dim, {
      align: 'center',
      css: th.font(700, kp),
      stroke: null,
    });
    const px = fitPx(ctx, val, (p) => th.font(700, p), 3 * u, chipW - 2 * u);
    text(ctx, val, x + chipW / 2, 41.9 * u, px, th.text, {
      align: 'center',
      css: th.font(700, px),
      stroke: null,
    });
  });

  // ---- TOP DRIFTS label, unlock toasts on the right
  const ly = 48.5 * u;
  const labelFont = th.font(800, 2.4 * u, true);
  text(ctx, 'TOP DRIFTS', x0, ly, 2.4 * u, th.accent2, { css: labelFont, stroke: null });
  const toasts = r.newPaints.map((id) => `NEW PAINT · ${paintName(id)}`);
  if (r.carPick) toasts.push('CAR PICK EARNED');
  if (toasts.length) {
    const room = cw - cssWidth(ctx, 'TOP DRIFTS', labelFont) - 3 * u;
    const tPad = 1.4 * u;
    const need = toasts.reduce(
      (a, t) => a + cssWidth(ctx, t, th.font(700, 1.9 * u)) + 2 * tPad + gap,
      0,
    );
    const k = Math.min(1, room / need);
    const px = 1.9 * u * k;
    let x = x0 + cw;
    toasts.forEach((t, i) => {
      const tw = cssWidth(ctx, t, th.font(700, px)) + 2 * tPad * k;
      x -= tw;
      const t0 = age - 0.6 - i * 0.12;
      ctx.save();
      ctx.globalAlpha = clamp01(t0 / 0.1);
      const tg = th.glow ? GREEN : undefined;
      box(ctx, x, ly - 1.8 * u, tw, 3.6 * u, 1.8 * u, 'rgba(43,245,140,0.16)', GREEN, hair, tg);
      ctx.restore();
      text(ctx, t, x + tw / 2, ly, px, GREEN, {
        align: 'center',
        css: th.font(700, px),
        stroke: null,
        scale: easeOutBack(t0 / 0.3),
        alpha: clamp01(t0 / 0.1),
      });
      x -= gap * k;
    });
  }

  // ---- snapshot cards
  const top = 51.5 * u;
  const textH = 8.5 * u;
  const cGap = 2.5 * u;
  const cardW = (cw - 2 * cGap) / 3;
  const imgH = Math.min((cardW * 9) / 16, height - 7 * u - top - textH);
  const n = r.drifts.length;
  if (!n)
    text(ctx, 'NO DRIFTS BANKED', cx, top + imgH / 2, 2.6 * u, th.dim, {
      align: 'center',
      css: th.font(600, 2.6 * u, true),
      stroke: null,
    });
  const sx = cx - (n * cardW + (n - 1) * cGap) / 2;
  r.drifts.forEach((d, i) => {
    const sel = i === r.driftRow;
    const x = sx + i * (cardW + cGap);
    const y = top - (sel ? 0.6 * u : 0);
    box(
      ctx,
      x,
      y,
      cardW,
      imgH + textH,
      1.2 * u,
      th.panel,
      sel ? th.accent : 'rgba(255,255,255,0.12)',
      sel ? 0.45 * u : hair,
      sel && th.glow ? th.accent : undefined,
    );
    // image area, clipped to rounded corners
    const ix = x + 0.6 * u;
    const iy = y + 0.6 * u;
    const iw = cardW - 1.2 * u;
    const ih = imgH - 0.6 * u;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(ix, iy, iw, ih, 0.8 * u);
    ctx.clip();
    ctx.fillStyle = '#05060d';
    ctx.fillRect(ix, iy, iw, ih);
    const st = d.still;
    if (st && st.width && st.height) {
      const k = Math.max(iw / st.width, ih / st.height); // cover
      ctx.drawImage(
        st,
        ix + (iw - st.width * k) / 2,
        iy + (ih - st.height * k) / 2,
        st.width * k,
        st.height * k,
      );
    } else {
      // placeholder: faint diagonal stripes
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1.2 * u;
      ctx.beginPath();
      for (let k = -ih; k < iw; k += 3.5 * u) {
        ctx.moveTo(ix + k, iy + ih);
        ctx.lineTo(ix + k + ih, iy);
      }
      ctx.stroke();
      text(ctx, 'NO SNAPSHOT', ix + iw / 2, iy + ih / 2, 1.8 * u, th.dim, {
        align: 'center',
        css: th.font(600, 1.8 * u),
        stroke: null,
      });
    }
    if (!sel) {
      ctx.fillStyle = 'rgba(4,5,12,0.35)';
      ctx.fillRect(ix, iy, iw, ih);
    }
    ctx.restore();
    // rank tag, saved tag
    plate(ctx, ix, iy + 0.8 * u, 6 * u, 3.6 * u, sel ? th.accent : 'rgba(4,5,12,0.8)');
    text(ctx, `#${i + 1}`, ix + 3.4 * u, iy + 2.6 * u, 2.4 * u, sel ? '#ffffff' : th.text, {
      align: 'center',
      css: th.font(800, 2.4 * u, true),
      stroke: null,
    });
    if (d.saved) {
      const tf = th.font(700, 1.8 * u);
      const sw = cssWidth(ctx, 'SAVED', tf) + 2.4 * u;
      const tx = ix + iw - sw - 0.8 * u;
      box(ctx, tx, iy + 0.8 * u, sw, 3.2 * u, 1.6 * u, 'rgba(4,5,12,0.8)', GREEN, hair);
      text(ctx, 'SAVED', tx + sw / 2, iy + 2.4 * u, 1.8 * u, GREEN, {
        align: 'center',
        css: tf,
        stroke: null,
      });
    }
    // score + combo name
    const ty = y + imgH;
    const score = formatScore(d.amount);
    const sPx = fitPx(ctx, score, (p) => th.font(800, p, true), 3.8 * u, cardW - 3 * u);
    text(ctx, score, x + 1.5 * u, ty + 3.2 * u, sPx, sel ? th.accent : th.text, {
      css: th.font(800, sPx, true),
      stroke: null,
      glow: sel && th.glow ? th.accent : undefined,
      alpha: sel ? 0.85 + 0.15 * pulse : 1,
    });
    const cFont = th.font(600, 1.9 * u);
    const combo = ellipsize(ctx, comboString(d.tricks), cFont, cardW - 3 * u);
    text(ctx, combo, x + 1.5 * u, ty + 6.6 * u, 1.9 * u, th.dim, { css: cFont, stroke: null });
  });

  if (r.chooser) drawChooser(ctx, r.chooser, width, height, u, th, pulse);
  hintBar(ctx, resultsHint(v.ui, r), width, height, u, th);
}

/** Car pick overlay: one locked car at a time, LATER as the last stop. */
function drawChooser(
  ctx: CanvasRenderingContext2D,
  c: NonNullable<NonNullable<HudView['results']>['chooser']>,
  width: number,
  height: number,
  u: number,
  th: Theme,
  pulse: number,
): void {
  overlay(ctx, width, height, 0.78);
  const cx = width / 2;
  const cy = height / 2;
  const later = c.row >= c.cars.length;
  text(ctx, 'CAR PICK', cx, cy - 16 * u, 7 * u, th.accent, {
    align: 'center',
    css: th.font(800, 7 * u, true),
    glow: th.glow ? th.accent : undefined,
  });
  text(ctx, 'unlock one car', cx, cy - 9.5 * u, 2.4 * u, th.dim, {
    align: 'center',
    css: th.font(600, 2.4 * u),
    stroke: null,
  });
  const pw = Math.min(70 * u, width - 8 * u);
  const ph = 13 * u;
  const g = th.glow ? th.accent : undefined;
  box(ctx, cx - pw / 2, cy - ph / 2, pw, ph, 1.4 * u, th.panel, th.accent, 0.45 * u, g);
  const name = later ? 'LATER' : c.cars[c.row].name.toUpperCase();
  const px = fitPx(ctx, name, (p) => th.font(800, p, true), 5.5 * u, pw - 14 * u);
  text(ctx, name, cx, cy - (later ? 1.2 : 0) * u, px, later ? th.dim : th.text, {
    align: 'center',
    css: th.font(800, px, true),
    stroke: null,
  });
  if (later)
    text(ctx, 'keep the pick for the garage', cx, cy + 3.6 * u, 1.9 * u, th.dim, {
      align: 'center',
      css: th.font(600, 1.9 * u),
      stroke: null,
    });
  // decorative arrows, not key text: the hint bar names the input
  for (const s of [-1, 1])
    text(
      ctx,
      s < 0 ? '◀' : '▶',
      cx + s * (pw / 2 - 3.5 * u + pulse * 0.6 * u),
      cy,
      3 * u,
      th.accent2,
      {
        align: 'center',
        css: th.font(700, 3 * u),
        stroke: null,
      },
    );
  // one dot per option
  const nOpt = c.cars.length + 1;
  const dg = Math.min(3 * u, (pw - 4 * u) / nOpt);
  ctx.save();
  for (let i = 0; i < nOpt; i++) {
    ctx.fillStyle = i === c.row ? th.accent : th.dim;
    ctx.globalAlpha = i === c.row ? 1 : 0.5;
    ctx.beginPath();
    const dx = cx + (i - (nOpt - 1) / 2) * dg;
    ctx.arc(dx, cy + ph / 2 + 3 * u, (i === c.row ? 0.7 : 0.45) * u, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
