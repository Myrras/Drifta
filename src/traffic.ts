import type { Vec } from './types';

/** Pure, deterministic city traffic and pedestrians. Metres, seconds, radians (0 = +x, clockwise on screen). */
export interface Lane {
  id: string;
  pts: Vec[];
  /** m/s */
  speed: number;
  /** lane ids it can continue into */
  next: string[];
  /** stopAt: distance along the lane of the stop line */
  light?: { id: string; stopAt: number };
}
/** phases loop; phase time = (time + offset) mod cycle length */
export interface Signal {
  id: string;
  cycle: { car: 'green' | 'amber' | 'red'; ped: boolean; dur: number }[];
  offset: number;
}
/** closed (first pt == last pt) walkways loop, open ones are walked back and forth */
export interface Walkway {
  id: string;
  pts: Vec[];
  /** if set, peds only start walking while the signal phase has ped=true */
  crossing?: { signal: string };
  /** side of the pts order (a -> b) where the road is, -1 = left: peds dodge away from it */
  kerb?: -1 | 1;
}
export interface CityGraph {
  lanes: Lane[];
  signals: Signal[];
  walkways: Walkway[];
  cars: number;
  peds: number;
}
export interface TrafficCar {
  id: number;
  pos: Vec;
  heading: number;
  speed: number;
  length: number;
  width: number;
  color: string;
  hazardsUntil: number;
  /** slowing down or standing: brake lights */
  braking: boolean;
}
export interface Ped {
  id: number;
  pos: Vec;
  heading: number;
  walking: boolean;
  /** 0..1 step-back amount */
  dodge: number;
  color: string;
}
export interface Traffic {
  cars: TrafficCar[];
  peds: Ped[];
  step(dt: number, player: { pos: Vec; vel: Vec }): void;
  /** car stops with hazards for HIT_STOP s, then resumes */
  hit(carId: number, now: number): void;
  signalState(id: string): { car: 'green' | 'amber' | 'red'; ped: boolean };
  time: number;
}

// IDM car following
const ACC = 2; // m/s² max acceleration
const DEC = 3; // m/s² comfortable braking
const MAX_DEC = 8;
const S0 = 2; // m standstill gap
const HEADWAY = 1.2; // s
const STOP_DEC = 4.5; // m/s² above this a car runs the amber/red instead of stopping
const STOP_MARGIN = 0.5; // m, cars stop this far before the line
const MIN_SPACING = 10; // m of lane per spawned car
export const HIT_STOP = 4; // s
const DODGE_R = 6; // m
const DODGE_UP = 4; // per s
const DODGE_DOWN = 1.5; // per s
const DODGE_STEP = 1.5; // m sideways at dodge = 1
const CROSS_MARGIN = 0.5; // s of ped phase a crossing must leave spare

const CAR_COLORS = ['#e8e8ea', '#1b1c20', '#9aa0a8', '#c0392b', '#2c5aa0', '#f2c230', '#3d6b4f'];
const PED_COLORS = ['#22252b', '#3a3f4a', '#d9d4c7', '#8a2f3c', '#2f4f7a', '#c78a3b', '#e6e1f0'];

/** mulberry32 */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Path {
  pts: Vec[];
  cum: number[];
  len: number;
}
function makePath(pts: Vec[]): Path {
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return { pts, cum, len: cum[cum.length - 1] };
}
/** writes the point at distance s into out, returns the segment heading */
function pointAt(p: Path, s: number, out: Vec): number {
  const { pts, cum } = p;
  let i = 0;
  while (i < cum.length - 2 && s > cum[i + 1]) i++;
  const a = pts[i];
  const b = pts[i + 1];
  const seg = cum[i + 1] - cum[i];
  const t = seg > 0 ? Math.max(0, Math.min(1, (s - cum[i]) / seg)) : 0;
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** cars: false runs pedestrians and signals only, with no moving cars */
export function createTraffic(g: CityGraph, seed: number, opts: { cars?: boolean } = {}): Traffic {
  const rng = makeRng(seed);
  const laneIdx = new Map(g.lanes.map((l, i) => [l.id, i]));
  const sigIdx = new Map(g.signals.map((s, i) => [s.id, i]));
  const find = (m: Map<string, number>, id: string, what: string): number => {
    const i = m.get(id);
    if (i === undefined) throw new Error(`traffic: unknown ${what} "${id}"`);
    return i;
  };
  const lanePaths = g.lanes.map((l) => {
    if (l.pts.length < 2) throw new Error(`traffic: lane "${l.id}" needs 2+ points`);
    return makePath(l.pts);
  });
  const laneNext = g.lanes.map((l) => l.next.map((id) => find(laneIdx, id, 'lane')));
  const laneSig = g.lanes.map((l) => (l.light ? find(sigIdx, l.light.id, 'signal') : -1));
  const walkPaths = g.walkways.map((w) => {
    if (w.pts.length < 2) throw new Error(`traffic: walkway "${w.id}" needs 2+ points`);
    return makePath(w.pts);
  });
  const walkSig = g.walkways.map((w) =>
    w.crossing ? find(sigIdx, w.crossing.signal, 'signal') : -1,
  );
  const kerb = g.walkways.map((w) => w.kerb ?? 0);
  const walkLoop = g.walkways.map((w) => {
    const a = w.pts[0];
    const b = w.pts[w.pts.length - 1];
    return Math.hypot(a.x - b.x, a.y - b.y) < 0.01;
  });
  const sigLen = g.signals.map((s) => {
    if (!s.cycle.length) throw new Error(`traffic: signal "${s.id}" has no phases`);
    return s.cycle.reduce((t, p) => t + p.dur, 0);
  });
  const phase = g.signals.map((s) => s.cycle[0]);
  const phaseLeft = new Float64Array(g.signals.length); // s left of the current phase

  const pickNext = (lane: number): number => {
    const n = laneNext[lane];
    return n.length ? n[Math.floor(rng() * n.length)] : -1;
  };

  /** spreads count items evenly (random start offset) over the concatenated paths */
  const spread = (paths: Path[], count: number, cb: (path: number, s: number) => void) => {
    const total = paths.reduce((t, p) => t + p.len, 0);
    if (!count || !total) return;
    const step = total / count;
    let at = rng() * step;
    let p = 0;
    let base = 0;
    for (let k = 0; k < count; k++, at += step) {
      while (at > base + paths[p].len && p < paths.length - 1) base += paths[p++].len;
      cb(p, at - base);
    }
  };

  // cars
  const nCars =
    opts.cars === false
      ? 0
      : Math.min(g.cars, Math.floor(lanePaths.reduce((t, p) => t + p.len, 0) / MIN_SPACING));
  const cars: TrafficCar[] = [];
  const cLane = new Int32Array(nCars);
  const cNext = new Int32Array(nCars);
  const cGo = new Int32Array(nCars).fill(-1); // lane whose light this car decided to run
  const cS = new Float64Array(nCars);
  const cStop = new Float64Array(nCars); // s left of hit stop
  const cAcc = new Float64Array(nCars);
  spread(lanePaths, nCars, (lane, s) => {
    const i = cars.length;
    const len = lanePaths[lane].len;
    // keep clear of lane ends so cars spawned on joined lanes cannot overlap
    cS[i] = Math.max(Math.min(3, len / 2), Math.min(s, Math.max(len - 3, len / 2)));
    cLane[i] = lane;
    cNext[i] = pickNext(lane);
    const car: TrafficCar = {
      id: i,
      pos: { x: 0, y: 0 },
      heading: 0,
      speed: 0,
      length: 4 + rng() * 0.8,
      width: 1.7 + rng() * 0.15,
      color: CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)],
      hazardsUntil: -Infinity,
      braking: false,
    };
    car.heading = pointAt(lanePaths[lane], cS[i], car.pos);
    cars.push(car);
  });

  // peds
  const peds: Ped[] = [];
  const pWalk = new Int32Array(g.peds);
  const pS = new Float64Array(g.peds);
  const pDir = new Float64Array(g.peds);
  const pSpeed = new Float64Array(g.peds);
  const pSide = new Float64Array(g.peds);
  const base: Vec = { x: 0, y: 0 };
  spread(walkPaths, g.peds, (w, s) => {
    const i = peds.length;
    pWalk[i] = w;
    pDir[i] = rng() < 0.5 ? 1 : -1;
    pSpeed[i] = 1.1 + rng() * 0.5;
    const cross = walkSig[w] >= 0;
    // crossers spawn waiting at a kerb, never mid-road
    pS[i] = cross ? (pDir[i] > 0 ? 0 : walkPaths[w].len) : s;
    const ped: Ped = {
      id: i,
      pos: { x: 0, y: 0 },
      heading: 0,
      walking: !cross,
      dodge: 0,
      color: PED_COLORS[Math.floor(rng() * PED_COLORS.length)],
    };
    ped.heading = pointAt(walkPaths[w], pS[i], ped.pos) + (pDir[i] < 0 ? Math.PI : 0);
    peds.push(ped);
  });

  const updateSignals = (t: number) => {
    for (let k = 0; k < g.signals.length; k++) {
      const len = sigLen[k];
      if (!(len > 0)) continue;
      const cyc = g.signals[k].cycle;
      let u = (((t + g.signals[k].offset) % len) + len) % len;
      let p = 0;
      while (p < cyc.length - 1 && u >= cyc[p].dur) u -= cyc[p++].dur;
      phase[k] = cyc[p];
      phaseLeft[k] = cyc[p].dur - u;
    }
  };

  // obstacle found by the leader search, reused to avoid allocations
  let gap = Infinity;
  let dv = 0;

  /** stop line on lane x, which starts `off` metres ahead of car i's lane start */
  const checkLight = (i: number, x: number, off: number, front: number, v: number) => {
    const k = laneSig[x];
    if (k < 0 || phase[k].car === 'green' || cGo[i] === x) return;
    const d = off + g.lanes[x].light!.stopAt - front;
    if (d < 0) return;
    if ((v * v) / (2 * Math.max(d, 0.01)) > STOP_DEC) {
      cGo[i] = x; // too close to stop: commit to going through
      return;
    }
    const e = d - STOP_MARGIN + S0;
    if (e < gap) {
      gap = e;
      dv = v;
    }
  };

  const accel = (i: number): number => {
    const c = cars[i];
    const L = cLane[i];
    const N = cNext[i];
    const len = lanePaths[L].len;
    const v = c.speed;
    const front = cS[i] + c.length / 2;
    gap = Infinity;
    dv = 0;
    for (let j = 0; j < cars.length; j++) {
      if (j === i) continue;
      let d: number;
      if (cLane[j] === L && (cS[j] > cS[i] || (cS[j] === cS[i] && j > i))) d = cS[j] - cS[i];
      else if (cLane[j] === N) d = len - cS[i] + cS[j];
      else continue;
      d -= (c.length + cars[j].length) / 2;
      if (d < gap) {
        gap = d;
        dv = v - cars[j].speed;
      }
    }
    checkLight(i, L, 0, front, v);
    if (N >= 0) checkLight(i, N, len, front, v);
    else if (len - front + S0 < gap) {
      gap = len - front + S0; // dead end: stop at the lane end
      dv = v;
    }
    const v0 = g.lanes[L].speed;
    const sStar = S0 + Math.max(0, v * HEADWAY + (v * dv) / (2 * Math.sqrt(ACC * DEC)));
    const free = v0 > 0 ? 1 - (v / v0) ** 4 : -1;
    const inter = gap === Infinity ? 0 : (sStar / Math.max(gap, 0.1)) ** 2;
    return Math.max(-MAX_DEC, ACC * (free - inter));
  };

  const api: Traffic = {
    cars,
    peds,
    time: 0,
    step(dt, player) {
      api.time += dt;
      updateSignals(api.time);

      // all accelerations from the same snapshot so car order does not matter
      for (let i = 0; i < cars.length; i++) cAcc[i] = accel(i);
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        if (cStop[i] > 0) {
          cStop[i] -= dt;
          c.speed = 0;
          c.braking = true;
          continue;
        }
        c.speed = Math.max(0, c.speed + cAcc[i] * dt);
        c.braking = cAcc[i] < -0.5 || c.speed < 0.3;
        cS[i] += c.speed * dt;
        let len = lanePaths[cLane[i]].len;
        while (cS[i] > len) {
          if (cNext[i] < 0) {
            cS[i] = len;
            break;
          }
          if (cGo[i] === cLane[i]) cGo[i] = -1;
          cS[i] -= len;
          cLane[i] = cNext[i];
          cNext[i] = pickNext(cLane[i]);
          len = lanePaths[cLane[i]].len;
        }
        c.heading = pointAt(lanePaths[cLane[i]], cS[i], c.pos);
      }

      const px = player.pos.x;
      const py = player.pos.y;
      const vx = player.vel.x;
      const vy = player.vel.y;
      for (let i = 0; i < peds.length; i++) {
        const p = peds[i];
        const w = pWalk[i];
        const path = walkPaths[w];
        const k = walkSig[w];
        // only start a crossing the ped phase still covers: once on the road, never turn back
        if (!p.walking && k >= 0 && phase[k].ped)
          p.walking = path.len / pSpeed[i] + CROSS_MARGIN <= phaseLeft[k];
        if (p.walking) {
          pS[i] += pDir[i] * pSpeed[i] * (1 - p.dodge) * dt;
          if (walkLoop[w]) pS[i] = ((pS[i] % path.len) + path.len) % path.len;
          else if (pS[i] >= path.len || pS[i] <= 0) {
            pS[i] = pS[i] <= 0 ? 0 : path.len;
            pDir[i] = -pDir[i];
            if (k >= 0) p.walking = false; // reached the kerb: wait for the next ped phase
          }
        }
        const h = pointAt(path, pS[i], base);
        p.heading = h + (pDir[i] < 0 ? Math.PI : 0);

        const dx = base.x - px;
        const dy = base.y - py;
        const d2 = dx * dx + dy * dy;
        const closing = d2 < DODGE_R * DODGE_R && vx * dx + vy * dy > 0.5 * Math.sqrt(d2);
        if (closing) {
          // the dodge offset is along the left-hand normal of the path heading h (pts order),
          // so the road side is fixed by the kerb hint whichever way the ped walks
          if (p.dodge === 0 && kerb[w]) pSide[i] = -kerb[w];
          else if (p.dodge === 0) {
            // step to whichever side of the player's path the ped is already on
            const v2 = vx * vx + vy * vy;
            const along = (dx * vx + dy * vy) / v2;
            const wx = dx - vx * along;
            const wy = dy - vy * along;
            pSide[i] = -Math.sin(h) * wx + Math.cos(h) * wy >= 0 ? 1 : -1;
          }
          p.dodge = Math.min(1, p.dodge + DODGE_UP * dt);
        } else p.dodge = Math.max(0, p.dodge - DODGE_DOWN * dt);
        const off = p.dodge * DODGE_STEP * pSide[i];
        p.pos.x = base.x - Math.sin(h) * off;
        p.pos.y = base.y + Math.cos(h) * off;
      }
    },
    hit(carId, now) {
      const i = cars.findIndex((c) => c.id === carId);
      if (i < 0) return;
      cStop[i] = HIT_STOP;
      cars[i].speed = 0;
      cars[i].hazardsUntil = now + HIT_STOP;
    },
    signalState(id) {
      return phase[find(sigIdx, id, 'signal')];
    },
  };
  updateSignals(0);
  return api;
}
