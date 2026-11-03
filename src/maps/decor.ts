import type { GameMap, Vec } from '../types';

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
  for (const d of decor) {
    if (d.floor !== floorIndex) continue;
    g.globalAlpha = base;
    switch (d.kind) {
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
