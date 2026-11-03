import { approach, easeOutElastic } from '../hud';

export interface TachPalette {
  accent: string;
  accent2: string;
  text: string;
  dim: string;
  glow: number;
}
export interface TachState {
  rpm: number;
  redline: number;
  gear: string;
  speedKmh: number;
}

// Same faces and racing slant as hud.ts.
const DISPLAY = 'Impact, Haettenschweiler, "Arial Black", sans-serif';
const LABEL = '"Segoe UI", system-ui, sans-serif';
const SKEW = -0.22;
const INK = 'rgba(4,5,12,0.82)'; // neutral backing so the dial reads over any scene
const OUTLINE = 'rgba(4,5,12,0.9)';

const A0 = (Math.PI * 5) / 6; // 240 deg arc, gap centred at the bottom
const SWEEP = (Math.PI * 4) / 3;
const LEDS = 10;
const LED_FROM = 0.75; // fraction of redline where the first shift LED lights
const FLASH_AT = 0.97;
const LIMIT_AT = 0.99;
const SWEEP_S = 0.9;
const PUNCH_S = 0.45;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Dial end: one thousand past the redline, rounded up. */
export const dialMax = (redline: number) => Math.max(2, Math.ceil(redline / 1000) + 1) * 1000;

export const rpmAngle = (rpm: number, max: number) => A0 + SWEEP * clamp(rpm / max, 0, 1);

/** Shift LEDs lit: none below 75% of redline, all of them at 97%. */
export function litLeds(rpm: number, redline: number, n = LEDS): number {
  const f = rpm / Math.max(1, redline);
  return clamp(Math.floor(((f - LED_FROM) / (FLASH_AT - LED_FROM)) * n + 1e-9), 0, n);
}

const mixCache = new Map<string, string>();
function hex(s: string): number[] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** Mid shift-LED colour: the average of two hex colours pushed back to full brightness
 *  (green + red gives yellow, not olive). Non-hex input falls back to `a`. Cached. */
export function blendHot(a: string, b: string): string {
  const key = a + '|' + b;
  let out = mixCache.get(key);
  if (out === undefined) {
    const pa = hex(a);
    const pb = hex(b);
    if (!pa || !pb) out = a;
    else {
      const c = pa.map((v, i) => (v + pb[i]) / 2);
      const k = 255 / Math.max(1, ...c);
      out =
        '#' +
        c
          .map((v) =>
            Math.round(v * k)
              .toString(16)
              .padStart(2, '0'),
          )
          .join('');
    }
    mixCache.set(key, out);
  }
  return out;
}

export function createTach() {
  let sweepT = 0; // startup sweep clock, -1 once done
  let v = 0; // displayed rpm
  let lastA = A0;
  let omega = 0; // smoothed needle angular velocity, rad/s
  let time = 0;
  let gear = '';
  let punch = PUNCH_S; // seconds since the last gear change
  let red = 0; // 0..1 how deep into the red zone glow
  let lim = 0; // 0..1 limiter intensity

  function reset(): void {
    sweepT = 0;
    v = 0;
    lastA = A0;
    omega = 0;
    red = lim = 0;
    punch = PUNCH_S;
  }

  function draw(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    s: TachState,
    pal: TachPalette,
    dt: number,
  ): void {
    dt = clamp(dt, 0, 0.1);
    time += dt;
    const ease = (cur: number, to: number, rate: number) => to + (cur - to) * Math.exp(-rate * dt);
    const redline = Math.max(1, s.redline);
    const max = dialMax(redline);

    if (sweepT >= 0) {
      sweepT += dt;
      const k = Math.min(1, sweepT / SWEEP_S);
      v = max * Math.sin(Math.PI * k) ** 0.6; // fast rise, brief hang at the top, drop
      if (k >= 1) sweepT = -1;
    } else v = approach(v, s.rpm, dt, 22);

    if (s.gear !== gear) {
      if (gear) punch = 0;
      gear = s.gear;
    }
    punch += dt;

    const na = rpmAngle(v, max);
    omega = ease(omega, dt > 0 ? (na - lastA) / dt : 0, 25);
    lastA = na;
    red = ease(red, v >= redline ? 1 : 0, 14);
    lim = ease(lim, v >= LIMIT_AT * redline ? 1 : 0, 25);

    const pulse = 0.5 + 0.5 * Math.sin(time * Math.PI * 2 * 5);
    const heat = red * pulse;
    const strobe = (time * 16) % 1 < 0.5;
    const glow = pal.glow;
    const redA = rpmAngle(redline, max);
    const end = A0 + SWEEP;

    ctx.save();
    if (lim > 0.01) {
      const a = r * 0.03 * lim;
      ctx.translate(Math.sin(time * 91) * a, Math.sin(time * 67 + 1) * a);
    }
    ctx.lineCap = 'butt';

    // bezel, red-zone heat halo, limiter strobe
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = r * 0.03;
    ctx.strokeStyle = pal.dim;
    ctx.globalAlpha = 0.45;
    ctx.stroke();
    if (heat > 0.01) {
      ctx.strokeStyle = ctx.shadowColor = pal.accent;
      ctx.shadowBlur = r * 0.4 * glow * heat;
      ctx.globalAlpha = heat * 0.9;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    if (lim > 0.05 && strobe) {
      ctx.fillStyle = pal.accent;
      ctx.globalAlpha = 0.2 * lim;
      ctx.fill();
    }

    // track, progress, red zone
    const tw = r * 0.1;
    ctx.lineWidth = tw;
    ctx.strokeStyle = pal.dim;
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.arc(cx, cy, r, A0, end);
    ctx.stroke();
    if (na > A0) {
      ctx.strokeStyle = pal.accent2;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(cx, cy, r, A0, Math.min(na, redA));
      ctx.stroke();
    }
    ctx.strokeStyle = ctx.shadowColor = pal.accent;
    ctx.shadowBlur = r * 0.3 * glow * heat;
    ctx.globalAlpha = 0.55 + 0.45 * Math.max(heat, v >= redline ? 0.6 : 0);
    ctx.lineWidth = tw * (1 + 0.35 * heat);
    ctx.beginPath();
    ctx.arc(cx, cy, r, redA, end);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // ticks every 500, numbers every 1000
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = pal.text;
    ctx.lineWidth = r * 0.035;
    ctx.beginPath();
    for (let k = 0; k <= max; k += 1000) tick(ctx, cx, cy, rpmAngle(k, max), r * 0.76, r * 0.9);
    ctx.stroke();
    ctx.strokeStyle = pal.dim;
    ctx.lineWidth = r * 0.02;
    ctx.beginPath();
    for (let k = 500; k < max; k += 1000) tick(ctx, cx, cy, rpmAngle(k, max), r * 0.82, r * 0.9);
    ctx.stroke();
    ctx.font = `${Math.max(11, r * 0.17)}px ${DISPLAY}`; // floor keeps small windows readable
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let k = 0; k <= max; k += 1000) {
      const a = rpmAngle(k, max);
      ctx.fillStyle = k >= redline ? pal.accent : pal.text;
      ctx.fillText(String(k / 1000), cx + Math.cos(a) * r * 0.63, cy + Math.sin(a) * r * 0.63);
    }

    // centre readout: gear punches in on change, speed below in the arc gap
    const pk = punch / PUNCH_S;
    if (pk < 1) {
      ctx.strokeStyle = pal.accent2;
      ctx.globalAlpha = (1 - pk) * 0.9;
      ctx.lineWidth = r * 0.05 * (1 - pk);
      ctx.beginPath();
      ctx.arc(cx, cy - r * 0.06, r * (0.22 + 0.32 * Math.sqrt(pk)), 0, Math.PI * 2);
      ctx.stroke();
    }
    const gs = 1 + 0.7 * (1 - easeOutElastic(pk));
    const limFlash = lim > 0.5 && strobe;
    slanted(ctx, s.gear, cx, cy - r * 0.06, r * 0.62 * gs, limFlash ? pal.accent : pal.text, {
      glow: limFlash ? pal.accent : pal.accent2,
      blur: r * 0.12 * glow * (pk < 1 ? 1 + 2 * (1 - pk) : 0.6),
    });
    slanted(ctx, String(Math.round(s.speedKmh)), cx, cy + r * 0.53, r * 0.24, pal.text, {});
    ctx.globalAlpha = 0.9;
    ctx.font = `italic 800 ${r * 0.1}px ${LABEL}`;
    ctx.fillStyle = pal.dim;
    ctx.fillText('km/h', cx, cy + r * 0.75);

    // needle floats outside the readout; smear + ghosts scale with angular velocity
    const r0 = r * 0.4;
    const r1 = r * 0.97;
    const trail = clamp(omega * 0.045, -0.9, 0.9);
    const tm = Math.abs(trail);
    if (tm > 0.005) {
      ctx.fillStyle = pal.text;
      ctx.globalAlpha = 0.22 * Math.min(1, tm / 0.3);
      ctx.beginPath();
      ctx.arc(cx, cy, r1, na - trail, na, trail < 0);
      ctx.arc(cx, cy, r0, na, na - trail, trail > 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = pal.text;
      ctx.lineWidth = r * 0.03;
      for (let i = 1; i <= 3; i++) {
        ctx.globalAlpha = 0.45 * (1 - i / 4) * Math.min(1, tm / 0.15);
        ctx.beginPath();
        tick(ctx, cx, cy, na - (trail * i) / 3, r0, r1);
        ctx.stroke();
      }
    }
    const c = Math.cos(na);
    const sn = Math.sin(na);
    const w0 = r * 0.04;
    const w1 = r * 0.01;
    ctx.globalAlpha = 1;
    ctx.fillStyle = pal.text;
    ctx.shadowColor = pal.accent;
    ctx.shadowBlur = r * 0.12 * glow * (0.5 + heat);
    ctx.beginPath();
    ctx.moveTo(cx + c * r0 - sn * w0, cy + sn * r0 + c * w0);
    ctx.lineTo(cx + c * r1 - sn * w1, cy + sn * r1 + c * w1);
    ctx.lineTo(cx + c * r1 + sn * w1, cy + sn * r1 - c * w1);
    ctx.lineTo(cx + c * r0 + sn * w0, cy + sn * r0 - c * w0);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    // shift LEDs: slanted segments on a plate above the arc
    const lit = litLeds(v, redline);
    const flash = v >= FLASH_AT * redline;
    const mid = blendHot(pal.accent2, pal.accent);
    const h = r * 0.13;
    const gap = r * 0.045;
    const rowW = r * 1.9;
    const lw = (rowW - gap * (LEDS - 1)) / LEDS;
    const y = cy - r * 1.3 - gap - h; // plate clears the bezel (r * 1.2) by r * 0.1
    const sk = -SKEW * h;
    ctx.globalAlpha = 1;
    ctx.fillStyle = INK;
    para(
      ctx,
      cx - rowW / 2 - gap * 1.5,
      y - gap,
      rowW + gap * 3,
      h + gap * 2,
      sk * (1 + (2 * gap) / h),
    );
    for (let i = 0; i < LEDS; i++) {
      const on = flash ? strobe : i < lit;
      const col = flash
        ? pal.accent
        : i < LEDS * 0.4
          ? pal.accent2
          : i < LEDS * 0.7
            ? mid
            : pal.accent;
      const x = cx - rowW / 2 + i * (lw + gap);
      // lit: full colour, halo and a hot core; unlit: tinted dark glass with a top glint
      ctx.fillStyle = col;
      ctx.globalAlpha = on ? 1 : 0.24;
      if (on) {
        ctx.shadowColor = col;
        ctx.shadowBlur = r * 0.32 * glow;
      }
      para(ctx, x, y, lw, h, sk);
      ctx.shadowBlur = 0;
      ctx.fillStyle = on ? '#ffffff' : pal.text;
      ctx.globalAlpha = on ? 0.5 : 0.14;
      para(ctx, x + sk * 0.6 + lw * 0.12, y + h * 0.12, lw * 0.76, h * 0.28, sk * 0.28);
    }
    ctx.restore();
  }

  return { draw, reset };
}

function tick(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  a: number,
  r0: number,
  r1: number,
) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  ctx.moveTo(cx + c * r0, cy + s * r0);
  ctx.lineTo(cx + c * r1, cy + s * r1);
}

/** Parallelogram with bottom-left at (x, y + h), top edge shifted right by sk. */
function para(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  sk: number,
) {
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x + sk, y);
  ctx.lineTo(x + sk + w, y);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
}

function slanted(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  o: { glow?: string; blur?: number },
) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.translate(x, y);
  ctx.transform(1, 0, SKEW, 1, 0, 0);
  ctx.font = `${size}px ${DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, size * 0.14);
  ctx.strokeStyle = OUTLINE;
  ctx.strokeText(s, 0, 0);
  if (o.glow && o.blur) {
    ctx.shadowColor = o.glow;
    ctx.shadowBlur = o.blur;
  }
  ctx.fillStyle = fill;
  ctx.fillText(s, 0, 0);
  ctx.restore();
}
