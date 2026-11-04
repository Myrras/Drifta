// End-of-run score tally: pure timeline (no DOM, no audio).
export interface TallyInput {
  drifts: readonly number[]; // counted top-drift amounts in display order (0..3)
  rest: number; // sum of counted combos not in `drifts`
  restCount: number; // how many combos that is (0 = no lump row)
  combo: number; // combo points = sum(drifts) + rest
  mult: number; // time multiplier, >= 1
  total: number; // final total
  medals?: readonly number[]; // [3rd, 2nd, 1st] thresholds; undefined on maps without places
  position: 1 | 2 | 3 | null; // final awarded place (already includes time rules)
}
export type TallyEventKind = 'row' | 'land' | 'slam' | 'build' | 'place' | 'final';
export interface TallyEvent {
  t: number;
  kind: TallyEventKind;
  index: number;
}
export interface TallyPlan {
  rows: number;
  rowStart: number[];
  rowLand: number[];
  multStart: number;
  multEnd: number;
  buildStart: number;
  buildEnd: number;
  duration: number;
  events: TallyEvent[];
}
export interface TallyFrame {
  rowsShown: number;
  rowValue: number[];
  combo: number;
  mult: number;
  total: number;
  tier: -1 | 0 | 1 | 2;
  done: boolean;
}

/** tally -> summary slide duration (s) */
export const SLIDE = 0.75;

export function timeMult(time: number, par: number): number {
  return Math.round(Math.max(1, 1 + (par - time) / par) * 100) / 100;
}

const countDur = (i: number) => Math.max(0.15, 0.32 - 0.04 * i);
const easeIO = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
const easeIOInv = (v: number) => (v < 0.5 ? Math.cbrt(v / 4) : 1 - Math.cbrt(2 * (1 - v)) / 2);
const clamp01 = (u: number) => Math.min(1, Math.max(0, u));
const amounts = (i: TallyInput) => (i.restCount > 0 ? [...i.drifts, i.rest] : [...i.drifts]);

export function planTally(i: TallyInput): TallyPlan {
  const amts = amounts(i);
  const rowStart: number[] = [];
  const rowLand: number[] = [];
  const events: TallyEvent[] = [];
  const allowed = i.position && i.medals ? 3 - i.position : -1; // highest tier index allowed
  const fired = new Set<number>();
  let t = 0.35;
  let lastLand = t;
  let sum = 0;
  amts.forEach((a, r) => {
    const d = countDur(r);
    const land = t + d + 1.4 * d;
    rowStart.push(t);
    rowLand.push(land);
    events.push({ t, kind: 'row', index: r }, { t: land, kind: 'land', index: r });
    sum += a;
    for (let k = 0; k <= allowed; k++) {
      if (!fired.has(k) && sum >= i.medals![k]) {
        fired.add(k);
        events.push({ t: land, kind: 'place', index: k });
      }
    }
    lastLand = land;
    t = land + 0.04;
  });
  const multStart = lastLand + 0.3;
  const multEnd = multStart + Math.max(0.4, (i.mult - 1) * 2.6);
  const buildStart = multEnd + 0.5 + 0.35;
  const buildEnd = buildStart + (i.mult > 1 ? 2.2 : 0.5);
  events.push({ t: multEnd, kind: 'slam', index: 0 }, { t: buildStart, kind: 'build', index: 0 });
  for (let k = 0; k <= allowed; k++) {
    const m = i.medals![k];
    if (fired.has(k) || m > i.total || i.total <= i.combo) continue;
    const u = easeIOInv(clamp01((m - i.combo) / (i.total - i.combo)));
    events.push({ t: buildStart + u * (buildEnd - buildStart), kind: 'place', index: k });
  }
  events.push({ t: buildEnd, kind: 'final', index: 0 });
  events.sort((a, b) => a.t - b.t);
  return {
    rows: amts.length,
    rowStart,
    rowLand,
    multStart,
    multEnd,
    buildStart,
    buildEnd,
    duration: buildEnd + 0.6,
    events,
  };
}

export function tallyAt(i: TallyInput, p: TallyPlan, t: number): TallyFrame {
  const amts = amounts(i);
  let combo = 0;
  let rowsShown = 0;
  const rowValue = amts.map((a, r) => {
    if (t >= p.rowStart[r]) rowsShown = r + 1;
    if (t >= p.rowLand[r]) combo += a;
    return Math.round(a * clamp01((t - p.rowStart[r]) / countDur(r)));
  });
  const m = clamp01((t - p.multStart) / (p.multEnd - p.multStart));
  const mult = t >= p.multEnd ? i.mult : 1 + (i.mult - 1) * (1 - (1 - m) ** 3);
  let total = 0;
  if (t >= p.buildEnd) total = i.total;
  else if (t >= p.buildStart) {
    const u = easeIO((t - p.buildStart) / (p.buildEnd - p.buildStart));
    total = Math.round(i.combo + (i.total - i.combo) * u);
  }
  let tier: TallyFrame['tier'] = -1;
  for (const e of p.events) {
    if (e.t <= t && e.kind === 'place' && e.index > tier) tier = e.index as 0 | 1 | 2;
  }
  if (t >= p.buildEnd) combo = i.combo;
  return { rowsShown, rowValue, combo, mult, total, tier, done: t >= p.duration };
}

export function eventsBetween(p: TallyPlan, t0: number, t1: number): TallyEvent[] {
  return p.events.filter((e) => e.t > t0 && e.t <= t1);
}
