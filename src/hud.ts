import { COMBO_GRACE } from './config';
import type { HudView, Popup } from './view';
import { drawMenu } from './ui/menu';

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
  if (o.font !== 'label') ctx.transform(1, 0, SKEW, 1, 0, 0);
  setFont(ctx, size, o.font);
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
  speed: 0,
};

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
    baseY + amp * 0.5 * Math.cos(a * 77),
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
      baseY + 7 * u + 3 * u * c0 + 45 * u * c0 * c0,
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

  if (v.phase === 'countdown') {
    anim.score = v.score;
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
    const fw = measure(ctx, v.floorName, 3 * u, 'label') + 6 * u;
    plate(ctx, cx - fw / 2 - 1 * u, pad, fw, 5.5 * u, INK);
    text(ctx, v.floorName, cx, pad + 2.75 * u, 3 * u, WHITE, {
      align: 'center',
      font: 'label',
      stroke: null,
    });

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

    // popups are appended oldest-first; keep the 3 newest tricks, newest lowest
    const live = v.popups
      .filter((p) => p.kind !== 'trick')
      .concat(v.popups.filter((p) => p.kind === 'trick').slice(-3));
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

    // ---- speedometer, needle eased toward the real speed
    anim.speed = approach(anim.speed, v.speedKmh, dt, 9);
    const r = 9 * u;
    const sx = width - pad - r - u;
    const sy = height - pad - r - u;
    const a0 = Math.PI * 0.667; // 240 deg arc, gap at the bottom
    const sweep = (Math.PI * 4) / 3;
    const f = clamp01(anim.speed / 140);
    ctx.save();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(sx, sy, r + 2.2 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.4 * u;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.arc(sx, sy, r, a0, a0 + sweep);
    ctx.stroke();
    ctx.strokeStyle = STEEL;
    ctx.lineWidth = 0.35 * u;
    ctx.beginPath();
    for (let i = 0; i <= 7; i++) {
      const a = a0 + (sweep * i) / 7;
      ctx.moveTo(sx + Math.cos(a) * (r - 2.2 * u), sy + Math.sin(a) * (r - 2.2 * u));
      ctx.lineTo(sx + Math.cos(a) * (r - 1.2 * u), sy + Math.sin(a) * (r - 1.2 * u));
    }
    ctx.stroke();
    if (f > 0) {
      const hot = f > 0.85;
      ctx.strokeStyle = hot ? RED : AMBER;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = hot ? 2 * u : u;
      ctx.lineWidth = 1.4 * u;
      ctx.beginPath();
      ctx.arc(sx, sy, r, a0, a0 + sweep * f);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    const na = a0 + sweep * f;
    ctx.strokeStyle = WHITE;
    ctx.lineCap = 'round';
    ctx.lineWidth = 0.5 * u;
    ctx.beginPath();
    ctx.moveTo(sx - Math.cos(na) * 1.5 * u, sy - Math.sin(na) * 1.5 * u);
    ctx.lineTo(sx + Math.cos(na) * (r - 0.8 * u), sy + Math.sin(na) * (r - 0.8 * u));
    ctx.stroke();
    ctx.fillStyle = RED;
    ctx.beginPath();
    ctx.arc(sx, sy, 1 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    text(ctx, String(Math.round(anim.speed)), sx, sy + 4.6 * u, 4.4 * u, WHITE, {
      align: 'center',
    });
    text(ctx, 'km/h', sx, sy + 8 * u, 1.8 * u, STEEL, {
      align: 'center',
      font: 'label',
      stroke: null,
    });

    if (v.phase === 'run' && v.time < 0.8) drawGo(ctx, v.time, width, height, u);
    if (v.phase === 'paused') {
      overlay(ctx, width, height, 0.6);
      text(ctx, 'PAUSED', cx, height * 0.45, 13 * u, WHITE, { align: 'center' });
      text(ctx, 'ENTER resume · R restart · ESC menu', cx, height * 0.55, 3 * u, STEEL, {
        align: 'center',
        font: 'label',
      });
    }
    return;
  }

  const r = v.results;
  if (!r) return;
  overlay(ctx, width, height, 0.7);
  const pw = Math.min(width * 0.9, 60 * u);
  const top = height / 2 - 28 * u;
  plate(ctx, cx - pw / 2 - 6 * u, top, pw, 56 * u, 'rgba(12,14,28,0.94)', AMBER, 1.4 * u);
  text(ctx, 'FINISHED', cx, top + 6.5 * u, 8 * u, WHITE, { align: 'center' });
  const rows: [string, string][] = [
    ['Combo points', formatScore(r.comboPoints)],
    ['Time', formatTime(r.time)],
    ['Time bonus', formatScore(r.timeBonus)],
  ];
  rows.forEach(([k, val], i) => {
    const y = top + (15 + i * 5) * u;
    text(ctx, k, cx - pw / 2 + 7 * u, y, 2.8 * u, STEEL, { font: 'label', stroke: null });
    text(ctx, val, cx + pw / 2 - 5 * u, y, 3.6 * u, WHITE, { align: 'right' });
  });
  text(ctx, 'Total', cx - pw / 2 + 3 * u, top + 33 * u, 4 * u, AMBER, { font: 'label' });
  text(ctx, formatScore(r.total), cx + pw / 2 - 5 * u, top + 33 * u, 8 * u, AMBER, {
    align: 'right',
    glow: AMBER,
  });
  text(ctx, `Best ${formatScore(r.best)}`, cx - 2 * u, top + 41 * u, 3 * u, STEEL, {
    align: 'center',
    font: 'label',
  });
  if (r.newBest && Math.floor(nowS * 3) % 2 === 0)
    text(ctx, 'NEW BEST!', cx - 3 * u, top + 47 * u, 5 * u, GREEN, {
      align: 'center',
      glow: GREEN,
    });
  text(ctx, 'ENTER / A race again', cx - 4 * u, top + 53 * u, 2.8 * u, WHITE, {
    align: 'center',
    font: 'label',
  });
}
