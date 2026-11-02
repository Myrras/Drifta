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

export function collide(car: CarState, solids: Solid[]): Hit | null {
  const corners = carCorners(car);
  let best: Hit | null = null;
  for (const s of solids) {
    const h = hitOne(car, corners, s);
    if (h && (!best || h.depth > best.depth)) best = h;
  }
  return best;
}

function pointRectDist(p: Vec, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

export function nearestDistance(car: CarState, solids: Solid[]): number {
  if (collide(car, solids)) return 0;
  const corners = carCorners(car);
  const c = Math.cos(car.angle);
  const s = Math.sin(car.angle);
  // rect corners in car-local frame vs the centered car box
  const carBox: Rect = { x: -HL, y: -HW, w: CAR_LENGTH, h: CAR_WIDTH };
  let min = Infinity;
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
