import { CAR_LENGTH, CAR_WIDTH, inRect } from './collision';
import type { CarState, Floor, GameMap, Helix, Rect, Solid, Vec } from './types';
import { garage, garageRoute } from './maps/garage';
import { CAR_MODELS } from './models';
import { drawParkedCar } from './sprites';
import type { RenderView } from './view';

// --- visual tuning ---
const STATIC_PX = 10; // px per meter, pre-rendered floor layer
const SKID_PX = 8; // px per meter, skid layer
const SPRITE_PX = 48; // px per meter, player car sprite
const VIEW_H_REST = 38; // meters visible vertically at rest
const VIEW_H_FAST = 58; // ... at ZOOM_FULL_KMH
const ZOOM_FULL_KMH = 130;
const LOOK_AHEAD = 0.35; // s of velocity
const CAM_POS_RATE = 4; // 1/s exponential follow
const CAM_ZOOM_RATE = 1.5;
const SHAKE_PX = 7; // CSS px at shake = 1

const BG = '#0a0b0d';
const CONCRETE = '#2b2c30';
const CONCRETE_ROOF = '#22262e';
const PAINT_WHITE = '#b9b9b0';
const ARROW_ALPHA = 0.35; // painted floor arrows, applied after the wear mask
const PAINT_YELLOW = '#cfa82a';
const HAZARD_YELLOW = '#dcae1e';
const HAZARD_BLACK = '#17171a';
const WALL = '#3a3b40';
const WALL_TOP = '#45464c';
const PILLAR = '#a19e95';
const PILLAR_TOP = '#b3b0a7';
const STATIC_SHADOW = 'rgba(0,0,0,0.55)';
const RAMP = '#37383d'; // helix ring: smooth ramp concrete
const LABEL = 'rgba(240,240,230,0.8)';
const DIP = 0.1; // camera zoom-out at mid helix crossfade
const PARKED_COLORS = [
  '#5a6470',
  '#6b5a4e',
  '#3e4a5c',
  '#7a7a74',
  '#4f5e52',
  '#5c4a5e',
  '#8a8578',
  '#2f3a44',
  '#6e4040',
];

const PLAYER_RED = '#d32030';
const PLAYER_HOOD = '#a81a28';
const PLAYER_DECK = '#b81c2b';
const CAR_SHADOW_OFFSET: Vec = { x: 0.25, y: 0.35 };
const CAR_SHADOW_ALPHA = 0.55;
const POD_Y = 0.48; // pop-up headlight pods, m off the center line

// lighting: dark ambient layer with light cut out (half res) drawn over the world, then additive glows
const LIGHT_PX = 4; // px per meter, static per-floor light layers
const AMBIENT = 0.82; // darkness inside the garage
const AMBIENT_ROOF = 0.74;
const LIGHT_R = 7; // ceiling pool radius
const POST_R = 9; // roof lamp posts
const HEAD_LEN = 25; // player headlight cones
const PARKED_HEAD_LEN = 18;
const HAZARD_HZ = 1.5;

const SKID_STYLE = 'rgba(12,12,14,0.35)';
const SKID_W = 0.25;
const SKID_MIN_KMH = 15;
const REAR_AXLE = -1.2; // m from car center along heading
const TRACK_HALF = CAR_WIDTH / 2 - 0.2;

const SMOKE_CAP = 300;
const SMOKE_LIFE = 1.2;
const SMOKE_RATE = 2.2; // particles/s per (rad x km/h)
const SMOKE_MAX_RATE = 140;
const SMOKE_INHERIT = 0.2;
const SMOKE_ALPHA = 0.2;
const SMOKE_RGB = '205,205,210';

type Ctx = CanvasRenderingContext2D;

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  return { c, g: c.getContext('2d')! };
}

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Radial falloff sprite, drawn once and reused. */
function glowSprite(rgb: string, stops: [number, number][]) {
  const { c, g } = makeCanvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [at, a] of stops) grad.addColorStop(at, `rgba(${rgb},${a})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return c;
}

/** Light cone, apex at the left middle, 1 unit long along +x (draw into a len x len square); ~35° spread, soft edges. */
function coneSprite(rgb: string) {
  const N = 256;
  const { c, g } = makeCanvas(N, N);
  const img = g.createImageData(N, N);
  const [r, gr, b] = rgb.split(',').map(Number);
  const half = (17.5 * Math.PI) / 180;
  const soft = (8 * Math.PI) / 180;
  const smooth = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N;
      const v = (y + 0.5 - N / 2) / N;
      const d = Math.hypot(u, v);
      const a =
        (1 - smooth(half - soft, half + soft, Math.abs(Math.atan2(v, u)))) *
        Math.max(0, 1 - d) ** 1.6 *
        smooth(0, 0.03, d);
      const i = (y * N + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = gr;
      img.data[i + 2] = b;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** A light source: cone (ang = direction, size = length) or round glow (size = radius). */
interface Lamp {
  cone: boolean;
  x: number;
  y: number;
  ang: number;
  size: number;
  /** how much darkness it removes, 0..1 */
  cut: number;
  /** colored additive glow: tint key + alpha */
  tint: Tint;
  glow: number;
}
type Tint = 'cool' | 'warm' | 'red' | 'amber' | 'white';
const TINTS: Record<Tint, string> = {
  cool: '205,230,255',
  warm: '255,232,190',
  red: '255,30,40',
  amber: '255,150,20',
  white: '255,255,255',
};

let lightSprites: {
  cone: HTMLCanvasElement;
  dot: HTMLCanvasElement;
  cones: Record<Tint, HTMLCanvasElement>;
  dots: Record<Tint, HTMLCanvasElement>;
} | null = null;
function lightKit() {
  if (!lightSprites) {
    const dot = (rgb: string) =>
      glowSprite(rgb, [
        [0, 1],
        [0.35, 0.5],
        [1, 0],
      ]);
    const per = (f: (rgb: string) => HTMLCanvasElement) =>
      Object.fromEntries(Object.entries(TINTS).map(([k, rgb]) => [k, f(rgb)])) as Record<
        Tint,
        HTMLCanvasElement
      >;
    lightSprites = {
      cone: coneSprite(TINTS.white),
      dot: dot(TINTS.white),
      cones: per(coneSprite),
      dots: per(dot),
    };
  }
  return lightSprites;
}

/** Draws a lamp's darkness cut (mask = true, white) or its colored glow, scaled by weight a. */
function drawLamp(g: Ctx, l: Lamp, mask: boolean, a: number) {
  const s = lightKit();
  const k = (mask ? l.cut : l.glow) * a;
  if (k <= 0) return;
  g.globalAlpha = Math.min(1, k);
  if (l.cone) {
    g.save();
    g.translate(l.x, l.y);
    g.rotate(l.ang);
    g.drawImage(mask ? s.cone : s.cones[l.tint], 0, -l.size / 2, l.size, l.size);
    g.restore();
  } else {
    const img = mask ? s.dot : s.dots[l.tint];
    g.drawImage(img, l.x - l.size, l.y - l.size, 2 * l.size, 2 * l.size);
  }
}

/** Patchy alpha used to make painted arrows look worn; tiles seamlessly enough at 19 m. */
let wear: HTMLCanvasElement | null = null;
function wearMask() {
  if (wear) return wear;
  const rand = rng(4242);
  const n = 24;
  const small = makeCanvas(n, n);
  const img = small.g.createImageData(n, n);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = 130 + rand() * 125;
  }
  small.g.putImageData(img, 0, 0);
  const { c, g } = makeCanvas(192, 192);
  g.drawImage(small.c, 0, 0, 192, 192);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(0,0,0,${0.3 + rand() * 0.7})`;
    g.fillRect(rand() * 192, rand() * 192, 1 + rand() * 2, 1 + rand() * 2);
  }
  return (wear = c);
}

function hazard(g: Ctx, r: Rect, band: number) {
  g.save();
  g.beginPath();
  g.rect(r.x, r.y, r.w, r.h);
  g.clip();
  g.fillStyle = HAZARD_YELLOW;
  g.fillRect(r.x, r.y, r.w, r.h);
  g.fillStyle = HAZARD_BLACK;
  g.beginPath();
  for (let d = 0; d < r.w + r.h; d += band * 2) {
    const x = r.x + d;
    g.moveTo(x, r.y);
    g.lineTo(x + band, r.y);
    g.lineTo(x + band - r.h, r.y + r.h);
    g.lineTo(x - r.h, r.y + r.h);
  }
  g.fill();
  g.restore();
}

const STEM = 6; // turn arrow stem length (m) behind the bend
const OUT = 2.4; // leg after the bend, before the head
const HEAD = 2;

/** Arrowhead at (x, y) pointing along ang. */
function arrowHead(g: Ctx, x: number, y: number, ang: number) {
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  g.beginPath();
  g.moveTo(HEAD, 0);
  g.lineTo(0, -1.4);
  g.lineTo(0, 1.4);
  g.closePath();
  g.fill();
  g.restore();
}

/** Painted turn arrow, bend at (x, y): stem along dirIn, bending by `turn` (|turn| <= 90°) into a head. */
function turnArrow(g: Ctx, x: number, y: number, dirIn: number, turn: number) {
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  g.save();
  g.translate(x, y);
  g.rotate(dirIn);
  g.beginPath();
  g.moveTo(-STEM, 0);
  g.arcTo(0, 0, c, s, 1.1);
  g.lineTo(OUT * c, OUT * s);
  g.stroke();
  arrowHead(g, OUT * c, OUT * s, turn);
  g.restore();
}

/** World sample points covering a turn arrow's footprint (stem, leg, head, ±0.9 m wide). */
function turnFootprint(x: number, y: number, dirIn: number, turn: number): Vec[] {
  const pts: Vec[] = [];
  const add = (u: number, w: number) =>
    pts.push({
      x: x + u * Math.cos(dirIn) - w * Math.sin(dirIn),
      y: y + u * Math.sin(dirIn) + w * Math.cos(dirIn),
    });
  for (let u = -STEM; u <= 0; u += 1) for (const w of [-1.4, 0, 1.4]) add(u, w);
  for (let d = 0.5; d <= OUT + HEAD; d += 0.8)
    for (const w of [-1.4, 0, 1.4])
      add(d * Math.cos(turn) - w * Math.sin(turn), d * Math.sin(turn) + w * Math.cos(turn));
  return pts;
}

/** Road-marking text centered at (x, y); `heading` = direction the reader drives (text top points there). */
function label(
  g: Ctx,
  text: string,
  x: number,
  y: number,
  heading: number,
  size: number,
  maxW: number,
  upright = false,
) {
  let rot = heading + Math.PI / 2;
  if (upright && Math.cos(rot) < -0.01) rot += Math.PI; // keep text readable on screen
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.scale(1 / STATIC_PX, 1 / STATIC_PX); // font in px: avoids tiny-font rendering quirks
  g.fillStyle = LABEL;
  g.font = `bold ${Math.round(size * STATIC_PX)}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 0, 0, maxW * STATIC_PX);
  g.restore();
}

/** Lane-center point and travel heading at fraction p of the helix sweep. */
function helixAt(h: Helix, p: number) {
  const a = h.enterAngle + h.sweep * p;
  const r = (h.rCore + h.rOuter) / 2;
  return {
    pos: { x: h.center.x + r * Math.cos(a), y: h.center.y + r * Math.sin(a) },
    angle: a + (Math.sign(h.sweep) * Math.PI) / 2,
  };
}

/** Helix ring surface on one of its two floors: ramp concrete, dashed edges, chevrons, label. */
function helixSurface(g: Ctx, h: Helix, upper: boolean, text: string) {
  const { x: cx, y: cy } = h.center;
  const a0 = h.enterAngle;
  const a1 = h.enterAngle + h.sweep;
  const ccw = h.sweep < 0;
  const w = h.rOuter - h.rCore;
  // draw the ring shape 1 km off-canvas and keep only its blurred shadow: soft ~0.5 m (sigma)
  // edges, no hard half-disc against the floor. Inset 0.25 m so the fade sits inside the rim.
  const ro = h.rOuter - 0.25;
  const da = (0.25 / ro) * Math.sign(h.sweep);
  g.save();
  g.translate(-1000, 0);
  g.shadowColor = RAMP;
  g.shadowOffsetX = 1000 * STATIC_PX;
  g.shadowBlur = STATIC_PX;
  g.beginPath();
  g.arc(cx, cy, ro, a0 + da, a1 - da, ccw);
  g.arc(cx, cy, h.rCore - 0.5, a1 - da, a0 + da, !ccw);
  g.closePath();
  g.fill();
  g.restore();

  g.strokeStyle = PAINT_WHITE;
  g.lineWidth = 0.15;
  g.setLineDash([1.2, 0.9]);
  for (const r of [h.rCore + 0.3, h.rOuter - 0.3]) {
    g.beginPath();
    g.arc(cx, cy, r, a0, a1, ccw);
    g.stroke();
  }
  g.setLineDash([]);

  // label at this floor's end of the ramp
  const { pos, angle } = helixAt(h, upper ? 0.07 : 0.93);
  label(g, text, pos.x, pos.y, angle, Math.min(1.6, w * 0.22), w * 0.8, true);
}

/** Curved painted arrow along the helix lane just after its entry. */
function helixArrow(g: Ctx, h: Helix) {
  const r = (h.rCore + h.rOuter) / 2;
  const a0 = h.enterAngle + h.sweep * 0.15;
  const a1 = h.enterAngle + h.sweep * 0.36;
  g.beginPath();
  g.arc(h.center.x, h.center.y, r, a0, a1, h.sweep < 0);
  g.stroke();
  const { pos, angle } = helixAt(h, 0.36);
  arrowHead(g, pos.x, pos.y, angle);
}

/** Direction from the rect center toward its back (wall or opposite bay) along its long axis. */
function backAngle(r: Rect, blockers: Rect[]) {
  const tall = r.h >= r.w;
  const p = tall ? { x: r.x + r.w / 2, y: r.y - 0.8 } : { x: r.x - 0.8, y: r.y + r.h / 2 };
  const first = blockers.some((b) => inRect(p, b));
  return tall ? (first ? -Math.PI / 2 : Math.PI / 2) : first ? Math.PI : 0;
}

interface ParkedPose {
  s: Solid;
  x: number;
  y: number;
  /** nose heading */
  facing: number;
  len: number;
  wid: number;
}

/** Parked cars with their center, nose heading (data or nose-in) and footprint. */
function parkedPoses(f: Floor): ParkedPose[] {
  const blockers: Rect[] = [...f.solids.filter((s) => s.kind === 'wall'), ...f.bays];
  return f.solids
    .filter((s) => s.kind === 'car')
    .map((s) => {
      const m = s.model && CAR_MODELS[s.model];
      return {
        s,
        x: s.x + s.w / 2,
        y: s.y + s.h / 2,
        facing: s.facing ?? backAngle(s, blockers),
        len: m ? m.length : Math.max(s.w, s.h),
        wid: m ? m.width : Math.min(s.w, s.h),
      };
    });
}

/** Lamps of a parked car with headlights on: cones from the front corners, lamp and tail glows. */
function parkedLamps(p: ParkedPose): Lamp[] {
  const c = Math.cos(p.facing);
  const s = Math.sin(p.facing);
  const at = (u: number, w: number) => ({ x: p.x + u * c - w * s, y: p.y + u * s + w * c });
  const out: Lamp[] = [];
  for (const side of [-1, 1]) {
    const w = side * (p.wid / 2 - 0.35);
    const f = at(p.len / 2 - 0.1, w);
    const r = at(-p.len / 2, w);
    out.push(
      {
        cone: true,
        ...f,
        ang: p.facing,
        size: PARKED_HEAD_LEN,
        cut: 0.8,
        tint: 'warm',
        glow: 0.14,
      },
      { cone: false, ...f, ang: 0, size: 0.7, cut: 0.4, tint: 'warm', glow: 0.4 },
      { cone: false, ...r, ang: 0, size: 0.6, cut: 0.15, tint: 'red', glow: 0.3 },
    );
  }
  return out;
}

/** The four corner lamps of a parked car with hazards on. */
function hazardLamps(p: ParkedPose): Lamp[] {
  const c = Math.cos(p.facing);
  const s = Math.sin(p.facing);
  const out: Lamp[] = [];
  for (const u of [-1, 1])
    for (const w of [-1, 1]) {
      const lu = u * (p.len / 2 - 0.15);
      const lw = w * (p.wid / 2 - 0.15);
      out.push({
        cone: false,
        x: p.x + lu * c - lw * s,
        y: p.y + lu * s + lw * c,
        ang: 0,
        size: 1.6,
        cut: 0.4,
        tint: 'amber',
        glow: 0.85,
      });
    }
  return out;
}

/** Static per-floor light layers: darkness cut mask (white alpha), colored glow, blinking hazard lamps. */
function buildLights(map: GameMap, idx: number) {
  const f = map.floors[idx];
  const mk = () => {
    const l = makeCanvas(f.w * LIGHT_PX, f.h * LIGHT_PX);
    l.g.scale(LIGHT_PX, LIGHT_PX);
    return l;
  };
  const mask = mk();
  const glow = mk();
  const lamps: Lamp[] = [];
  if (idx === 0) {
    // roof: lamp posts (its pillars) instead of ceiling lights
    for (const s of f.solids) {
      if (s.kind !== 'pillar') continue;
      const [x, y] = [s.x + s.w / 2, s.y + s.h / 2];
      lamps.push({ cone: false, x, y, ang: 0, size: POST_R, cut: 0.5, tint: 'cool', glow: 0.1 });
    }
  } else {
    for (const l of f.lights)
      lamps.push({ cone: false, ...l, ang: 0, size: LIGHT_R, cut: 0.5, tint: 'cool', glow: 0.07 });
  }
  const poses = parkedPoses(f);
  for (const p of poses) if (p.s.lights === 'on') lamps.push(...parkedLamps(p));
  for (const l of lamps) {
    drawLamp(mask.g, l, true, 1);
    drawLamp(glow.g, l, false, 1);
  }
  return {
    mask: mask.c,
    glow: glow.c,
    hazards: poses.filter((p) => p.s.lights === 'hazard').map(hazardLamps),
  };
}

/** Parked car in local frame, +x = nose. */
function parkedCar(g: Ctx, len: number, wid: number, color: string) {
  const hl = len / 2;
  const hw = wid / 2;
  g.shadowColor = STATIC_SHADOW;
  g.shadowBlur = 10;
  g.shadowOffsetX = 3;
  g.shadowOffsetY = 4;
  g.fillStyle = color;
  g.beginPath();
  g.roundRect(-hl, -hw, len, wid, [0.35, 0.55, 0.55, 0.35]);
  g.fill();
  g.shadowColor = 'transparent';
  g.fillStyle = 'rgba(0,0,0,0.18)'; // hood/trunk shading
  g.fillRect(hl - 1.0, -hw + 0.15, 0.8, wid - 0.3);
  g.fillRect(-hl + 0.15, -hw + 0.15, 0.6, wid - 0.3);
  g.fillStyle = '#121519'; // windshield + rear window
  g.beginPath();
  g.moveTo(0.95, -hw + 0.2);
  g.lineTo(0.95, hw - 0.2);
  g.lineTo(0.45, hw - 0.12);
  g.lineTo(0.45, -hw + 0.12);
  g.closePath();
  g.moveTo(-0.95, -hw + 0.22);
  g.lineTo(-0.95, hw - 0.22);
  g.lineTo(-0.6, hw - 0.14);
  g.lineTo(-0.6, -hw + 0.14);
  g.closePath();
  g.fill();
  g.fillStyle = color; // roof
  g.beginPath();
  g.roundRect(-0.6, -hw + 0.14, 1.05, wid - 0.28, 0.15);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.fill();
  g.fillStyle = 'rgba(230,230,200,0.5)'; // headlights
  g.fillRect(hl - 0.12, -hw + 0.15, 0.08, 0.35);
  g.fillRect(hl - 0.12, hw - 0.5, 0.08, 0.35);
}

/** Worn white arrow layer (full opacity, caller fades it): turn arrows before route turns > 30°, curved arrows at helix entries. */
function paintArrows(map: GameMap, idx: number): HTMLCanvasElement {
  const f = map.floors[idx];
  const { c, g } = makeCanvas(f.w * STATIC_PX, f.h * STATIC_PX);
  g.scale(STATIC_PX, STATIC_PX);
  g.strokeStyle = g.fillStyle = '#fff';
  g.lineWidth = 0.9;
  g.lineJoin = 'round';
  g.lineCap = 'round';

  const route = map === garage ? (garageRoute.find((r) => r.floor === idx)?.points ?? []) : [];
  const rings = map.helixes.filter((h) => h.from === idx || h.from + 1 === idx);
  const blocked = (p: Vec) =>
    p.x < 1 ||
    p.y < 1 ||
    p.x > f.w - 1 ||
    p.y > f.h - 1 ||
    f.bays.some((r) => inRect(p, r)) ||
    f.solids.some((r) => inRect(p, r)) ||
    f.circles.some((k) => Math.hypot(p.x - k.x, p.y - k.y) < k.r + 0.3) ||
    rings.some((h) => {
      const d = Math.hypot(p.x - h.center.x, p.y - h.center.y);
      return d > h.rCore - 0.3 && d < h.rOuter + 0.3;
    });
  const placed: Vec[] = [];
  for (let i = 1; i + 1 < route.length; i++) {
    const [a, b, n] = [route[i - 1], route[i], route[i + 1]];
    const dirIn = Math.atan2(b.y - a.y, b.x - a.x);
    let turn = Math.atan2(n.y - b.y, n.x - b.x) - dirIn;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    if (Math.abs(turn) <= Math.PI / 6) continue;
    turn = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, turn));
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    for (const back of [10, 8, 12, 6]) {
      if (back > segLen) continue;
      const x = b.x - back * Math.cos(dirIn);
      const y = b.y - back * Math.sin(dirIn);
      if (placed.some((q) => Math.hypot(q.x - x, q.y - y) < 10)) continue;
      if (turnFootprint(x, y, dirIn, turn).some(blocked)) continue;
      placed.push({ x, y });
      turnArrow(g, x, y, dirIn, turn);
      break;
    }
  }
  for (const h of map.helixes) if (h.from === idx) helixArrow(g, h);

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'destination-in';
  g.fillStyle = g.createPattern(wearMask(), 'repeat')!;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

function buildStatic(map: GameMap, idx: number): HTMLCanvasElement {
  const f = map.floors[idx];
  const roof = idx === 0;
  const { c, g } = makeCanvas(f.w * STATIC_PX, f.h * STATIC_PX);
  g.scale(STATIC_PX, STATIC_PX);
  const rand = rng(idx * 7919 + 17);

  // concrete + large-scale mottling + speckle + slab joints
  g.fillStyle = roof ? CONCRETE_ROOF : CONCRETE;
  g.fillRect(0, 0, f.w, f.h);
  for (let i = 0; i < (f.w * f.h) / 30; i++) {
    const x = rand() * f.w;
    const y = rand() * f.h;
    const r = 2 + rand() * 7;
    const tone = rand() < 0.55 ? '0,0,0' : '255,255,255';
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${tone},${0.02 + rand() * 0.035})`);
    grad.addColorStop(1, `rgba(${tone},0)`);
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  for (let i = 0; i < f.w * f.h * 0.5; i++) {
    g.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.045)';
    g.fillRect(rand() * f.w, rand() * f.h, 0.1, 0.1);
  }
  g.strokeStyle = 'rgba(0,0,0,0.22)';
  g.lineWidth = 0.06;
  g.beginPath();
  for (let x = 10; x < f.w; x += 10) (g.moveTo(x, 0), g.lineTo(x, f.h));
  for (let y = 10; y < f.h; y += 10) (g.moveTo(0, y), g.lineTo(f.w, y));
  g.stroke();

  // painted bays (tall or wide): long sides + back line, yellow wheel stop near the back
  const walls = f.solids.filter((s) => s.kind === 'wall');
  const blockers: Rect[] = [...walls, ...f.bays];
  g.strokeStyle = PAINT_WHITE;
  g.lineWidth = 0.12;
  g.lineCap = 'square';
  for (const b of f.bays) {
    const d = Math.max(b.w, b.h) / 2;
    const w = Math.min(b.w, b.h) / 2;
    g.save();
    g.translate(b.x + b.w / 2, b.y + b.h / 2);
    g.rotate(backAngle(b, blockers)); // local +x = toward the back
    g.beginPath();
    g.moveTo(-d, -w);
    g.lineTo(d, -w);
    g.lineTo(d, w);
    g.lineTo(-d, w);
    g.stroke();
    g.fillStyle = PAINT_YELLOW;
    g.fillRect(d - 0.82, -0.75, 0.22, 1.5);
    g.restore();
  }

  // finish: checkered strip on the edge facing the floor boundary + EXIT
  if (idx === map.finish.floor) {
    const z = map.finish.zone;
    const gaps = [z.x, f.w - z.x - z.w, z.y, f.h - z.y - z.h];
    const side = gaps.indexOf(Math.min(...gaps)); // 0 left, 1 right, 2 top, 3 bottom
    const d = 1;
    const strip: Rect =
      side === 0
        ? { x: z.x, y: z.y, w: d, h: z.h }
        : side === 1
          ? { x: z.x + z.w - d, y: z.y, w: d, h: z.h }
          : side === 2
            ? { x: z.x, y: z.y, w: z.w, h: d }
            : { x: z.x, y: z.y + z.h - d, w: z.w, h: d };
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.fillRect(z.x, z.y, z.w, z.h);
    const cell = 0.5;
    for (let i = 0; i * cell < strip.w; i++) {
      for (let j = 0; j * cell < strip.h; j++) {
        g.fillStyle = (i + j) % 2 ? '#111' : '#f2f2ee';
        g.fillRect(
          strip.x + i * cell,
          strip.y + j * cell,
          Math.min(cell, strip.w - i * cell),
          Math.min(cell, strip.h - j * cell),
        );
      }
    }
    // road-marking style next to the strip, reading toward the approaching driver
    const off = d + 1.3;
    label(
      g,
      'EXIT',
      side === 0 ? z.x + off : side === 1 ? z.x + z.w - off : z.x + z.w / 2,
      side === 2 ? z.y + off : side === 3 ? z.y + z.h - off : z.y + z.h / 2,
      [Math.PI, 0, -Math.PI / 2, Math.PI / 2][side],
      1.8,
      Infinity,
    );
  }

  for (const h of map.helixes) {
    if (h.from === idx) helixSurface(g, h, true, 'DOWN');
    else if (h.from + 1 === idx) helixSurface(g, h, false, f.name);
  }
  g.globalAlpha = ARROW_ALPHA;
  g.drawImage(paintArrows(map, idx), 0, 0, f.w, f.h);
  g.globalAlpha = 1;

  // walls with an inner hazard edge, pillars, parked cars (all with soft drop shadows)
  const shadow = () => {
    g.shadowColor = STATIC_SHADOW;
    g.shadowBlur = 10;
    g.shadowOffsetX = 3;
    g.shadowOffsetY = 4;
  };
  const noShadow = () => (g.shadowColor = 'transparent');
  for (const w of walls) {
    shadow();
    g.fillStyle = WALL;
    g.fillRect(w.x, w.y, w.w, w.h);
    noShadow();
    g.fillStyle = WALL_TOP;
    g.fillRect(w.x + 0.1, w.y + 0.1, w.w - 0.2, w.h - 0.2);
    const t = 0.3;
    const horiz = w.w >= w.h;
    const strip: Rect = horiz
      ? { x: w.x, y: w.y + w.h / 2 < f.h / 2 ? w.y + w.h - t : w.y, w: w.w, h: t }
      : { x: w.x + w.w / 2 < f.w / 2 ? w.x + w.w - t : w.x, y: w.y, w: t, h: w.h };
    hazard(g, strip, 0.4);
  }
  for (const s of f.solids) {
    if (s.kind !== 'pillar') continue;
    shadow();
    g.fillStyle = PILLAR;
    g.fillRect(s.x, s.y, s.w, s.h);
    noShadow();
    const e = s.w * 0.12;
    g.fillStyle = PILLAR_TOP;
    g.fillRect(s.x + e, s.y + e, s.w - 2 * e, s.h - 2 * e);
  }
  parkedPoses(f).forEach((p, i) => {
    const pick = (colors: string[]) => colors[(i * 7 + idx * 3) % colors.length];
    g.save();
    g.translate(p.x, p.y);
    g.rotate(p.facing);
    if (p.s.model) {
      shadow(); // shadow from an inset silhouette, the model sprite covers it
      g.fillStyle = '#000';
      g.beginPath();
      g.roundRect(-p.len / 2 + 0.15, -p.wid / 2 + 0.15, p.len - 0.3, p.wid - 0.3, 0.5);
      g.fill();
      noShadow();
      drawParkedCar(g, p.s.model, p.s.color ?? pick(CAR_MODELS[p.s.model].colors));
    } else parkedCar(g, p.len, p.wid, p.s.color ?? pick(PARKED_COLORS));
    g.restore();
  });
  // round concrete cores: hazard band at the edge, soft top highlight
  for (const k of f.circles) {
    shadow();
    g.fillStyle = PILLAR;
    g.beginPath();
    g.arc(k.x, k.y, k.r, 0, Math.PI * 2);
    g.fill();
    noShadow();
    const band = Math.min(0.45, k.r * 0.2);
    const n = 2 * Math.max(4, Math.round((Math.PI * k.r) / 0.9)); // even: stripes alternate cleanly
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const b = ((i + 1) / n) * Math.PI * 2;
      g.fillStyle = i % 2 ? HAZARD_BLACK : HAZARD_YELLOW;
      g.beginPath();
      g.arc(k.x, k.y, k.r, a, b);
      g.arc(k.x, k.y, k.r - band, b, a, true);
      g.fill();
    }
    const ri = k.r - band;
    const hl = g.createRadialGradient(k.x - ri * 0.35, k.y - ri * 0.35, 0, k.x, k.y, ri);
    hl.addColorStop(0, 'rgba(255,255,255,0.16)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = PILLAR_TOP;
    g.beginPath();
    g.arc(k.x, k.y, ri, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = hl;
    g.fill();
  }
  return c;
}

const SPRITE_M = 0.5; // sprite margin (m) around the car for shadow blur

/** Player roadster sprite + its blurred shadow, local frame +x = nose. */
function playerSprites() {
  const L = CAR_LENGTH;
  const hl = L / 2;
  const bh = CAR_WIDTH / 2 - 0.1; // body half width; tires peek out 0.1 m
  const mk = () => {
    const s = makeCanvas((L + 2 * SPRITE_M) * SPRITE_PX, (CAR_WIDTH + 2 * SPRITE_M) * SPRITE_PX);
    s.g.translate(s.c.width / 2, s.c.height / 2);
    s.g.scale(SPRITE_PX, SPRITE_PX);
    return s;
  };
  const body = (g: Ctx) => {
    g.beginPath();
    g.roundRect(-hl, -bh, L, 2 * bh, [0.35, 0.7, 0.7, 0.35]);
  };

  const sh = mk();
  sh.g.shadowColor = '#000';
  sh.g.shadowBlur = 14;
  sh.g.fillStyle = '#000';
  body(sh.g);
  sh.g.fill();

  const { c, g } = mk();
  g.fillStyle = '#121315'; // tires
  for (const x of [hl - 0.85, -hl + 0.8]) {
    for (const y of [-1, 1]) {
      g.beginPath();
      g.roundRect(x - 0.33, y * (CAR_WIDTH / 2 - 0.15) - 0.15, 0.66, 0.3, 0.08);
      g.fill();
    }
  }
  g.fillStyle = PLAYER_RED;
  body(g);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.1)'; // side gloss
  g.fillRect(-hl + 0.35, -bh + 0.07, L - 0.8, 0.1);
  g.fillStyle = PLAYER_HOOD;
  g.beginPath();
  g.roundRect(0.42, -bh + 0.2, hl - 0.55, 2 * bh - 0.4, [0.1, 0.5, 0.5, 0.1]);
  g.fill();
  g.fillStyle = PLAYER_DECK;
  g.beginPath();
  g.roundRect(-hl + 0.18, -bh + 0.2, 0.85, 2 * bh - 0.4, 0.25);
  g.fill();
  // raised pop-up headlight pods: dark recess behind, body-color top, lens face forward
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.lineWidth = 0.03;
  for (const y of [-1, 1]) {
    g.fillStyle = '#1a0306';
    g.fillRect(hl - 0.68, y * POD_Y - 0.15, 0.4, 0.3);
    g.fillStyle = '#e0303e';
    g.fillRect(hl - 0.6, y * POD_Y - 0.13, 0.28, 0.26);
    g.strokeRect(hl - 0.6, y * POD_Y - 0.13, 0.28, 0.26);
    g.fillStyle = '#fff2cc';
    g.fillRect(hl - 0.32, y * POD_Y - 0.12, 0.06, 0.24);
  }
  g.fillStyle = '#4a070d'; // tail lights
  g.fillRect(-hl + 0.02, -bh + 0.2, 0.08, 0.32);
  g.fillRect(-hl + 0.02, bh - 0.52, 0.08, 0.32);
  g.fillStyle = PLAYER_RED; // mirrors
  g.fillRect(0.0, -bh - 0.09, 0.14, 0.12);
  g.fillRect(0.0, bh - 0.03, 0.14, 0.12);
  g.fillStyle = '#0c0f13'; // windshield
  g.beginPath();
  g.moveTo(0.4, -bh + 0.18);
  g.lineTo(0.4, bh - 0.18);
  g.lineTo(0.12, bh - 0.08);
  g.lineTo(0.12, -bh + 0.08);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.22)';
  g.lineWidth = 0.035;
  g.beginPath();
  g.moveTo(0.36, -bh + 0.24);
  g.lineTo(0.36, bh - 0.24);
  g.stroke();
  g.fillStyle = '#1a1b1f'; // open cockpit
  g.beginPath();
  g.roundRect(-1.0, -bh + 0.14, 1.1, 2 * bh - 0.28, 0.22);
  g.fill();
  g.fillStyle = '#2d2e34'; // seats
  for (const y of [-1, 1]) {
    g.beginPath();
    g.roundRect(-0.88, y * 0.33 - 0.21, 0.62, 0.42, 0.12);
    g.fill();
  }
  g.fillStyle = '#7d7e84'; // roll hoops
  for (const y of [-1, 1]) g.fillRect(-0.98, y * 0.33 - 0.2, 0.07, 0.4);
  g.strokeStyle = '#050506'; // steering wheel
  g.lineWidth = 0.05;
  g.beginPath();
  g.arc(-0.12, -0.33, 0.15, 0, Math.PI * 2);
  g.stroke();
  return { car: c, shadow: sh.c };
}

const BODY_HALF = CAR_WIDTH / 2 - 0.1;
const TAIL_Y = BODY_HALF - 0.36;
const REVERSE_Y = 0.22;
const reversing = (car: CarState) =>
  car.vel.x * Math.cos(car.angle) + car.vel.y * Math.sin(car.angle) < -0.5;

/** Player light sources: headlight cones, pod/tail/brake/reverse glows, a faint body glow. */
function playerLamps(car: CarState, brake: number): Lamp[] {
  const c = Math.cos(car.angle);
  const s = Math.sin(car.angle);
  const at = (u: number, w: number) => ({
    x: car.pos.x + u * c - w * s,
    y: car.pos.y + u * s + w * c,
  });
  const hl = CAR_LENGTH / 2;
  const braking = brake > 0.1;
  const rev = reversing(car);
  const ang = car.angle;
  const out: Lamp[] = [
    { cone: false, ...at(0, 0), ang, size: 5, cut: 0.3, tint: 'white', glow: 0 },
  ];
  for (const side of [-1, 1]) {
    out.push(
      {
        cone: true,
        ...at(hl - 0.2, side * 0.6),
        ang,
        size: HEAD_LEN,
        cut: 1,
        tint: 'warm',
        glow: 0.22,
      },
      {
        cone: false,
        ...at(hl - 0.3, side * POD_Y),
        ang,
        size: 1,
        cut: 0.5,
        tint: 'warm',
        glow: 0.6,
      },
      {
        cone: false,
        ...at(-hl, side * TAIL_Y),
        ang,
        size: braking ? 2 : 1,
        cut: braking ? 0.4 : 0.15,
        tint: 'red',
        glow: braking ? 0.75 : 0.3,
      },
    );
    if (rev)
      out.push({
        cone: false,
        ...at(-hl, side * REVERSE_Y),
        ang,
        size: 1,
        cut: 0.4,
        tint: 'white',
        glow: 0.5,
      });
  }
  if (rev)
    out.push({
      cone: true,
      ...at(-hl, 0),
      ang: ang + Math.PI,
      size: 9,
      cut: 0.85,
      tint: 'white',
      glow: 0.15,
    });
  return out;
}

/** Lit lamp lenses on top of the darkness: pod lenses, tail/brake lights, reverse lights. */
function playerLenses(g: Ctx, car: CarState, brake: number) {
  const hl = CAR_LENGTH / 2;
  g.save();
  g.translate(car.pos.x, car.pos.y);
  g.rotate(car.angle);
  g.fillStyle = '#fff6dc';
  for (const y of [-1, 1]) g.fillRect(hl - 0.32, y * POD_Y - 0.12, 0.06, 0.24);
  g.fillStyle = brake > 0.1 ? '#ff3a48' : '#a8101c';
  for (const y of [-1, 1]) g.fillRect(-hl + 0.02, y * TAIL_Y - 0.16, 0.08, 0.32);
  if (reversing(car)) {
    g.fillStyle = '#f4f4f0';
    for (const y of [-1, 1]) g.fillRect(-hl + 0.02, y * REVERSE_Y - 0.07, 0.07, 0.14);
  }
  g.restore();
}

function rearWheels(car: CarState): [Vec, Vec] {
  const c = Math.cos(car.angle);
  const s = Math.sin(car.angle);
  const bx = car.pos.x + REAR_AXLE * c;
  const by = car.pos.y + REAR_AXLE * s;
  return [
    { x: bx + TRACK_HALF * s, y: by - TRACK_HALF * c },
    { x: bx - TRACK_HALF * s, y: by + TRACK_HALF * c },
  ];
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  r0: number;
}

export function createRenderer(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  let dpr = 1;
  let cssW = 1;
  let cssH = 1;

  const statics = new Map<Floor, HTMLCanvasElement>();
  const skids = new Map<Floor, ReturnType<typeof makeCanvas>>();
  const lightLayers = new Map<Floor, ReturnType<typeof buildLights>>();
  let shade = makeCanvas(1, 1); // half-res darkness mask
  let clock = 0;
  const sprites = playerSprites();
  const puff = glowSprite(SMOKE_RGB, [
    [0, 1],
    [0.5, 0.55],
    [1, 0],
  ]);
  const smoke: Particle[] = Array.from({ length: SMOKE_CAP }, () => ({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    age: SMOKE_LIFE,
    r0: 0,
  }));
  let smokeNext = 0;
  let smokeAcc = 0;

  const cam = { x: 0, y: 0, viewH: VIEW_H_REST };
  let lastFloor = -1;
  let lastRun = NaN;
  let prevWheels: [Vec, Vec] | null = null;

  function skidLayer(f: Floor) {
    let s = skids.get(f);
    if (!s) {
      s = makeCanvas(f.w * SKID_PX, f.h * SKID_PX);
      s.g.scale(SKID_PX, SKID_PX);
      s.g.strokeStyle = SKID_STYLE;
      s.g.lineWidth = SKID_W;
      skids.set(f, s);
    }
    return s;
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    cssW = window.innerWidth;
    cssH = window.innerHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    shade = makeCanvas(canvas.width / 2, canvas.height / 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(v: RenderView, dt: number) {
    const f = v.map.floors[v.floorIndex];
    const car = v.car;
    const kmh = Math.hypot(car.vel.x, car.vel.y) * 3.6;
    const step = Math.min(dt, 0.1);
    clock += step;

    if (v.runId !== lastRun)
      for (const s of skids.values()) s.g.clearRect(0, 0, s.c.width, s.c.height);
    // helix floor switches keep the camera, skids and smoke continuous
    const snap = v.runId !== lastRun || (v.floorIndex !== lastFloor && !v.blend);
    if (snap) {
      prevWheels = null;
      for (const p of smoke) p.age = SMOKE_LIFE;
      smokeAcc = 0;
    }
    lastRun = v.runId;
    lastFloor = v.floorIndex;

    // camera
    const tx = car.pos.x + car.vel.x * LOOK_AHEAD;
    const ty = car.pos.y + car.vel.y * LOOK_AHEAD;
    const tvh = VIEW_H_REST + (VIEW_H_FAST - VIEW_H_REST) * Math.min(kmh / ZOOM_FULL_KMH, 1);
    if (snap) {
      cam.x = tx;
      cam.y = ty;
      cam.viewH = tvh;
    } else {
      const kp = 1 - Math.exp(-CAM_POS_RATE * dt);
      const kz = 1 - Math.exp(-CAM_ZOOM_RATE * dt);
      cam.x += (tx - cam.x) * kp;
      cam.y += (ty - cam.y) * kp;
      cam.viewH += (tvh - cam.viewH) * kz;
    }
    const dip = v.blend ? 1 - DIP * Math.sin(Math.PI * v.blend.t) : 1;
    const scale = (cssH / cam.viewH) * dip; // CSS px per meter
    const halfW = cssW / 2 / scale;
    const halfH = cssH / 2 / scale;
    const visible = (x: number, y: number, r: number) =>
      Math.abs(x - cam.x) < halfW + r && Math.abs(y - cam.y) < halfH + r;

    // skid marks
    const wheels = rearWheels(car);
    const skidding = v.drift.drifting || (v.handbrake && v.drift.speedKmh > SKID_MIN_KMH);
    if (skidding && prevWheels) {
      const g = skidLayer(f).g;
      g.beginPath();
      for (let i = 0; i < 2; i++) {
        g.moveTo(prevWheels[i].x, prevWheels[i].y);
        g.lineTo(wheels[i].x, wheels[i].y);
      }
      g.stroke();
    }
    prevWheels = skidding ? wheels : null;

    // smoke
    if (v.drift.drifting) {
      const k = Math.abs(v.drift.slip) * v.drift.speedKmh;
      smokeAcc += Math.min(k * SMOKE_RATE, SMOKE_MAX_RATE) * step;
      while (smokeAcc >= 1) {
        smokeAcc -= 1;
        const w = wheels[smokeNext & 1];
        const p = smoke[smokeNext];
        smokeNext = (smokeNext + 1) % SMOKE_CAP;
        p.x = w.x + (Math.random() - 0.5) * 0.3;
        p.y = w.y + (Math.random() - 0.5) * 0.3;
        p.vx = car.vel.x * SMOKE_INHERIT + (Math.random() - 0.5) * 1.2;
        p.vy = car.vel.y * SMOKE_INHERIT + (Math.random() - 0.5) * 1.2;
        p.age = 0;
        p.r0 = Math.min(0.35 + k * 0.012, 1.2);
      }
    }
    const drag = Math.exp(-1.5 * step);
    for (const p of smoke) {
      if (p.age >= SMOKE_LIFE) continue;
      p.age += step;
      p.x += p.vx * step;
      p.y += p.vy * step;
      p.vx *= drag;
      p.vy *= drag;
    }

    // world
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const sx = (Math.random() * 2 - 1) * SHAKE_PX * v.shake;
    const sy = (Math.random() * 2 - 1) * SHAKE_PX * v.shake;
    const ws = dpr * scale;
    const ox = dpr * (cssW / 2 + sx - cam.x * scale);
    const oy = dpr * (cssH / 2 + sy - cam.y * scale);
    ctx.setTransform(ws, 0, 0, ws, ox, oy);

    // crossfade: current floor opaque, target floor over it at t (= A(1-t) + Bt, no darkening)
    const floors: [number, number][] = [[v.floorIndex, 1]];
    if (v.blend) floors.push([v.blend.toFloor, v.blend.t]);
    for (const [idx, a] of floors) {
      const fl = v.map.floors[idx];
      let layer = statics.get(fl);
      if (!layer) statics.set(fl, (layer = buildStatic(v.map, idx)));
      ctx.globalAlpha = a;
      ctx.drawImage(layer, 0, 0, fl.w, fl.h);
      const skid = skids.get(fl);
      if (skid) ctx.drawImage(skid.c, 0, 0, fl.w, fl.h);
    }
    ctx.globalAlpha = 1;

    const sw = CAR_LENGTH + 2 * SPRITE_M;
    const sh = CAR_WIDTH + 2 * SPRITE_M;
    for (const [img, ox, oy, a] of [
      [sprites.shadow, CAR_SHADOW_OFFSET.x, CAR_SHADOW_OFFSET.y, CAR_SHADOW_ALPHA],
      [sprites.car, 0, 0, 1],
    ] as const) {
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(car.pos.x + ox, car.pos.y + oy);
      ctx.rotate(car.angle);
      ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
      ctx.restore();
    }

    for (const p of smoke) {
      if (p.age >= SMOKE_LIFE) continue;
      const t = p.age / SMOKE_LIFE;
      const r = p.r0 * (1 + 2.5 * t);
      if (!visible(p.x, p.y, r)) continue;
      ctx.globalAlpha = SMOKE_ALPHA * (1 - t);
      ctx.drawImage(puff, p.x - r, p.y - r, 2 * r, 2 * r);
    }
    ctx.globalAlpha = 1;

    // lighting: each floor's lights weighted by its own share of the crossfade, (1-t) and t
    const layers = floors.map(([idx, a]) => {
      const fl = v.map.floors[idx];
      let l = lightLayers.get(fl);
      if (!l) lightLayers.set(fl, (l = buildLights(v.map, idx)));
      const w = v.blend && idx === v.floorIndex ? 1 - v.blend.t : a;
      return { fl, l, w, amb: idx === 0 ? AMBIENT_ROOF : AMBIENT };
    });
    const dyn: [Lamp, number][] = playerLamps(car, v.brake).map((l) => [l, 1]);
    if ((clock * HAZARD_HZ) % 1 < 0.5)
      for (const { l, w } of layers)
        for (const set of l.hazards)
          if (visible(set[0].x, set[0].y, 6)) for (const lamp of set) dyn.push([lamp, w]);

    const m = shade.g;
    const k = shade.c.width / canvas.width;
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.globalCompositeOperation = 'source-over';
    m.globalAlpha = 1;
    m.clearRect(0, 0, shade.c.width, shade.c.height);
    m.fillStyle = `rgba(0,0,0,${layers.reduce((s, x) => s + x.w * x.amb, 0)})`;
    m.fillRect(0, 0, shade.c.width, shade.c.height);
    m.setTransform(ws * k, 0, 0, ws * k, ox * k, oy * k);
    m.globalCompositeOperation = 'destination-out';
    for (const { fl, l, w } of layers) {
      m.globalAlpha = w;
      m.drawImage(l.mask, 0, 0, fl.w, fl.h);
    }
    for (const [l, a] of dyn) drawLamp(m, l, true, a);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(shade.c, 0, 0, canvas.width, canvas.height);
    ctx.setTransform(ws, 0, 0, ws, ox, oy);
    playerLenses(ctx, car, v.brake);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, f.w, f.h); // keep glows off the void outside the floor
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    for (const { fl, l, w } of layers) {
      ctx.globalAlpha = w;
      ctx.drawImage(l.glow, 0, 0, fl.w, fl.h);
    }
    for (const [l, a] of dyn) drawLamp(ctx, l, false, a);
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (v.fade > 0) {
      ctx.globalAlpha = Math.min(v.fade, 1);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.globalAlpha = 1;
    }
  }

  resize();
  return {
    ctx,
    width: () => cssW,
    height: () => cssH,
    resize,
    draw,
  };
}
