import { CAR_LENGTH, CAR_WIDTH, inRect } from './collision';
import type { CarState, Floor, GameMap, Helix, Rect, Vec } from './types';
import { garage, garageRoute } from './maps/garage';
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
const PAINT_ARROW = 'rgba(220,220,210,0.55)';
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

const LIGHT_RGB = '190,255,225'; // cool fluorescent
const POST_RGB = '200,215,255'; // roof lamp posts
const LIGHT_R = 7.5;
const POST_R = 10;
const TUBE = 'rgba(225,245,235,0.4)';

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

/** Arrow pointing along `angle`, ~3.2 m long at size 1. */
function arrow(g: Ctx, x: number, y: number, angle: number, size: number) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.scale(size, size);
  g.beginPath();
  g.moveTo(-1.6, -0.18);
  g.lineTo(0.3, -0.18);
  g.lineTo(0.3, -0.75);
  g.lineTo(1.6, 0);
  g.lineTo(0.3, 0.75);
  g.lineTo(0.3, 0.18);
  g.lineTo(-1.6, 0.18);
  g.closePath();
  g.fill();
  g.restore();
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

  // chevrons along the lane center; the slot at this floor's end of the ramp holds the label
  const n = Math.max(2, Math.round((Math.abs(h.sweep) * (h.rCore + w / 2)) / 5));
  const slot = upper ? 0 : n - 1;
  const half = Math.min(0.9, w * 0.18);
  g.strokeStyle = PAINT_ARROW;
  g.lineWidth = 0.35;
  g.lineJoin = 'miter';
  g.lineCap = 'butt';
  for (let i = 0; i < n; i++) {
    const { pos, angle } = helixAt(h, (i + 0.5) / n);
    if (i === slot) {
      label(g, text, pos.x, pos.y, angle, Math.min(1.6, w * 0.22), w * 0.8, true);
      continue;
    }
    g.save();
    g.translate(pos.x, pos.y);
    g.rotate(angle);
    g.beginPath();
    g.moveTo(-half * 0.7, -half);
    g.lineTo(half * 0.4, 0);
    g.lineTo(-half * 0.7, half);
    g.stroke();
    g.restore();
  }
}

// shortcut: assumes vertical (tall) bays and parked cars like the garage map; add a horizontal branch if a map needs it.
/** True if the rect's back (wall / opposite bay) is its top edge, false if bottom. */
function backIsTop(r: Rect, blockers: Rect[]) {
  const p = { x: r.x + r.w / 2, y: r.y - 0.8 };
  return blockers.some((b) => inRect(p, b));
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

  // lane arrows: every ~14 m along this floor's route, in travel direction, clear of obstacles
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
  g.fillStyle = PAINT_ARROW;
  let next = 7;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const [c, s] = [Math.cos(ang), Math.sin(ang)];
    for (; next <= len; next += 14) {
      const p = { x: a.x + c * next, y: a.y + s * next };
      const clear = [-1.7, -0.8, 0, 0.8, 1.7].every((u) =>
        [-0.8, 0, 0.8].every((w) => !blocked({ x: p.x + c * u - s * w, y: p.y + s * u + c * w })),
      );
      if (clear && placed.every((q) => Math.hypot(q.x - p.x, q.y - p.y) >= 9)) {
        placed.push(p);
        arrow(g, p.x, p.y, ang, 0.9);
      }
    }
    next -= len;
  }

  // painted bays: sides + back line, yellow wheel stop near the back
  const walls = f.solids.filter((s) => s.kind === 'wall');
  const blockers: Rect[] = [...walls, ...f.bays];
  g.strokeStyle = PAINT_WHITE;
  g.lineWidth = 0.12;
  g.lineCap = 'square';
  for (const b of f.bays) {
    const top = backIsTop(b, blockers);
    const back = top ? b.y : b.y + b.h;
    const front = top ? b.y + b.h : b.y;
    g.beginPath();
    g.moveTo(b.x, front);
    g.lineTo(b.x, back);
    g.lineTo(b.x + b.w, back);
    g.lineTo(b.x + b.w, front);
    g.stroke();
    g.fillStyle = PAINT_YELLOW;
    g.fillRect(b.x + b.w / 2 - 0.75, top ? back + 0.6 : back - 0.82, 1.5, 0.22);
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
  let carIdx = 0;
  for (const s of f.solids) {
    if (s.kind === 'pillar') {
      shadow();
      g.fillStyle = PILLAR;
      g.fillRect(s.x, s.y, s.w, s.h);
      noShadow();
      const e = s.w * 0.12;
      g.fillStyle = PILLAR_TOP;
      g.fillRect(s.x + e, s.y + e, s.w - 2 * e, s.h - 2 * e);
    } else if (s.kind === 'car') {
      g.save();
      g.translate(s.x + s.w / 2, s.y + s.h / 2);
      g.rotate(backIsTop(s, blockers) ? -Math.PI / 2 : Math.PI / 2); // nose-in
      parkedCar(g, s.h, s.w, PARKED_COLORS[(carIdx++ * 7 + idx * 3) % PARKED_COLORS.length]);
      g.restore();
    }
  }
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
  g.fillStyle = '#b01c2a'; // pop-up headlight lids
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.lineWidth = 0.03;
  for (const y of [-1, 1]) {
    g.fillRect(hl - 0.62, y * 0.48 - 0.12, 0.34, 0.24);
    g.strokeRect(hl - 0.62, y * 0.48 - 0.12, 0.34, 0.24);
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
  const sprites = playerSprites();
  const lightSprite = glowSprite(LIGHT_RGB, [
    [0, 0.3],
    [0.35, 0.12],
    [1, 0],
  ]);
  const postSprite = glowSprite(POST_RGB, [
    [0, 0.2],
    [0.4, 0.08],
    [1, 0],
  ]);
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
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(v: RenderView, dt: number) {
    const f = v.map.floors[v.floorIndex];
    const car = v.car;
    const kmh = Math.hypot(car.vel.x, car.vel.y) * 3.6;
    const step = Math.min(dt, 0.1);

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
    ctx.setTransform(
      ws,
      0,
      0,
      ws,
      dpr * (cssW / 2 + sx - cam.x * scale),
      dpr * (cssH / 2 + sy - cam.y * scale),
    );

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
      if (idx > 0) {
        // fixture tubes sit under the car; same floor weighting as the pools below
        ctx.globalAlpha = v.blend && idx === v.floorIndex ? 1 - v.blend.t : a;
        ctx.fillStyle = TUBE;
        for (const l of fl.lights) {
          if (visible(l.x, l.y, 1)) ctx.fillRect(l.x - 0.8, l.y - 0.09, 1.6, 0.18);
        }
      }
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

    // lights: fluorescent ceiling pools + tubes; roof has lamp posts (its pillars) instead
    // additive, so each floor's lights are weighted by its own share: (1-t) and t
    ctx.globalCompositeOperation = 'lighter';
    for (const [idx, a] of floors) {
      const fl = v.map.floors[idx];
      ctx.globalAlpha = v.blend && idx === v.floorIndex ? 1 - v.blend.t : a;
      if (idx === 0) {
        for (const s of fl.solids) {
          if (s.kind !== 'pillar') continue;
          const x = s.x + s.w / 2;
          const y = s.y + s.h / 2;
          if (visible(x, y, POST_R))
            ctx.drawImage(postSprite, x - POST_R, y - POST_R, 2 * POST_R, 2 * POST_R);
        }
      } else {
        for (const l of fl.lights) {
          if (!visible(l.x, l.y, LIGHT_R)) continue;
          ctx.drawImage(lightSprite, l.x - LIGHT_R, l.y - LIGHT_R, 2 * LIGHT_R, 2 * LIGHT_R);
        }
      }
    }
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
