import type { CarState, Hit, Rect, Solid, Vec } from './types';

export const CAR_LENGTH = 4.0; // along heading
export const CAR_WIDTH = 1.75;

const HL = CAR_LENGTH / 2;
const HW = CAR_WIDTH / 2;

export function carCorners(car: CarState): Vec[] {
  const c = Math.cos(car.angle);
  const s = Math.sin(car.angle);
  return [
    [HL, HW],
    [HL, -HW],
    [-HL, -HW],
    [-HL, HW],
  ].map(([l, w]) => ({ x: car.pos.x + l * c - w * s, y: car.pos.y + l * s + w * c }));
}

export function inRect(p: Vec, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

function rectCorners(r: Rect): Vec[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}

function hitOne(car: CarState, corners: Vec[], r: Rect): Hit | null {
  const c = Math.cos(car.angle);
  const s = Math.sin(car.angle);
  const axes: Vec[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: c, y: s },
    { x: -s, y: c },
  ];
  const rc = rectCorners(r);
  const rcx = r.x + r.w / 2;
  const rcy = r.y + r.h / 2;
  let best: Hit | null = null;
  for (const a of axes) {
    const pr = (pts: Vec[]) => pts.map((p) => p.x * a.x + p.y * a.y);
    const cp = pr(corners);
    const rp = pr(rc);
    const depth =
      Math.min(Math.max(...cp), Math.max(...rp)) - Math.max(Math.min(...cp), Math.min(...rp));
    if (depth <= 0) return null;
    if (!best || depth < best.depth) {
      const sign = (car.pos.x - rcx) * a.x + (car.pos.y - rcy) * a.y >= 0 ? 1 : -1;
      best = { normal: { x: a.x * sign, y: a.y * sign }, depth };
    }
  }
  return best;
}

// Structural stand-in: types.ts has no Circle yet. Swap for the shared type once it lands.
export interface Circle {
  x: number;
  y: number;
  r: number;
}

function hitCircle(car: CarState, k: Circle): Hit | null {
  const dx = k.x - car.pos.x;
  const dy = k.y - car.pos.y;
  if (Math.abs(dx) > k.r + 3 || Math.abs(dy) > k.r + 3) return null;
  const c = Math.cos(car.angle);
  const s = Math.sin(car.angle);
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;
  const ex = Math.max(-HL, Math.min(HL, lx)) - lx;
  const ey = Math.max(-HW, Math.min(HW, ly)) - ly;
  const d = Math.hypot(ex, ey);
  if (d >= k.r) return null;
  if (d > 1e-9) {
    // local vector circle -> closest point, rotated to world
    return { normal: { x: (ex * c - ey * s) / d, y: (ex * s + ey * c) / d }, depth: k.r - d };
  }
  const m = Math.hypot(dx, dy);
  const nx = m > 1e-9 ? -dx / m : 1;
  const ny = m > 1e-9 ? -dy / m : 0;
  // distance from center to box face along the direction toward the car (local frame)
  const ux = nx * c + ny * s;
  const uy = -nx * s + ny * c;
  const t = Math.min(
    Math.abs(ux) > 1e-9 ? (HL - Math.sign(ux) * lx) / Math.abs(ux) : Infinity,
    Math.abs(uy) > 1e-9 ? (HW - Math.sign(uy) * ly) / Math.abs(uy) : Infinity,
  );
  return { normal: { x: nx, y: ny }, depth: k.r + t };
}

export function collide(car: CarState, solids: Solid[], circles: Circle[] = []): Hit | null {
  const corners = carCorners(car);
  let best: Hit | null = null;
  for (const s of solids) {
    const h = hitOne(car, corners, s);
    if (h && (!best || h.depth > best.depth)) best = h;
  }
  for (const k of circles) {
    const h = hitCircle(car, k);
    if (h && (!best || h.depth > best.depth)) best = h;
  }
  return best;
}

function pointRectDist(p: Vec, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

function circleGap(car: CarState, k: Circle): number {
  const dx = k.x - car.pos.x;
  const dy = k.y - car.pos.y;
  const c = Math.cos(car.angle);
  const s = Math.sin(car.angle);
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;
  const d = Math.hypot(lx - Math.max(-HL, Math.min(HL, lx)), ly - Math.max(-HW, Math.min(HW, ly)));
  return Math.max(0, d - k.r);
}

export function nearestDistance(car: CarState, solids: Solid[], circles: Circle[] = []): number {
  if (collide(car, solids, circles)) return 0;
  const corners = carCorners(car);
  const c = Math.cos(car.angle);
  const s = Math.sin(car.angle);
  // rect corners in car-local frame vs the centered car box
  const carBox: Rect = { x: -HL, y: -HW, w: CAR_LENGTH, h: CAR_WIDTH };
  let min = Infinity;
  for (const k of circles) min = Math.min(min, circleGap(car, k));
  for (const r of solids) {
    for (const p of corners) min = Math.min(min, pointRectDist(p, r));
    for (const p of rectCorners(r)) {
      const dx = p.x - car.pos.x;
      const dy = p.y - car.pos.y;
      min = Math.min(min, pointRectDist({ x: dx * c + dy * s, y: -dx * s + dy * c }, carBox));
    }
  }
  return min;
}
