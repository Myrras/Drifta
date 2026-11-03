import { CAR_LENGTH, CAR_WIDTH, inRect } from './collision';
import type { CarState, Floor, GameMap, Helix, PlayerModel, Rect, Solid, Vec } from './types';
import { garage, garageRoute } from './maps/garage';
import { docks, docksRoute } from './maps/docks';
import { CAR_MODELS, PLAYER_MODELS } from './models';
import {
  createPool,
  drawSmoke,
  drawSparks,
  puffSprites,
  updateSmoke,
  updateSparks,
} from './particles';
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

const CAR_SHADOW_OFFSET: Vec = { x: 0.25, y: 0.35 };
const CAR_SHADOW_ALPHA = 0.55;
const POD_Y = 0.48; // pop-up headlight pods, m off the center line

// lighting: dark ambient layer with light cut out (half res) drawn over the world, then additive glows
const LIGHT_PX = 4; // px per meter, static per-floor light layers
const AMBIENT = 0.82; // darkness inside the garage
const ROUTES = new Map<GameMap, { floor: number; points: Vec[] }[]>([
  [garage, garageRoute],
  [docks, docksRoute],
]);
const AMBIENT_ROOF = 0.74;
const LIGHT_R = 7; // ceiling pool radius
const POST_R = 9; // roof lamp posts
const HEAD_LEN = 25; // player headlight cones
const PARKED_HEAD_LEN = 18;
const HAZARD_HZ = 1.5;

const SKID_W = 0.25;
const SKID_MIN_KMH = 15;

const SMOKE_CAP = 500;
const SMOKE_LIFE = 2;
const SMOKE_RATE = 3; // particles/s per (rad x km/h)
const SMOKE_MAX_RATE = 200;
const SMOKE_INHERIT = 0.25;
const SMOKE_ALPHA = 0.34; // at full |slip| x speed

const SPARK_CAP = 300;
const SPARK_RATE = 220; // particles/s at scrape = 1
const IMPACT_SPARKS = 45;
const FLASH_LIFE = 0.16;

// weight: body offset vs its shadow
const ROLL_K = 0.012; // m per m/s² lateral
const ROLL_MAX = 0.12;
const PITCH_K = 0.006;
const PITCH_MAX = 0.07;
const SQUASH = 0.035; // max length squash at hard braking/accel
const WEIGHT_RATE = 8; // 1/s smoothing
const BOUNCE = 0.07; // body scale amplitude after an impact

// speed feel
const SPEED_FX_KMH = 90;
const SPEED_FX_FULL = 150;
const STREAKS = 48;
const PUNCH = 0.04; // zoom-in on impact
const DRIFT_LOOK = 3; // m extra look-ahead toward the nose while drifting

const DOCKS = 'WANGAN DOCKS';
const TESTPAD = 'TEST PAD';
/** Per-map darkness: docks and test pad are lit up so obstacles read at speed. */
function ambientOf(map: GameMap, idx: number) {
  return map.name === DOCKS
    ? 0.58
    : map.name === TESTPAD
      ? 0.3
      : idx === 0
        ? AMBIENT_ROOF
        : AMBIENT;
}
const ASPHALT = '#2a2b2f';
const QUAY_YELLOW = '#d6a51f';
const CONTAINER_COLORS = ['#7b3a2c', '#2e4a6e', '#3c5e48', '#62666a', '#a8642c'];

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
type Tint = 'cool' | 'warm' | 'red' | 'amber' | 'white' | 'sodium';
const TINTS: Record<Tint, string> = {
  cool: '205,230,255',
  sodium: '255,150,45',
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

/** 20 ft / 40 ft shipping container footprint. */
function isContainer(s: Solid) {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.2;
  const long = Math.max(s.w, s.h);
  return near(Math.min(s.w, s.h), 2.44) && (near(long, 12.2) || near(long, 6.1));
}

/** Container roof detail over its base color, local frame centered: corrugation, frame, end doors. */
function container(g: Ctx, w: number, h: number) {
  g.save();
  if (h > w) {
    g.rotate(Math.PI / 2);
    [w, h] = [h, w];
  }
  const [hw, hh] = [w / 2, h / 2];
  for (let x = -hw + 0.3, i = 0; x < hw - 0.3; x += 0.22, i++) {
    g.fillStyle = i % 2 ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.07)';
    g.fillRect(x, -hh + 0.12, 0.11, h - 0.24);
  }
  g.strokeStyle = 'rgba(0,0,0,0.4)';
  g.lineWidth = 0.12;
  g.strokeRect(-hw + 0.06, -hh + 0.06, w - 0.12, h - 0.12);
  g.fillStyle = 'rgba(0,0,0,0.3)'; // door end + corner castings
  g.fillRect(hw - 0.3, -hh + 0.1, 0.18, h - 0.2);
  for (const x of [-hw, hw - 0.22]) for (const y of [-hh, hh - 0.22]) g.fillRect(x, y, 0.22, 0.22);
  g.fillStyle = 'rgba(255,255,255,0.14)'; // lighter roof face so stacks read as blocks
  g.fillRect(-hw + 0.25, -hh + 0.25, w - 0.5, h - 0.5);
  g.fillStyle = 'rgba(255,255,255,0.08)'; // light from above-left
  g.fillRect(-hw + 0.1, -hh + 0.1, w - 0.2, 0.12);
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

/** Edge highlight of every solid, drawn above the darkness (warm on docks, cool elsewhere). */
function buildRim(map: GameMap, idx: number) {
  const f = map.floors[idx];
  const docks = map.name === DOCKS;
  const { c, g } = makeCanvas(f.w * STATIC_PX, f.h * STATIC_PX);
  g.scale(STATIC_PX, STATIC_PX);
  g.strokeStyle = docks ? 'rgba(255,210,150,0.32)' : 'rgba(190,220,255,0.28)';
  g.lineWidth = 0.1;
  for (const s of f.solids) {
    g.save();
    g.translate(s.x + s.w / 2, s.y + s.h / 2);
    g.rotate(s.angle ?? 0);
    g.strokeRect(-s.w / 2, -s.h / 2, s.w, s.h);
    g.restore();
  }
  for (const k of f.circles) {
    g.beginPath();
    g.arc(k.x, k.y, k.r, 0, Math.PI * 2);
    g.stroke();
  }
  if (docks) {
    g.strokeStyle = 'rgba(255,215,40,0.7)'; // reflective quay edge
    g.lineWidth = 0.22;
    g.strokeRect(1.1, 1.1, f.w - 2.2, f.h - 2.2);
  }
  return c;
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
  if (map.name === DOCKS) {
    for (const l of f.lights)
      lamps.push({
        cone: false,
        ...l,
        ang: 0,
        size: LIGHT_R * 1.8,
        cut: 0.85,
        tint: 'sodium',
        glow: 0.4,
      });
  } else if (idx === 0) {
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
    rim: buildRim(map, idx),
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

  const route = (ROUTES.get(map) ?? []).find((r) => r.floor === idx)?.points ?? [];
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
  const docks = map.name === DOCKS;

  // concrete (or dock asphalt) + large-scale mottling + speckle
  g.fillStyle = docks ? ASPHALT : roof ? CONCRETE_ROOF : CONCRETE;
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
  for (let i = 0; i < f.w * f.h * (docks ? 1.2 : 0.5); i++) {
    g.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.045)';
    const d = docks ? 0.06 : 0.1; // finer aggregate
    g.fillRect(rand() * f.w, rand() * f.h, d, d);
  }
  if (docks) {
    // faint wet sheen: long soft streaks of cool reflection
    for (let i = 0; i < (f.w * f.h) / 250; i++) {
      g.save();
      g.translate(rand() * f.w, rand() * f.h);
      g.rotate(rand() * Math.PI);
      g.scale(3 + rand() * 3, 1);
      const r = 1.5 + rand() * 2.5;
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
      grad.addColorStop(0, `rgba(150,170,205,${0.03 + rand() * 0.04})`);
      grad.addColorStop(1, 'rgba(150,170,205,0)');
      g.fillStyle = grad;
      g.fillRect(-r, -r, 2 * r, 2 * r);
      g.restore();
    }
  } else if (map.name === TESTPAD) {
    for (let step = 10; step < f.w; step += 10) {
      const major = step % 50 === 0;
      g.strokeStyle = major ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.18)';
      g.lineWidth = major ? 0.2 : 0.1;
      g.beginPath();
      g.moveTo(step, 0);
      g.lineTo(step, f.h);
      g.moveTo(0, step);
      g.lineTo(f.w, step);
      g.stroke();
    }
    g.fillStyle = 'rgba(255,140,30,0.9)'; // painted cone markers
    for (let x = 20; x < f.w; x += 20)
      for (let y = 20; y < f.h; y += 20) {
        if ((x / 20 + y / 20) % 3) continue;
        g.beginPath();
        g.arc(x + 5, y + 5, 0.45, 0, Math.PI * 2);
        g.fill();
      }
  } else {
    g.strokeStyle = 'rgba(0,0,0,0.22)'; // slab joints
    g.lineWidth = 0.06;
    g.beginPath();
    for (let x = 10; x < f.w; x += 10) (g.moveTo(x, 0), g.lineTo(x, f.h));
    for (let y = 10; y < f.h; y += 10) (g.moveTo(0, y), g.lineTo(f.w, y));
    g.stroke();
  }

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
  /** Runs draw in the solid's local frame: origin at its center, rotated by its angle. */
  const local = (s: Solid, draw: () => void) => {
    g.save();
    g.translate(s.x + s.w / 2, s.y + s.h / 2);
    g.rotate(s.angle ?? 0);
    draw();
    g.restore();
  };
  let containers = 0;
  for (const w of walls) {
    if (w.angle !== undefined || (docks && isContainer(w))) {
      const c = isContainer(w) ? CONTAINER_COLORS[containers++ % CONTAINER_COLORS.length] : null;
      local(w, () => {
        shadow();
        g.fillStyle = c ?? WALL;
        g.fillRect(-w.w / 2, -w.h / 2, w.w, w.h);
        noShadow();
        if (c) container(g, w.w, w.h);
        else {
          g.fillStyle = WALL_TOP;
          g.fillRect(-w.w / 2 + 0.1, -w.h / 2 + 0.1, w.w - 0.2, w.h - 0.2);
        }
      });
      continue;
    }
    shadow();
    g.fillStyle = WALL;
    g.fillRect(w.x, w.y, w.w, w.h);
    noShadow();
    g.fillStyle = WALL_TOP;
    g.fillRect(w.x + 0.1, w.y + 0.1, w.w - 0.2, w.h - 0.2);
    const t = 0.3;
    const horiz = w.w >= w.h;
    const top = w.y + w.h / 2 < f.h / 2;
    const left = w.x + w.w / 2 < f.w / 2;
    const perimeter =
      w.x <= 0.01 || w.y <= 0.01 || w.x + w.w >= f.w - 0.01 || w.y + w.h >= f.h - 0.01;
    if (docks && perimeter) {
      // quay edge: yellow line painted on the ground just inside the wall
      g.fillStyle = QUAY_YELLOW;
      if (horiz) g.fillRect(w.x, top ? w.y + w.h + 0.25 : w.y - 0.55, w.w, t);
      else g.fillRect(left ? w.x + w.w + 0.25 : w.x - 0.55, w.y, t, w.h);
      continue;
    }
    const strip: Rect = horiz
      ? { x: w.x, y: top ? w.y + w.h - t : w.y, w: w.w, h: t }
      : { x: left ? w.x + w.w - t : w.x, y: w.y, w: t, h: w.h };
    hazard(g, strip, 0.4);
  }
  for (const s of f.solids) {
    if (s.kind !== 'pillar') continue;
    local(s, () => {
      shadow();
      g.fillStyle = PILLAR;
      g.fillRect(-s.w / 2, -s.h / 2, s.w, s.h);
      noShadow();
      const e = s.w * 0.12;
      g.fillStyle = PILLAR_TOP;
      g.fillRect(-s.w / 2 + e, -s.h / 2 + e, s.w - 2 * e, s.h - 2 * e);
    });
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

/** Pop-up headlight pod center (m off the center line); other models have fixed lamps. */
const POPUP_Y: Partial<Record<PlayerModel, number>> = {
  mx5: POD_Y,
  rx7: 0.32,
  '180sx': 0.42,
  ae86: 0.37,
  nsx: 0.37,
};

/** Half length/width of the player's body: the roadster matches the collision box. */
function playerDims(model: PlayerModel) {
  const m = model === 'mx5' ? { length: CAR_LENGTH, width: CAR_WIDTH } : PLAYER_MODELS[model];
  return { hl: m.length / 2, hw: m.width / 2 };
}

/** Raised pop-up pods: dark recess behind, body-color top, lens face forward. */
function pods(g: Ctx, hl: number, py: number, color: string) {
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.lineWidth = 0.03;
  for (const y of [-py, py]) {
    g.fillStyle = '#1a0306';
    g.fillRect(hl - 0.68, y - 0.15, 0.4, 0.3);
    g.fillStyle = color;
    g.fillRect(hl - 0.6, y - 0.13, 0.28, 0.26);
    g.fillStyle = 'rgba(255,255,255,0.1)';
    g.fillRect(hl - 0.6, y - 0.13, 0.28, 0.26);
    g.strokeRect(hl - 0.6, y - 0.13, 0.28, 0.26);
    g.fillStyle = '#fff2cc';
    g.fillRect(hl - 0.32, y - 0.12, 0.06, 0.24);
  }
}

function bodyPath(g: Ctx, hl: number, bh: number) {
  g.beginPath();
  g.roundRect(-hl, -bh, 2 * hl, 2 * bh, [0.35, 0.7, 0.7, 0.35]);
}

/** Player car sprite (roadster or a JDM model in its paint) + its blurred shadow, local frame +x = nose. */
function playerSprites(model: PlayerModel, color: string) {
  const { hl, hw } = playerDims(model);
  const bh = hw - 0.1; // body half width; tires peek out 0.1 m
  const w = 2 * hl + 2 * SPRITE_M;
  const h = 2 * hw + 2 * SPRITE_M;
  const mk = () => {
    const s = makeCanvas(w * SPRITE_PX, h * SPRITE_PX);
    s.g.translate(s.c.width / 2, s.c.height / 2);
    s.g.scale(SPRITE_PX, SPRITE_PX);
    return s;
  };
  const sh = mk();
  sh.g.shadowColor = '#000';
  sh.g.shadowBlur = 14;
  sh.g.fillStyle = '#000';
  bodyPath(sh.g, hl, bh);
  sh.g.fill();

  const { c, g } = mk();
  if (model === 'mx5') roadster(g, hl, bh, color);
  else drawParkedCar(g, model, color);
  const py = POPUP_Y[model];
  if (py !== undefined) pods(g, hl, py, color);
  return { car: c, shadow: sh.c, w, h };
}

function roadster(g: Ctx, hl: number, bh: number, color: string) {
  const L = 2 * hl;
  g.fillStyle = '#121315'; // tires
  for (const x of [hl - 0.85, -hl + 0.8]) {
    for (const y of [-1, 1]) {
      g.beginPath();
      g.roundRect(x - 0.33, y * (CAR_WIDTH / 2 - 0.15) - 0.15, 0.66, 0.3, 0.08);
      g.fill();
    }
  }
  g.fillStyle = color;
  bodyPath(g, hl, bh);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.1)'; // side gloss
  g.fillRect(-hl + 0.35, -bh + 0.07, L - 0.8, 0.1);
  for (const [shade, x, w, r] of [
    [0.2, 0.42, hl - 0.55, [0.1, 0.5, 0.5, 0.1]], // hood
    [0.13, -hl + 0.18, 0.85, 0.25], // deck
  ] as const) {
    g.beginPath();
    g.roundRect(x, -bh + 0.2, w, 2 * bh - 0.4, r);
    g.fillStyle = color;
    g.fill();
    g.fillStyle = `rgba(0,0,0,${shade})`;
    g.fill();
  }
  g.fillStyle = '#4a070d'; // tail lights
  g.fillRect(-hl + 0.02, -bh + 0.2, 0.08, 0.32);
  g.fillRect(-hl + 0.02, bh - 0.52, 0.08, 0.32);
  g.fillStyle = color; // mirrors
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
}

const REVERSE_Y = 0.22;
const reversing = (car: CarState) =>
  car.vel.x * Math.cos(car.angle) + car.vel.y * Math.sin(car.angle) < -0.5;

/** Player light sources: headlight cones, pod/head/tail/brake/reverse glows, a faint body glow. */
function playerLamps(car: CarState, brake: number, model: PlayerModel): Lamp[] {
  const c = Math.cos(car.angle);
  const s = Math.sin(car.angle);
  const at = (u: number, w: number) => ({
    x: car.pos.x + u * c - w * s,
    y: car.pos.y + u * s + w * c,
  });
  const { hl, hw } = playerDims(model);
  const py = POPUP_Y[model];
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
        ...at(hl - 0.2, side * (hw - 0.3)),
        ang,
        size: HEAD_LEN,
        cut: 1,
        tint: 'warm',
        glow: 0.22,
      },
      {
        cone: false,
        ...(py !== undefined ? at(hl - 0.3, side * py) : at(hl - 0.15, side * (hw - 0.4))),
        ang,
        size: 1,
        cut: 0.5,
        tint: 'warm',
        glow: 0.6,
      },
      {
        cone: false,
        ...at(-hl, side * (hw - 0.46)),
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

/** Lit lamp lenses on top of the darkness, in the body frame (caller sets the transform). */
function playerLenses(g: Ctx, car: CarState, brake: number, model: PlayerModel) {
  const { hl, hw } = playerDims(model);
  const py = POPUP_Y[model];
  const tailY = hw - 0.46;
  g.fillStyle = '#fff6dc';
  if (py !== undefined) for (const y of [-py, py]) g.fillRect(hl - 0.32, y - 0.12, 0.06, 0.24);
  g.fillStyle = brake > 0.1 ? '#ff3a48' : '#a8101c';
  for (const y of [-1, 1]) g.fillRect(-hl + 0.04, y * tailY - 0.16, 0.07, 0.32);
  if (reversing(car)) {
    g.fillStyle = '#f4f4f0';
    for (const y of [-1, 1]) g.fillRect(-hl + 0.04, y * REVERSE_Y - 0.07, 0.07, 0.14);
  }
}

function rearWheels(car: CarState, model: PlayerModel): [Vec, Vec] {
  const { hl, hw } = playerDims(model);
  const axle = -(hl - 0.8);
  const track = hw - 0.2;
  const c = Math.cos(car.angle);
  const s = Math.sin(car.angle);
  const bx = car.pos.x + axle * c;
  const by = car.pos.y + axle * s;
  return [
    { x: bx + track * s, y: by - track * c },
    { x: bx - track * s, y: by + track * c },
  ];
}

/** Nearest point on a (possibly rotated) solid's outline; `inside` when p penetrates it. */
function closestOn(p: Vec, s: Solid): { q: Vec; inside: boolean } {
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const c = Math.cos(s.angle ?? 0);
  const sn = Math.sin(s.angle ?? 0);
  const [hw, hh] = [s.w / 2, s.h / 2];
  let lx = (p.x - cx) * c + (p.y - cy) * sn;
  let ly = -(p.x - cx) * sn + (p.y - cy) * c;
  const inside = Math.abs(lx) < hw && Math.abs(ly) < hh;
  if (inside) {
    // exit through the nearest edge
    if (hw - Math.abs(lx) < hh - Math.abs(ly)) lx = Math.sign(lx) * hw;
    else ly = Math.sign(ly) * hh;
  } else {
    lx = Math.max(-hw, Math.min(hw, lx));
    ly = Math.max(-hh, Math.min(hh, ly));
  }
  return { q: { x: cx + lx * c - ly * sn, y: cy + lx * sn + ly * c }, inside };
}

/** Body corner nearest to (or deepest into) any obstacle: contact point q, unit normal n out of it. */
function contact(car: CarState, model: PlayerModel, f: Floor) {
  const { hl, hw } = playerDims(model);
  const c = Math.cos(car.angle);
  const s = Math.sin(car.angle);
  let best = { d: Infinity, q: car.pos, n: { x: 0, y: -1 } };
  for (const [u, w] of [
    [hl, hw],
    [hl, -hw],
    [-hl, -hw],
    [-hl, hw],
  ]) {
    const p = { x: car.pos.x + u * c - w * s, y: car.pos.y + u * s + w * c };
    const hits = f.solids.map((o) => closestOn(p, o));
    for (const k of f.circles) {
      const d = Math.hypot(p.x - k.x, p.y - k.y) || 1;
      const q = { x: k.x + ((p.x - k.x) * k.r) / d, y: k.y + ((p.y - k.y) * k.r) / d };
      hits.push({ q, inside: d < k.r });
    }
    for (const { q, inside } of hits) {
      const dist = Math.hypot(p.x - q.x, p.y - q.y);
      const d = inside ? -dist : dist; // penetration ranks before any gap
      if (d >= best.d || dist < 1e-6) continue;
      const k = (inside ? -1 : 1) / dist;
      best = { d, q, n: { x: (p.x - q.x) * k, y: (p.y - q.y) * k } };
    }
  }
  return best;
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
  const carSprites = new Map<string, ReturnType<typeof playerSprites>>();
  const puffs = puffSprites();
  const smoke = createPool(SMOKE_CAP);
  const sparks = createPool(SPARK_CAP);
  let smokeAcc = 0;
  let sparkAcc = 0;
  let wheelSide = 0;
  const flash = { x: 0, y: 0, age: Infinity };
  const vignette = glowSprite('0,0,0', [
    [0, 0],
    [0.6, 0],
    [1, 0.85],
  ]);
  /** speed lines in normalized screen coords */
  const streaks = Array.from({ length: STREAKS }, () => ({
    x: Math.random(),
    y: Math.random(),
    len: 0.5 + Math.random(),
  }));

  const cam = { x: 0, y: 0, viewH: VIEW_H_REST };
  const look = { x: 0, y: 0 }; // extra drift look-ahead, smoothed
  let lastFloor = -1;
  let lastRun = NaN;
  let prevWheels: [Vec, Vec] | null = null;
  // weight: smoothed lateral/longitudinal acceleration (m/s², car frame), impact bounce
  const body = { lat: 0, lon: 0, bounceT: Infinity, bounceA: 0 };
  const prevVel = { x: 0, y: 0, ok: false };
  let prevImpact = 0;
  let punchT = Infinity;

  function skidLayer(f: Floor) {
    let s = skids.get(f);
    if (!s) {
      s = makeCanvas(f.w * SKID_PX, f.h * SKID_PX);
      s.g.scale(SKID_PX, SKID_PX);
      s.g.lineWidth = SKID_W;
      skids.set(f, s);
    }
    return s;
  }

  function spritesFor(model: PlayerModel, color: string) {
    const key = `${model}|${color}`;
    let s = carSprites.get(key);
    if (!s) carSprites.set(key, (s = playerSprites(model, color)));
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
    const model = v.player.model;
    const speed = Math.hypot(car.vel.x, car.vel.y);
    const kmh = speed * 3.6;
    const step = Math.min(dt, 0.1);
    clock += step;
    const ca = Math.cos(car.angle);
    const sa = Math.sin(car.angle);

    if (v.runId !== lastRun)
      for (const s of skids.values()) s.g.clearRect(0, 0, s.c.width, s.c.height);
    // helix floor switches keep the camera, skids and smoke continuous
    const snap = v.runId !== lastRun || (v.floorIndex !== lastFloor && !v.blend);
    if (snap) {
      prevWheels = null;
      smoke.clear();
      sparks.clear();
      smokeAcc = sparkAcc = 0;
      flash.age = punchT = body.bounceT = Infinity;
      body.lat = body.lon = 0;
      prevVel.ok = false;
      prevImpact = v.impact;
      look.x = look.y = 0;
    }
    lastRun = v.runId;
    lastFloor = v.floorIndex;

    // fx triggers: rising impact pulse, wall scrape
    flash.age += step;
    punchT += step;
    body.bounceT += step;
    const hit = v.impact > 0.3 && v.impact > prevImpact + 0.01;
    prevImpact = v.impact;
    const touch = hit || v.scrape > 0 ? contact(car, model, f) : null;
    if (hit) {
      body.bounceT = punchT = 0;
      body.bounceA = Math.min(1, v.impact);
    }

    // weight: body leans/pitches against the acceleration, shadow stays put
    if (prevVel.ok && step > 0) {
      const ax = (car.vel.x - prevVel.x) / step;
      const ay = (car.vel.y - prevVel.y) / step;
      const k = 1 - Math.exp(-WEIGHT_RATE * step);
      body.lat += (-ax * sa + ay * ca - body.lat) * k;
      body.lon += (ax * ca + ay * sa - body.lon) * k;
    }
    Object.assign(prevVel, car.vel, { ok: true });
    const clamp = (x: number, m: number) => Math.max(-m, Math.min(m, x));
    const roll = clamp(-body.lat * ROLL_K, ROLL_MAX);
    const pitch = clamp(-body.lon * PITCH_K, PITCH_MAX);
    const bx = car.pos.x + pitch * ca - roll * sa;
    const by = car.pos.y + pitch * sa + roll * ca;
    const sq = SQUASH * Math.min(1, Math.abs(body.lon) / 12);
    const bounce =
      1 + BOUNCE * body.bounceA * Math.exp(-7 * body.bounceT) * Math.sin(26 * body.bounceT);
    const bodyFrame = (g: Ctx) => {
      g.translate(bx, by);
      g.rotate(car.angle);
      g.scale((1 - sq) * bounce, (1 + sq / 2) * bounce);
    };

    // camera, with a gentle extra look toward the nose while drifting
    let lx = 0;
    let ly = 0;
    if (v.drift.drifting && speed > 1) {
      const px = -car.vel.y / speed;
      const py = car.vel.x / speed;
      const m =
        DRIFT_LOOK * Math.min(1, Math.abs(v.drift.slip) / 0.6) * Math.sign(ca * px + sa * py);
      lx = px * m;
      ly = py * m;
    }
    const kl = 1 - Math.exp(-2 * step);
    look.x += (lx - look.x) * kl;
    look.y += (ly - look.y) * kl;
    const tx = car.pos.x + car.vel.x * LOOK_AHEAD + look.x;
    const ty = car.pos.y + car.vel.y * LOOK_AHEAD + look.y;
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
    const punch = punchT < 0.05 ? punchT / 0.05 : Math.exp(-(punchT - 0.05) * 7);
    const scale = (cssH / cam.viewH) * dip * (1 + PUNCH * punch); // CSS px per meter
    const halfW = cssW / 2 / scale;
    const halfH = cssH / 2 / scale;
    const visible = (x: number, y: number, r: number) =>
      Math.abs(x - cam.x) < halfW + r && Math.abs(y - cam.y) < halfH + r;

    // skid marks, darker at higher slip
    const wheels = rearWheels(car, model);
    const skidding = v.drift.drifting || (v.handbrake && v.drift.speedKmh > SKID_MIN_KMH);
    if (skidding && prevWheels) {
      const g = skidLayer(f).g;
      g.strokeStyle = `rgba(12,12,14,${0.22 + 0.4 * Math.min(1, Math.abs(v.drift.slip) / 0.7)})`;
      g.beginPath();
      for (let i = 0; i < 2; i++) {
        g.moveTo(prevWheels[i].x, prevWheels[i].y);
        g.lineTo(wheels[i].x, wheels[i].y);
      }
      g.stroke();
    }
    prevWheels = skidding ? wheels : null;

    // tire smoke from both rear wheels: amount, size and density follow |slip| x speed
    if (v.drift.drifting) {
      const k = Math.abs(v.drift.slip) * v.drift.speedKmh;
      const amt = Math.min(1, k / 40);
      smokeAcc += Math.min(k * SMOKE_RATE, SMOKE_MAX_RATE) * step;
      while (smokeAcc >= 1) {
        smokeAcc -= 1;
        const w = wheels[(wheelSide ^= 1)];
        const p = smoke.spawn(
          w.x + (Math.random() - 0.5) * 0.3,
          w.y + (Math.random() - 0.5) * 0.3,
          car.vel.x * SMOKE_INHERIT + (Math.random() - 0.5) * 1.6,
          car.vel.y * SMOKE_INHERIT + (Math.random() - 0.5) * 1.6,
          SMOKE_LIFE * (0.75 + Math.random() * 0.5),
        );
        p.size = 0.35 + 0.65 * amt + Math.random() * 0.2;
        p.alpha = SMOKE_ALPHA * (0.35 + 0.65 * amt);
        p.spin = (Math.random() - 0.5) * 2.4;
        p.kind = Math.floor(Math.random() * puffs.length);
      }
    }
    updateSmoke(smoke, step);

    // sparks: streaming along the wall while scraping, a burst on impact
    if (touch) {
      const { q, n } = touch;
      let ux = -n.y;
      let uy = n.x;
      if (ux * car.vel.x + uy * car.vel.y < 0) [ux, uy] = [-ux, -uy];
      if (v.scrape > 0) {
        sparkAcc += SPARK_RATE * v.scrape * (0.3 + Math.min(1, speed / 15)) * step;
        while (sparkAcc >= 1) {
          sparkAcc -= 1;
          const a = (Math.random() - 0.5) * 0.6;
          const sp = 3 + speed * (0.4 + 0.6 * Math.random());
          const out = Math.random() * 0.15;
          sparks.spawn(
            q.x,
            q.y,
            (ux * Math.cos(a) - uy * Math.sin(a) + n.x * out) * sp,
            (ux * Math.sin(a) + uy * Math.cos(a) + n.y * out) * sp,
            0.12 + Math.random() * 0.22,
          );
        }
      }
      if (hit) {
        flash.x = q.x;
        flash.y = q.y;
        flash.age = 0;
        const base = Math.atan2(n.y, n.x);
        for (let i = 0; i < IMPACT_SPARKS; i++) {
          const a = base + (Math.random() - 0.5) * 2.8;
          const sp = 4 + Math.random() * 12 * Math.min(1, v.impact + 0.3);
          sparks.spawn(q.x, q.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.2 + Math.random() * 0.3);
        }
      }
    }
    updateSparks(sparks, step);

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

    const spr = spritesFor(model, v.player.color);
    ctx.save();
    ctx.globalAlpha = CAR_SHADOW_ALPHA;
    ctx.translate(car.pos.x + CAR_SHADOW_OFFSET.x, car.pos.y + CAR_SHADOW_OFFSET.y);
    ctx.rotate(car.angle);
    ctx.drawImage(spr.shadow, -spr.w / 2, -spr.h / 2, spr.w, spr.h);
    ctx.restore();
    ctx.save();
    bodyFrame(ctx);
    ctx.drawImage(spr.car, -spr.w / 2, -spr.h / 2, spr.w, spr.h);
    ctx.restore();

    drawSmoke(ctx, smoke, puffs, visible); // under the darkness: lit by the same lights

    // lighting: each floor's lights weighted by its own share of the crossfade, (1-t) and t
    const layers = floors.map(([idx, a]) => {
      const fl = v.map.floors[idx];
      let l = lightLayers.get(fl);
      if (!l) lightLayers.set(fl, (l = buildLights(v.map, idx)));
      const w = v.blend && idx === v.floorIndex ? 1 - v.blend.t : a;
      return { fl, l, w, amb: ambientOf(v.map, idx) };
    });
    const dyn: [Lamp, number][] = playerLamps(car, v.brake, model).map((l) => [l, 1]);
    if (touch && v.scrape > 0) {
      const { x, y } = touch.q;
      dyn.push([
        { cone: false, x, y, ang: 0, size: 2.5, cut: 0.5, tint: 'amber', glow: 0.8 },
        v.scrape,
      ]);
    }
    if (flash.age < FLASH_LIFE) {
      const t = flash.age / FLASH_LIFE;
      const { x, y } = flash;
      dyn.push([
        { cone: false, x, y, ang: 0, size: 2 + 5 * t, cut: 1, tint: 'white', glow: 1 },
        1 - t,
      ]);
    }
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
    for (const { fl, l, w } of layers) {
      ctx.globalAlpha = w;
      ctx.drawImage(l.rim, 0, 0, fl.w, fl.h);
    }
    ctx.globalAlpha = 1;
    ctx.save();
    bodyFrame(ctx);
    playerLenses(ctx, car, v.brake, model);
    ctx.restore();
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
    drawSparks(ctx, sparks, visible);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // speed: dark vignette + faint lines streaming past the screen edges
    const sf = Math.max(0, Math.min(1, (kmh - SPEED_FX_KMH) / (SPEED_FX_FULL - SPEED_FX_KMH)));
    if (sf > 0) {
      ctx.globalAlpha = 0.55 * sf;
      ctx.drawImage(vignette, 0, 0, cssW, cssH);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = 1.5;
      const ux = -car.vel.x / speed;
      const uy = -car.vel.y / speed;
      const px = speed * scale * 1.6 * step; // a bit faster than the ground: wind, not debris
      for (const s of streaks) {
        s.x = (((s.x + (ux * px) / cssW) % 1) + 1) % 1;
        s.y = (((s.y + (uy * px) / cssH) % 1) + 1) % 1;
        const edge = Math.min(1, (Math.hypot(s.x * 2 - 1, s.y * 2 - 1) - 0.65) / 0.45);
        if (edge <= 0) continue;
        const x = s.x * cssW;
        const y = s.y * cssH;
        const len = s.len * (30 + 70 * sf);
        ctx.strokeStyle = `rgba(220,230,255,${0.2 * sf * edge})`;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - ux * len, y - uy * len);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
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
