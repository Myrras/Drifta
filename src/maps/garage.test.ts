import { describe, expect, it } from 'vitest';
import { garage, garageCorners, garageRoute } from './garage';
import { drawDecor, type Decor, type DecorLayer } from './decor';
import { CAR_MODELS } from '../models';
import { CAR_WIDTH } from '../collision';
import type { CarModel, Floor, Helix, Rect, Solid, Vec } from '../types';

const S = 0.5;
const CLEAR = 1.4;
const DEG = Math.PI / 180;

const center = (r: Rect): Vec => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const halfDiag = (s: Solid) => Math.hypot(s.w, s.h) / 2;
const distToRect = (p: Vec, r: Rect) =>
  Math.hypot(Math.max(r.x - p.x, 0, p.x - (r.x + r.w)), Math.max(r.y - p.y, 0, p.y - (r.y + r.h)));
/** Rotated solids are approximated by the circle around them (radius = half-diagonal). */
const distToSolid = (p: Vec, s: Solid) =>
  s.angle
    ? Math.max(0, Math.hypot(p.x - center(s).x, p.y - center(s).y) - halfDiag(s))
    : distToRect(p, s);
const clearance = (p: Vec, f: Floor) =>
  Math.min(
    ...f.solids.map((s) => distToSolid(p, s)),
    ...f.circles.map((c) => Math.hypot(p.x - c.x, p.y - c.y) - c.r),
  );
const inside = (r: Rect, f: Floor) => r.x >= 0 && r.y >= 0 && r.x + r.w <= f.w && r.y + r.h <= f.h;
const inRect = (p: Vec, r: Rect) =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/** Corners of a (rotated) solid grown by `pad`. */
function cornersOf(s: Solid, pad = 0): Vec[] {
  const a = s.angle ?? 0;
  const c = center(s);
  return [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ].map(([i, j]) => {
    const u = i * (s.w / 2 + pad);
    const w = j * (s.h / 2 + pad);
    return {
      x: c.x + u * Math.cos(a) - w * Math.sin(a),
      y: c.y + u * Math.sin(a) + w * Math.cos(a),
    };
  });
}
/** Separating axis test: true if a and b, each grown by gap / 2, still don't overlap. */
function separated(a: Solid, b: Solid, gap = 0) {
  const pa = cornersOf(a, gap / 2);
  const pb = cornersOf(b, gap / 2);
  return [a.angle ?? 0, b.angle ?? 0].some((ang) =>
    [ang, ang + Math.PI / 2].some((t) => {
      const pr = (pts: Vec[]) => pts.map((p) => p.x * Math.cos(t) + p.y * Math.sin(t));
      const A = pr(pa);
      const B = pr(pb);
      return Math.max(...A) <= Math.min(...B) + 1e-9 || Math.max(...B) <= Math.min(...A) + 1e-9;
    }),
  );
}
/** Point strictly inside a (rotated) solid. */
function inSolid(p: Vec, s: Solid) {
  const a = s.angle ?? 0;
  const c = center(s);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const u = dx * Math.cos(a) + dy * Math.sin(a);
  const w = -dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(u) < s.w / 2 && Math.abs(w) < s.h / 2;
}

const rMid = (h: Helix) => (h.rCore + h.rOuter) / 2;
const onRing = (h: Helix, a: number, r = rMid(h)): Vec => ({
  x: h.center.x + r * Math.cos(a),
  y: h.center.y + r * Math.sin(a),
});
const entryPoint = (h: Helix) => onRing(h, h.enterAngle);
const exitPoint = (h: Helix) => onRing(h, h.enterAngle + h.sweep);
const inAnnulus = (p: Vec, h: Helix) => {
  const d = Math.hypot(p.x - h.center.x, p.y - h.center.y);
  return d >= h.rCore && d <= h.rOuter;
};
/** Point on the tangent lane just outside the annulus: before the entry or after the exit. */
function mouth(h: Helix, atExit: boolean): Vec {
  const a = h.enterAngle + (atExit ? h.sweep : 0);
  const heading = a + (Math.sign(h.sweep) * Math.PI) / 2;
  const L = (atExit ? 1 : -1) * (Math.sqrt(h.rOuter ** 2 - rMid(h) ** 2) + 1);
  const p = onRing(h, a);
  return { x: p.x + L * Math.cos(heading), y: p.y + L * Math.sin(heading) };
}

const free = new Map<Floor, Uint8Array>();
/** 1 where a 0.5 m cell center has ≥ 1.4 m clearance from every solid and circle. */
function freeGrid(f: Floor) {
  let g = free.get(f);
  if (!g) {
    const cols = Math.round(f.w / S);
    g = new Uint8Array(cols * Math.round(f.h / S));
    for (let i = 0; i < g.length; i++) {
      const p = { x: ((i % cols) + 0.5) * S, y: (Math.floor(i / cols) + 0.5) * S };
      g[i] = clearance(p, f) >= CLEAR ? 1 : 0;
    }
    free.set(f, g);
  }
  return g;
}

/** Flood fill over free cells (minus `blocked`) from `from`; true if the cell holding `to` is reached. */
function reaches(f: Floor, from: Vec, to: Vec, blocked = (_p: Vec) => false): boolean {
  const g = freeGrid(f);
  const cols = Math.round(f.w / S);
  const rows = Math.round(f.h / S);
  const cell = (p: Vec) => Math.floor(p.y / S) * cols + Math.floor(p.x / S);
  const goal = cell(to);
  const seen = new Uint8Array(g.length);
  const stack = [cell(from)];
  while (stack.length) {
    const i = stack.pop()!;
    if (seen[i] || !g[i]) continue;
    const c = i % cols;
    const r = Math.floor(i / cols);
    if (blocked({ x: (c + 0.5) * S, y: (r + 0.5) * S })) continue;
    seen[i] = 1;
    if (i === goal) return true;
    if (c + 1 < cols) stack.push(i + 1);
    if (c > 0) stack.push(i - 1);
    if (r + 1 < rows) stack.push(i + cols);
    if (r > 0) stack.push(i - cols);
  }
  return false;
}

const segDist = (p: Vec, [a, b]: Vec[]) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
/** Samples every 0.5 m along a polyline. */
function samples(points: Vec[]): Vec[] {
  const out: Vec[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    for (let d = 0; d <= len; d += 0.5)
      out.push({ x: a.x + ((b.x - a.x) * d) / len, y: a.y + ((b.y - a.y) * d) / len });
  }
  return out;
}

const { floors, helixes } = garage;
/** Where the car appears on floor i, and where it must get to. */
const spawnOf = (i: number) => (i === 0 ? garage.start.pos : exitPoint(helixes[i - 1]));
const targetOf = (i: number) =>
  i < helixes.length ? entryPoint(helixes[i]) : center(garage.finish.zone);
const carsOf = (f: Floor) => f.solids.filter((s) => s.kind === 'car');

describe('garage (B2 MEET)', () => {
  it('has 2 floors joined by 1 half-circle helix', () => {
    expect(floors.map((f) => f.name)).toEqual(['B1', 'B2']);
    expect(helixes.map((h) => h.from)).toEqual([0]);
    for (const h of helixes) {
      expect(Math.abs(h.sweep)).toBeCloseTo(Math.PI);
      for (const f of [floors[h.from], floors[h.from + 1]]) {
        expect(f.circles).toContainEqual({ x: h.center.x, y: h.center.y, r: h.rCore });
      }
    }
    expect(garage.start.floor).toBe(0);
    expect(garage.finish.floor).toBe(1);
  });

  it('keeps everything inside floor bounds', () => {
    const all = { x: 0, y: 0, w: 140, h: 80 };
    for (const f of floors) {
      for (const r of [...f.solids, ...f.bays]) expect(inside(r, f)).toBe(true);
      for (const s of f.solids) for (const p of cornersOf(s)) expect(inRect(p, all)).toBe(true);
      for (const c of f.circles) {
        expect(inside({ x: c.x - c.r, y: c.y - c.r, w: 2 * c.r, h: 2 * c.r }, f)).toBe(true);
      }
      for (const l of f.lights) expect(inRect(l, { x: 0, y: 0, w: f.w, h: f.h })).toBe(true);
      expect(f.lights.length).toBeGreaterThan(0);
      expect(f.bays.length).toBeGreaterThan(0);
    }
    expect(inside(garage.finish.zone, floors[1])).toBe(true);
  });

  it('centres and aligns every car that touches a bay, fully inside it', () => {
    for (const f of floors) {
      for (const c of carsOf(f)) {
        const pts = cornersOf(c);
        const m = { x: c.x + c.w / 2, y: c.y + c.h / 2 };
        for (const b of f.bays) {
          if (!pts.some((p) => inRect(p, b)) && !inRect(m, b)) continue;
          expect(m.x).toBeCloseTo(b.x + b.w / 2, 5);
          expect(m.y).toBeCloseTo(b.y + b.h / 2, 5);
          expect(Math.abs(Math.sin(c.facing!)) > 0.5).toBe(b.h > b.w);
          expect(pts.every((p) => inRect(p, b))).toBe(true);
        }
      }
    }
  });

  it('keeps the driven half of every helix ring free of solids on both floors', () => {
    for (const h of helixes) {
      for (const f of [floors[h.from], floors[h.from + 1]]) {
        for (let r = h.rCore + 0.05; r < h.rOuter; r += 0.25) {
          for (let t = 0; t <= 1; t += 0.1 / r / Math.PI) {
            const p = onRing(h, h.enterAngle + h.sweep * t, r);
            expect(f.solids.find((s) => inSolid(p, s))).toBeUndefined();
          }
        }
      }
    }
  });

  it('keeps start and finish clear of solids by 3 m', () => {
    expect(clearance(garage.start.pos, floors[0])).toBeGreaterThanOrEqual(3);
    expect(clearance(center(garage.finish.zone), floors[1])).toBeGreaterThanOrEqual(3);
    expect(floors[0].solids.find((s) => inSolid(garage.start.pos, s))).toBeUndefined();
  });

  it('reaches the helix / the finish from every floor spawn', () => {
    floors.forEach((f, i) => expect(reaches(f, spawnOf(i), targetOf(i))).toBe(true));
  });

  it('only lets you into the helix ring from its open lane', () => {
    for (const h of helixes) {
      const ring = (p: Vec) => inAnnulus(p, h);
      const upper = floors[h.from];
      const lower = floors[h.from + 1];
      expect(reaches(upper, spawnOf(h.from), mouth(h, false), ring)).toBe(true);
      expect(reaches(upper, spawnOf(h.from), mouth(h, true), ring)).toBe(false);
      expect(reaches(lower, mouth(h, true), targetOf(h.from + 1), ring)).toBe(true);
      expect(reaches(lower, mouth(h, true), mouth(h, false), ring)).toBe(false);
    }
  });

  it('has no shortcut past the east side of B1 or the south straight of B2', () => {
    const ring = (p: Vec) => helixes.some((h) => inAnnulus(p, h));
    const cutB1 = (p: Vec) => ring(p) || (p.x > 88 && p.y > 40 && p.y < 42);
    expect(reaches(floors[0], spawnOf(0), mouth(helixes[0], false), cutB1)).toBe(false);
    const cutB2 = (p: Vec) => ring(p) || (p.x > 85 && p.x < 87 && p.y > 45);
    expect(reaches(floors[1], mouth(helixes[0], true), targetOf(1), cutB2)).toBe(false);
  });

  it('route chains spawn to finish and keeps lanes 5+ car widths wide', () => {
    expect(garageRoute.map((r) => r.floor)).toEqual([0, 1]);
    expect(garageRoute[0].points[0]).toEqual(garage.start.pos);
    const last = garageRoute[1].points.at(-1)!;
    expect(inRect(last, garage.finish.zone)).toBe(true);
    // 5 m each side of the line: 10 m lanes, 5.7 car widths
    expect(2 * 5).toBeGreaterThanOrEqual(5 * CAR_WIDTH);
    for (const { floor, points } of garageRoute) {
      for (const p of samples(points)) {
        // helix half circles are drawn as chords, which dip 0.1 m toward the core
        const min = helixes.some((h) => inAnnulus(p, h)) ? 4.9 : 5;
        expect(clearance(p, floors[floor])).toBeGreaterThanOrEqual(min);
      }
    }
    for (const h of helixes) {
      const near = (pts: Vec[], q: Vec) => pts.some((p) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6);
      expect(near(garageRoute[h.from].points, entryPoint(h))).toBe(true);
      expect(near(garageRoute[h.from + 1].points, exitPoint(h))).toBe(true);
    }
  });

  it('links left and right corners on B1', () => {
    const turns = garageCorners[0].map((c) => c.turn).filter((t) => Math.abs(t) > 30 * DEG);
    expect(turns.length).toBeGreaterThanOrEqual(8);
    const flicks = turns.filter((t, i) => i > 0 && Math.sign(t) !== Math.sign(turns[i - 1]));
    expect(flicks.length).toBeGreaterThanOrEqual(4);
  });

  it('laps B2 through 4+ big corners of 3+ radii, never one radius twice in a row', () => {
    const big = garageCorners[1].filter((c) => Math.abs(c.turn) > 60 * DEG);
    expect(big.length).toBeGreaterThanOrEqual(4);
    expect(new Set(big.map((c) => c.r)).size).toBeGreaterThanOrEqual(3);
    big.forEach((c, i) => i > 0 && expect(c.r).not.toBe(big[i - 1].r));
    // a full lap: the B2 line turns through at least 270°
    const sum = garageCorners[1].reduce((s, c) => s + c.turn, 0);
    expect(Math.abs(sum)).toBeGreaterThanOrEqual(1.5 * Math.PI - 1e-9);
  });

  it('sets par from the route length at 17 m/s, medals scaled by length', () => {
    const len = garageRoute
      .flatMap((r) =>
        r.points.slice(1).map((b, i) => Math.hypot(b.x - r.points[i].x, b.y - r.points[i].y)),
      )
      .reduce((a, b) => a + b, 0);
    expect(garage.parTime).toBe(Math.round(len / 17));
    expect(garage.parTime).toBeGreaterThanOrEqual(35);
    expect(garage.parTime).toBeLessThanOrEqual(120);
    const [b, s, g] = garage.medals!;
    expect(b).toBeLessThan(s);
    expect(s).toBeLessThan(g);
    expect(g).toBe(Math.round((17500 * len) / 812 / 500) * 500);
  });

  it('keeps parked cars 0.3 m from every other solid and pillars off everything', () => {
    for (const f of floors) {
      expect(carsOf(f).length).toBeGreaterThan(20);
      for (const c of f.solids.filter((s) => s.kind !== 'wall')) {
        for (const s of f.solids) {
          if (s !== c) expect(separated(c, s, c.kind === 'car' ? 0.3 : 0)).toBe(true);
        }
      }
    }
  });

  it('is called B2 MEET', () => {
    expect(garage.name).toBe('B2 MEET');
  });

  it('parks every car as a JDM model with its real footprint, rotated to its heading', () => {
    const used = new Set<CarModel>();
    for (const f of floors) {
      for (const c of carsOf(f)) {
        expect(c.model && c.color && Number.isFinite(c.facing)).toBeTruthy();
        const m = CAR_MODELS[c.model!];
        used.add(c.model!);
        expect(m.colors).toContain(c.color);
        expect(c.angle).toBe(c.facing);
        expect(c.w).toBeCloseTo(m.length, 6);
        expect(c.h).toBeCloseTo(m.width, 6);
      }
    }
    expect(used.size).toBe(10);
  });

  it('lines up the B2 meet with hazards on', () => {
    expect(carsOf(floors[1]).filter((c) => c.lights === 'hazard').length).toBeGreaterThanOrEqual(
      12,
    );
  });

  it('has exactly 2 boom cars on every floor, each near the route', () => {
    floors.forEach((f, i) => {
      const boom = carsOf(f).filter((c) => c.boom);
      expect(boom.length).toBe(2);
      for (const c of boom) {
        const d = Math.min(
          ...garageRoute[i].points.map((p) => Math.hypot(p.x - center(c).x, p.y - center(c).y)),
        );
        expect(d).toBeLessThan(15);
      }
    });
  });

  it('lights about 1 in 5 other cars, aimed down the course at open floor', () => {
    const cars = floors.flatMap(carsOf).filter((c) => c.lights !== 'hazard');
    const lit = cars.filter((c) => c.lights === 'on');
    expect(lit.length / cars.length).toBeGreaterThan(0.12);
    expect(lit.length / cars.length).toBeLessThan(0.3);
    garageRoute.forEach(({ points }, i) => {
      const f = floors[i];
      for (const c of carsOf(f).filter((s) => s.lights === 'on')) {
        const k = center(c);
        const ahead = (d: number) => ({
          x: k.x + (c.w / 2 + d) * Math.cos(c.facing!),
          y: k.y + (c.w / 2 + d) * Math.sin(c.facing!),
        });
        expect(f.solids.find((s) => inSolid(ahead(6), s))).toBeUndefined();
        const near = points
          .slice(1)
          .map((q, j) => [points[j], q])
          .reduce((best, seg) => (segDist(k, seg) < segDist(k, best) ? seg : best));
        const dir = Math.atan2(near[1].y - near[0].y, near[1].x - near[0].x);
        expect(Math.cos(c.facing! - dir)).toBeGreaterThan(0);
      }
    });
  });

  it('dresses both floors with every decor kind, inside the floor', () => {
    const decor = garage.decor!;
    const kinds = new Set(decor.map((d) => d.kind));
    for (const k of [
      'text',
      'arrow',
      'hatch',
      'stain',
      'skid',
      'graffiti',
      'neon',
      'pool',
      'shaft',
      'crowd',
    ])
      expect(kinds).toContain(k);
    const pts = (d: Decor): Vec[] =>
      d.kind === 'skid' ? d.points : d.kind === 'neon' ? [d.a, d.b] : [{ x: d.x, y: d.y }];
    for (const d of decor) {
      expect(floors[d.floor]).toBeDefined();
      for (const p of pts(d)) expect(inRect(p, { x: 0, y: 0, w: 140, h: 80 })).toBe(true);
    }
    for (const i of [0, 1]) expect(decor.filter((d) => d.floor === i).length).toBeGreaterThan(30);
  });
});

describe('drawDecor', () => {
  /** Canvas stand-in: every method is a counted no-op, gradients included. */
  function mockCtx() {
    const calls: string[] = [];
    const gradient = { addColorStop: () => {} };
    const state: Record<string | symbol, unknown> = { globalAlpha: 1 };
    const ctx = new Proxy(state, {
      get: (t, k) =>
        k in t
          ? t[k]
          : (...args: unknown[]) => {
              calls.push(String(k));
              void args;
              return String(k).startsWith('create') ? gradient : undefined;
            },
      set: (t, k, v) => ((t[k] = v), true),
    }) as unknown as CanvasRenderingContext2D;
    return { ctx, calls, state };
  }

  it('draws every layer of both floors and restores the caller alpha', () => {
    const layers: DecorLayer[] = ['floor', 'wall', 'light', 'glow', 'over'];
    for (const floor of [0, 1]) {
      for (const layer of layers) {
        const { ctx, calls, state } = mockCtx();
        state.globalAlpha = 0.5;
        expect(() => drawDecor(ctx, garage.decor!, layer, floor, 12.3)).not.toThrow();
        expect(calls.length).toBeGreaterThan(0);
        expect(state.globalAlpha).toBe(0.5);
      }
    }
  });

  it('skips decor of other floors', () => {
    const { ctx, calls } = mockCtx();
    drawDecor(ctx, garage.decor!, 'floor', 7, 0);
    expect(calls).toEqual([]);
  });
});
