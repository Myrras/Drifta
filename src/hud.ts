import { COMBO_GRACE } from './config';
import { itemById } from './cosmetics';
import type { HudView, MpHud, Popup } from './view';
import { drawMenu, carImage } from './ui/menu';
import { createTach } from './ui/tach';
import { THEMES, drawOverlayFx, linear, DISPLAY as DELA, MASTHEAD, type Theme } from './ui/theme';
import { glyph, hintLine, type Action } from './ui/prompts';
import {
  planTally,
  SLIDE,
  tallyAt,
  type TallyEvent,
  type TallyEventKind,
  type TallyInput,
  type TallyPlan,
} from './tally';

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

/** time-limit readout: seconds left, its colour, and the latest place cutoff already missed */
export function limitState(
  time: number,
  par: number,
  limit: number,
): { left: number; color: string; pulse: boolean; missed: string } {
  const left = Math.max(0, limit - time);
  const n = [1, 2].filter((p) => time > par * POS_TIME[p] + 1e-6).pop();
  return {
    left,
    color: left < 5 ? RED : left < 15 ? AMBER : WHITE,
    pulse: left < 5,
    missed: n ? `${ORD[n]} ✗` : '',
  };
}

export function formatScore(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function comboString(all: string[]): string {
  // NEAR MISS always follows a CLOSE CALL, so it would never group: count it once, after the last CLOSE CALL
  const tricks = all.filter((t) => t !== 'NEAR MISS');
  const nm = all.length - tricks.length;
  const groups: string[] = [];
  for (let i = 0; i < tricks.length;) {
    let j = i;
    while (j < tricks.length && tricks[j] === tricks[i]) j++;
    groups.push(j - i > 1 ? `${tricks[i]} ×${j - i}` : tricks[i]);
    i = j;
  }
  if (nm) {
    let at = groups.length;
    while (at > 0 && !groups[at - 1].startsWith('CLOSE CALL')) at--;
    groups.splice(at, 0, nm > 1 ? `NEAR MISS ×${nm}` : 'NEAR MISS');
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
  ctx.globalAlpha *= clamp01(o.alpha ?? 1); // multiplies, so callers can fade groups
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
  rival: 0,
};

let tachInst: ReturnType<typeof createTach> | undefined; // lazy: tach.ts imports hud.ts (cycle)
let lastPhase = '';
let lastTime = 0;

export const pauseHint = (ui: HudView['ui']): string =>
  hintLine(
    [
      ['confirm', 'resume'],
      ['photo', 'photo mode'],
      ['restart', 'restart'],
      ['back', 'menu'],
    ],
    ui.device,
    ui.padStyle,
  );
export const photoHint = (ui: HudView['ui']): string =>
  hintLine(
    [
      ['confirm', 'save'],
      ['back', 'back'],
      ['steer', 'move'],
      ['rotate', 'rotate'],
      ['zoom', 'zoom'],
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

export type Verdict = 'win' | 'lose' | 'draw';

/** Head-to-head outcome on displayed (rounded) totals; a rival DNF (null) loses. */
export function verdict(you: number, rival: number | null): Verdict {
  if (rival === null || Math.round(you) > Math.round(rival)) return 'win';
  return Math.round(you) < Math.round(rival) ? 'lose' : 'draw';
}

export const verdictText = (v: Verdict, rival: string): string =>
  v === 'win' ? 'YOU WIN' : v === 'lose' ? `${rival.toUpperCase()} WINS` : 'DRAW';

export const rivalTotalText = (total: number | null): string =>
  total === null ? 'DNF' : formatScore(total);

/** Rival name + live score under the score plate; `right` is the plate's bottom-right corner. */
function drawRivalPanel(
  ctx: CanvasRenderingContext2D,
  mp: MpHud,
  right: number,
  y: number,
  u: number,
): void {
  const w = 30 * u;
  const h = 8 * u;
  const done = mp.rivalTotal !== null;
  plate(ctx, right - w, y, w, h, INK, !mp.connected ? RED : done ? GREEN : STEEL);
  const tag = mp.connected && done ? 'FINISHED' : '';
  const tagW = tag ? measure(ctx, tag, 1.9 * u, 'label') + 2 * u : 0;
  const name = ellipsize(
    ctx,
    mp.rival.toUpperCase(),
    `italic 800 ${2.2 * u}px ${LABEL}`,
    w - 6 * u - tagW,
  );
  text(ctx, name, right - w + 4 * u, y + 2.4 * u, 2.2 * u, WHITE, {
    font: 'label',
    stroke: null,
    alpha: mp.connected ? 1 : 0.45,
  });
  if (tag)
    text(ctx, tag, right + 0.3 * u, y + 2.4 * u, 1.9 * u, GREEN, {
      align: 'right',
      font: 'label',
      stroke: null,
    });
  if (!mp.connected)
    text(ctx, 'DISCONNECTED', right - 0.6 * u, y + 5.6 * u, 2.4 * u, RED, {
      align: 'right',
      font: 'label',
      stroke: null,
    });
  else
    text(ctx, formatScore(anim.rival), right - 0.6 * u, y + 5.5 * u, 4.2 * u, WHITE, {
      align: 'right',
      glow: done ? GREEN : undefined,
    });
}

/** Short centred banner, e.g. a disconnect notice. */
function drawToast(ctx: CanvasRenderingContext2D, s: string, cx: number, y: number, u: number) {
  const px = 2.8 * u;
  const w = measure(ctx, s, px, 'label') + 8 * u;
  plate(ctx, cx - w / 2 - 1 * u, y - 2.5 * u, w, 5 * u, INK, RED);
  text(ctx, s, cx, y, px, WHITE, { align: 'center', font: 'label', stroke: null });
}

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
    ring(
      ctx,
      cx,
      y0,
      lerp(4, 22, easeOutCubic(a / 0.5)) * u,
      p.late ? STEEL : AMBER,
      1 - a / 0.5,
      0.8 * u,
    );
    text(
      ctx,
      p.late ? 'NOT COUNTED' : 'BANKED',
      cx,
      baseY - 5 * u - easeOutCubic(a) * 4 * u,
      3.4 * u,
      p.late ? STEEL : AMBER,
      {
        align: 'center',
        font: 'label',
        alpha: 1 - clamp01((a - 0.5) / 0.5),
      },
    );
    if (a > BANK_FLY || p.late) return; // late points never fly to the score
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
  const mp = v.mp;
  if (mp) {
    const t = mp.rivalTotal ?? mp.rivalScore;
    anim.rival = v.phase === 'countdown' || t < anim.rival ? t : approach(anim.rival, t, dt, 9);
  }

  if (v.phase === 'countdown') {
    anim.score = v.score;
    lastPhase = v.phase;
    drawCountdown(ctx, v, cx, u);
    if (mp) {
      drawRivalPanel(ctx, mp, width - pad - 2.6 * u, pad, u);
      if (mp.toast) drawToast(ctx, mp.toast, cx, pad + 10.5 * u, u);
    }
    return;
  }

  if (v.phase === 'photo') {
    if (!v.photoShot)
      text(ctx, photoHint(v.ui), cx, height - 5 * u, 2.6 * u, th.dim, {
        align: 'center',
        css: th.font(600, 2.6 * u),
      });
    return; // lastPhase stays run/paused so the tach is not reset on return
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

    // ---- under the timer: time left before TIME UP
    if (v.limit > 0) {
      const ls = limitState(v.time, v.par, v.limit);
      const ly = pad + 12.5 * u;
      plate(ctx, pad, ly, 27 * u, 6.5 * u, INK, ls.color);
      const alpha = ls.pulse ? 0.65 + 0.35 * Math.sin(nowS * 12) : 1;
      if (v.timeUp) {
        const msg = 'TIME UP · score locked';
        const px = 2.6 * u * Math.min(1, (23 * u) / measure(ctx, msg, 2.6 * u, 'label'));
        text(ctx, msg, pad + 3 * u, ly + 3.3 * u, px, RED, { font: 'label', stroke: null, alpha });
      } else
        text(ctx, formatTime(ls.left), pad + 6 * u, ly + 3.3 * u, 4.2 * u, ls.color, { alpha });
      const mw = measure(ctx, ls.missed, 2.2 * u, 'label');
      const lw = measure(ctx, formatTime(ls.left), 4.2 * u);
      if (!v.timeUp && ls.missed && 6 * u + lw + 2 * u + mw < 26 * u)
        text(ctx, ls.missed, pad + 25 * u, ly + 3.3 * u, 2.2 * u, STEEL, {
          align: 'right',
          font: 'label',
          stroke: null,
        });
    }

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
      if (p.kind === 'bank' && !p.late) {
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
    if (v.late > 0) {
      const lt = `+${formatScore(v.late)}`;
      const lx = width - pad - sw - 2.6 * u + 4 * u;
      const lw = measure(ctx, lt, 2.2 * u, 'label');
      text(ctx, lt, lx, pad + 9 * u, 2.2 * u, STEEL, { font: 'label', stroke: null });
      ctx.fillStyle = STEEL;
      ctx.fillRect(lx - 0.3 * u, pad + 8.9 * u, lw + 0.6 * u, 0.3 * u);
    }
    // continues the score plate's slant 1u below it
    if (mp) drawRivalPanel(ctx, mp, width - pad - 2.6 * u + SKEW * 9 * u, pad + 12.5 * u, u);

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
        const col = v.timeUp ? STEEL : multColor(m);
        // shrink long chains to stay clear of the speedometer
        const maxW = Math.max(40 * u, Math.min(90 * u, width - 64 * u));
        const strSize = 3.6 * u * Math.min(1, maxW / measure(ctx, str, 3.6 * u, 'label'));
        const pw = Math.max(measure(ctx, str, strSize, 'label'), 30 * u) + 12 * u;
        plate(ctx, cx - pw / 2 - 2 * u, baseY - 4.5 * u, pw, 17.5 * u, INK, col);
        text(ctx, str, cx, baseY, strSize, v.timeUp ? STEEL : AMBER, {
          align: 'center',
          font: 'label',
          scale: 1 + 0.3 * (1 - easeOutElastic(tk / 0.7)),
          stroke: OUTLINE,
        });

        const shake = 0.9 * u * Math.exp(-mk * 9);
        const multSize = 6.5 * u * (1 + Math.min(m - 1, 12) * 0.06);
        text(
          ctx,
          `×${+m.toFixed(1)}`,
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
        text(
          ctx,
          formatScore(anim.combo),
          cx + 2 * u,
          baseY + 6.5 * u,
          5.4 * u,
          v.timeUp ? STEEL : WHITE,
          {},
        );
        if (v.timeUp) {
          const cw = measure(ctx, formatScore(anim.combo), 5.4 * u);
          ctx.fillStyle = STEEL;
          ctx.fillRect(cx + 1.5 * u, baseY + 4.6 * u, cw + u, 0.4 * u);
        }

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
    if (mp?.toast) drawToast(ctx, mp.toast, cx, pad + 10.5 * u, u);
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

  lastPhase = v.phase;
  const r = v.results;
  if (!r) return;
  drawResults(ctx, v, r, width, height, u, th, nowS);
  if (mp?.toast) drawToast(ctx, mp.toast, cx, height - 9 * u, u);
  drawOverlayFx(ctx, width, height, nowS, th, { osd: false });
}

// ---------- results ----------

const ORD = ['', '1ST', '2ND', '3RD'];
export const POS_COL = ['', '#ffd23f', '#dfe6ff', '#ff9a4a'];
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
export const paintName = (id: string): string =>
  itemById(id)?.name ?? id.replace(/-/g, ' ').toUpperCase();

/** MP results: role decides REMATCH (host) or waiting (guest) */
export function resultsHint(
  ui: HudView['ui'],
  r: NonNullable<HudView['results']>,
  mp?: Pick<MpHud, 'connected' | 'role'>,
): string {
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
  const line = (xs: [Action, string][]) => hintLine(xs, ui.device, ui.padStyle);
  if (r.carPick) items.push(['confirm', 'choose car']);
  if (mp && !mp.connected) return line([...items, ['back', 'title']]);
  if (mp?.role === 'guest' && !r.carPick)
    return [line(items), 'waiting for host', line([['back', 'leave']])].filter(Boolean).join(' · ');
  if (!r.carPick) items.push(['confirm', mp ? 'rematch' : 'retry']);
  items.push(['back', mp ? 'leave' : 'menu']);
  return line(items);
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
  fill: string | CanvasGradient,
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

const DARK = '#14121c'; // text on filled pills and buttons
const EDGE = 'rgba(255,255,255,0.12)';

/** Big numerals: Dela Gothic in arcade, the masthead face in VHS (as the menus do). */
const disp = (th: Theme, px: number, italic = false): string =>
  `${italic ? 'italic ' : ''}400 ${px}px ${th.id === 'vhs' ? MASTHEAD : DELA}`;

/** m:ss.s */
function fmtT1(sec: number): string {
  const d = Math.floor(Math.max(0, sec) * 10 + 1e-6);
  return `${Math.floor(d / 600)}:${String(Math.floor((d % 600) / 10)).padStart(2, '0')}.${d % 10}`;
}

const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

/** Small tracked-out label. */
function spaced(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  px: number,
  col: string,
  th: Theme,
  o: { align?: CanvasTextAlign; weight?: number; em?: number; alpha?: number; glow?: string } = {},
): void {
  ctx.save();
  ctx.letterSpacing = `${(o.em ?? 0.2) * px}px`;
  text(ctx, s, x, y, px, col, {
    align: o.align,
    css: th.font(o.weight ?? 700, px),
    stroke: null,
    alpha: o.alpha,
    glow: o.glow,
  });
  ctx.restore();
}

/** Box with its edge at a lower alpha than the fill. */
function frame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rad: number,
  fill: string,
  edge: string,
  lw: number,
  edgeAlpha: number,
): void {
  box(ctx, x, y, w, h, rad, fill);
  ctx.save();
  ctx.globalAlpha *= edgeAlpha;
  box(ctx, x, y, w, h, rad, 'rgba(0,0,0,0)', edge, lw);
  ctx.restore();
}

const pillW = (ctx: CanvasRenderingContext2D, s: string, font: string, h: number) =>
  cssWidth(ctx, s, font) + 1.1 * h;

/** Rounded pill, x = left edge; glow lights the fill. Returns its width. */
function pill(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  cy: number,
  h: number,
  font: string,
  col: string,
  fill: string,
  edge?: string,
  lw = 1,
  glow?: string,
): number {
  const w = pillW(ctx, s, font, h);
  ctx.save();
  if (glow) {
    ctx.shadowColor = glow;
    ctx.shadowBlur = h * 0.6;
  }
  box(ctx, x, cy - h / 2, w, h, h / 2, fill, edge, lw);
  ctx.restore();
  text(ctx, s, x + w / 2, cy, h / 2, col, { align: 'center', css: font, stroke: null });
  return w;
}

type Seg = [s: string, font: string, col: string];

/** Outlined pill holding coloured text runs, x = left edge. Returns its width; draws only if draw. */
function segPill(
  ctx: CanvasRenderingContext2D,
  segs: Seg[],
  x: number,
  cy: number,
  h: number,
  edge: string,
  th: Theme,
  draw: boolean,
): number {
  const gap = h * 0.16;
  const pad = h * 0.42;
  const ws = segs.map(([s, f]) => cssWidth(ctx, s, f));
  const w = ws.reduce((a, b) => a + b, 0) + gap * (segs.length - 1) + 2 * pad;
  if (!draw) return w;
  frame(ctx, x, cy - h / 2, w, h, h / 2, th.panel, edge, Math.max(1.5, h * 0.05), 0.45);
  let tx = x + pad;
  segs.forEach(([s, f, c], i) => {
    text(ctx, s, tx, cy, h / 3, c, { css: f, stroke: null });
    tx += ws[i] + gap;
  });
  return w;
}

/** Draw one results pane shifted by dx and clipped to the screen. */
function pane(ctx: CanvasRenderingContext2D, dx: number, w: number, h: number, draw: () => void) {
  ctx.save();
  ctx.translate(dx, 0);
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  draw();
  ctx.restore();
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
  overlay(ctx, width, height, 0.82);
  const sum = r.stage === 'summary';
  const e = sum ? easeInOut(clamp01(r.summaryT / SLIDE)) : 0;
  if (e < 1) pane(ctx, -e * width, width, height, () => drawTally(ctx, v, r, width, height, u, th));
  if (sum)
    pane(ctx, (1 - e) * width, width, height, () =>
      drawSummary(ctx, v, r, width, height, u, th, now),
    );
}

let tallyMemo: { input: TallyInput; plan: TallyPlan } | undefined;
function planFor(i: TallyInput): TallyPlan {
  if (tallyMemo?.input !== i) tallyMemo = { input: i, plan: planTally(i) };
  return tallyMemo.plan;
}

/** shake magnitude (u) and length (s) per tally event */
function shakeOf(e: TallyEvent, placed: boolean): [number, number] {
  if (e.kind === 'land') return [0.25 + 0.08 * e.index, 0.18];
  if (e.kind === 'slam') return [1.4, 0.38];
  if (e.kind === 'place') return [0.6 + 0.4 * e.index, 0.26];
  if (e.kind === 'final') return [placed ? 2.2 : 1, 0.52];
  return [0, 0];
}

/** Pane 1: drifts count into COMBOS, the time multiplier slams, the total builds to a place. */
function drawTally(
  ctx: CanvasRenderingContext2D,
  v: HudView,
  r: NonNullable<HudView['results']>,
  width: number,
  height: number,
  u: number,
  th: Theme,
): void {
  const ti = r.tally;
  const p = planFor(ti);
  const t = r.tallyT;
  const f = tallyAt(ti, p, t);
  const pos = ti.position;
  const pc = pos ? POS_COL[pos] : th.text;
  const glow = (c: string) => (th.glow ? c : undefined);
  const hair = Math.max(1, 0.15 * u);
  /** s since the latest event of kind, Infinity if none yet */
  const ago = (kind: TallyEventKind) => {
    let a = Infinity;
    for (const e of p.events) if (e.kind === kind && e.t <= t) a = t - e.t;
    return a;
  };

  // decaying screen shake summed over recent events
  let sx = 0;
  let sy = 0;
  for (const e of p.events) {
    const a = t - e.t;
    const [mag, dur] = shakeOf(e, !!pos);
    if (a < 0 || a >= dur) continue;
    const amp = mag * u * (1 - a / dur);
    sx += amp * Math.sin(a * 95 + e.t * 7);
    sy += amp * 0.6 * Math.cos(a * 77 + e.t * 5);
  }
  ctx.save();
  ctx.translate(sx, sy);

  const cw = Math.min(width - 12 * u, 156 * u); // clear of the theme vignette
  const x0 = (width - cw) / 2;
  const oy = Math.max(0, (height - 100 * u) / 2); // the layout is 100u tall; centre it
  const Y = (y: number) => oy + y * u;
  const lw = (cw - 5 * u) * 0.49;
  const rx = x0 + lw + 5 * u;
  const rw = x0 + cw - rx;

  // ---- header: RESULTS, map, place pill + NEW BEST
  spaced(ctx, 'RESULTS', x0, Y(7), 2.6 * u, th.accent2, th, { em: 0.25 });
  const mapF = disp(th, 5 * u, true);
  text(ctx, ellipsize(ctx, r.mapName, mapF, cw - 40 * u), x0, Y(12), 5 * u, th.text, {
    css: mapF,
    stroke: null,
  });
  const pillF = disp(th, 3.6 * u);
  const pillH = 7 * u;
  const pw = pos ? pillW(ctx, ORD[pos], pillF, pillH) : 0;
  const fa = t - p.buildEnd; // since the total landed
  const da = fa - 0.22; // the pill drops a beat later
  if (pos && da > 0) {
    const k = easeOutBack(da / 0.6);
    const sc = lerp(3, 1, k);
    ctx.save();
    ctx.globalAlpha = clamp01(da / 0.15);
    ctx.translate(x0 + cw - pw / 2, Y(11) - (1 - k) * 10 * u);
    ctx.scale(sc, sc);
    pill(ctx, ORD[pos], -pw / 2, 0, pillH, pillF, '#1a1030', pc, undefined, 1, glow(pc));
    ctx.restore();
    streaks(ctx, x0 + cw - pw / 2, Y(11), 3 * u, 14 * u, (da - 0.36) / 0.6, 18, pc, 0.5 * u);
  }
  if (r.newBest && fa >= 0 && (fa > 2.4 || Math.floor(fa / 0.3) % 2 === 0))
    spaced(ctx, 'NEW BEST!', x0 + cw - pw - (pos ? 2.5 * u : 0), Y(11), 2.8 * u, GREEN, th, {
      align: 'right',
      em: 0.12,
      glow: glow(GREEN),
    });

  // ---- left: one row per counted drift, then the lump of the rest
  spaced(ctx, 'DRIFTS', x0, Y(21.5), 2.5 * u, th.accent, th);
  const counted = r.drifts.filter((d) => !d.late);
  const amts = ti.restCount > 0 ? [...ti.drifts, ti.rest] : [...ti.drifts];
  const rowH = 8.4 * u;
  const rowY = (i: number) => Y(25) + i * 10 * u;
  const valF = disp(th, 3.6 * u);
  const valW = amts.map((a) => cssWidth(ctx, formatScore(a), valF));
  const countEnd = (i: number) => p.rowStart[i] + (p.rowLand[i] - p.rowStart[i]) / 2.4;
  for (let i = 0; i < p.rows; i++) {
    const a = t - p.rowStart[i];
    if (a < 0) break;
    const x = x0 - 5 * u * (1 - easeOutBack(a / 0.22));
    const y = rowY(i);
    ctx.save();
    ctx.globalAlpha *= clamp01(a / 0.18);
    const done = t >= countEnd(i);
    frame(ctx, x, y, lw, rowH, u, th.panel, done ? th.accent2 : EDGE, hair, done ? 0.45 : 1);
    text(ctx, formatScore(f.rowValue[i]), x + lw - 2 * u, y + rowH / 2, 3.6 * u, th.text, {
      align: 'right',
      css: valF,
      stroke: null,
    });
    const name =
      i < ti.drifts.length
        ? counted[i]
          ? comboString(counted[i].tricks)
          : 'DRIFT'
        : `+${ti.restCount} MORE`;
    const tf = th.font(600, 2 * u);
    text(
      ctx,
      ellipsize(ctx, name, tf, lw - valW[i] - 6 * u),
      x + 2 * u,
      y + rowH / 2,
      2 * u,
      th.dim,
      {
        css: tf,
        stroke: null,
      },
    );
    ctx.restore();
  }

  // ---- right: COMBOS
  const numF = disp(th, 6.4 * u);
  const comboY = Y(25);
  const lit = (t0: number) => (t >= t0 ? 1 : 0.25);
  const comboA = lit(0.35);
  spaced(ctx, 'COMBOS', rx, comboY, 2.7 * u, th.dim, th, { alpha: comboA });
  const la = ago('land');
  text(ctx, formatScore(f.combo), rx + rw, comboY, 6.4 * u, th.accent2, {
    align: 'right',
    css: numF,
    stroke: null,
    alpha: comboA,
    scale: la < 0.18 ? 1 + 0.12 * Math.sin((Math.PI * la) / 0.18) : 1,
  });
  const comboCx = rx + rw - cssWidth(ctx, formatScore(ti.combo), numF) / 2;

  // ---- TIME / PAR and the multiplier: swells while rolling, then slams
  const timeY = Y(36.5);
  const timeA = lit(p.multStart - 0.2);
  spaced(ctx, 'TIME', rx, timeY, 2.7 * u, th.dim, th, { alpha: timeA });
  const sub = v.par > 0 ? `${fmtT1(r.time)} / PAR ${fmtT1(v.par)}` : fmtT1(r.time);
  ctx.save();
  ctx.letterSpacing = `${0.2 * 2.7 * u}px`;
  const timeW = cssWidth(ctx, 'TIME', th.font(700, 2.7 * u));
  ctx.restore();
  const multW = cssWidth(ctx, `×${ti.mult.toFixed(2)}`, numF);
  const subPx = fitPx(ctx, sub, (q) => th.font(600, q), 2.3 * u, rw - timeW - multW - 3.2 * u);
  if (subPx > 1.2 * u)
    text(ctx, sub, rx + timeW + 1.2 * u, timeY + 0.2 * u, subPx, th.dim, {
      css: th.font(600, subPx),
      stroke: null,
      alpha: timeA,
    });
  const multS = `×${f.mult.toFixed(2)}`;
  const ma = t - p.multEnd;
  const mk = clamp01((t - p.multStart) / (p.multEnd - p.multStart));
  text(ctx, multS, rx + rw, timeY, 6.4 * u, th.accent, {
    align: 'right',
    css: numF,
    stroke: null,
    alpha: ma >= 0 ? lerp(0.3, 1, clamp01(ma / 0.4)) : timeA,
    scale: ma >= 0 ? lerp(2.2, 1, easeOutBack(ma / 0.4)) : 1 + 0.35 * easeOutCubic(mk),
    glow: ma >= 0 ? glow(th.accent) : undefined,
  });
  const multCx = rx + rw - multW / 2;

  // ---- dashed rule
  ctx.save();
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = hair;
  ctx.setLineDash([0.8 * u, 0.8 * u]);
  ctx.beginPath();
  ctx.moveTo(rx, Y(43.5));
  ctx.lineTo(rx + rw, Y(43.5));
  ctx.stroke();
  ctx.restore();

  // ---- TOTAL: builds from the combos, swelling and jittering, lands in the place colour
  const totalA = lit(p.buildStart - 0.35);
  const totalY = Y(54.5);
  spaced(ctx, 'TOTAL', rx, Y(57), 2.7 * u, th.dim, th, { alpha: totalA });
  if (t >= p.buildStart - 0.35)
    text(ctx, `${formatScore(ti.combo)} × ${ti.mult.toFixed(2)}`, rx, Y(61), 2.5 * u, th.dim, {
      css: th.font(600, 2.5 * u),
      stroke: null,
    });
  const shown = t >= p.buildStart ? f.total : t >= p.buildStart - 0.35 ? ti.combo : 0;
  const totalS = formatScore(Math.max(ti.total, ti.combo));
  const tpx = fitPx(ctx, totalS, (q) => disp(th, q), 11.4 * u, rw - 18 * u);
  const totalF = disp(th, tpx);
  const bk = clamp01((t - p.buildStart) / (p.buildEnd - p.buildStart));
  const building = t >= p.buildStart && fa < 0;
  const j = building ? bk ** 3 * 0.6 * u : 0;
  text(
    ctx,
    formatScore(shown),
    rx + rw + j * Math.sin(t * 137),
    totalY + j * Math.cos(t * 151),
    tpx,
    fa >= 0 && pos ? pc : th.text,
    {
      align: 'right',
      css: totalF,
      stroke: null,
      alpha: totalA,
      scale: building ? 1 + 0.3 * bk : fa >= 0 ? lerp(1.6, 1, easeOutBack(fa / 0.55)) : 1,
      glow: fa >= 0 && pos ? glow(pc) : undefined,
    },
  );
  const totalCx = rx + rw - cssWidth(ctx, formatScore(ti.total), totalF) / 2;

  // ---- place bar: 3RD / 2ND / 1ST ticks light as their tier fires
  const medals = ti.medals;
  const barY = Y(71.5);
  const barMax = medals ? medals[2] * 1.2 : 1;
  const tickX = (k: number) => rx + (rw * (medals?.[k] ?? 0)) / barMax;
  if (medals) {
    const bh = 2 * u;
    box(ctx, rx, barY - bh / 2, rw, bh, bh / 2, 'rgba(255,255,255,0.08)');
    const fw = rw * clamp01(Math.max(f.combo, f.total) / barMax);
    if (fw > 0) {
      const grad = linear(ctx, rx, 0, rx + rw, 0, [
        [0, th.accent2],
        [1, th.accent],
      ]);
      box(ctx, rx, barY - bh / 2, fw, bh, bh / 2, grad);
    }
    for (let k = 0; k < 3; k++) {
      const hit = f.tier >= k;
      const c = hit ? POS_COL[3 - k] : th.dim;
      spaced(ctx, ORD[3 - k], tickX(k), Y(68), 2.1 * u, c, th, {
        align: 'center',
        em: 0.1,
        glow: hit ? glow(c) : undefined,
      });
      ctx.save();
      ctx.globalAlpha *= 0.6;
      ctx.fillStyle = c;
      ctx.fillRect(tickX(k) - hair, Y(69.4), 2 * hair, 3 * u);
      ctx.restore();
    }
  }

  // ---- each counted amount flies from its row up to COMBOS
  for (let i = 0; i < p.rows; i++) {
    const c0 = countEnd(i);
    const c1 = p.rowLand[i];
    if (t < c0 || t >= c1) continue;
    const k = ((t - c0) / (c1 - c0)) ** 2; // eases in, like a throw
    const ax = x0 + lw - 2 * u - valW[i] / 2;
    const ay = rowY(i) + rowH / 2;
    const mx = ax + (comboCx - ax) * 0.35;
    const my = ay + (comboY - ay) * 0.35 - 0.06 * width;
    const q = k < 0.4 ? k / 0.4 : (k - 0.4) / 0.6;
    const [x, y, sc] =
      k < 0.4
        ? [lerp(ax, mx, q), lerp(ay, my, q), lerp(1, 1.5, q)]
        : [lerp(mx, comboCx, q), lerp(my, comboY, q), lerp(1.5, 0.5, q)];
    text(ctx, `+${formatScore(amts[i])}`, x, y, 4.3 * u, th.accent2, {
      align: 'center',
      css: disp(th, 4.3 * u),
      stroke: null,
      scale: sc,
      alpha: k < 0.4 ? 1 : lerp(1, 0.8, q),
      glow: glow(th.accent2),
    });
  }

  // ---- sparks + flash per event
  let flashA = 0;
  let flashC = '';
  const flash = (c: string, peak: number, a: number) => {
    const fa2 = peak * (1 - easeOutCubic(a / 0.42));
    if (fa2 > flashA) [flashA, flashC] = [fa2, c];
  };
  for (const e of p.events) {
    const a = t - e.t;
    if (a < 0 || a > 1) continue;
    if (e.kind === 'land')
      streaks(
        ctx,
        comboCx,
        comboY,
        2 * u,
        (10 + 1.5 * e.index) * u,
        a / 0.5,
        12 + 3 * e.index,
        th.accent2,
        0.5 * u,
      );
    else if (e.kind === 'slam') {
      streaks(ctx, multCx, timeY, 3 * u, 18 * u, a / 0.6, 24, th.accent, 0.6 * u);
      flash(th.accent, 0.35, a);
    } else if (e.kind === 'place' && medals) {
      const c = POS_COL[3 - e.index];
      streaks(
        ctx,
        tickX(e.index),
        barY,
        u,
        (9 + 3 * e.index) * u,
        a / 0.6,
        16 + 6 * e.index,
        c,
        0.5 * u,
      );
      flash(c, 0.2 + 0.08 * e.index, a);
    } else if (e.kind === 'final') {
      const c = pos ? pc : '#ffffff';
      streaks(ctx, totalCx, totalY, 4 * u, 30 * u, a / 0.8, 32, c, 0.8 * u);
      flash(c, pos ? 0.55 : 0.2, a);
    }
  }
  ctx.restore(); // shake

  // ---- SKIP hint, then CONTINUE
  const g = glyph('confirm', v.ui.device, v.ui.padStyle);
  const bx = x0 + cw;
  if (!f.done)
    spaced(ctx, `${g} SKIP`, bx, height - 4 * u, 2.1 * u, th.dim, th, {
      align: 'right',
      weight: 600,
      em: 0.1,
    });
  else {
    const rise = (1 - easeOutBack((t - p.duration) / 0.35)) * 2.7 * u;
    const by = height - 7.5 * u + rise;
    const lab = 'CONTINUE ▶';
    const labF = disp(th, 3 * u);
    const keyF = th.font(700, 2 * u);
    const kw = cssWidth(ctx, g, keyF);
    const w = cssWidth(ctx, lab, labF) + 1.4 * u + kw + 7.8 * u;
    const h = 7.6 * u;
    ctx.save();
    if (th.glow) {
      ctx.shadowColor = th.accent2;
      ctx.shadowBlur = 3 * u;
    }
    box(ctx, bx - w, by - h / 2, w, h, 0.7 * u, th.accent2);
    ctx.restore();
    text(ctx, lab, bx - w + 3.9 * u, by, 3 * u, DARK, { css: labF, stroke: null });
    text(ctx, g, bx - 3.9 * u, by, 2 * u, DARK, {
      align: 'right',
      css: keyF,
      stroke: null,
      alpha: 0.7,
    });
  }

  if (flashA > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = flashA;
    ctx.fillStyle = flashC;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
}

/** Pane 2: hero total and pills, stat pills, then the top drift cards. */
function drawSummary(
  ctx: CanvasRenderingContext2D,
  v: HudView,
  r: NonNullable<HudView['results']>,
  width: number,
  height: number,
  u: number,
  th: Theme,
  now: number,
): void {
  const s = r.summaryT;
  const pulse = 0.5 + 0.5 * Math.sin(now * 4.2);
  const cx = width / 2;
  const cw = Math.min(width - 12 * u, 150 * u);
  const x0 = cx - cw / 2;
  const hair = Math.max(1, 0.15 * u);
  const lw2 = Math.max(1.5, 0.3 * u);
  const pos = r.position;
  const pc = pos ? POS_COL[pos] : th.text;
  /** fade + rise of stagger slot d, timed off summaryT */
  const enter = (d: number, draw: () => void) => {
    const k = clamp01((s - 0.42 - d * 0.09) / 0.5);
    if (k <= 0) return;
    ctx.save();
    ctx.globalAlpha *= k;
    ctx.translate(0, (1 - easeOutBack(k)) * 3 * u);
    draw();
    ctx.restore();
  };

  // ---- vertical layout: cards at the bottom, hero centred in the space above
  const dl = r.daily;
  const pillsRow = !!r.medals || r.newBest;
  const lateMsg = r.timeUp
    ? r.late
      ? `+${formatScore(r.late)} after time not counted`
      : 'score locked at the time limit'
    : '';
  const msg = lateMsg || nextTarget(pos, r.medals, v.par);
  const statsDy = (pillsRow ? 30.4 : 23.8) * u;
  const heroH = statsDy + 3.1 * u + (msg ? 4 * u : 0);
  const cGap = 2 * u;
  const cardW = (cw - 2 * cGap) / 3;
  const bottom = height - 8 * u;
  const imgH = Math.max(6 * u, Math.min((cardW * 9) / 16, bottom - 17.4 * u - heroH));
  const cardsTop = bottom - 3.2 * u - imgH;
  const labelY = cardsTop - 2.5 * u;
  const top = 4 * u + Math.max(0, (labelY - 7.9 * u - heroH) / 2);
  const totalY = top + 10.55 * u;

  // ---- headline + total
  const verdictHead = dl
    ? `${dl.kind.toUpperCase()} ${dl.cleared ? 'CLEARED' : 'FAILED'} · TARGET ${formatScore(dl.target)}${dl.kind === 'legend' ? ` · WALL HITS ${dl.wallHits}` : ''}`
    : `FINISHED · ${r.mapName}`;
  const head = r.timeUp ? (dl ? `TIME UP · ${verdictHead}` : 'TIME UP') : verdictHead;
  const rv = r.rival;
  const h2h = !!rv && (rv.total !== null || !v.mp?.connected);
  const side = h2h || !!v.mp?.waiting;
  const totalS = formatScore(r.total);
  const totalPx = fitPx(ctx, totalS, (q) => disp(th, q, true), 13.5 * u, cw - (side ? 38 * u : 0));
  enter(0, () => {
    const hp = fitPx(ctx, head, (q) => th.font(700, q), 2.4 * u, cw - 10 * u);
    spaced(
      ctx,
      head,
      cx,
      top + (th.id === 'vhs' ? -0.4 : 1.2) * u, // the masthead face rides higher
      hp,
      r.timeUp ? RED : dl ? (dl.cleared ? GREEN : RED) : th.dim,
      th,
      {
        align: 'center',
        em: 0.3,
      },
    );
    text(ctx, totalS, cx, totalY, totalPx, pc, {
      align: 'center',
      css: disp(th, totalPx, true),
      stroke: null,
      glow: th.glow ? pc : undefined,
    });
    if (!pillsRow) return;
    // place pill (or NO PLACE) + NEW BEST
    const ph = 5.2 * u;
    const pf = disp(th, 2.8 * u);
    const nf = th.font(700, 1.9 * u);
    const place = r.medals ? positionLabel(pos) : '';
    const w1 = place ? pillW(ctx, place, pf, ph) : 0;
    const w2 = r.newBest ? pillW(ctx, 'NEW BEST', nf, ph) : 0;
    let x = cx - (w1 + w2 + (w1 && w2 ? 1.2 * u : 0)) / 2;
    const py = top + 21.3 * u;
    if (place) {
      if (pos) pill(ctx, place, x, py, ph, pf, DARK, pc, undefined, 1, th.glow ? pc : undefined);
      else pill(ctx, place, x, py, ph, pf, th.dim, 'rgba(0,0,0,0)', EDGE, lw2);
      x += w1 + 1.2 * u;
    }
    if (r.newBest) {
      ctx.save();
      ctx.globalAlpha *= Math.floor(s / 0.33) % 2 ? 0.2 : 1;
      pill(ctx, 'NEW BEST', x, py, ph, nf, GREEN, 'rgba(0,0,0,0)', GREEN, lw2);
      ctx.restore();
    }
  });

  // ---- stats: [COMBOS] × [TIME ×mult] | [BEST delta], shrunk to fit
  const sy = top + statsDy;
  const d = r.total - r.prevBest;
  const up = d > 0;
  const delta = d > 0 ? `▲ +${formatScore(d)}` : d < 0 ? `-${formatScore(-d)}` : '±0';
  const statRow = (uu: number, x: number | null): number => {
    const h = 6.2 * uu;
    const lab = th.font(700, 1.8 * uu);
    const val = disp(th, 3.4 * uu);
    const draw = x !== null;
    let at = x ?? 0;
    const step = (w: number) => (at += w + 1.2 * uu);
    step(
      segPill(
        ctx,
        [
          ['COMBOS', lab, th.dim],
          [formatScore(r.tally.combo), val, th.accent2],
        ],
        at,
        sy,
        h,
        th.accent2,
        th,
        draw,
      ),
    );
    const opF = disp(th, 2.8 * uu);
    if (draw) text(ctx, '×', at, sy, 2.8 * uu, th.dim, { css: opF, stroke: null });
    step(cssWidth(ctx, '×', opF));
    step(
      segPill(
        ctx,
        [
          ['TIME', lab, th.dim],
          [fmtT1(r.time), lab, th.text],
          [`×${r.tally.mult.toFixed(2)}`, val, th.accent],
        ],
        at,
        sy,
        h,
        th.accent,
        th,
        draw,
      ),
    );
    if (draw) {
      ctx.fillStyle = EDGE;
      ctx.fillRect(at + 1.6 * uu, sy - 1.7 * uu, 2, 3.4 * uu);
    }
    step(2 + 2 * uu);
    step(
      segPill(
        ctx,
        [
          ['BEST', lab, th.dim],
          [formatScore(Math.max(r.best, r.total)), val, th.text],
          [delta, th.font(700, 1.6 * uu), up ? GREEN : th.dim],
        ],
        at,
        sy,
        h,
        th.text,
        th,
        draw,
      ),
    );
    return at - (x ?? 0) - 1.2 * uu;
  };
  const rowW = statRow(u, null);
  const k = Math.min(1, cw / rowW);
  enter(1.5, () => statRow(u * k, cx - (rowW * k) / 2));
  if (msg)
    enter(2, () => {
      const px = fitPx(ctx, msg, (q) => th.font(600, q), 1.9 * u, cw);
      spaced(ctx, msg, cx, sy + 6.05 * u, px, lateMsg ? RED : th.dim, th, {
        align: 'center',
        weight: 600,
        em: 0.08,
      });
    });

  // ---- multiplayer: YOU / rival panels flanking the total
  if (side) {
    const totalW = cssWidth(ctx, totalS, disp(th, totalPx, true));
    const sw = Math.max(16 * u, Math.min(34 * u, (cw - totalW) / 2 - 3 * u));
    const py = totalY - 6.75 * u;
    const fade = clamp01((s - 0.6) / 0.15);
    if (rv && h2h) {
      const res = verdict(r.total, rv.total);
      const vt = verdictText(res, rv.name);
      const vc = res === 'win' ? GREEN : res === 'lose' ? RED : AMBER;
      const vs = easeOutBack((s - 0.8) / 0.35);
      sidePanel(ctx, x0, py, sw, u, th, 'YOU', totalS, res !== 'lose' ? vt : '', vc, vs, fade);
      const rn = rv.name.toUpperCase();
      const rt = rivalTotalText(rv.total);
      sidePanel(ctx, x0 + cw - sw, py, sw, u, th, rn, rt, res !== 'win' ? vt : '', vc, vs, fade);
    } else if (v.mp) {
      const label = `WAITING FOR ${v.mp.rival.toUpperCase()}`;
      const a = fade * (0.55 + 0.45 * pulse);
      sidePanel(ctx, x0 + cw - sw, py, sw, u, th, label, formatScore(anim.rival), '', AMBER, 1, a);
    }
  }

  // ---- TOP DRIFTS label, unlock toasts on the right
  const labelFont = th.font(800, 2.2 * u, true);
  enter(2.5, () =>
    text(ctx, 'TOP DRIFTS', x0, labelY, 2.2 * u, th.accent2, { css: labelFont, stroke: null }),
  );
  const toasts = r.newPaints.map((id) => `NEW PAINT · ${paintName(id)}`);
  if (dl?.reward) toasts.push(`NEW · ${itemById(dl.reward)?.name ?? paintName(dl.reward)}`);
  if (r.carPick) toasts.push('CAR PICK EARNED');
  if (toasts.length) {
    const room = cw - cssWidth(ctx, 'TOP DRIFTS', labelFont) - 3 * u;
    const tPad = 1.4 * u;
    const need = toasts.reduce(
      (a, t) => a + cssWidth(ctx, t, th.font(700, 1.9 * u)) + 2 * tPad + cGap,
      0,
    );
    const tk = Math.min(1, room / need);
    const px = 1.9 * u * tk;
    let x = x0 + cw;
    toasts.forEach((t, i) => {
      const tw = cssWidth(ctx, t, th.font(700, px)) + 2 * tPad * tk;
      x -= tw;
      const t0 = s - 0.9 - i * 0.12;
      ctx.save();
      ctx.globalAlpha = clamp01(t0 / 0.1);
      const tg = th.glow ? GREEN : undefined;
      box(ctx, x, labelY - 1.8 * u, tw, 3.6 * u, 1.8 * u, 'rgba(43,245,140,0.16)', GREEN, hair, tg);
      ctx.restore();
      text(ctx, t, x + tw / 2, labelY, px, GREEN, {
        align: 'center',
        css: th.font(700, px),
        stroke: null,
        scale: easeOutBack(t0 / 0.3),
        alpha: clamp01(t0 / 0.1),
      });
      x -= cGap * tk;
    });
  }

  // ---- cards: rounded snapshot, #n, REPLAY on the selected one, amount pill, tricks under
  const n = r.drifts.length;
  if (!n)
    enter(3, () =>
      text(ctx, 'NO DRIFTS BANKED', cx, cardsTop + imgH / 2, 2.6 * u, th.dim, {
        align: 'center',
        css: th.font(600, 2.6 * u, true),
        stroke: null,
      }),
    );
  const sx = cx - (n * cardW + (n - 1) * cGap) / 2;
  const tagH = 3.6 * u;
  const tagF = th.font(700, 1.6 * u);
  const ink = 'rgba(0,0,0,0.6)';
  r.drifts.forEach((dr, i) =>
    enter(3 + i * 0.5, () => {
      const sel = i === r.driftRow;
      const x = sx + i * (cardW + cGap);
      const y = cardsTop;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, cardW, imgH, 1.2 * u);
      ctx.clip();
      ctx.fillStyle = '#05060d';
      ctx.fillRect(x, y, cardW, imgH);
      const st = dr.still;
      if (st && st.width && st.height) {
        const c = Math.max(cardW / st.width, imgH / st.height); // cover
        ctx.drawImage(
          st,
          x + (cardW - st.width * c) / 2,
          y + (imgH - st.height * c) / 2,
          st.width * c,
          st.height * c,
        );
      } else {
        // placeholder: faint diagonal stripes
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1.2 * u;
        ctx.beginPath();
        for (let q = -imgH; q < cardW; q += 3.5 * u) {
          ctx.moveTo(x + q, y + imgH);
          ctx.lineTo(x + q + imgH, y);
        }
        ctx.stroke();
      }
      if (!sel) {
        ctx.fillStyle = 'rgba(4,5,12,0.35)';
        ctx.fillRect(x, y, cardW, imgH);
        text(ctx, '▶', x + cardW / 2, y + imgH / 2, 5 * u, 'rgba(255,255,255,0.7)', {
          align: 'center',
          css: th.font(700, 5 * u),
          stroke: null,
        });
      }
      ctx.restore();
      const g = sel && th.glow ? th.accent2 : undefined;
      const edge = sel ? th.accent2 : EDGE;
      box(ctx, x, y, cardW, imgH, 1.2 * u, 'rgba(0,0,0,0)', edge, sel ? lw2 : hair, g);
      const pad = 1.2 * u;
      const ty = y + pad + tagH / 2;
      pill(ctx, `#${i + 1}`, x + pad, ty, tagH, tagF, th.text, ink);
      let tr = x + cardW - pad; // right-hand tags, laid out leftwards
      if (sel)
        tr -=
          pill(ctx, '● REPLAY', tr - pillW(ctx, '● REPLAY', tagF, tagH), ty, tagH, tagF, RED, ink) +
          pad;
      if (dr.saved)
        pill(
          ctx,
          'SAVED',
          tr - pillW(ctx, 'SAVED', tagF, tagH),
          ty,
          tagH,
          tagF,
          GREEN,
          ink,
          GREEN,
          hair,
        );
      const by = y + imgH - pad - tagH / 2;
      const amtF = disp(th, 2.2 * u);
      ctx.save();
      if (sel) ctx.globalAlpha *= 0.85 + 0.15 * pulse;
      const aw = pill(
        ctx,
        formatScore(dr.amount),
        x + pad,
        by,
        tagH,
        amtF,
        DARK,
        dr.late ? th.dim : sel ? th.accent2 : th.text,
      );
      ctx.restore();
      if (dr.late) pill(ctx, 'NOT COUNTED', x + 2 * pad + aw, by, tagH, tagF, RED, ink, RED, hair);
      const cf = th.font(600, 1.6 * u);
      const tricks = ellipsize(ctx, comboString(dr.tricks), cf, cardW - 1.2 * u);
      text(ctx, tricks, x + 0.6 * u, y + imgH + 2.2 * u, 1.6 * u, th.dim, {
        css: cf,
        stroke: null,
      });
    }),
  );

  if (r.chooser) drawChooser(ctx, r.chooser, width, height, u, th, pulse);
  hintBar(ctx, resultsHint(v.ui, r, v.mp), width, height, u, th);
}

/** Results side panel beside the total: label, value, optional verdict tag (winner gets the glow). */
function sidePanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  u: number,
  th: Theme,
  label: string,
  value: string,
  tag: string,
  tagCol: string,
  tagScale: number,
  alpha: number,
): void {
  const h = 13.5 * u;
  const cx = x + w / 2;
  ctx.save();
  ctx.globalAlpha = clamp01(alpha);
  const edge = tag ? tagCol : 'rgba(255,255,255,0.12)';
  const g = tag && th.glow ? tagCol : undefined;
  box(ctx, x, y, w, h, 1 * u, th.panel, edge, tag ? 0.35 * u : Math.max(1, 0.15 * u), g);
  ctx.restore();
  const lp = fitPx(ctx, label, (p) => th.font(700, p), 2.2 * u, w - 3 * u);
  text(ctx, label, cx, y + 2.6 * u, lp, th.dim, {
    align: 'center',
    css: th.font(700, lp),
    stroke: null,
    alpha,
  });
  const vp = fitPx(ctx, value, (p) => th.font(800, p, true), 4.6 * u, w - 3 * u);
  text(ctx, value, cx, y + 6.8 * u, vp, th.text, {
    align: 'center',
    css: th.font(800, vp, true),
    stroke: null,
    alpha,
  });
  if (!tag) return;
  const tp = fitPx(ctx, tag, (p) => th.font(800, p, true), 2.6 * u, w - 3 * u);
  text(ctx, tag, cx, y + 11 * u, tp, tagCol, {
    align: 'center',
    css: th.font(800, tp, true),
    stroke: null,
    glow: th.glow ? tagCol : undefined,
    scale: tagScale,
    alpha,
  });
}

function statBar(
  ctx: CanvasRenderingContext2D,
  th: Theme,
  u: number,
  label: string,
  v: number,
  x: number,
  w: number,
  y: number,
): void {
  text(ctx, label, x, y, 1.8 * u, th.dim, { css: th.font(700, 1.8 * u), stroke: null });
  const bx = x + 9 * u;
  const bw = w - 9 * u;
  const bh = 1.2 * u;
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fillRect(bx, y - bh / 2, bw, bh);
  ctx.fillStyle = th.id === 'vhs' ? th.accent : th.accent2;
  ctx.fillRect(bx, y - bh / 2, bw * (0.08 + 0.92 * v), bh);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  for (let k = 1; k < 10; k++)
    ctx.fillRect(bx + (bw * k) / 10, y - bh / 2, Math.max(1, 0.2 * u), bh);
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
  text(ctx, 'CAR PICK', cx, cy - 20 * u, 7 * u, th.accent, {
    align: 'center',
    css: th.font(800, 7 * u, true),
    glow: th.glow ? th.accent : undefined,
  });
  text(ctx, 'unlock one car', cx, cy - 13.5 * u, 2.4 * u, th.dim, {
    align: 'center',
    css: th.font(600, 2.4 * u),
    stroke: null,
  });
  const pw = Math.min(70 * u, width - 8 * u);
  const ph = (later ? 21 : 30) * u;
  const top = cy - 10.5 * u;
  const g = th.glow ? th.accent : undefined;
  box(ctx, cx - pw / 2, top, pw, ph, 1.4 * u, th.panel, th.accent, 0.45 * u, g);
  const name = later ? 'LATER' : c.cars[c.row].name.toUpperCase();
  if (!later) {
    const car = c.cars[c.row];
    const sz = 12 * u; // equipped look, centred in the card's upper half
    ctx.drawImage(
      carImage(car.model, car.color, car.look),
      cx - sz / 2,
      cy - 4 * u - sz / 2,
      sz,
      sz,
    );
  }
  if (!later) {
    const { power, grip, weight } = c.cars[c.row].stats;
    const bx = cx - pw / 2 + 5 * u;
    Object.entries({ POWER: power, GRIP: grip, WEIGHT: weight }).forEach(([label, v], i) =>
      statBar(ctx, th, u, label, v, bx, pw - 10 * u, cy + (11 + i * 2.7) * u),
    );
  }
  const px = fitPx(ctx, name, (p) => th.font(800, p, true), 5.5 * u, pw - 14 * u);
  text(ctx, name, cx, cy + (later ? -1.2 : 6.5) * u, px, later ? th.dim : th.text, {
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
    ctx.arc(dx, top + ph + 3 * u, (i === c.row ? 0.7 : 0.45) * u, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
