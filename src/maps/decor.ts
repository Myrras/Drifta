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
    | DockDecor
  );
export type DecoratedMap = GameMap & { decor?: Decor[] };
/**
 * floor: static ground paint (under solids). wall: static, over solids.
 * light: static darkness cut (white alpha). glow: static colored light (additive).
 * over: per frame, additive (neon flicker, shimmer, phone screens).
 * sea: per frame, under the floor, outside its bounds (harbour water).
 */
export type DecorLayer = 'floor' | 'wall' | 'light' | 'glow' | 'over' | 'sea';

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
    case 'crane':
      return [d.x, d.y, (d.len + d.span) / 2 + d.boom + 3];
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
    if (d.floor !== floorIndex || (layer === 'sea') !== (d.kind === 'sea')) continue;
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
      default:
        drawDock(g, d, layer, t);
    }
  }
  g.globalAlpha = base;
}

// --- dock kinds (WANGAN DOCKS) ---

/** Port scenery: containers and trucks over their solids, cranes, quay furniture, the harbour. */
export type DockDecor =
  /**
   * Shipping container over its solid (rect rotated by angle about its center): ribbed roof,
   * door end at +x of the long side, stencilled code, optional line name. tone -1..1 reads as
   * the stack tier (lighter = higher). part: 'trailer' = 40 ft box on a chassis, front at +x;
   * 'cab' = truck cab, nose at +x.
   */
  | {
      kind: 'container';
      x: number;
      y: number;
      w: number;
      h: number;
      angle: number;
      color: string;
      code?: string;
      brand?: string;
      tone?: number;
      part?: 'trailer' | 'cab';
    }
  /**
   * Gantry crane centered at (x, y), +x along its travel: legs at (±len/2, ±span/2), overhead
   * girders as open truss, a boom reaching `boom` m past the +y legs (0: none, no rails).
   * Red warning lamps on the legs and boom tip blink on the over layer.
   */
  | {
      kind: 'crane';
      x: number;
      y: number;
      angle: number;
      len: number;
      span: number;
      boom: number;
      seed: number;
    }
  /** mooring bollard over a 0.8 m pillar */
  | { kind: 'bollard'; x: number; y: number }
  /** coiled mooring rope */
  | { kind: 'coil'; x: number; y: number; seed: number }
  /** sodium lamp streaking down the wet asphalt below (x, y) */
  | { kind: 'reflection'; x: number; y: number }
  /** puddle catching the lamps */
  | { kind: 'puddle'; x: number; y: number; r: number; seed: number }
  /**
   * The harbour round the floor rect (x, y, w, h), on the sea layer: water shimmer, quay fenders, a moored
   * ship (bow at +x, quay side at +y) and mooring ropes from a (quay) to b (ship).
   */
  | { kind: 'sea'; x: number; y: number; w: number; h: number; ship: Rect; ropes: [Vec, Vec][] };

/** Container line colors, bright enough to read under the sodium light. */
export const DOCK_BOXES = [
  '#b8382c',
  '#2f6db0',
  '#2f8a5a',
  '#e07a24',
  '#d8b02a',
  '#1f8f8f',
  '#8a3a7a',
  '#e8e4dc',
  '#6b7480',
  '#8e3b22',
  '#3a4fa0',
];
const STEEL = '#e3a72a'; // crane paint
const LAMP_RED = '255,45,30';

/** True for pale paint that wants dark stencils. */
const pale = (hex: string) => {
  const [r, g, b] = rgb(hex).split(',').map(Number);
  return 0.3 * r + 0.59 * g + 0.11 * b > 150;
};

function drawContainer(g: Ctx, d: Of<'container'>) {
  local(g, d.x, d.y, d.angle, () => {
    let [w, h] = [d.w, d.h];
    let turn = d.angle;
    if (h > w) {
      g.rotate(Math.PI / 2);
      [w, h] = [h, w];
      turn += Math.PI / 2;
    }
    if (d.part === 'cab') return drawCab(g, w, h, d.color);
    if (d.part === 'trailer') {
      g.fillStyle = '#1a1b1f'; // chassis and gooseneck ahead of the box
      g.fillRect(-w / 2, -h / 2 + 0.15, w, h - 0.3);
      g.fillStyle = '#34353a';
      g.fillRect(w / 2 - 1.5, -0.3, 1.5, 0.6);
      g.translate(-(w - 12.2) / 2, 0);
      [w, h] = [12.2, 2.44];
    }
    const [hw, hh] = [w / 2, h / 2];
    g.fillStyle = d.color;
    g.fillRect(-hw, -hh, w, h);
    const tone = d.tone ?? 0;
    g.fillStyle = tone > 0 ? `rgba(255,255,255,${0.14 * tone})` : `rgba(0,0,0,${-0.35 * tone})`;
    g.fillRect(-hw, -hh, w, h);
    // corrugated roof: dark grooves with a lit crest beside each
    g.fillStyle = 'rgba(0,0,0,0.24)';
    for (let x = -hw + 0.3; x < hw - 0.4; x += 0.28) g.fillRect(x, -hh + 0.12, 0.1, h - 0.24);
    g.fillStyle = 'rgba(255,255,255,0.1)';
    for (let x = -hw + 0.4; x < hw - 0.4; x += 0.28) g.fillRect(x, -hh + 0.12, 0.06, h - 0.24);
    // top rails (lit from the north like the render's light), door end at +x, corner castings
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(-hw, -hh, w, 0.1);
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.fillRect(-hw, hh - 0.12, w, 0.12);
    g.fillRect(hw - 0.3, -hh, 0.3, h);
    g.fillRect(-hw, -hh, 0.14, h);
    g.fillStyle = 'rgba(225,220,205,0.55)';
    for (const x of [-hw, hw - 0.22])
      for (const y of [-hh, hh - 0.22]) g.fillRect(x, y, 0.22, 0.22);
    // stencils, upright on screen
    if (Math.cos(turn) < -1e-6) g.rotate(Math.PI);
    g.fillStyle = pale(d.color) ? 'rgba(25,25,30,0.7)' : 'rgba(242,240,232,0.72)';
    if (d.brand) {
      g.save();
      g.translate(0, -0.2);
      text(g, d.brand, Math.min(1.05, ((w - 2) / d.brand.length) * 1.6), true);
      g.restore();
    }
    if (d.code) {
      g.save();
      g.translate(d.brand ? hw * 0.45 : 0, d.brand ? 0.78 : 0);
      text(g, d.code, d.brand ? 0.4 : Math.min(0.8, ((w - 1.4) / d.code.length) * 1.7), true);
      g.restore();
    }
  });
}

/** Truck cab in its local frame, nose at +x. */
function drawCab(g: Ctx, w: number, h: number, color: string) {
  const [hw, hh] = [w / 2, h / 2];
  g.fillStyle = color;
  g.beginPath();
  g.roundRect(-hw, -hh, w, h, [0.15, 0.45, 0.45, 0.15]);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.14)'; // roof fairing
  g.fillRect(-hw + 0.25, -hh + 0.3, w - 1, h - 0.6);
  g.fillStyle = '#111418'; // windshield
  g.fillRect(hw - 0.6, -hh + 0.15, 0.3, h - 0.3);
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fillRect(-hw, -hh + 0.1, 0.16, h - 0.2);
  g.fillStyle = '#1a1b1f'; // mirrors
  g.fillRect(hw - 0.75, -hh - 0.22, 0.14, 0.22);
  g.fillRect(hw - 0.75, hh, 0.14, 0.22);
}

/** Open truss girder from a to b, `w` wide: two chords and zigzag lacing. */
function truss(g: Ctx, a: Vec, b: Vec, w: number, color: string, alpha: number) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  local(g, a.x, a.y, Math.atan2(b.y - a.y, b.x - a.x), () => {
    g.fillStyle = `rgba(${color},${alpha * 0.18})`;
    g.fillRect(0, -w / 2, len, w);
    g.strokeStyle = `rgba(${color},${alpha})`;
    g.lineCap = 'butt';
    g.lineWidth = 0.18;
    g.beginPath();
    g.moveTo(0, -w / 2);
    g.lineTo(len, -w / 2);
    g.moveTo(0, w / 2);
    g.lineTo(len, w / 2);
    g.stroke();
    g.lineWidth = 0.08;
    g.beginPath();
    for (let x = 0, s = 1; x < len; x += w, s = -s) {
      g.moveTo(x, (-s * w) / 2);
      g.lineTo(Math.min(len, x + w), (s * w) / 2);
    }
    g.stroke();
  });
}

function drawCrane(g: Ctx, d: Of<'crane'>, layer: DecorLayer, t: number) {
  const [hl, hs] = [d.len / 2, d.span / 2];
  const legs = [-hl, hl].flatMap((x) => [-hs, hs].map((y) => ({ x, y })));
  const tip = { x: 0, y: hs + d.boom };
  const lamps = d.boom > 0 ? [...legs, tip] : legs;
  const girders: [Vec, Vec, number][] = [
    [{ x: -hl - 1, y: -hs }, { x: hl + 1, y: -hs }, 1],
    [{ x: -hl - 1, y: hs }, { x: hl + 1, y: hs }, 1],
    [{ x: -hl, y: -hs }, { x: -hl, y: hs }, 1.4],
    [{ x: hl, y: -hs }, { x: hl, y: hs }, 1.4],
  ];
  if (d.boom > 0) girders.push([{ x: 0, y: -hs }, tip, 2]);
  local(g, d.x, d.y, d.angle, () => {
    if (layer === 'floor') {
      if (d.boom > 0) {
        g.strokeStyle = 'rgba(160,160,155,0.45)'; // crane rails
        g.lineWidth = 0.1;
        g.beginPath();
        for (const y of [-hs, hs])
          for (const o of [-0.35, 0.35]) (g.moveTo(-hl - 30, y + o), g.lineTo(hl + 30, y + o));
        g.stroke();
      }
      g.strokeStyle = 'rgba(0,0,0,0.28)'; // the girders' shadow on the ground
      g.lineCap = 'butt';
      for (const [a, b, w] of girders) {
        g.lineWidth = w;
        g.beginPath();
        g.moveTo(a.x + 1, a.y + 1.4);
        g.lineTo(b.x + 1, b.y + 1.4);
        g.stroke();
      }
    } else if (layer === 'wall') {
      for (const [a, b, w] of girders) truss(g, a, b, w, rgb(STEEL), 0.9);
      const trolley = d.boom > 0 ? { x: 0, y: hs + d.boom * 0.7 } : { x: hl, y: 0 };
      g.fillStyle = '#2a2b30';
      g.fillRect(trolley.x - 1.1, trolley.y - 1.4, 2.2, 2.8);
      g.fillStyle = 'rgba(160,200,230,0.5)'; // operator cab glass
      g.fillRect(trolley.x - 0.8, trolley.y + 0.6, 1.6, 0.5);
      for (const p of legs) {
        g.fillStyle = STEEL;
        g.fillRect(p.x - 1, p.y - 1, 2, 2);
        g.strokeStyle = 'rgba(0,0,0,0.45)';
        g.lineWidth = 0.12;
        g.strokeRect(p.x - 0.9, p.y - 0.9, 1.8, 1.8);
        g.beginPath();
        g.moveTo(p.x - 0.9, p.y - 0.9);
        g.lineTo(p.x + 0.9, p.y + 0.9);
        g.moveTo(p.x + 0.9, p.y - 0.9);
        g.lineTo(p.x - 0.9, p.y + 0.9);
        g.stroke();
      }
      g.fillStyle = '#5a1410'; // unlit lamp housings
      for (const p of lamps) {
        g.beginPath();
        g.arc(p.x, p.y, 0.25, 0, Math.PI * 2);
        g.fill();
      }
    } else if (layer === 'over' && (t * 0.8 + d.seed * 0.29) % 1 < 0.4) {
      for (const p of lamps) {
        pool(g, p.x, p.y, 2.2, LAMP_RED, 0.5);
        pool(g, p.x, p.y, 0.45, '255,190,170', 1);
      }
    }
  });
}

function drawBollard(g: Ctx, d: Of<'bollard'>) {
  g.fillStyle = '#26272b'; // base plate over the pillar
  g.fillRect(d.x - 0.4, d.y - 0.4, 0.8, 0.8);
  const disc = (r: number, color: string, dx = 0) => {
    g.fillStyle = color;
    g.beginPath();
    g.arc(d.x + dx, d.y + dx, r, 0, Math.PI * 2);
    g.fill();
  };
  disc(0.31, '#d6a51f');
  disc(0.2, '#1c1d21');
  disc(0.07, 'rgba(255,255,255,0.3)', -0.07);
}

function drawCoil(g: Ctx, d: Of<'coil'>) {
  const rand = rng(d.seed * 31 + 9);
  const color = ['#c9a46a', '#d0662a', '#2f6db0'][Math.floor(rand() * 3)];
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.beginPath();
  g.arc(d.x + 0.08, d.y + 0.1, 0.55, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = 0.07;
  for (let r = 0.14; r < 0.52; r += 0.085) {
    g.beginPath();
    g.arc(d.x, d.y, r, rand() * 6, rand() * 6 + 6);
    g.stroke();
  }
  const a = rand() * Math.PI * 2; // loose end
  g.beginPath();
  g.moveTo(d.x + 0.5 * Math.cos(a), d.y + 0.5 * Math.sin(a));
  g.quadraticCurveTo(
    d.x + 1.1 * Math.cos(a + 0.4),
    d.y + 1.1 * Math.sin(a + 0.4),
    d.x + 1.5 * Math.cos(a),
    d.y + 1.5 * Math.sin(a),
  );
  g.stroke();
}

function drawPuddle(g: Ctx, d: Of<'puddle'>, layer: DecorLayer) {
  const rand = rng(d.seed * 59 + 4);
  for (let i = 0; i < 3; i++) {
    const x = d.x + (rand() - 0.5) * d.r;
    const y = d.y + (rand() - 0.5) * d.r * 0.6;
    g.save();
    g.translate(x, y);
    g.scale(1 + rand(), 0.6 + rand() * 0.3);
    if (layer === 'floor') {
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, d.r);
      grad.addColorStop(0, 'rgba(6,8,14,0.3)');
      grad.addColorStop(0.7, 'rgba(10,14,24,0.2)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(-d.r, -d.r, 2 * d.r, 2 * d.r);
    } else pool(g, 0, 0, d.r, SODIUM, 0.16); // the mirror catches the lamps
    g.restore();
  }
}

const ships = new WeakMap<object, HTMLCanvasElement>();
const SHIP_PX = 10;

/** Moored container ship, bow at +x, prerendered once. */
function shipCanvas(L: number, B: number) {
  const c = document.createElement('canvas');
  c.width = L * SHIP_PX;
  c.height = B * SHIP_PX;
  const g = c.getContext('2d')!;
  g.scale(SHIP_PX, SHIP_PX);
  const rand = rng(1957);
  const hull = new Path2D();
  hull.moveTo(3, 0.3);
  hull.lineTo(L - 32, 0.3);
  hull.quadraticCurveTo(L - 5, 0.3, L, B / 2);
  hull.quadraticCurveTo(L - 5, B - 0.3, L - 32, B - 0.3);
  hull.lineTo(3, B - 0.3);
  hull.quadraticCurveTo(0, B / 2, 3, 0.3);
  g.fillStyle = '#7a2620'; // red hull flare seen past the deck edge
  g.fill(hull);
  g.save();
  g.clip(hull);
  g.fillStyle = '#3a3f46';
  g.fillRect(1, 1.1, L - 2.2, B - 2.2);
  g.restore();
  g.strokeStyle = '#d8d4c8'; // white bulwark rail
  g.lineWidth = 0.15;
  g.stroke(hull);
  // container bays between the bridge and the forecastle
  for (let x = 28; x + 12.2 < L - 34; x += 12.8) {
    g.fillStyle = '#2b3036'; // hatch cover
    g.fillRect(x - 0.2, 1.6, 12.6, B - 3.2);
    for (let y = 2; y + 2.44 <= B - 2; y += 2.5) {
      if (rand() < 0.08) continue;
      g.fillStyle = DOCK_BOXES[Math.floor(rand() * DOCK_BOXES.length)];
      g.fillRect(x, y, 12.2, 2.4);
      g.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.08)';
      g.fillRect(x, y, 12.2, 2.4);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      for (let k = x + 0.4; k < x + 12; k += 0.5) g.fillRect(k, y + 0.1, 0.12, 2.2);
    }
  }
  // accommodation block and bridge wings near the stern, funnel aft of it
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(9.5, 3.5, 13, B - 6);
  g.fillStyle = '#dcd8cc';
  g.fillRect(8, 3, 13, B - 6);
  g.fillStyle = '#cbc7bb';
  g.fillRect(18, 0.6, 3, B - 1.2);
  g.fillStyle = '#ffd890'; // lit bridge windows
  for (let y = 1; y < B - 1; y += 0.9) g.fillRect(20.7, y, 0.3, 0.5);
  g.fillStyle = '#1c1c1e';
  g.fillRect(4, B / 2 - 2.2, 4, 4.4);
  g.fillStyle = '#b5302a';
  g.fillRect(4, B / 2 - 2.2, 4, 1);
  g.fillRect(4, B / 2 + 1.2, 4, 1);
  // forecastle: winches, anchor chains, mast
  g.fillStyle = '#2b2e33';
  for (const y of [B / 2 - 4, B / 2 + 4]) {
    g.beginPath();
    g.arc(L - 22, y, 1.2, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = '#55585e';
  g.lineWidth = 0.25;
  g.beginPath();
  g.moveTo(L - 22, B / 2 - 4);
  g.lineTo(L - 8, B / 2 - 1.5);
  g.moveTo(L - 22, B / 2 + 4);
  g.lineTo(L - 8, B / 2 + 1.5);
  g.stroke();
  g.fillStyle = '#e8e4d8';
  g.fillRect(L - 16, B / 2 - 0.4, 0.8, 0.8);
  // deck lights and running lights (red port, green starboard = quay side)
  for (let x = 30; x < L - 36; x += 26) pool(g, x, B - 1.2, 5, '255,190,110', 0.25);
  pool(g, 19.5, 0.8, 1.4, '255,40,30', 0.9);
  pool(g, 19.5, B - 0.8, 1.4, '40,255,120', 0.9);
  pool(g, L - 15.6, B / 2, 1.2, '255,255,240', 0.9);
  return c;
}

/** Water past the floor edge: shimmer on a 3 m grid, fenders on the quay face, ship, ropes. */
function drawSea(g: Ctx, d: Of<'sea'>, t: number) {
  const [fx0, fy0, fx1, fy1] = [d.x, d.y, d.x + d.w, d.y + d.h];
  const view = viewOf(g) ?? { x: fx0 - 60, y: fy0 - 60, w: d.w + 120, h: d.h + 120 };
  const [x0, y0, x1, y1] = [view.x, view.y, view.x + view.w, view.y + view.h];
  if (x0 >= fx0 && y0 >= fy0 && x1 <= fx1 && y1 <= fy1) return;
  g.save();
  g.beginPath();
  g.rect(x0, y0, view.w, view.h);
  g.rect(d.x, d.y, d.w, d.h);
  g.clip('evenodd');
  g.fillStyle = '#0b1a22';
  g.fillRect(x0, y0, view.w, view.h);
  const S = 3;
  const glints: number[][] = [[], [], []];
  for (let i = Math.floor(x0 / S); i * S < x1; i++)
    for (let j = Math.floor(y0 / S); j * S < y1; j++) {
      if (i * S >= fx0 && j * S >= fy0 && (i + 1) * S <= fx1 && (j + 1) * S <= fy1) continue;
      const h = Math.abs(Math.sin(i * 127.1 + j * 311.7) * 43758.5453) % 1;
      const k = 0.5 + 0.5 * Math.sin(t * (0.6 + h) + h * 40);
      glints[Math.min(2, Math.floor(k * 3))].push(
        i * S + ((h * 13) % 1) * S,
        j * S + ((h * 7) % 1) * S,
        0.6 + ((h * 3) % 1) * 1.8,
      );
    }
  g.lineWidth = 0.12;
  glints.forEach((gs, b) => {
    g.strokeStyle = `rgba(140,185,225,${[0.03, 0.09, 0.2][b]})`;
    g.beginPath();
    for (let n = 0; n < gs.length; n += 3)
      (g.moveTo(gs[n], gs[n + 1]), g.lineTo(gs[n] + gs[n + 2], gs[n + 1]));
    g.stroke();
  });
  // rubber fenders hung on the quay face every 8 m
  g.fillStyle = '#141416';
  for (let x = fx0 + 4; x < fx1; x += 8) {
    if (x < x0 - 2 || x > x1 + 2) continue;
    g.fillRect(x - 0.9, fy0 - 0.7, 1.8, 0.7);
    g.fillRect(x - 0.9, fy1, 1.8, 0.7);
  }
  for (let y = fy0 + 4; y < fy1; y += 8) {
    if (y < y0 - 2 || y > y1 + 2) continue;
    g.fillRect(fx0 - 0.7, y - 0.9, 0.7, 1.8);
    g.fillRect(fx1, y - 0.9, 0.7, 1.8);
  }
  const s = d.ship;
  const seen = s.x < x1 && s.x + s.w > x0 && s.y < y1 && s.y + s.h > y0;
  if (seen && typeof document !== 'undefined') {
    const along = s.h > s.w; // lying north-south: bow south, quay side west
    let c = ships.get(d);
    if (!c) ships.set(d, (c = along ? shipCanvas(s.h, s.w) : shipCanvas(s.w, s.h)));
    g.save();
    g.translate(along ? s.x + s.w : s.x, s.y);
    if (along) g.rotate(Math.PI / 2);
    g.drawImage(c, 0, 0, Math.max(s.w, s.h), Math.min(s.w, s.h));
    g.restore();
  }
  g.strokeStyle = '#b39468';
  g.lineWidth = 0.12;
  g.beginPath();
  for (const [a, b] of d.ropes) (g.moveTo(a.x, a.y), g.lineTo(b.x, b.y));
  g.stroke();
  g.restore();
}

function drawDock(g: Ctx, d: Of<DockDecor['kind']>, layer: DecorLayer, t: number) {
  switch (d.kind) {
    case 'container':
      if (layer === 'wall') drawContainer(g, d);
      break;
    case 'crane':
      drawCrane(g, d, layer, t);
      break;
    case 'bollard':
      if (layer === 'wall') drawBollard(g, d);
      break;
    case 'coil':
      if (layer === 'floor') drawCoil(g, d);
      break;
    case 'puddle':
      if (layer === 'floor' || layer === 'glow') drawPuddle(g, d, layer);
      break;
    case 'reflection': {
      if (layer !== 'light' && layer !== 'glow') break;
      const glow = layer === 'glow';
      g.save();
      g.translate(d.x, d.y + 3);
      g.scale(0.8, 4.5);
      pool(g, 0, 0, 1, glow ? SODIUM : '255,255,255', glow ? 0.3 : 0.25);
      g.restore();
      break;
    }
    case 'sea':
      if (layer === 'sea') drawSea(g, d, t);
      break;
  }
}
