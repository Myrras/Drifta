import { describe, expect, it } from 'vitest';
import { tokyo, tokyoCity, tokyoCorners, tokyoDeck, tokyoRoute, type KerbWalkway } from './tokyo';
import { drawDecor, type Decor, type DecorLayer } from './decor';
import { createTraffic } from '../traffic';
import { CAR_WIDTH, nearestDistance } from '../collision';
import { COP_SHOW_DIST } from '../scoring';
import type { Floor, Rect, Solid, Vec } from '../types';

const DEG = Math.PI / 180;
const [f, deck] = tokyo.floors;
const [helix] = tokyo.helixes;
const MAP = { x: 0, y: 0, w: f.w, h: f.h };
const inRect = (p: Vec, r: Rect) =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/** Exact distance from p to a (rotated) solid; 0 inside. */
function distToSolid(p: Vec, s: Solid) {
  const a = s.angle ?? 0;
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const dx = p.x - cx;
  const dy = p.y - cy;
  const u = Math.abs(dx * Math.cos(a) + dy * Math.sin(a)) - s.w / 2;
  const w = Math.abs(-dx * Math.sin(a) + dy * Math.cos(a)) - s.h / 2;
  return Math.hypot(Math.max(u, 0), Math.max(w, 0));
}
const clearance = (p: Vec, fl: Floor = f) =>
  Math.min(
    ...fl.solids.map((s) => distToSolid(p, s)),
    ...fl.circles.map((c) => Math.hypot(p.x - c.x, p.y - c.y) - c.r),
  );
function cornersOf(s: Solid): Vec[] {
  const a = s.angle ?? 0;
  const c = { x: s.x + s.w / 2, y: s.y + s.h / 2 };
  return [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ].map(([i, j]) => ({
    x: c.x + ((i * s.w) / 2) * Math.cos(a) - ((j * s.h) / 2) * Math.sin(a),
    y: c.y + ((i * s.w) / 2) * Math.sin(a) + ((j * s.h) / 2) * Math.cos(a),
  }));
}
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
const segDist = (p: Vec, a: Vec, b: Vec) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
const polyDist = (p: Vec, pts: Vec[]) =>
  Math.min(...pts.slice(1).map((b, i) => segDist(p, pts[i], b)));
const length = (pts: Vec[]) =>
  pts.slice(1).reduce((s, b, i) => s + Math.hypot(b.x - pts[i].x, b.y - pts[i].y), 0);
/** City parts of route A and B (floor 0, up to the helix midpoint), then the shared deck. */
const [cityA, cityB, deckRoute] = tokyoRoute.map((r) => r.points);
const routes = [cityA, cityB];
const SCRAMBLE = { x: 210, y: 125 };
const onRing = (p: number, r = (helix.rCore + helix.rOuter) / 2): Vec => {
  const a = helix.enterAngle + helix.sweep * p;
  return { x: helix.center.x + r * Math.cos(a), y: helix.center.y + r * Math.sin(a) };
};
const inRing = (p: Vec) => {
  const d = Math.hypot(p.x - helix.center.x, p.y - helix.center.y);
  return d >= helix.rCore - 1 && d <= helix.rOuter + 1;
};

/** Flood fill a 1 m grid from `from`; a cell is blocked within a car half width of a solid. */
function reachable(fl: Floor, from: Vec, cut = (_p: Vec) => false) {
  const blocked = new Uint8Array(fl.w * fl.h);
  for (const s of fl.solids) {
    const cs = cornersOf(s);
    const [x0, x1] = [Math.min(...cs.map((p) => p.x)) - 2, Math.max(...cs.map((p) => p.x)) + 2];
    const [y0, y1] = [Math.min(...cs.map((p) => p.y)) - 2, Math.max(...cs.map((p) => p.y)) + 2];
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(fl.h, y1); y++)
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(fl.w, x1); x++)
        if (distToSolid({ x: x + 0.5, y: y + 0.5 }, s) < CAR_WIDTH / 2) blocked[y * fl.w + x] = 1;
  }
  for (let i = 0; i < blocked.length; i++) {
    const p = { x: (i % fl.w) + 0.5, y: Math.floor(i / fl.w) + 0.5 };
    if (cut(p) || fl.circles.some((c) => Math.hypot(p.x - c.x, p.y - c.y) < c.r + CAR_WIDTH / 2))
      blocked[i] = 1;
  }
  const seen = new Uint8Array(fl.w * fl.h);
  const start = Math.floor(from.y) * fl.w + Math.floor(from.x);
  const todo = [start];
  seen[start] = 1;
  while (todo.length) {
    const i = todo.pop()!;
    const [x, y] = [i % fl.w, Math.floor(i / fl.w)];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const [nx, ny] = [x + dx, y + dy];
      const j = ny * fl.w + nx;
      if (nx < 0 || ny < 0 || nx >= fl.w || ny >= fl.h || seen[j] || blocked[j]) continue;
      seen[j] = 1;
      todo.push(j);
    }
  }
  return (p: Vec) => seen[Math.floor(p.y) * fl.w + Math.floor(p.x)] === 1;
}
/** The deck just past the helix exit, heading west. */
const DECK_IN = { x: 285, y: 9 };

describe('tokyo (TOKYO NIGHTS)', () => {
  it('is the city with the expressway deck over it, joined by one helix up', () => {
    expect(tokyo.name).toBe('TOKYO NIGHTS');
    expect(tokyo.floors.map((fl) => fl.name)).toEqual(['NEON CITY', 'EXPWY']);
    expect(deck.below).toBe(0);
    expect(f.below).toBeUndefined();
    expect(tokyo.helixes.length).toBe(1);
    expect(helix.from).toBe(0);
    expect(Math.abs(helix.sweep)).toBeCloseTo(Math.PI);
    for (const fl of tokyo.floors)
      expect(fl.circles).toContainEqual({ ...helix.center, r: helix.rCore });
    expect(tokyo.start.floor).toBe(0);
    expect(tokyo.finish.floor).toBe(1);
    expect(f.w * f.h).toBeGreaterThanOrEqual(400 * 300);
    expect([deck.w, deck.h]).toEqual([f.w, f.h]);
  });

  it('keeps solids, lights, clip zones and the finish inside the map', () => {
    for (const fl of tokyo.floors) {
      for (const s of fl.solids) for (const p of cornersOf(s)) expect(inRect(p, MAP)).toBe(true);
      for (const l of fl.lights) expect(inRect(l, MAP)).toBe(true);
      for (const z of fl.clipZones!)
        expect(inRect(z, MAP) && inRect({ x: z.x + z.w, y: z.y + z.h }, MAP)).toBe(true);
      expect(fl.clipZones!.length).toBeGreaterThanOrEqual(3);
    }
    const z = tokyo.finish.zone;
    expect(inRect(z, MAP) && inRect({ x: z.x + z.w, y: z.y + z.h }, MAP)).toBe(true);
    expect(f.lights.length).toBeGreaterThan(40);
    expect(deck.lights.length).toBeGreaterThan(15);
  });

  it('keeps the start and the finish clear of solids by 3 m', () => {
    expect(clearance(tokyo.start.pos)).toBeGreaterThanOrEqual(3);
    const z = tokyo.finish.zone;
    expect(clearance({ x: z.x + z.w / 2, y: z.y + z.h / 2 }, deck)).toBeGreaterThanOrEqual(3);
    expect(inRect(tokyo.start.pos, z)).toBe(false);
  });

  it('both routes run start to helix, the deck helix to finish, 5 m off every solid (5+ car widths)', () => {
    expect(tokyoRoute.map((r) => r.floor)).toEqual([0, 0, 1]);
    expect(2 * 5).toBeGreaterThanOrEqual(5 * CAR_WIDTH);
    const near = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
    for (const r of routes) {
      expect(r[0]).toEqual(tokyo.start.pos);
      expect(r.some((p) => near(p, onRing(0)))).toBe(true);
      expect(near(r.at(-1)!, onRing(0.5))).toBe(true);
    }
    expect(near(deckRoute[0], onRing(0.5))).toBe(true);
    expect(deckRoute.some((p) => near(p, onRing(1)))).toBe(true);
    expect(inRect(deckRoute.at(-1)!, tokyo.finish.zone)).toBe(true);
    for (const { floor, points } of tokyoRoute)
      for (const p of samples(points)) {
        // the helix arcs are drawn as chords, which dip 0.1 m toward the core
        const min = inRing(p) ? 4.9 : 5;
        expect(clearance(p, tokyo.floors[floor])).toBeGreaterThanOrEqual(min);
      }
  });

  it('keeps the driven quarter of the helix free of solids on each floor', () => {
    for (const [fl, t0, t1] of [
      [f, 0, 0.55],
      [deck, 0.45, 1],
    ] as [Floor, number, number][])
      for (let r = helix.rCore + 0.05; r < helix.rOuter; r += 0.25)
        for (let t = t0; t <= t1; t += 0.1 / r / Math.PI)
          expect(clearance(onRing(t, r), fl)).toBeGreaterThan(0);
  });

  it('forks at the start: A over the scramble, B along the canal, A a little longer', () => {
    const [a, b] = routes;
    expect(a.some((p) => Math.hypot(p.x - SCRAMBLE.x, p.y - SCRAMBLE.y) < 12)).toBe(true);
    expect(samples(b).some((p) => Math.hypot(p.x - SCRAMBLE.x, p.y - SCRAMBLE.y) < 40)).toBe(false);
    expect(Math.min(...b.map((p) => p.x))).toBeLessThan(70); // down the canal
    const ratio = length(a) / length(b);
    expect(ratio).toBeGreaterThan(1.02);
    expect(ratio).toBeLessThan(1.12);
  });

  it('city routes: flowing corners, no radius twice per route, A has its hairpin', () => {
    for (const cs of tokyoCorners.slice(0, 2)) {
      const big = cs.filter((c) => Math.abs(c.turn) > 60 * DEG);
      expect(new Set(big.map((c) => c.r)).size).toBe(big.length);
      expect(cs.filter((c) => Math.abs(c.turn) < 60 * DEG).length).toBeGreaterThanOrEqual(4);
    }
    // route A's hairpin: two tight corners turning the same way, back to back
    const a = tokyoCorners[0];
    expect(
      a.some(
        (c, i) =>
          i > 0 && c.r < 16 && a[i - 1].r < 16 && Math.sign(c.turn) === Math.sign(a[i - 1].turn),
      ),
    ).toBe(true);
  });

  it('bends the deck: sweepers and S-bends, no right angles, one long banked curve', () => {
    const cs = tokyoCorners[2];
    expect(cs.length).toBeGreaterThanOrEqual(8);
    expect(new Set(cs.map((c) => c.r)).size).toBe(cs.length); // every radius different
    expect(Math.min(...cs.map((c) => c.r))).toBeGreaterThanOrEqual(30);
    const flicks = cs.filter((c, i) => i > 0 && Math.sign(c.turn) !== Math.sign(cs[i - 1].turn));
    expect(flicks.length).toBeGreaterThanOrEqual(4);
    // nothing near 90°: corners stay under 70°, except the one long sweeper
    const long = cs.filter((c) => Math.abs(c.turn) >= 70 * DEG);
    expect(long.length).toBe(1);
    expect(long[0].r).toBeGreaterThanOrEqual(50);
    expect(Math.abs(long[0].turn) * long[0].r).toBeGreaterThan(90);
    // longest straight under 90 m
    const seg = deckRoute
      .slice(1)
      .map((b, i) => Math.hypot(b.x - deckRoute[i].x, b.y - deckRoute[i].y));
    expect(Math.max(...seg)).toBeLessThan(90);
    expect(length(deckRoute)).toBeGreaterThan(600);
    // the deck floats over the city, well clear of the scramble
    expect(polyDist(SCRAMBLE, tokyoDeck.center)).toBeGreaterThan(35);
  });

  it('makes the scramble a SCRAMBLE bonus zone on route A only', () => {
    const zones = f.bonusZones!;
    expect(zones.length).toBeGreaterThanOrEqual(1);
    expect(deck.bonusZones ?? []).toEqual([]);
    for (const z of zones) {
      expect(z).toMatchObject({ id: 'scramble', trick: 'SCRAMBLE' });
      expect(inRect(z, MAP) && inRect({ x: z.x + z.w, y: z.y + z.h }, MAP)).toBe(true);
      expect(samples(routes[0]).some((p) => inRect(p, z))).toBe(true);
      expect(samples(routes[1]).some((p) => inRect(p, z))).toBe(false);
    }
  });

  it('parks police cars by the on-ramp, close to both routes', () => {
    const cops = f.solids.filter((s) => s.kind === 'car' && s.police);
    expect(cops.length).toBeGreaterThanOrEqual(2);
    for (const c of cops)
      expect(Math.hypot(c.x + c.w / 2 - 286, c.y + c.h / 2 - 20)).toBeLessThan(60);
    for (const r of routes)
      expect(
        Math.min(...samples(r).flatMap((p) => cops.map((c) => distToSolid(p, c)))),
      ).toBeLessThan(7);
  });

  it('lets a car drifting down either route earn COP SHOW (slip 0.5 rad, hull to police rect)', () => {
    const cops = f.solids.filter((s) => s.kind === 'car' && s.police);
    for (const r of routes) {
      let best = Infinity;
      for (let i = 1; i < r.length; i++)
        for (const p of samples([r[i - 1], r[i]])) {
          const heading = Math.atan2(r[i].y - r[i - 1].y, r[i].x - r[i - 1].x);
          for (const slip of [-0.5, 0.5]) {
            const car = { pos: p, vel: { x: 0, y: 0 }, angle: heading + slip, angVel: 0, rpm: 0 };
            best = Math.min(best, nearestDistance(car, cops));
          }
        }
      expect(best).toBeLessThan(COP_SHOW_DIST);
    }
  });

  it('closes the side streets and the city edge: only the routes and the helix are reachable', () => {
    const reach = reachable(f, tokyo.start.pos);
    for (const r of routes) for (const p of samples(r)) expect(reach(p)).toBe(true);
    // the scramble's closed arms, the side streets mid way, the city beyond the wall
    for (const [x, y] of [
      [130, 125],
      [210, 175],
      [100, 90],
      [140, 180],
      [262, 175],
      [250, 80],
      [150, 10],
      [390, 150],
      [200, 292],
      [DECK_IN.x, DECK_IN.y],
    ])
      expect(reach({ x, y })).toBe(false);
    // without the helix ring the street can't get up: the ring is the only way past the wall
    const noRing = reachable(f, tokyo.start.pos, inRing);
    expect(noRing({ x: 280, y: 31 })).toBe(true);
    expect(noRing({ x: helix.center.x, y: 5 })).toBe(false);
  });

  it('keeps the deck closed: helix exit to finish, nothing off its rails', () => {
    const reach = reachable(deck, DECK_IN);
    const z = tokyo.finish.zone;
    expect(reach({ x: z.x + z.w / 2, y: z.y + z.h / 2 })).toBe(true);
    for (const p of samples(deckRoute)) expect(reach(p)).toBe(true);
    // the city below, the frontage road, either side of the deck
    for (const p of [
      { x: 200, y: 150 },
      { x: 302, y: 45 },
      { x: 330, y: 120 },
      { x: 380, y: 260 },
    ])
      expect(reach(p)).toBe(false);
    // up here the ring only runs down to its p = 0.25 block
    expect(reach(onRing(0.4))).toBe(true);
    expect(reach(onRing(0.1))).toBe(false);
  });

  it('sets par from the route length at 17 m/s, medals scaled like B2 MEET', () => {
    const len = length(cityA) + length(deckRoute);
    expect(tokyo.parTime).toBe(Math.round(len / 17));
    const [b, s, g] = tokyo.medals!;
    expect(b).toBeLessThan(s);
    expect(s).toBeLessThan(g);
    expect(g).toBe(Math.round((17500 * len) / 812 / 500) * 500);
    expect(tokyo.start.angle).toBeCloseTo(-Math.PI / 2); // up the stub toward the fork
  });

  it('keeps every lane and walkway inside the map, lanes 1.2 m off solids', () => {
    for (const l of tokyoCity.lanes) {
      for (const p of samples(l.pts)) {
        expect(inRect(p, MAP)).toBe(true);
        expect(clearance(p)).toBeGreaterThanOrEqual(1.2);
      }
    }
    for (const w of tokyoCity.walkways) for (const p of w.pts) expect(inRect(p, MAP)).toBe(true);
    // about 30% fewer cars than the 30 of v0.9
    expect(tokyoCity.cars).toBeGreaterThanOrEqual(18);
    expect(tokyoCity.cars).toBeLessThanOrEqual(22);
    expect(tokyoCity.peds).toBeGreaterThanOrEqual(40);
  });

  it('keeps traffic off the helix (the deck is a floor of its own)', () => {
    for (const l of tokyoCity.lanes) for (const p of samples(l.pts)) expect(inRing(p)).toBe(false);
  });

  it('gives every lane a way on and holds the loop at the scramble signal', () => {
    const ids = new Set(tokyoCity.lanes.map((l) => l.id));
    const feeders = new Map<string, string[]>();
    for (const l of tokyoCity.lanes) {
      expect(l.next.length).toBeGreaterThan(0);
      for (const n of l.next) {
        expect(ids.has(n)).toBe(true);
        feeders.set(n, [...(feeders.get(n) ?? []), l.id]);
      }
    }
    const byId = new Map(tokyoCity.lanes.map((l) => [l.id, l]));
    const merges = [...feeders.values()].filter((fs) => fs.length > 1);
    // both directions of the loop stop for the scramble
    const held = tokyoCity.lanes.filter((l) => l.light?.id === 'Sa');
    expect(held.length).toBe(2);
    for (const l of held) expect(polyDist(SCRAMBLE, l.pts)).toBeLessThan(10);
    const t = createTraffic({ ...tokyoCity, cars: 0, peds: 0 }, 1);
    const lit = merges.map((fs) => fs.map((id) => byId.get(id)!.light!.id));
    for (const fs of merges) for (const id of fs) expect(byId.get(id)!.light).toBeDefined();
    // never two feeders of one merge on green or amber at once
    for (let n = 0; n < 4 * 300; n++) {
      t.step(0.25, { pos: { x: 1e4, y: 1e4 }, vel: { x: 0, y: 0 } });
      for (const sigs of lit) {
        const going = sigs.filter((s) => t.signalState(s).car !== 'red');
        expect(going.length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('runs a scramble: all-red ped phase, straight and diagonal crossings on its signal', () => {
    const scramble = tokyoCity.walkways.filter((w) => w.crossing?.signal === 'Sa');
    const diagonal = scramble.filter((w) => {
      const [a, b] = w.pts;
      return Math.abs(Math.abs(b.x - a.x) - Math.abs(b.y - a.y)) < 1;
    });
    expect(diagonal.length).toBeGreaterThanOrEqual(2);
    expect(scramble.length - diagonal.length).toBeGreaterThanOrEqual(4);
    const sig = tokyoCity.signals.find((s) => s.id === 'Sa')!;
    expect(sig.cycle.some((p) => p.ped && p.car === 'red')).toBe(true);
    const b = tokyoCity.signals.find((s) => s.id === 'Sb')!;
    // ped phase lines up: both car signals red throughout it
    let t = 0;
    for (const p of sig.cycle) {
      if (p.ped) {
        let u = 0;
        const at = b.cycle.find((q) => (u += q.dur) > t + 0.01)!;
        expect(at.car).toBe('red');
      }
      t += p.dur;
    }
    // sidewalk loops carry the kerb hint
    const loops = tokyoCity.walkways.filter((w) => !w.crossing) as KerbWalkway[];
    expect(loops.every((w) => w.kerb === -1)).toBe(true);
  });

  it('steps 60 s of traffic: cars stay on lanes, no two on one lane overlap', () => {
    const t = createTraffic(tokyoCity, 1);
    expect(t.cars.length).toBe(tokyoCity.cars);
    expect(t.peds.length).toBe(tokyoCity.peds);
    let moving = 0;
    for (let n = 0; n < 60 * 60; n++) {
      t.step(1 / 60, { pos: { x: 1e4, y: 1e4 }, vel: { x: 0, y: 0 } });
      if (n % 10) continue;
      for (const a of t.cars) {
        if (a.speed > 1) moving++;
        for (const b of t.cars) {
          if (a === b || Math.cos(a.heading - b.heading) < 0.999) continue;
          const dx = b.pos.x - a.pos.x;
          const dy = b.pos.y - a.pos.y;
          const along = dx * Math.cos(a.heading) + dy * Math.sin(a.heading);
          const side = -dx * Math.sin(a.heading) + dy * Math.cos(a.heading);
          if (Math.abs(side) > 0.5) continue;
          expect(Math.abs(along)).toBeGreaterThan((a.length + b.length) / 2);
        }
      }
    }
    for (const c of t.cars) {
      expect(Math.min(...tokyoCity.lanes.map((l) => polyDist(c.pos, l.pts)))).toBeLessThan(0.01);
    }
    expect(moving).toBeGreaterThan(0);
  });

  it('dresses the district with every city decor kind, all inside the map', () => {
    const decor = tokyo.decor!;
    const kinds = new Set(decor.map((d) => d.kind));
    for (const k of [
      'asphalt',
      'paint',
      'block',
      'front',
      'sign',
      'screen',
      'vending',
      'manhole',
      'neon',
      'crowd',
      'pool',
      'skid',
      'arrow',
      'text',
      'cone',
      'roadsign',
      'lantern',
    ])
      expect(kinds).toContain(k);
    const pts = (d: Decor): Vec[] =>
      d.kind === 'skid'
        ? d.points
        : d.kind === 'neon'
          ? [d.a, d.b]
          : d.kind === 'paint'
            ? [{ x: d.x, y: d.y }, ...d.to]
            : d.kind === 'block' || d.kind === 'asphalt'
              ? [
                  { x: d.x, y: d.y },
                  { x: d.x + d.w, y: d.y + d.h },
                ]
              : [{ x: d.x, y: d.y }];
    for (const d of decor) {
      expect([0, 1]).toContain(d.floor);
      for (const p of pts(d)) expect(inRect(p, MAP)).toBe(true);
    }
    expect(decor.filter((d) => d.kind === 'crowd').length).toBeGreaterThan(30);
    // the deck: surface and lines, lamps, sign gantries, tire marks; no city kinds up there
    const up = new Set(decor.filter((d) => d.floor === 1).map((d) => d.kind));
    for (const k of ['paint', 'pool', 'sign', 'skid', 'arrow', 'text']) expect(up).toContain(k);
    for (const k of ['asphalt', 'block', 'front', 'crowd']) expect(up).not.toContain(k);
    // the over layer (per frame) stays lean
    const over = decor.filter((d) => ['neon', 'crowd', 'screen', 'shaft'].includes(d.kind));
    expect(over.length).toBeLessThan(400);
  });
});

describe('drawDecor (city kinds)', () => {
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

  it('draws every layer of the district and restores the caller alpha', () => {
    for (const layer of ['floor', 'wall', 'light', 'glow', 'over'] as DecorLayer[]) {
      const { ctx, calls, state } = mockCtx();
      state.globalAlpha = 0.5;
      expect(() => drawDecor(ctx, tokyo.decor!, layer, 0, 7.7)).not.toThrow();
      expect(calls.length).toBeGreaterThan(0);
      expect(state.globalAlpha).toBe(0.5);
    }
  });

  it('culls the over layer to the visible area', () => {
    const { ctx, calls, state } = mockCtx();
    state.canvas = { width: 100, height: 100 };
    state.getTransform = () => ({ a: 10, b: 0, c: 0, d: 10, e: -1e5, f: -1e5 }); // far away
    drawDecor(ctx, tokyo.decor!, 'over', 0, 1);
    expect(calls).toEqual([]);
  });
});
