import type { GameMap, Rect, Vec } from '../types';

/**
 * Scenery drawn on top of a map: no collision, no scoring. Every item sits on one floor.
 * Angles follow the heading convention (0 = +x, positive = clockwise on screen).
 */
export type Decor = { floor: number } &
  /** painted floor text (bay numbers, level stencils); angle = text baseline direction */
  (
    | {
        kind: 'text';
        x: number;
        y: number;
        angle: number;
        text: string;
        size: number;
        color?: string;
      }
    /** painted straight lane arrow, 6 m long, pointing along angle */
    | { kind: 'arrow'; x: number; y: number; angle: number }
    /** hatched no-go paint */
    | { kind: 'hatch'; x: number; y: number; w: number; h: number; color?: string }
    /** oil stain, radius in m */
    | { kind: 'stain'; x: number; y: number; r: number }
    /** old tire marks: a pair of rubber lines along a polyline */
    | { kind: 'skid'; points: Vec[] }
    /** graffiti panel on a wall face or wall top; text runs along the long side */
    | { kind: 'graffiti'; x: number; y: number; w: number; h: number; seed: number; text?: string }
    /** neon tube from a to b; flicker 0..1 */
    | { kind: 'neon'; a: Vec; b: Vec; color: string; flicker?: number }
    /** soft overhead light pool */
    | { kind: 'pool'; x: number; y: number; r: number; color?: string }
    /** slanted light shaft: soft ellipse w x h, long axis along angle */
    | { kind: 'shaft'; x: number; y: number; w: number; h: number; angle: number }
    /** standing spectators facing angle, scattered around (x, y) */
    | { kind: 'crowd'; x: number; y: number; angle: number; n: number; seed: number }
    /** wet street asphalt over a rect: mottling, sheen streaks and puddles */
    | { kind: 'asphalt'; x: number; y: number; w: number; h: number; seed: number }
    /**
     * Painted line from (x, y) through `to` (lane lines; zebras via dash). top = drawn over the
     * solids (barrier tops, rails).
     */
    | {
        kind: 'paint';
        x: number;
        y: number;
        to: Vec[];
        w: number;
        color?: string;
        dash?: number[];
        top?: boolean;
      }
    /**
     * City block over its solids: rooftops split into lots, a sidewalk band `walk` m wide inside
     * the edge (the curb), `open` rects paved instead of built (plazas, alleys). `round` rounds
     * one corner (0 nw, 1 ne, 2 se, 3 sw) with radius r; concave = a bite of radius r centered on
     * that corner instead.
     */
    | {
        kind: 'block';
        x: number;
        y: number;
        w: number;
        h: number;
        walk: number;
        seed: number;
        round?: { corner: number; r: number; concave?: boolean };
        open?: Rect[];
      }
    /** lit shop front from (x, y), len m along angle; light spills to the left of angle */
    | {
        kind: 'front';
        x: number;
        y: number;
        angle: number;
        len: number;
        color: string;
        seed: number;
      }
    /** lit sign panel w x h centered at (x, y), long side along angle; made-up glyphs if no text */
    | {
        kind: 'sign';
        x: number;
        y: number;
        w: number;
        h: number;
        angle: number;
        color: string;
        text?: string;
        seed: number;
      }
    /** big video screen w x h, long side along angle, animated on the over layer */
    | { kind: 'screen'; x: number; y: number; w: number; h: number; angle: number; seed: number }
    /** row of n vending machines centered at (x, y), lit fronts facing angle */
    | { kind: 'vending'; x: number; y: number; angle: number; n: number; seed: number }
    | { kind: 'manhole'; x: number; y: number }
    // --- drive-thru kinds ---
    /** dry lot tarmac over a rect: worn patches and sealed cracks */
    | { kind: 'tarmac'; x: number; y: number; w: number; h: number; seed: number }
    /** opened hood on a parked car len x wid centered at (x, y), nose along angle */
    | {
        kind: 'hood';
        x: number;
        y: number;
        angle: number;
        len: number;
        wid: number;
        color: string;
        seed: number;
      }
    /** glowing crescent-moon logo, radius r */
    | { kind: 'moon'; x: number; y: number; r: number }
    /** food truck over its solid: w x h centered at (x, y), long side along angle, hatch on +y */
    | { kind: 'truck'; x: number; y: number; w: number; h: number; angle: number }
    /** string of warm bulbs along a polyline from (x, y) through `to` */
    | { kind: 'bulbs'; x: number; y: number; to: Vec[] }
    /** flat restaurant roof over its solid: parapet, plant, a fascia band in color */
    | { kind: 'roof'; x: number; y: number; w: number; h: number; color: string; seed: number }
  );
export type DecoratedMap = GameMap & { decor?: Decor[] };
/**
 * floor: static ground paint (under solids). wall: static, over solids.
 * light: static darkness cut (white alpha). glow: static colored light (additive).
 * over: per frame, additive (neon flicker, shimmer, phone screens).
 */
export type DecorLayer = 'floor' | 'wall' | 'light' | 'glow' | 'over';

type Ctx = CanvasRenderingContext2D;
type Of<K extends Decor['kind']> = Extract<Decor, { kind: K }>;

const PAINT = 'rgba(205,205,195,';
const SODIUM = '255,150,45';
const SKIN = ['#e0b896', '#c08a64', '#8a5a3c', '#f0cfb0'];
const CLOTHES = ['#15161a', '#2a2f3a', '#e8e6e0', '#b0263a', '#2a5a9a', '#d8b02a', '#3a3a3e'];
const SPRAY = ['#ff2d95', '#2de2ff', '#ffd23a', '#9b5cff', '#ff7a1a', '#f4f4ee'];
const TAGS = ['DRIFT', 'MEET', 'SLIDE', 'KAIDO', 'NOS', 'SKID'];

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** '#rrggbb' -> 'r,g,b' */
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',');

/** Text in world meters; font set in px at 10 px/m to dodge tiny-font quirks. */
function text(g: Ctx, s: string, size: number, fill: boolean) {
  g.save();
  g.scale(0.1, 0.1);
  g.font = `900 ${Math.round(size * 10)}px Impact, 'Arial Black', sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (fill) g.fillText(s, 0, 0);
  else g.strokeText(s, 0, 0);
  g.restore();
}

function drawText(g: Ctx, d: Of<'text'>) {
  g.save();
  g.translate(d.x, d.y);
  g.rotate(d.angle);
  g.fillStyle = d.color ?? `${PAINT}0.42)`;
  text(g, d.text, d.size, true);
  g.restore();
}

function drawArrow(g: Ctx, d: Of<'arrow'>) {
  g.save();
  g.translate(d.x, d.y);
  g.rotate(d.angle);
  g.fillStyle = `${PAINT}0.3)`;
  g.fillRect(-3, -0.3, 4, 0.6);
  g.beginPath();
  g.moveTo(3, 0);
  g.lineTo(1, -1.2);
  g.lineTo(1, 1.2);
  g.closePath();
  g.fill();
  g.restore();
}

function drawHatch(g: Ctx, d: Of<'hatch'>) {
  const c = d.color ?? '220,175,40';
  g.save();
  g.beginPath();
  g.rect(d.x, d.y, d.w, d.h);
  g.clip();
  g.strokeStyle = `rgba(${c},0.38)`;
  g.lineWidth = 0.35;
  g.beginPath();
  for (let k = 0; k < d.w + d.h; k += 1.1) {
    g.moveTo(d.x + k, d.y);
    g.lineTo(d.x + k - d.h, d.y + d.h);
  }
  g.stroke();
  g.lineWidth = 0.25;
  g.strokeRect(d.x, d.y, d.w, d.h);
  g.restore();
}

function drawStain(g: Ctx, d: Of<'stain'>) {
  const rand = rng(Math.round(d.x * 73 + d.y * 151));
  for (let i = 0; i < 4; i++) {
    const x = d.x + (rand() - 0.5) * d.r;
    const y = d.y + (rand() - 0.5) * d.r;
    const r = d.r * (0.4 + rand() * 0.6);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(4,4,6,0.42)');
    grad.addColorStop(0.7, 'rgba(10,8,16,0.22)');
    grad.addColorStop(0.85, 'rgba(110,80,170,0.07)'); // oil sheen
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
}

function drawSkid(g: Ctx, d: Of<'skid'>) {
  const p = d.points;
  if (p.length < 2) return;
  g.save();
  g.strokeStyle = 'rgba(8,8,10,0.3)';
  g.lineWidth = 0.24;
  g.lineJoin = g.lineCap = 'round';
  for (const side of [-0.72, 0.72]) {
    g.beginPath();
    p.forEach((q, i) => {
      const a = p[Math.max(0, i - 1)];
      const b = p[Math.min(p.length - 1, i + 1)];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const x = q.x - ((b.y - a.y) / len) * side;
      const y = q.y + ((b.x - a.x) / len) * side;
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    });
    g.stroke();
  }
  g.restore();
}

function drawGraffiti(g: Ctx, d: Of<'graffiti'>) {
  const rand = rng(d.seed * 977 + 13);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const wide = d.w >= d.h;
  const L = wide ? d.w : d.h;
  const T = wide ? d.h : d.w;
  g.save();
  g.translate(d.x + d.w / 2, d.y + d.h / 2);
  if (!wide) g.rotate(-Math.PI / 2);
  g.beginPath();
  g.rect(-L / 2, -T / 2, L, T);
  g.clip();
  g.fillStyle = 'rgba(18,16,24,0.85)'; // buffed-out dark base
  g.fillRect(-L / 2, -T / 2, L, T);
  // background spray clouds
  for (let i = 0; i < L / 1.5; i++) {
    const x = (rand() - 0.5) * L;
    const y = (rand() - 0.5) * T;
    const r = T * (0.4 + rand() * 0.7);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${rgb(pick(SPRAY))},0.5)`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  // fat tag: black outline, color fill, white highlight
  const tag = d.text ?? pick(TAGS);
  const size = Math.min(T * 0.95, (L / tag.length) * 1.5);
  g.lineJoin = 'round';
  g.save();
  g.rotate((rand() - 0.5) * 0.08);
  g.strokeStyle = '#08080a';
  g.lineWidth = size * 2.2;
  text(g, tag, size, false);
  g.fillStyle = pick(SPRAY.slice(0, 5));
  text(g, tag, size, true);
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.lineWidth = size * 0.35;
  text(g, tag, size, false);
  g.restore();
  // drips
  g.fillStyle = pick(SPRAY);
  for (let i = 0; i < L / 2; i++) g.fillRect((rand() - 0.5) * L, T / 4, 0.06, T * rand() * 0.3);
  g.restore();
}

function drawCrowd(g: Ctx, d: Of<'crowd'>) {
  const rand = rng(d.seed * 389 + 5);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  for (const p of people(d)) {
    g.save();
    g.translate(p.x, p.y);
    g.rotate(p.a);
    g.fillStyle = 'rgba(0,0,0,0.35)'; // shadow
    g.beginPath();
    g.ellipse(0.1, 0.12, 0.25, 0.38, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = pick(CLOTHES); // shoulders
    g.beginPath();
    g.ellipse(0, 0, 0.22, 0.34, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = rand() < 0.3 ? '#111' : pick(SKIN); // head (or cap)
    g.beginPath();
    g.arc(0.03, 0, 0.14, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
}

/** Positions of a crowd's spectators: a loose line across the facing direction. */
function people(d: Of<'crowd'>) {
  const rand = rng(d.seed * 389 + 5);
  const out: (Vec & { a: number; phone: boolean })[] = [];
  const c = Math.cos(d.angle);
  const s = Math.sin(d.angle);
  for (let i = 0; i < d.n; i++) {
    const u = (rand() - 0.5) * 1.2; // depth
    const w = (i - (d.n - 1) / 2) * 0.65 + (rand() - 0.5) * 0.3;
    out.push({
      x: d.x + u * c - w * s,
      y: d.y + u * s + w * c,
      a: d.angle + (rand() - 0.5) * 0.9,
      phone: rand() < 0.35,
    });
  }
  return out;
}

/** Light spilling off a neon tube onto the floor: a soft band either side. */
function neonSpill(g: Ctx, d: Of<'neon'>, color: string, alpha: number, spread: number) {
  const dx = d.b.x - d.a.x;
  const dy = d.b.y - d.a.y;
  const len = Math.hypot(dx, dy);
  g.save();
  g.translate(d.a.x, d.a.y);
  g.rotate(Math.atan2(dy, dx));
  const grad = g.createLinearGradient(0, -spread, 0, spread);
  grad.addColorStop(0, `rgba(${color},0)`);
  grad.addColorStop(0.5, `rgba(${color},${alpha})`);
  grad.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = grad;
  g.fillRect(-spread / 3, -spread, len + (2 * spread) / 3, 2 * spread);
  g.restore();
}

function neonTube(g: Ctx, d: Of<'neon'>, color: string, alpha: number, width: number) {
  g.strokeStyle = `rgba(${color},${alpha})`;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(d.a.x, d.a.y);
  g.lineTo(d.b.x, d.b.y);
  g.stroke();
}

/** Neon brightness at time t: gentle hum plus rare dropouts. */
export function neonLevel(d: Of<'neon'>, t: number) {
  const f = d.flicker ?? 0.3;
  const seed = d.a.x * 12.9898 + d.a.y * 78.233;
  const tick = Math.floor(t * 14 + seed);
  const r = Math.abs(Math.sin(tick * 43758.5453)) % 1;
  const drop = r < 0.04 * f ? 0.25 : 1;
  return drop * (1 - 0.12 * f * (0.5 + 0.5 * Math.sin(t * 9 + seed)));
}

function pool(g: Ctx, x: number, y: number, r: number, color: string, a: number) {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, `rgba(${color},${a})`);
  grad.addColorStop(0.5, `rgba(${color},${a * 0.45})`);
  grad.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = grad;
  g.fillRect(x - r, y - r, 2 * r, 2 * r);
}

function shaft(g: Ctx, d: Of<'shaft'>, color: string, a: number) {
  g.save();
  g.translate(d.x, d.y);
  g.rotate(d.angle);
  g.scale(d.w / 2, d.h / 2);
  pool(g, 0, 0, 1, color, a);
  g.restore();
}

// --- city kinds ---

const PAVE = '#38383d';
const ROOFS = ['#2b2d33', '#303238', '#36383f', '#26272c', '#2e3230', '#353035', '#3a3b3f'];
const KIOSK = ['#e8e8ea', '#c0392b', '#2c5aa0', '#1d6b4a', '#e8e8ea', '#d8b02a'];

function drawAsphalt(g: Ctx, d: Of<'asphalt'>) {
  const rand = rng(d.seed * 131 + 7);
  g.fillStyle = '#2e2f35';
  g.fillRect(d.x, d.y, d.w, d.h);
  const blob = (n: number, color: () => string, rMin: number, rMax: number, stretch: number) => {
    for (let i = 0; i < n; i++) {
      const r = rMin + rand() * (rMax - rMin);
      g.save();
      g.translate(d.x + rand() * d.w, d.y + rand() * d.h);
      g.rotate(rand() * Math.PI);
      g.scale(1 + rand() * stretch, 1);
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
      grad.addColorStop(0, color());
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(-r, -r, 2 * r, 2 * r);
      g.restore();
    }
  };
  const area = d.w * d.h;
  // patched tarmac, then wet sheen streaks and a few puddles catching the sky glow
  blob(
    area / 40,
    () => `rgba(${rand() < 0.6 ? '0,0,0' : '255,255,255'},${0.025 + rand() * 0.04})`,
    2,
    8,
    1,
  );
  blob(area / 110, () => `rgba(140,165,215,${0.03 + rand() * 0.05})`, 1.5, 3.5, 6);
  blob(area / 900, () => `rgba(120,150,210,${0.08 + rand() * 0.06})`, 1.2, 3, 1.5);
}

function drawPaint(g: Ctx, d: Of<'paint'>) {
  if (!d.to.length) return;
  g.save();
  g.strokeStyle = d.color ?? `${PAINT}0.45)`;
  g.lineWidth = d.w;
  g.lineJoin = 'round';
  g.lineCap = 'butt'; // the caller may leave square caps set: they would stretch every dash
  if (d.dash) g.setLineDash(d.dash);
  g.beginPath();
  g.moveTo(d.x, d.y);
  for (const p of d.to) g.lineTo(p.x, p.y);
  g.stroke();
  g.restore();
}

/** Rooftop of one lot: tone, parapet and a few units (AC, tank, stair house, garden). */
function drawRoof(g: Ctx, r: Rect, rand: () => number) {
  g.fillStyle = ROOFS[Math.floor(rand() * ROOFS.length)];
  g.fillRect(r.x + 0.2, r.y + 0.2, r.w - 0.4, r.h - 0.4);
  g.strokeStyle = 'rgba(255,255,255,0.07)';
  g.lineWidth = 0.3;
  g.strokeRect(r.x + 0.55, r.y + 0.55, r.w - 1.1, r.h - 1.1);
  const n = Math.floor(rand() * 4);
  for (let k = 0; k < n; k++) {
    const kind = rand();
    const x = r.x + 1.5 + rand() * Math.max(0, r.w - 6);
    const y = r.y + 1.5 + rand() * Math.max(0, r.h - 6);
    if (kind < 0.45) {
      for (let i = 0; i < 2 + Math.floor(rand() * 3); i++) {
        g.fillStyle = '#5d6066';
        g.fillRect(x + i * 1.3, y, 1.1, 0.8);
        g.fillStyle = '#25262b';
        g.beginPath();
        g.arc(x + i * 1.3 + 0.55, y + 0.4, 0.28, 0, Math.PI * 2);
        g.fill();
      }
    } else if (kind < 0.65) {
      g.fillStyle = '#6a6d74';
      g.beginPath();
      g.arc(x + 1.2, y + 1.2, 1.2, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#4b4e54';
      g.lineWidth = 0.15;
      g.stroke();
    } else if (kind < 0.9) {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x + 0.4, y + 0.5, 3, 3.6);
      g.fillStyle = '#44464d';
      g.fillRect(x, y, 3, 3.6);
    } else {
      g.fillStyle = '#26382b';
      g.fillRect(x, y, Math.min(5, r.w - 3), Math.min(4, r.h - 3));
    }
  }
}

/** Splits a rect into building lots of roughly 6-22 m. */
function lots(r: Rect, rand: () => number, out: Rect[]) {
  const big = Math.max(r.w, r.h);
  if (big < 9 || (big < 22 && rand() < 0.4)) {
    out.push(r);
    return;
  }
  const k = 0.3 + rand() * 0.4;
  if (r.w >= r.h) {
    lots({ ...r, w: r.w * k }, rand, out);
    lots({ ...r, x: r.x + r.w * k, w: r.w * (1 - k) }, rand, out);
  } else {
    lots({ ...r, h: r.h * k }, rand, out);
    lots({ ...r, y: r.y + r.h * k, h: r.h * (1 - k) }, rand, out);
  }
}

/**
 * Clockwise outline of a block grown inward by `inset` (m); a rounded corner is sampled every
 * 3 degrees. Also used by maps for sidewalk walkways and facades.
 */
export function blockOutline(b: Pick<Of<'block'>, 'x' | 'y' | 'w' | 'h' | 'round'>, inset = 0) {
  const sx = [-1, 1, 1, -1];
  const sy = [-1, -1, 1, 1];
  const out: Vec[] = [];
  for (let k = 0; k < 4; k++) {
    const cx = b.x + (b.w * (1 + sx[k])) / 2;
    const cy = b.y + (b.h * (1 + sy[k])) / 2;
    const ix = cx - sx[k] * inset;
    const iy = cy - sy[k] * inset;
    const rd = b.round;
    if (rd?.corner !== k) {
      out.push({ x: ix, y: iy });
      continue;
    }
    // corner k points along polar angle (k + 2) * 90 deg ... (k + 3) * 90 deg, clockwise
    const a0 = ((k + 2) * Math.PI) / 2;
    const n = 30;
    const o = rd.concave ? { x: cx, y: cy } : { x: cx - sx[k] * rd.r, y: cy - sy[k] * rd.r };
    const r = rd.concave ? rd.r + inset : rd.r - inset;
    for (let i = 0; i <= n; i++) {
      // concave bites run the other way round, centered on the corner itself
      const a = rd.concave
        ? a0 + 1.5 * Math.PI - (i / n) * (Math.PI / 2)
        : a0 + (i / n) * (Math.PI / 2);
      out.push({ x: o.x + r * Math.cos(a), y: o.y + r * Math.sin(a) });
    }
  }
  return out;
}

function drawBlock(g: Ctx, d: Of<'block'>) {
  const rand = rng(d.seed * 733 + 11);
  const pts = blockOutline(d);
  const path = () => {
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath();
  };
  const box: Rect = { x: d.x, y: d.y, w: d.w, h: d.h };
  g.save();
  path();
  g.clip();
  g.fillStyle = '#121317'; // gaps between buildings
  g.fillRect(box.x, box.y, box.w, box.h);
  const all: Rect[] = [];
  lots(box, rand, all);
  for (const r of all) drawRoof(g, r, rand);
  for (const o of d.open ?? []) {
    g.fillStyle = PAVE;
    g.fillRect(o.x, o.y, o.w, o.h);
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 0.05;
    g.beginPath();
    for (let x = o.x; x < o.x + o.w; x += 1.2) (g.moveTo(x, o.y), g.lineTo(x, o.y + o.h));
    for (let y = o.y; y < o.y + o.h; y += 1.2) (g.moveTo(o.x, y), g.lineTo(o.x + o.w, y));
    g.stroke();
  }
  if (d.walk > 0) {
    // the sidewalk is a stroke along the curb, clipped to the inside: band = lineWidth / 2
    const band = (w: number, color: string, dash?: number[]) => {
      g.strokeStyle = color;
      g.lineWidth = 2 * w;
      g.setLineDash(dash ?? []);
      path();
      g.stroke();
    };
    band(d.walk + 0.5, 'rgba(0,0,0,0.5)'); // facade shadow
    band(d.walk, PAVE);
    band(d.walk - 1.2, '#7a6a2a'); // tactile guide strip
    band(d.walk - 1.5, PAVE);
    band(d.walk, 'rgba(0,0,0,0.22)', [0.05, 1.1]); // slab joints
    band(0.35, '#65666c'); // curb stones
  }
  g.restore();
}

function local(g: Ctx, x: number, y: number, angle: number, draw: () => void) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  draw();
  g.restore();
}

/** Shop front in its local frame: +x along the facade, -y toward the street. */
function drawFront(g: Ctx, d: Of<'front'>, layer: DecorLayer) {
  const len = d.len;
  const c = rgb(d.color);
  local(g, d.x, d.y, d.angle, () => {
    if (layer === 'wall') {
      const rand = rng(d.seed * 53 + 1);
      g.fillStyle = `rgba(${c},0.85)`;
      g.fillRect(0, 0, len, 0.7);
      g.fillStyle = 'rgba(10,10,14,0.6)'; // mullions
      for (let x = 0.9 + rand(); x < len; x += 1.1 + rand() * 0.8) g.fillRect(x, 0, 0.08, 0.7);
      if (rand() < 0.5) {
        g.fillStyle = rand() < 0.5 ? 'rgba(120,20,30,0.85)' : 'rgba(25,40,70,0.85)'; // awning
        g.fillRect(0, -1.1, len, 1.1);
        g.fillStyle = 'rgba(255,255,255,0.12)';
        for (let x = 0; x < len; x += 0.8) g.fillRect(x, -1.1, 0.4, 1.1);
      }
      return;
    }
    const light = layer === 'light';
    const grad = g.createLinearGradient(0, 0.7, 0, -6);
    grad.addColorStop(0, light ? 'rgba(255,255,255,0.9)' : `rgba(${c},0.4)`);
    grad.addColorStop(0.15, light ? 'rgba(255,255,255,0.7)' : `rgba(${c},0.25)`);
    grad.addColorStop(1, light ? 'rgba(255,255,255,0)' : `rgba(${c},0)`);
    g.fillStyle = grad;
    g.fillRect(0, -6, len, 6.7);
  });
}

/** A made-up kanji-like glyph: a few strokes in an s x s cell. */
function glyph(g: Ctx, cx: number, cy: number, s: number, rand: () => number) {
  const q = s * 0.42;
  g.beginPath();
  for (let k = 0, n = 3 + Math.floor(rand() * 3); k < n; k++) {
    const t = Math.floor(rand() * 4);
    const u = (rand() - 0.5) * 1.6 * q;
    if (t === 0) (g.moveTo(cx - q, cy + u), g.lineTo(cx + q, cy + u));
    else if (t === 1) (g.moveTo(cx + u, cy - q), g.lineTo(cx + u, cy + q));
    else if (t === 2) g.rect(cx - q * 0.6, cy - q * 0.6 + u * 0.3, q * 1.2, q * 0.9);
    else (g.moveTo(cx + u * 0.5, cy - q * 0.3), g.lineTo(cx + u - q * 0.7, cy + q));
  }
  g.lineWidth = s * 0.11;
  g.stroke();
}

function drawSign(g: Ctx, d: Of<'sign'>, layer: DecorLayer) {
  const c = rgb(d.color);
  const r = Math.max(d.w, d.h);
  if (layer === 'light') {
    local(g, d.x, d.y, d.angle, () => {
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.fillRect(-d.w / 2, -d.h / 2, d.w, d.h);
    });
    pool(g, d.x, d.y, r * 0.8 + 1, '255,255,255', 0.35);
    return;
  }
  if (layer === 'glow') {
    pool(g, d.x, d.y, r * 0.9 + 3, c, 0.32);
    return;
  }
  local(g, d.x, d.y, d.angle, () => {
    g.fillStyle = '#0b0b10';
    g.fillRect(-d.w / 2, -d.h / 2, d.w, d.h);
    g.strokeStyle = g.fillStyle = `rgb(${c})`;
    g.lineWidth = 0.12;
    g.strokeRect(-d.w / 2 + 0.12, -d.h / 2 + 0.12, d.w - 0.24, d.h - 0.24);
    if (d.text) {
      if (Math.cos(d.angle) < -1e-6) g.rotate(Math.PI); // keep words upright on screen
      text(g, d.text, Math.min(d.h * 0.62, (d.w / d.text.length) * 1.45), true);
      return;
    }
    const rand = rng(d.seed * 197 + 3);
    const s = d.h * 0.72;
    const n = Math.max(1, Math.floor((d.w - 0.3) / (s * 1.1)));
    g.lineCap = 'square';
    for (let i = 0; i < n; i++) glyph(g, (i - (n - 1) / 2) * s * 1.1, 0, s, rand);
  });
}

const SCREEN_ADS = ['NEO', 'YORU', 'GO!', 'KAIJU', '24H', 'HIKARI'];
function drawScreen(g: Ctx, d: Of<'screen'>, layer: DecorLayer, t: number) {
  const r = Math.max(d.w, d.h);
  if (layer === 'light') {
    local(g, d.x, d.y, d.angle, () => {
      g.fillStyle = 'rgba(255,255,255,0.95)';
      g.fillRect(-d.w / 2, -d.h / 2, d.w, d.h);
    });
    pool(g, d.x, d.y, r * 0.9, '255,255,255', 0.45);
    return;
  }
  if (layer === 'glow') {
    pool(g, d.x, d.y, r * 1.4, d.seed % 2 ? '90,200,255' : '255,90,190', 0.3);
    return;
  }
  local(g, d.x, d.y, d.angle, () => {
    const hw = d.w / 2;
    const hh = d.h / 2;
    if (layer === 'wall') {
      g.fillStyle = '#07070a';
      g.fillRect(-hw - 0.4, -hh - 0.4, d.w + 0.8, d.h + 0.8);
      g.fillStyle = '#1a2440';
      g.fillRect(-hw, -hh, d.w, d.h);
      return;
    }
    // over: an ad loop, a new spot every 5 s
    const hue = (t * 25 + d.seed * 97) % 360;
    const spot = Math.floor(t / 5 + d.seed) % 3;
    const grad = g.createLinearGradient(-hw, 0, hw, 0);
    grad.addColorStop(0, `hsla(${hue},90%,55%,0.55)`);
    grad.addColorStop(1, `hsla(${hue + 70},90%,45%,0.55)`);
    g.fillStyle = grad;
    g.fillRect(-hw, -hh, d.w, d.h);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    if (spot === 0) {
      for (let k = 0; k < 4; k++) {
        const x = ((((t * 3 + k * d.w * 0.27) % d.w) + d.w) % d.w) - hw;
        g.fillRect(x, -hh, d.w * 0.06, d.h);
      }
    } else if (spot === 1) {
      text(g, SCREEN_ADS[(d.seed + Math.floor(t / 15)) % SCREEN_ADS.length], d.h * 0.55, true);
    } else {
      const k = 0.5 + 0.5 * Math.sin(t * 2.2);
      g.beginPath();
      g.arc(0, 0, hh * (0.4 + 0.4 * k), 0, Math.PI * 2);
      g.fill();
    }
  });
}

function drawVending(g: Ctx, d: Of<'vending'>, layer: DecorLayer) {
  const rand = rng(d.seed * 41 + 2);
  const fx = d.x + 0.6 * Math.cos(d.angle);
  const fy = d.y + 0.6 * Math.sin(d.angle);
  if (layer === 'light') return pool(g, fx, fy, 1 + 0.6 * d.n, '255,255,255', 0.85);
  if (layer === 'glow') return pool(g, fx, fy, 1.8 + 0.6 * d.n, '190,225,255', 0.4);
  local(g, d.x, d.y, d.angle, () => {
    for (let i = 0; i < d.n; i++) {
      const y = (i - (d.n - 1) / 2) * 0.95 - 0.45;
      g.fillStyle = KIOSK[Math.floor(rand() * KIOSK.length)];
      g.fillRect(-0.75, y, 0.75, 0.9);
      g.fillStyle = '#e6f6ff'; // lit display
      g.fillRect(-0.14, y + 0.08, 0.14, 0.74);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(-0.7, y + 0.1, 0.4, 0.7);
    }
  });
}

function drawManhole(g: Ctx, d: Of<'manhole'>) {
  g.fillStyle = '#2d2e33';
  g.strokeStyle = '#46474d';
  g.lineWidth = 0.06;
  g.beginPath();
  g.arc(d.x, d.y, 0.33, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.beginPath();
  g.arc(d.x, d.y, 0.2, 0, Math.PI * 2);
  g.moveTo(d.x - 0.3, d.y);
  g.lineTo(d.x + 0.3, d.y);
  g.moveTo(d.x, d.y - 0.3);
  g.lineTo(d.x, d.y + 0.3);
  g.stroke();
}

// --- drive-thru kinds ---

const WARM = '255,196,120';

function drawTarmac(g: Ctx, d: Of<'tarmac'>) {
  const rand = rng(d.seed * 211 + 5);
  g.fillStyle = '#2a292b';
  g.fillRect(d.x, d.y, d.w, d.h);
  // worn mottling, then darker resurfaced patches
  for (let i = 0; i < (d.w * d.h) / 35; i++) {
    const x = d.x + rand() * d.w;
    const y = d.y + rand() * d.h;
    const r = 2 + rand() * 6;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const tone = rand() < 0.5 ? '0,0,0' : '255,240,220';
    grad.addColorStop(0, `rgba(${tone},${0.025 + rand() * 0.035})`);
    grad.addColorStop(1, `rgba(${tone},0)`);
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let i = 0; i < (d.w * d.h) / 900; i++)
    g.fillRect(d.x + rand() * d.w, d.y + rand() * d.h, 3 + rand() * 7, 2 + rand() * 5);
  // tar-sealed cracks: thin glossy black wanderers
  g.strokeStyle = 'rgba(8,8,10,0.45)';
  g.lineWidth = 0.08;
  g.lineJoin = 'round';
  for (let i = 0; i < (d.w * d.h) / 500; i++) {
    let x = d.x + rand() * d.w;
    let y = d.y + rand() * d.h;
    let a = rand() * Math.PI * 2;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 8; k++) {
      a += (rand() - 0.5) * 1.2;
      x += Math.cos(a) * 1.2;
      y += Math.sin(a) * 1.2;
      g.lineTo(x, y);
    }
    g.stroke();
  }
}

/** Raised hood, car local frame (+x = nose): engine bay in front of the hinge, panel propped up. */
function drawHood(g: Ctx, d: Of<'hood'>) {
  const rand = rng(d.seed * 61 + 9);
  const hl = d.len / 2;
  const hw = d.wid / 2 - 0.16;
  const hinge = hl - d.len * 0.3;
  local(g, d.x, d.y, d.angle, () => {
    g.fillStyle = '#121316'; // engine bay
    g.beginPath();
    g.roundRect(hinge + 0.42, -hw, hl - 0.14 - hinge - 0.42, 2 * hw, 0.12);
    g.fill();
    g.fillStyle = '#5a5d63'; // radiator
    g.fillRect(hl - 0.3, -hw + 0.1, 0.12, 2 * hw - 0.2);
    const cover = ['#a8231c', '#1b1b1d', '#7c8088', '#2a4f9a'][Math.floor(rand() * 4)];
    g.fillStyle = '#3b3d42'; // block
    g.fillRect(hinge + 0.55, -0.35, 0.55, 0.7);
    g.fillStyle = cover; // cam cover
    g.fillRect(hinge + 0.62, -0.25, 0.42, 0.5);
    g.fillStyle = '#8a8d93'; // strut tops, battery
    for (const s of [-1, 1]) {
      g.beginPath();
      g.arc(hinge + 0.6, s * (hw - 0.17), 0.09, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#26282c';
    g.fillRect(hl - 0.62, hw - 0.42, 0.26, 0.3);
    // the panel stands up near vertical: a short foreshortened strip over the cowl
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(hinge - 0.12, -hw, 0.24, 2 * hw); // shadow on the windscreen
    g.fillStyle = d.color;
    g.beginPath();
    g.roundRect(hinge, -hw - 0.04, 0.4, 2 * hw + 0.08, 0.08);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.28)'; // lit leading edge
    g.fillRect(hinge + 0.33, -hw, 0.07, 2 * hw);
    g.strokeStyle = '#9a9ca2'; // prop rod
    g.lineWidth = 0.03;
    g.beginPath();
    g.moveTo(hl - 0.3, hw - 0.12);
    g.lineTo(hinge + 0.38, hw - 0.3);
    g.stroke();
  });
}

function drawMoon(g: Ctx, d: Of<'moon'>, layer: DecorLayer, t: number) {
  const { x, y, r } = d;
  if (layer === 'light') return pool(g, x, y, r * 2.4, '255,255,255', 0.9);
  if (layer === 'glow') {
    pool(g, x, y, r * 4, '255,60,170', 0.32);
    pool(g, x, y, r * 2.2, '255,220,140', 0.4);
    return;
  }
  if (layer === 'over') {
    const k = 0.75 + 0.25 * Math.sin(t * 1.6);
    g.globalAlpha *= k;
    pool(g, x, y, r * 1.8, '255,70,180', 0.35);
    return;
  }
  g.fillStyle = '#0d0b1a'; // backplate
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#ff3fb0'; // neon ring, blue inner tube
  g.lineWidth = r * 0.09;
  g.stroke();
  g.strokeStyle = '#3ad7ff';
  g.lineWidth = r * 0.04;
  g.beginPath();
  g.arc(x, y, r * 0.84, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#ffe7a3'; // crescent: a disc bitten by the backplate
  g.beginPath();
  g.arc(x - r * 0.08, y, r * 0.6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#0d0b1a';
  g.beginPath();
  g.arc(x + r * 0.2, y - r * 0.14, r * 0.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff6d8';
  for (const [u, w] of [
    [0.42, 0.32],
    [0.3, 0.55],
    [0.55, 0.05],
  ]) {
    g.beginPath();
    g.arc(x + u * r, y + w * r, r * 0.05, 0, Math.PI * 2);
    g.fill();
  }
}

/** Food truck from above: cab at +x, roof vents, serving hatch with a striped awning on +y. */
function drawTruck(g: Ctx, d: Of<'truck'>, layer: DecorLayer) {
  const hw = d.w / 2;
  const hh = d.h / 2;
  const hatch = {
    x: d.x - Math.sin(d.angle) * (hh + 1.2),
    y: d.y + Math.cos(d.angle) * (hh + 1.2),
  };
  if (layer === 'light') return pool(g, hatch.x, hatch.y, 5, '255,255,255', 0.9);
  if (layer === 'glow') return pool(g, hatch.x, hatch.y, 6, WARM, 0.45);
  local(g, d.x, d.y, d.angle, () => {
    g.fillStyle = '#d9d2c0'; // cream box
    g.beginPath();
    g.roundRect(-hw, -hh, d.w, d.h, 0.25);
    g.fill();
    g.fillStyle = '#2f7f7a'; // teal cab
    g.beginPath();
    g.roundRect(hw - 1.6, -hh + 0.05, 1.55, d.h - 0.1, [0.1, 0.4, 0.4, 0.1]);
    g.fill();
    g.fillStyle = '#121519';
    g.fillRect(hw - 0.9, -hh + 0.2, 0.35, d.h - 0.4); // windscreen
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(-hw + 0.3, -hh + 0.3, d.w - 2.2, d.h - 0.6);
    g.fillStyle = '#9ea2a8'; // roof vents
    for (const u of [-1.6, 0.2]) g.fillRect(u, -0.35, 0.7, 0.7);
    g.fillStyle = '#2f7f7a'; // teal waist stripe
    g.fillRect(-hw, hh - 0.25, d.w - 1.6, 0.25);
    for (let u = -hw + 0.5, k = 0; u < hw - 2.2; u += 0.5, k++) {
      g.fillStyle = k % 2 ? '#f4efe4' : '#c8324a'; // awning stripes
      g.fillRect(u, hh, 0.5, 1);
    }
    g.fillStyle = '#1a1a1c'; // chalkboard
    g.fillRect(-hw + 0.6, hh + 1.6, 0.9, 0.12);
  });
}

function drawBulbs(g: Ctx, d: Of<'bulbs'>, layer: DecorLayer) {
  const p = [{ x: d.x, y: d.y }, ...d.to];
  if (layer === 'wall') {
    g.strokeStyle = 'rgba(20,18,16,0.8)';
    g.lineWidth = 0.04;
    g.beginPath();
    p.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
    g.stroke();
  }
  let n = 0;
  for (let i = 1; i < p.length; i++) {
    const len = Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
    for (let s = 0; s < len; s += 0.9, n++) {
      const x = p[i - 1].x + ((p[i].x - p[i - 1].x) * s) / len;
      const y = p[i - 1].y + ((p[i].y - p[i - 1].y) * s) / len;
      if (layer === 'light') pool(g, x, y, 1.4, '255,255,255', 0.5);
      else if (layer === 'glow') pool(g, x, y, 1.8, WARM, 0.35);
      else {
        g.fillStyle = n % 3 ? '#ffe2a8' : '#ffb35c';
        g.beginPath();
        g.arc(x, y, 0.09, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
}

function drawDinerRoof(g: Ctx, d: Of<'roof'>) {
  const rand = rng(d.seed * 17 + 3);
  g.fillStyle = '#3a3739';
  g.fillRect(d.x, d.y, d.w, d.h);
  g.fillStyle = '#4a4648'; // membrane
  g.fillRect(d.x + 0.6, d.y + 0.6, d.w - 1.2, d.h - 1.2);
  g.strokeStyle = 'rgba(0,0,0,0.18)';
  g.lineWidth = 0.05;
  g.beginPath();
  for (let x = d.x + 2; x < d.x + d.w - 1; x += 2)
    (g.moveTo(x, d.y + 0.6), g.lineTo(x, d.y + d.h - 0.6));
  g.stroke();
  g.strokeStyle = d.color; // fascia band
  g.lineWidth = 0.35;
  g.strokeRect(d.x + 0.2, d.y + 0.2, d.w - 0.4, d.h - 0.4);
  for (let k = 0; k < 4; k++) {
    const x = d.x + 3 + rand() * (d.w - 9);
    const y = d.y + 3 + rand() * (d.h - 8);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(x + 0.3, y + 0.4, 3, 2);
    g.fillStyle = '#6a6d72'; // AC unit with fan
    g.fillRect(x, y, 3, 2);
    g.fillStyle = '#2b2c30';
    g.beginPath();
    g.arc(x + 1.5, y + 1, 0.7, 0, Math.PI * 2);
    g.fill();
  }
  const ex = d.x + d.w * 0.7; // kitchen exhaust
  const ey = d.y + d.h * 0.7;
  g.fillStyle = '#8a8c90';
  g.beginPath();
  g.arc(ex, ey, 0.9, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#2b2c30';
  g.beginPath();
  g.arc(ex, ey, 0.5, 0, Math.PI * 2);
  g.fill();
}

/** World rect visible on an axis-aligned canvas transform; null if unknown (no culling). */
function viewOf(g: Ctx): Rect | null {
  const m = typeof g.getTransform === 'function' ? g.getTransform() : null;
  const w = (g.canvas as HTMLCanvasElement | undefined)?.width;
  const h = (g.canvas as HTMLCanvasElement | undefined)?.height;
  if (!m || !(m.a > 0) || !(m.d > 0) || m.b || m.c || !(w! > 0) || !(h! > 0)) return null;
  return { x: -m.e / m.a, y: -m.f / m.d, w: w! / m.a, h: h! / m.d };
}
/** Center and reach of the decor kinds drawn on the over layer. */
function reach(d: Decor): [number, number, number] | null {
  switch (d.kind) {
    case 'neon':
      return [
        (d.a.x + d.b.x) / 2,
        (d.a.y + d.b.y) / 2,
        Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y) / 2 + 5,
      ];
    case 'crowd':
      return [d.x, d.y, d.n * 0.4 + 2];
    case 'shaft':
    case 'screen':
      return [d.x, d.y, Math.max(d.w, d.h)];
    case 'moon':
      return [d.x, d.y, d.r * 2];
    default:
      return null;
  }
}

/**
 * Draws one layer of a floor's decor. `t` is the clock (s), used by the 'over' layer only.
 * Multiplies into the caller's globalAlpha, so crossfades keep working.
 */
export function drawDecor(
  g: Ctx,
  decor: Decor[],
  layer: DecorLayer,
  floorIndex: number,
  t: number,
): void {
  const base = g.globalAlpha;
  const view = layer === 'over' ? viewOf(g) : null; // the over layer runs per frame: cull
  for (const d of decor) {
    if (d.floor !== floorIndex) continue;
    if (view) {
      const r = reach(d);
      if (!r) continue;
      const [x, y, k] = r;
      if (x + k < view.x || x - k > view.x + view.w || y + k < view.y || y - k > view.y + view.h)
        continue;
    }
    g.globalAlpha = base;
    switch (d.kind) {
      case 'asphalt':
        if (layer === 'floor') drawAsphalt(g, d);
        break;
      case 'paint':
        if (layer === (d.top ? 'wall' : 'floor')) drawPaint(g, d);
        break;
      case 'block':
        if (layer === 'wall') drawBlock(g, d);
        break;
      case 'front':
        if (layer !== 'floor' && layer !== 'over') drawFront(g, d, layer);
        break;
      case 'sign':
        if (layer !== 'floor' && layer !== 'over') drawSign(g, d, layer);
        break;
      case 'screen':
        if (layer !== 'floor') drawScreen(g, d, layer, t);
        break;
      case 'vending':
        if (layer !== 'floor' && layer !== 'over') drawVending(g, d, layer);
        break;
      case 'manhole':
        if (layer === 'floor') drawManhole(g, d);
        break;
      case 'tarmac':
        if (layer === 'floor') drawTarmac(g, d);
        break;
      case 'hood':
        if (layer === 'wall') drawHood(g, d);
        break;
      case 'moon':
        if (layer !== 'floor') drawMoon(g, d, layer, t);
        break;
      case 'truck':
        if (layer !== 'floor' && layer !== 'over') drawTruck(g, d, layer);
        break;
      case 'bulbs':
        if (layer !== 'floor' && layer !== 'over') drawBulbs(g, d, layer);
        break;
      case 'roof':
        if (layer === 'wall') drawDinerRoof(g, d);
        break;
      case 'text':
        if (layer === 'floor') drawText(g, d);
        break;
      case 'arrow':
        if (layer === 'floor') drawArrow(g, d);
        break;
      case 'hatch':
        if (layer === 'floor') drawHatch(g, d);
        break;
      case 'stain':
        if (layer === 'floor') drawStain(g, d);
        break;
      case 'skid':
        if (layer === 'floor') drawSkid(g, d);
        break;
      case 'graffiti':
        if (layer === 'wall') drawGraffiti(g, d);
        else if (layer === 'light') {
          g.fillStyle = 'rgba(255,255,255,0.55)'; // murals catch a little light
          g.fillRect(d.x, d.y, d.w, d.h);
        }
        break;
      case 'crowd':
        if (layer === 'wall') drawCrowd(g, d);
        else if (layer === 'over') {
          // phone screens filming the meet
          for (const [i, p] of people(d).entries()) {
            if (!p.phone) continue;
            g.globalAlpha = base * (0.6 + 0.4 * Math.sin(t * 2 + i));
            pool(g, p.x + 0.3 * Math.cos(p.a), p.y + 0.3 * Math.sin(p.a), 0.35, '200,225,255', 1);
          }
        }
        break;
      case 'neon': {
        const c = rgb(d.color);
        if (layer === 'wall') neonTube(g, d, c, 0.9, 0.16);
        else if (layer === 'light') neonSpill(g, d, '255,255,255', 0.55, 3.5);
        else if (layer === 'glow') neonSpill(g, d, c, 0.22, 4.5);
        else if (layer === 'over') {
          g.globalAlpha = base * neonLevel(d, t);
          neonSpill(g, d, c, 0.35, 0.9);
          neonTube(g, d, c, 0.9, 0.22);
          neonTube(g, d, '255,255,255', 0.85, 0.07);
        }
        break;
      }
      case 'pool': {
        const c = d.color ? rgb(d.color) : SODIUM;
        if (layer === 'light') pool(g, d.x, d.y, d.r, '255,255,255', 0.95);
        else if (layer === 'glow') pool(g, d.x, d.y, d.r, c, 0.5);
        break;
      }
      case 'shaft':
        if (layer === 'light') shaft(g, d, '255,255,255', 0.7);
        else if (layer === 'glow') shaft(g, d, '255,236,200', 0.2);
        else if (layer === 'over')
          shaft(g, d, '255,240,215', 0.03 + 0.02 * Math.sin(t * 0.7 + d.x));
        break;
    }
  }
  g.globalAlpha = base;
}
