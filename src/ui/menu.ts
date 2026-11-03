import type { HudView, MenuRow, MenuView, UiContext } from '../view';
import { drawCar } from '../sprites';
import type { Look } from '../cosmetics';
import { drawSlot } from './garage';
import { PLAYER_MODELS } from '../models';
import { cachedGrad, DISPLAY, drawBackdrop, drawOverlayFx, MASTHEAD, OSD, THEMES } from './theme';
import { drawLogo } from './logo';
import { glyph, hintLine, type Action } from './prompts';

const CAR_HALF = 3; // m, half-size of the cached preview square (fits the longest car rotated)
const CAR_PX = 96; // px per m in the cache
const carCache = new Map<string, HTMLCanvasElement>();

/** Car with its warm rim glow, rendered once per model|color (blur is costly per frame). */
export function carImage(
  model: Parameters<typeof drawCar>[1],
  color: string,
  look: Look,
): HTMLCanvasElement {
  const key = `${model}|${color}|${JSON.stringify(look)}`;
  let c = carCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = 2 * CAR_HALF * CAR_PX;
    const g = c.getContext('2d')!;
    g.translate(c.width / 2, c.height / 2);
    g.scale(CAR_PX, CAR_PX);
    g.shadowColor = 'rgba(255,225,170,0.9)';
    g.shadowBlur = (1.1 / 13) * CAR_PX; // same glow as 1.1 u at scale 13 u/m
    drawCar(g, model, color, look);
    carCache.set(key, c);
  }
  return c;
}

const SKEW = -0.2;
const HAZARD = '#ffd23f';
const INK = '#120a06';
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (p: number): number => 1 - (1 - clamp01(p)) ** 3;

// ---------- per-frame context and animation state (module-local, reused every frame) ----------

const F = { th: THEMES.arcade, u: 1, w: 0, h: 0, now: 0 };
const A = {
  screen: '',
  tab: -1,
  open: 0, // screen opened
  rowsOpen: 0, // rows (re)entered: screen open or tab switch
  from: 0, // highlight slides from this row index...
  to: 0, // ...to this one
  at: -1, // slide start, -1 = snapped
  boot: -1, // first title frame, drives the logo intro once
  last: -1, // previous menu frame
  model: '',
  modelAt: 0,
};
const SLIDE = 0.18; // s, highlight travel between rows

function selPos(now: number): number {
  return A.at < 0 ? A.to : A.from + (A.to - A.from) * ease((now - A.at) / SLIDE);
}

function track(m: MenuView, now: number): void {
  const tab = m.tabs ? m.tabs.active : -1;
  if (m.screen !== A.screen || now - A.last > 0.3) {
    A.screen = m.screen;
    A.tab = tab;
    A.open = A.rowsOpen = now;
    A.from = A.to = m.row;
    A.at = -1;
  } else if (tab !== A.tab) {
    A.tab = tab;
    A.rowsOpen = now;
  }
  if (m.row !== A.to) {
    A.from = selPos(now);
    A.to = m.row;
    A.at = now;
  }
  if (m.garage && m.garage.model !== A.model) {
    A.model = m.garage.model;
    A.modelAt = now;
  }
  if (A.boot < 0 && m.screen === 'title') A.boot = now;
  A.last = now;
}

/** Staggered entrance of item i, 0..1. */
const enter = (i: number, base: number): number => ease((F.now - base - i * 0.05) / 0.36);

// ---------- hints: built once per device change ----------

const TITLE_HINTS: [Action, string][] = [
  ['navigate', 'move'],
  ['adjust', 'map'],
  ['confirm', 'select'],
];
const DRIVE_HINTS: [Action, string][] = [
  ['throttle', 'gas'],
  ['brake', 'brake'],
  ['steer', 'steer'],
  ['handbrake', 'handbrake'],
  ['clutch', 'clutch'],
  ['pause', 'pause'],
];
const SETTINGS_HINTS: [Action, string][] = [
  ['navigate', 'move'],
  ['adjust', 'change'],
  ['tabs', 'tab'],
  ['confirm', 'select'],
  ['back', 'back'],
];
const GARAGE_HINTS: [Action, string][] = [
  ['navigate', 'slot'],
  ['adjust', 'change'],
  ['tune', 'tune'],
  ['rev', 'rev'],
  ['confirm', 'select'],
  ['back', 'back'],
];
const STARTER_HINTS: [Action, string][] = [
  ['adjust', 'car'],
  ['confirm', 'choose'],
];
const PICK_HINTS: [Action, string][] = [
  ['confirm', 'use car pick'],
  ['back', 'cancel'],
];
const H = {
  starter: '',
  pick: '',
  device: '',
  pad: '',
  title: '',
  drive: '',
  settings: '',
  garage: '',
  tabL: '',
  tabR: '',
};

function hintsFor(ui: UiContext): typeof H {
  if (ui.device !== H.device || ui.padStyle !== H.pad) {
    H.device = ui.device;
    H.pad = ui.padStyle;
    H.title = hintLine(TITLE_HINTS, ui.device, ui.padStyle);
    H.drive = hintLine(DRIVE_HINTS, ui.device, ui.padStyle);
    H.settings = hintLine(SETTINGS_HINTS, ui.device, ui.padStyle);
    H.garage = hintLine(GARAGE_HINTS, ui.device, ui.padStyle);
    H.starter = hintLine(STARTER_HINTS, ui.device, ui.padStyle);
    H.pick = hintLine(PICK_HINTS, ui.device, ui.padStyle);
    [H.tabL, H.tabR] = glyph('tabs', ui.device, ui.padStyle).split('/');
  }
  return H;
}

// ---------- primitives ----------

function text(
  g: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  font: string,
  fill: string,
  align: CanvasTextAlign = 'left',
): void {
  g.font = font;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillStyle = fill;
  g.fillText(s, x, y);
}

/** Font px that makes s fit maxW, at most px. */
function fitPx(
  g: CanvasRenderingContext2D,
  s: string,
  font: string,
  px: number,
  maxW: number,
): number {
  g.font = font;
  const mw = g.measureText(s).width;
  return mw > maxW ? (px * maxW) / mw : px;
}

const vhs = (): boolean => F.th.id === 'vhs';
/** Row label face: italic theme face in Arcade, condensed masthead cover lines in VHS. */
const labelFont = (px: number): string =>
  vhs() ? `400 ${px * 1.12}px ${MASTHEAD}` : F.th.font(700, px, true);
const valueFont = (px: number): string => F.th.font(700, px, vhs());

/** Row plate centered on (cx, cy): skewed slab in Arcade, ruled magazine slab in VHS. */
function plate(g: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number): void {
  const { th, u } = F;
  if (th.id === 'vhs') {
    g.fillStyle = th.panel;
    g.fillRect(cx - w / 2, cy - h / 2, w, h);
    g.fillStyle = 'rgba(245,231,204,0.4)';
    g.fillRect(cx - w / 2, cy - h / 2, w, Math.max(1, 0.18 * u));
    return;
  }
  g.save();
  g.transform(1, 0, SKEW, 1, cx, cy);
  g.fillStyle = th.panel;
  g.fillRect(-w / 2, -h / 2, w, h);
  g.globalAlpha *= 0.55;
  g.fillStyle = th.accent;
  g.fillRect(-w / 2, -h / 2, h * 0.1, h);
  g.restore();
}

/** Selection: slides between rows, pops on arrival, pulses while idle. */
function highlight(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  alpha: number,
): void {
  const { th, u, now } = F;
  const pop = A.at < 0 ? 0 : 1 - ease((now - A.at) / 0.3);
  const ph = h * (1 + 0.14 * pop);
  const pulse = 0.5 + 0.5 * Math.sin(now * 4.2);
  g.save();
  g.globalAlpha = alpha;
  if (th.id === 'vhs') {
    g.globalAlpha = alpha * (0.86 + 0.14 * pulse);
    g.fillStyle = th.panelSel;
    g.fillRect(cx - w / 2, cy - ph / 2, w, ph);
    g.fillStyle = th.accent;
    g.fillRect(cx - w / 2, cy - ph / 2, 0.9 * u, ph);
    // VCR menu cursor, blinking like an on-screen display
    if ((now * 1.5) % 1 < 0.62) {
      g.globalAlpha = alpha;
      text(g, '▶', cx - w / 2 - 1.2 * u, cy, `400 ${h * 0.8}px ${OSD}`, th.text, 'right');
    }
  } else {
    g.transform(1, 0, SKEW, 1, cx, cy);
    g.shadowColor = th.accent;
    g.shadowBlur = (1.2 + 1.6 * pulse + 3 * pop) * u * th.glow;
    g.fillStyle = th.panelSel;
    g.fillRect(-w / 2, -ph / 2, w, ph);
    g.shadowBlur = 0;
    g.fillStyle = th.accent2;
    g.fillRect(-w / 2, -ph / 2, h * 0.14, ph);
    // twin slashes ahead of the plate, nudging toward it
    const off = (1 - pulse) * 1.2 * u + pop * 3 * u;
    for (let k = 0; k < 2; k++) {
      g.globalAlpha = alpha * (k ? 0.5 : 1);
      g.fillRect(-w / 2 - (2.6 + 1.8 * k) * u - off, -h * 0.3, 0.9 * u, h * 0.6);
    }
  }
  g.restore();
}

function hints(g: CanvasRenderingContext2D, line: string, line2: string): void {
  const { th, u, w, h } = F;
  const bandH = (line2 ? 8.6 : 5.4) * u;
  g.fillStyle = th.panel;
  g.fillRect(0, h - bandH, w, bandH);
  g.fillStyle = th.id === 'vhs' ? 'rgba(245,231,204,0.45)' : 'rgba(46,242,255,0.4)';
  g.fillRect(0, h - bandH, w, Math.max(1, 0.2 * u));
  g.globalAlpha = 0.88;
  for (let i = 0; i < 2; i++) {
    const s = i ? line2 : line;
    if (!s) continue;
    const px = fitPx(g, s, th.font(600, 2.4 * u), 2.4 * u, w - 4 * u);
    const y = h - (line2 && !i ? 6.1 : 2.7) * u;
    text(g, s, w / 2, y, th.font(600, px), i ? th.dim : th.text, 'center');
  }
  g.globalAlpha = 1;
}

/** Screen heading: neon slab in Arcade, ruled section head in VHS. */
function heading(
  g: CanvasRenderingContext2D,
  s: string,
  cx: number,
  y: number,
  rule: number,
): void {
  const { th, u } = F;
  const e = enter(0, A.open);
  g.save();
  g.globalAlpha = e;
  if (th.id === 'vhs') {
    g.font = `400 ${10 * u}px ${MASTHEAD}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = th.accent2;
    g.fillText(s, cx + 0.5 * u, y + 0.5 * u);
    g.fillStyle = th.text;
    g.fillText(s, cx, y);
    g.fillRect(cx - (rule / 2) * e, y + 4.6 * u, rule * e, Math.max(1, 0.3 * u));
  } else {
    g.translate(cx + (1 - e) * -12 * u, y);
    g.transform(1, 0, SKEW, 1, 0, 0);
    g.font = `400 ${7.4 * u}px ${DISPLAY}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 0.7 * u;
    g.strokeStyle = th.accent;
    g.shadowColor = th.accent;
    g.shadowBlur = 2 * u * th.glow;
    g.strokeText(s, 0, 0);
    g.shadowBlur = 0;
    g.fillStyle = th.text;
    g.fillText(s, 0, 0);
  }
  g.restore();
}

// ---------- rows ----------

/**
 * Plates, highlight and text for a list. `first` is the entrance/highlight index of list[0]
 * (settings puts the tab strip at 0); `hi` is the animated highlight index.
 */
function rows(
  g: CanvasRenderingContext2D,
  list: MenuRow[],
  sel: number,
  top: number,
  step: number,
  first: number,
  base: number,
  hi: number,
): void {
  const { th, u, w } = F;
  const pw = Math.min(72 * u, w * 0.94);
  const ph = Math.min(8 * u, step - 1.2 * u);
  const cx = w / 2;
  const lf = labelFont(3.6 * u);
  const vf = valueFont(3 * u);
  // label column | gap | bar column | gap | value column, measured on bar rows only so
  // other values (MUSIC, reset prompt) do not resize the bars
  let labelW = 0;
  let valW = 0;
  g.font = lf;
  for (const r of list)
    if (r.bar !== undefined) labelW = Math.max(labelW, g.measureText(r.label).width);
  g.font = vf;
  for (const r of list)
    if (r.bar !== undefined && r.value) valW = Math.max(valW, g.measureText(r.value).width);
  const dx = vhs() ? 6 * u : -26 * u; // entrance: VHS eases in, Arcade skids in from the left

  for (let i = 0; i < list.length; i++) {
    const e = enter(i + first, base);
    g.globalAlpha = e;
    plate(g, cx + (1 - e) * dx, top + i * step, pw, ph);
  }
  g.globalAlpha = 1;
  highlight(g, cx, top + (hi - first) * step, pw, ph, enter(0, A.open));

  const onLabel = vhs() ? th.text : '#ffffff';
  const offVal = vhs() ? th.accent : th.accent2;
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    const e = enter(i + first, base);
    if (e <= 0) continue;
    g.globalAlpha = e;
    const y = top + i * step;
    const on = i === sel;
    const x0 = cx - pw / 2 + 3.4 * u + (1 - e) * dx;
    const x1 = cx + pw / 2 - 3 * u + (1 - e) * dx;
    text(g, r.label, x0, y, lf, on ? onLabel : th.text);
    if (r.bar !== undefined) {
      const bx = x0 + labelW + 4 * u;
      const bw = Math.max(6 * u, x1 - valW - 3 * u - bx);
      const bh = 1.6 * u;
      g.fillStyle = 'rgba(255,255,255,0.16)';
      g.fillRect(bx, y - bh / 2, bw, bh);
      g.fillStyle = on ? (vhs() ? th.text : th.accent2) : th.accent;
      g.fillRect(bx, y - bh / 2, bw * r.bar, bh);
      // tick marks every 10 %
      g.fillStyle = 'rgba(0,0,0,0.35)';
      for (let k = 1; k < 10; k++)
        g.fillRect(bx + (bw * k) / 10, y - bh / 2, Math.max(1, 0.2 * u), bh);
    }
    if (r.value) text(g, r.value, x1, y, vf, on ? onLabel : offVal, 'right');
  }
  g.globalAlpha = 1;
}

/** Settings rows (strip included, n total): start y and step so the last row clears the hint line. */
export function settingsLayout(h: number, u: number, n: number): { top: number; step: number } {
  const bottom = h - 9 * u;
  const minTop = h * 0.14 + 7 * u; // under the SETTINGS title
  const top = Math.max(minTop, Math.min(h * 0.25, bottom - (n - 1) * 7.8 * u));
  return { top, step: Math.min(7.8 * u, (bottom - top) / (n - 1)) };
}

function tabStrip(
  g: CanvasRenderingContext2D,
  names: string[],
  active: number,
  on: boolean,
  y: number,
  h: number,
  hk: typeof H,
): void {
  const { th, u, w } = F;
  const pw = Math.min(72 * u, w * 0.94);
  const cx = w / 2;
  const e = enter(0, A.open);
  g.globalAlpha = e;
  const kf = th.font(700, 2.4 * u);
  const keyCol = on ? th.text : th.dim;
  text(g, hk.tabL, cx - pw / 2 + 3.6 * u, y, kf, keyCol, 'center');
  text(g, hk.tabR, cx + pw / 2 - 3.6 * u, y, kf, keyCol, 'center');
  const cw = (pw - 14 * u) / names.length;
  const nf = vhs() ? labelFont(3.2 * u) : th.font(700, 3.2 * u, true);
  for (let i = 0; i < names.length; i++) {
    const x = cx - pw / 2 + 7 * u + cw * (i + 0.5);
    const cur = i === active;
    if (vhs()) {
      if (cur) {
        g.fillStyle = th.text;
        g.fillRect(x - cw * 0.42, y - h * 0.34, cw * 0.84, h * 0.68);
      }
      text(g, names[i], x, y, nf, cur ? INK : on ? th.text : th.dim, 'center');
    } else {
      const col = cur ? (on ? '#ffffff' : th.accent2) : on ? 'rgba(255,255,255,0.7)' : th.dim;
      text(g, names[i], x, y, nf, col, 'center');
      if (cur) {
        g.fillStyle = col;
        g.fillRect(x - cw * 0.28, y + h * 0.3, cw * 0.56, 0.5 * u);
      }
    }
  }
  g.globalAlpha = 1;
}

// ---------- garage ----------

function hazardBadge(g: CanvasRenderingContext2D, s: string, x: number, y: number): void {
  const { th, u, now } = F;
  const slap = ease((now - A.modelAt) / 0.22);
  const font = th.font(800, 2.3 * u);
  g.font = font;
  const tw = g.measureText(s).width;
  const end = 3.2 * u; // striped end caps
  const bw = tw + 2 * end + 2.4 * u;
  const bh = 4.4 * u;
  g.save();
  g.translate(x - bw / 2, y);
  g.rotate(vhs() ? 0.045 : -0.055);
  g.scale(1 + (1 - slap) * 0.5, 1 + (1 - slap) * 0.5);
  g.globalAlpha = slap;
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fillRect(-bw / 2 + 0.5 * u, -bh / 2 + 0.6 * u, bw, bh);
  g.fillStyle = HAZARD;
  g.fillRect(-bw / 2, -bh / 2, bw, bh);
  // black diagonal stripes in both end caps
  g.save();
  g.beginPath();
  g.rect(-bw / 2, -bh / 2, end, bh);
  g.rect(bw / 2 - end, -bh / 2, end, bh);
  g.clip();
  g.fillStyle = INK;
  g.beginPath();
  for (let sx = -bw / 2 - bh; sx < bw / 2 + bh; sx += 1.6 * u) {
    g.moveTo(sx, bh / 2);
    g.lineTo(sx + 0.8 * u, bh / 2);
    g.lineTo(sx + 0.8 * u + bh, -bh / 2);
    g.lineTo(sx + bh, -bh / 2);
  }
  g.fill();
  g.restore();
  g.strokeStyle = INK;
  g.lineWidth = Math.max(1, 0.25 * u);
  g.strokeRect(-bw / 2 + 0.4 * u, -bh / 2 + 0.4 * u, bw - 0.8 * u, bh - 0.8 * u);
  text(g, s, 0, 0.1 * u, font, INK, 'center');
  g.restore();
}

function bar(
  g: CanvasRenderingContext2D,
  label: string,
  v: number,
  x0: number,
  x1: number,
  y: number,
): void {
  const { th, u } = F;
  text(g, label, x0, y, th.font(700, 2.4 * u), th.dim);
  const bx = x0 + 13 * u;
  const bw = x1 - bx;
  const bh = 1.6 * u;
  g.fillStyle = 'rgba(255,255,255,0.16)';
  g.fillRect(bx, y - bh / 2, bw, bh);
  g.fillStyle = vhs() ? th.accent : th.accent2;
  g.fillRect(bx, y - bh / 2, bw * (0.08 + 0.92 * v), bh);
  g.fillStyle = 'rgba(0,0,0,0.4)';
  for (let k = 1; k < 10; k++) g.fillRect(bx + (bw * k) / 10, y - bh / 2, Math.max(1, 0.2 * u), bh);
}

function drawGarage(
  g: CanvasRenderingContext2D,
  m: NonNullable<MenuView['garage']>,
  title: string,
  hint: string,
  row: number,
  hint2: string,
): void {
  const { th, u, w, h, now } = F;
  const arcade = th.id === 'arcade';
  const bottom = h - 8 * u;
  const wide = w >= h * 1.05;
  const cw = wide ? Math.min(72 * u, w * 0.46) : Math.min(76 * u, w - 8 * u);
  const ch = 68 * u;
  let cardX: number, cardY: number, carX: number, carY: number, carR: number;
  if (wide) {
    cardX = w - 5 * u - cw;
    cardY = Math.max(16 * u, (10 * u + bottom - ch) / 2);
    carX = cardX / 2 + 1.5 * u;
    carY = h * 0.53;
    carR = Math.min(cardX * 0.48, h * 0.4);
  } else {
    cardX = (w - cw) / 2;
    cardY = bottom - ch;
    carX = w / 2;
    carY = (cardY + 25 * u) / 2; // below the heading and the VHS tape counter
    carR = Math.min((cardY - 27 * u) / 2, w * 0.45);
  }
  const scale = Math.min(13 * u, carR / 2.5);
  const open = enter(0, A.open);

  // turntable: lit floor disc so dark paints separate, ring on top
  const R = scale * 2.7;
  g.save();
  g.translate(carX, carY);
  g.scale(1, 0.55);
  g.globalAlpha = open;
  g.fillStyle = cachedGrad(g, `m-disc|${th.id}|${R}`, () => {
    const d = g.createRadialGradient(0, 0, 0, 0, 0, R);
    d.addColorStop(0, arcade ? 'rgba(170,160,255,0.6)' : 'rgba(255,220,160,0.6)');
    d.addColorStop(0.7, arcade ? 'rgba(255,47,180,0.2)' : 'rgba(228,112,42,0.24)');
    d.addColorStop(1, 'rgba(0,0,0,0)');
    return d;
  });
  g.beginPath();
  g.arc(0, 0, R, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = arcade ? th.accent2 : th.accent;
  g.lineWidth = 0.4 * u;
  g.shadowColor = g.strokeStyle;
  g.shadowBlur = 1.5 * u * th.glow;
  g.globalAlpha = open * 0.7;
  g.beginPath();
  g.arc(0, 0, R * 0.86, 0, Math.PI * 2);
  g.stroke();
  g.shadowBlur = 0;
  g.restore();
  // car, slowly rotating, grows in on open
  const car = carImage(m.model, m.color, m.look);
  g.save();
  g.translate(carX, carY);
  g.rotate(now * 0.5);
  const s = scale * (0.85 + 0.15 * open);
  g.scale(s, s);
  g.globalAlpha = open;
  if (m.lock) g.filter = 'grayscale(1) brightness(0.45)';
  g.drawImage(car, -CAR_HALF, -CAR_HALF, 2 * CAR_HALF, 2 * CAR_HALF);
  g.restore();
  if (m.lock) {
    padlock(g, carX, carY, scale * 0.9);
    const n = m.lock.picks;
    const note = m.lock.offer
      ? `USE CAR PICK?  ${n} LEFT`
      : n > 0
        ? `LOCKED · ${n} CAR PICK${n > 1 ? 'S' : ''}`
        : 'WIN 1ST ON A MAP OR CLEAR 3 DAILIES';
    const f = th.font(800, 2.6 * u);
    const px = fitPx(g, note, f, 2.6 * u, wide ? cardX - 6 * u : w - 8 * u);
    const y = carY + R * 0.62 + 3 * u;
    text(g, note, carX, y, th.font(800, px), m.lock.offer ? HAZARD : th.text, 'center');
  }

  // spec card
  const e = enter(2, A.open);
  g.save();
  g.globalAlpha = e;
  g.translate(wide ? (1 - e) * 18 * u : 0, wide ? 0 : (1 - e) * 14 * u);
  const x = cardX;
  const y = cardY;
  const x0 = x + 3.4 * u;
  const x1 = x + cw - 3.4 * u;
  g.fillStyle = th.panel;
  if (arcade) {
    const cut = 4 * u;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + cw - cut, y);
    g.lineTo(x + cw, y + cut);
    g.lineTo(x + cw, y + ch);
    g.lineTo(x, y + ch);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(46,242,255,0.35)';
    g.lineWidth = Math.max(1, 0.2 * u);
    g.stroke();
    g.fillStyle = th.accent;
    g.fillRect(x, y, cw * 0.38, 0.8 * u);
  } else {
    g.fillRect(x, y, cw, ch);
    g.fillStyle = th.text;
    g.fillRect(x, y, cw, 0.8 * u);
    g.fillRect(x, y + ch - Math.max(1, 0.2 * u), cw, Math.max(1, 0.2 * u));
  }

  const name = m.name.toUpperCase();
  const nameFont = (px: number): string =>
    arcade ? th.font(700, px, true) : `400 ${px * 1.2}px ${MASTHEAD}`;
  const npx = fitPx(g, name, nameFont(6 * u), 6 * u, x1 - x0);
  text(g, name, x0, y + 6.4 * u, nameFont(npx), th.text);
  g.fillStyle = arcade ? 'rgba(46,242,255,0.45)' : 'rgba(245,231,204,0.5)';
  g.fillRect(x0, y + 10.6 * u, x1 - x0, Math.max(1, 0.18 * u));
  const acc = arcade ? th.accent2 : th.accent;
  const sf = th.font(700, 2.6 * u);
  if (row === 0) {
    g.globalAlpha = e * 0.2;
    g.fillStyle = acc;
    g.fillRect(x0 - 1.2 * u, y + 11.8 * u, x1 - x0 + 2.4 * u, 4 * u);
    g.globalAlpha = e;
  }
  text(g, `◀  ${m.index + 1} / ${m.count}  ▶`, x0, y + 13.8 * u, sf, acc);
  text(g, 'TUNE', x0, y + 18.4 * u, th.font(700, 2.4 * u), th.dim);
  text(g, `◀ ${m.tune.toUpperCase()} ▶`, x1, y + 18.4 * u, sf, th.text, 'right');
  m.slots.forEach((r, i) =>
    drawSlot(g, th, u, r, row === i + 1, x0, x1, y + (22.8 + i * 4.2) * u, acc),
  );
  if (m.slotLock) text(g, `LOCKED: ${m.slotLock}`, x0, y + 52.4 * u, th.font(700, 2.2 * u), acc);
  bar(g, 'POWER', m.stats.power, x0, x1, y + 57 * u);
  bar(g, 'GRIP', m.stats.grip, x0, x1, y + 60.8 * u);
  bar(g, 'WEIGHT', m.stats.weight, x0, x1, y + 64.6 * u);
  const tag = PLAYER_MODELS[m.model].tag;
  if (tag) hazardBadge(g, tag, x1 + 1.5 * u, y - 0.4 * u);
  g.restore();

  // page heading: over the card when side by side, over the car when stacked
  heading(
    g,
    title,
    wide ? cardX + cw / 2 : w / 2,
    wide ? cardY - 9 * u : 19 * u,
    wide ? 0 : 40 * u,
  );
  hints(g, hint, hint2);
}

/** Padlock centred on (x, y); s = body width in px. */
function padlock(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  g.save();
  g.translate(x, y);
  g.fillStyle = g.strokeStyle = HAZARD;
  g.lineWidth = s * 0.18;
  g.beginPath();
  g.moveTo(-s * 0.3, s * 0.05);
  g.arc(0, -s * 0.15, s * 0.3, Math.PI, 0);
  g.lineTo(s * 0.3, s * 0.05);
  g.stroke();
  g.fillRect(-s * 0.5, 0, s, s * 0.75);
  g.fillStyle = INK;
  g.beginPath();
  g.arc(0, s * 0.3, s * 0.1, 0, Math.PI * 2);
  g.fill();
  g.fillRect(-s * 0.04, s * 0.3, s * 0.08, s * 0.25);
  g.restore();
}

/** Short notice at the top of the screen. */
function toast(g: CanvasRenderingContext2D, s: string): void {
  const { th, u, w } = F;
  const y = 8 * u;
  const f = th.font(800, 3 * u);
  g.font = f;
  const tw = g.measureText(s).width + 6 * u;
  g.fillStyle = HAZARD;
  g.fillRect(w / 2 - tw / 2, y - 2.8 * u, tw, 5.6 * u);
  text(g, s, w / 2, y, f, INK, 'center');
}

// ---------- title ----------

let bestVal = -1;
let bestStr = '';

function drawTitle(g: CanvasRenderingContext2D, v: HudView, m: MenuView, hk: typeof H): void {
  const { th, u, w, h, now } = F;
  const step = 10 * u;
  const ph = 8 * u;
  const hintTop = h - 8.6 * u;
  // logo spans about -1.1 S (VHS rule) .. +1.35 S (kana / strapline); VHS stamp needs ~5.4 S wide
  const top = 12 * u;
  const Sw = Math.min((w * 0.9) / 5.4, 24 * u);
  // tall windows: center logo + rows as one block; short ones: rows sit low, logo shrinks
  const block = 2.5 * Sw + 4 * u + ph + 2 * step + 7.6 * u;
  const rowsTop = Math.min(
    h * 0.5 + 10 * u,
    hintTop - 9 * u - ph / 2 - 2 * step,
    top + Math.max(0, hintTop - top - block) * 0.42 + 2.5 * Sw + 4 * u + ph / 2,
  );
  const S = Math.max(4 * u, Math.min(Sw, (rowsTop - ph / 2 - 4 * u - top) / 2.5));
  const cy = rowsTop - ph / 2 - 4 * u - 1.35 * S;
  drawLogo(g, w / 2, cy, S, now - A.boot, th);
  if (th.id === 'vhs') {
    // cover strapline under the masthead
    const e = clamp01((now - A.boot - 1.3) / 0.4);
    g.globalAlpha = e;
    text(
      g,
      'Drift. Chain. Bank.',
      w / 2 - 2.2 * S,
      cy + 0.98 * S,
      th.font(800, 0.24 * S, true),
      th.text,
    );
    g.globalAlpha = 1;
  }
  rows(g, m.rows, m.row, rowsTop, step, 0, A.rowsOpen, selPos(now));
  if (v.par > 0) {
    if (v.best !== bestVal) {
      bestVal = v.best;
      bestStr = `BEST  ${Math.round(v.best).toLocaleString('en-US')}`;
    }
    g.globalAlpha = enter(3, A.open);
    text(
      g,
      bestStr,
      w / 2,
      rowsTop + 2 * step + ph / 2 + 3.6 * u,
      th.font(700, 3 * u, th.id === 'vhs'),
      th.id === 'vhs' ? th.accent : th.accent2,
      'center',
    );
    g.globalAlpha = 1;
  }
  hints(g, hk.title, hk.drive);
}

/** Draws title / garage / settings; returns false when no menu is active. */
export function drawMenu(
  ctx: CanvasRenderingContext2D,
  v: HudView,
  width: number,
  height: number,
): boolean {
  const m = v.menu;
  if (!m) return false;
  const now = performance.now() / 1000;
  F.th = THEMES[m.ui.theme] ?? THEMES.arcade;
  F.u = Math.min(width, height) / 100;
  F.w = width;
  F.h = height;
  F.now = now;
  const { th, u } = F;
  track(m, now);
  const hk = hintsFor(m.ui);
  const carScreen = m.screen === 'garage' || m.screen === 'starter';
  drawBackdrop(ctx, width, height, now, th, !carScreen); // attract scene behind
  if (carScreen) {
    const gm = m.garage;
    if (gm && m.screen === 'starter') drawGarage(ctx, gm, 'PICK YOUR STARTER', hk.starter, -1, '');
    else if (gm) drawGarage(ctx, gm, 'GARAGE', hk.garage, m.row, gm.lock?.offer ? hk.pick : '');
  } else if (m.screen === 'title') {
    drawTitle(ctx, v, m, hk);
  } else {
    const pw = Math.min(72 * u, width * 0.94);
    heading(ctx, 'SETTINGS', width / 2, height * 0.14, pw);
    const { top, step } = settingsLayout(height, u, m.rows.length + 1);
    const ph = Math.min(8 * u, step - 1.2 * u);
    if (m.tabs) {
      ctx.globalAlpha = enter(0, A.open);
      plate(ctx, width / 2, top, pw, ph);
      ctx.globalAlpha = 1;
    }
    rows(ctx, m.rows, m.row - 1, top + step, step, 1, A.rowsOpen, selPos(now));
    if (m.tabs) tabStrip(ctx, m.tabs.names, m.tabs.active, m.row === 0, top, ph, hk);
    hints(ctx, hk.settings, '');
  }
  if (m.toast) toast(ctx, m.toast);
  drawOverlayFx(ctx, width, height, now, th);
  return true;
}
