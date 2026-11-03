import { describe, expect, it } from 'vitest';
import { createTraffic, type CityGraph, type Lane, type Signal } from './traffic';

const DT = 1 / 120;
const IDLE = { pos: { x: 1e4, y: 1e4 }, vel: { x: 0, y: 0 } };
const P = (x: number, y: number) => ({ x, y });

/** single loop: A runs east along y=0 with a stop line at x=190, B returns around */
function ring(cars: number, signal: Signal | null): CityGraph {
  const lanes: Lane[] = [
    {
      id: 'A',
      pts: [P(0, 0), P(200, 0)],
      speed: 14,
      next: ['B'],
      light: signal ? { id: signal.id, stopAt: 190 } : undefined,
    },
    { id: 'B', pts: [P(200, 0), P(200, 20), P(0, 20), P(0, 0)], speed: 14, next: ['A'] },
  ];
  return { lanes, signals: signal ? [signal] : [], walkways: [], cars, peds: 0 };
}

const phases = (green: string, len = 36): Signal['cycle'] =>
  green === 'ew'
    ? [
        { car: 'green', ped: false, dur: 12 },
        { car: 'amber', ped: false, dur: 3 },
        { car: 'red', ped: false, dur: len - 21 },
        { car: 'red', ped: true, dur: 24 },
      ]
    : [
        { car: 'red', ped: false, dur: 15 },
        { car: 'green', ped: false, dur: 12 },
        { car: 'amber', ped: false, dur: 3 },
        { car: 'red', ped: true, dur: 24 },
      ];

/** 4-way: an east ring and a south ring cross at the origin, east can turn right; scramble crossing */
function fourWay(cars: number, peds: number): CityGraph {
  return {
    lanes: [
      {
        id: 'e_in',
        pts: [P(-150, 2), P(-12, 2)],
        speed: 14,
        next: ['e_x', 'es'],
        light: { id: 'ew', stopAt: 136 },
      },
      { id: 'e_x', pts: [P(-12, 2), P(12, 2)], speed: 12, next: ['e_out'] },
      { id: 'es', pts: [P(-12, 2), P(-6, 4), P(-2, 12)], speed: 7, next: ['s_out'] },
      {
        id: 'e_out',
        pts: [P(12, 2), P(150, 2), P(150, 150), P(-150, 150), P(-150, 2)],
        speed: 14,
        next: ['e_in'],
      },
      {
        id: 's_in',
        pts: [P(-2, -150), P(-2, -12)],
        speed: 14,
        next: ['s_x'],
        light: { id: 'ns', stopAt: 136 },
      },
      { id: 's_x', pts: [P(-2, -12), P(-2, 12)], speed: 12, next: ['s_out'] },
      {
        id: 's_out',
        pts: [P(-2, 12), P(-2, 160), P(-160, 160), P(-160, -150), P(-2, -150)],
        speed: 14,
        next: ['s_in'],
      },
    ],
    signals: [
      { id: 'ew', cycle: phases('ew'), offset: 0 },
      { id: 'ns', cycle: phases('ns'), offset: 0 },
    ],
    walkways: [
      { id: 'scramble', pts: [P(-10, -10), P(10, 10)], crossing: { signal: 'ew' } },
      { id: 'kerb', pts: [P(-150, 6), P(-12, 6)] },
      { id: 'block', pts: [P(20, 20), P(140, 20), P(140, 140), P(20, 140), P(20, 20)] },
    ],
    cars,
    peds,
  };
}

describe('traffic', () => {
  it('cars stop for red and go on green', () => {
    const t = createTraffic(
      ring(1, {
        id: 'L',
        offset: 0,
        cycle: [
          { car: 'red', ped: false, dur: 40 },
          { car: 'green', ped: false, dur: 40 },
        ],
      }),
      1,
    );
    const c = t.cars[0];
    while (t.time < 39) t.step(DT, IDLE);
    expect(t.signalState('L').car).toBe('red');
    expect(c.speed).toBeLessThan(0.05);
    expect(c.pos.y).toBeCloseTo(0);
    const front = c.pos.x + c.length / 2;
    expect(front).toBeLessThanOrEqual(190);
    expect(front).toBeGreaterThan(188);
    while (t.time < 50) t.step(DT, IDLE);
    expect(t.signalState('L').car).toBe('green');
    expect(c.speed).toBeGreaterThan(5);
    expect(c.pos.x > 200 || c.pos.y > 0).toBe(true);
  });

  it('runs an amber it is too close to stop for', () => {
    const g = ring(1, { id: 'L', offset: 0, cycle: [{ car: 'green', ped: false, dur: 1e9 }] });
    const t = createTraffic(g, 1);
    const c = t.cars[0];
    // cruise on a permanent green, then flip it to amber right before the line
    while (t.time < 60 && !(c.pos.y === 0 && c.pos.x > 180 && c.speed > 12)) t.step(DT, IDLE);
    expect(c.speed).toBeGreaterThan(12);
    g.signals[0].cycle[0].car = 'amber';
    const x0 = c.pos.x;
    for (let k = 0; k < 120; k++) t.step(DT, IDLE);
    expect(c.pos.x > x0 + 5 || c.pos.y > 0).toBe(true);
  });

  it('no two cars on the same lane overlap', () => {
    const t = createTraffic(fourWay(40, 0), 7);
    expect(t.cars.length).toBe(40);
    let moving = 0;
    for (let n = 0; n < 120 * 120; n++) {
      t.step(DT, IDLE);
      if (n % 12) continue;
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
    expect(moving).toBeGreaterThan(0);
  });

  it('a hit car stops with hazards, the car behind queues, then it resumes', () => {
    const t = createTraffic(ring(12, null), 3);
    while (t.time < 20) t.step(DT, IDLE);
    const c = t.cars[0];
    expect(c.speed).toBeGreaterThan(5);
    const now = t.time;
    t.hit(0, now);
    expect(c.hazardsUntil).toBeCloseTo(now + 4);
    const x = c.pos.x;
    const y = c.pos.y;
    while (t.time < now + 3.9) t.step(DT, IDLE);
    expect(c.speed).toBe(0);
    expect(c.pos.x).toBe(x);
    expect(c.pos.y).toBe(y);
    const queued = t.cars.some(
      (o) => o !== c && o.speed < 4 && Math.hypot(o.pos.x - x, o.pos.y - y) < 12,
    );
    expect(queued).toBe(true);
    while (t.time < now + 8) t.step(DT, IDLE);
    expect(c.speed).toBeGreaterThan(2);
  });

  it('peds wait for the ped phase before crossing', () => {
    const g = fourWay(0, 30);
    const t = createTraffic(g, 5);
    // peds on the scramble crossing: the first walkway in the spread
    const onCrossing = (p: { pos: { x: number; y: number } }) =>
      Math.abs(p.pos.x - p.pos.y) < 0.01 && Math.abs(p.pos.x) <= 10.01;
    const crossers = t.peds.filter(onCrossing);
    expect(crossers.length).toBeGreaterThan(0);
    let crossed = 0;
    const was = crossers.map((p) => ({ walking: p.walking, x: p.pos.x }));
    for (let n = 0; n < 120 * 80; n++) {
      t.step(DT, IDLE);
      const ped = t.signalState('ew').ped;
      crossers.forEach((p, k) => {
        if (!was[k].walking && p.walking) {
          expect(ped).toBe(true);
          crossed++;
        }
        if (!was[k].walking && !p.walking) expect(p.pos.x).toBe(was[k].x);
        was[k] = { walking: p.walking, x: p.pos.x };
      });
    }
    expect(crossed).toBeGreaterThan(0);
  });

  it('dodge rises when the player approaches and the ped steps aside', () => {
    const g: CityGraph = {
      lanes: [],
      signals: [],
      walkways: [{ id: 'w', pts: [P(0, 0), P(100, 0)] }],
      cars: 0,
      peds: 1,
    };
    const t = createTraffic(g, 2);
    const p = t.peds[0];
    t.step(DT, IDLE);
    expect(p.dodge).toBe(0);
    // player comes up from +y toward the ped at 10 m/s, slightly off to the -x side
    const player = { pos: { x: p.pos.x - 0.5, y: 10 }, vel: { x: 0, y: -10 } };
    let max = 0;
    for (let n = 0; n < 90; n++) {
      t.step(DT, player);
      player.pos.y += player.vel.y * DT;
      max = Math.max(max, p.dodge);
    }
    expect(max).toBeGreaterThan(0.5);
    expect(Math.abs(p.pos.y)).toBeGreaterThan(0.5);
    // far away again: dodge decays
    for (let n = 0; n < 240; n++) t.step(DT, IDLE);
    expect(p.dodge).toBe(0);
  });

  it('with a kerb hint the ped dodges away from the road, either way it walks', () => {
    // road on the left of the pts order: north (-y) of a walkway running east
    const g = (kerb?: -1 | 1): CityGraph => ({
      lanes: [],
      signals: [],
      walkways: [{ id: 'w', pts: [P(0, 0), P(100, 0)], kerb }],
      cars: 0,
      peds: 1,
    });
    const dodgeY = (kerb: -1 | 1 | undefined, seed: number) => {
      const t = createTraffic(g(kerb), seed);
      const p = t.peds[0];
      t.step(DT, IDLE);
      // player comes along the sidewalk side (+y), so its path alone says "step toward the road"
      const player = { pos: { x: p.pos.x - 5, y: 0.8 }, vel: { x: 10, y: 0 } };
      let y = 0;
      for (let n = 0; n < 40; n++) {
        t.step(DT, player);
        player.pos.x += player.vel.x * DT;
        if (Math.abs(p.pos.y) > Math.abs(y)) y = p.pos.y;
      }
      return { y, east: Math.cos(p.heading) > 0 };
    };
    const dirs = new Set<boolean>();
    for (let seed = 1; seed <= 8; seed++) {
      const { y, east } = dodgeY(-1, seed);
      dirs.add(east);
      expect(y).toBeGreaterThan(0.5);
      expect(dodgeY(undefined, seed).y).toBeLessThan(-0.5);
    }
    expect(dirs.size).toBe(2);
  });

  it('peds only start a crossing the ped phase covers and never turn back mid-road', () => {
    const graph = (ped: number): CityGraph => ({
      lanes: [],
      signals: [
        {
          id: 'L',
          offset: 0,
          cycle: [
            { car: 'green', ped: false, dur: 20 },
            { car: 'red', ped: true, dur: ped },
          ],
        },
      ],
      walkways: [{ id: 'x', pts: [P(0, 0), P(20, 0)], crossing: { signal: 'L' } }],
      cars: 0,
      peds: 12,
    });
    // 20 m at 1.1..1.6 m/s takes 12.5..18 s: a 10 s phase is never enough
    const short = createTraffic(graph(10), 4);
    for (let n = 0; n < 120 * 90; n++) {
      short.step(DT, IDLE);
      for (const p of short.peds) expect(p.walking).toBe(false);
    }
    const t = createTraffic(graph(30), 4);
    const dir = t.peds.map(() => 0);
    const prev = t.peds.map((p) => p.pos.x);
    let crossed = 0;
    for (let n = 0; n < 120 * 150; n++) {
      t.step(DT, IDLE);
      t.peds.forEach((p, k) => {
        const mid = p.pos.x > 0.01 && p.pos.x < 19.99;
        if (mid) expect(t.signalState('L').ped).toBe(true);
        const d = Math.sign(p.pos.x - prev[k]);
        if (!mid) dir[k] = 0;
        else if (!dir[k]) dir[k] = d;
        else if (d) expect(d).toBe(dir[k]);
        if (!mid && prev[k] > 0.01 && prev[k] < 19.99) crossed++;
        prev[k] = p.pos.x;
      });
    }
    expect(crossed).toBeGreaterThan(6);
  });

  it('same seed gives the same state', () => {
    const run = (seed: number) => {
      const t = createTraffic(fourWay(30, 40), seed);
      const player = { pos: { x: -60, y: 2 }, vel: { x: 12, y: 0 } };
      for (let n = 0; n < 120 * 30; n++) {
        if (n === 600) t.hit(3, t.time);
        player.pos.x += player.vel.x * DT;
        t.step(DT, player);
      }
      return JSON.stringify({ cars: t.cars, peds: t.peds, time: t.time });
    };
    expect(run(42)).toBe(run(42));
    expect(run(42)).not.toBe(run(43));
  });

  it('cars: false keeps peds and signals but never has moving cars', () => {
    const run = () => {
      const t = createTraffic(fourWay(30, 40), 11, { cars: false });
      const peds0 = JSON.stringify(t.peds);
      const player = { pos: { x: -60, y: 2 }, vel: { x: 12, y: 0 } };
      let walked = 0;
      for (let n = 0; n < 120 * 30; n++) {
        player.pos.x += player.vel.x * DT;
        t.step(DT, player);
        t.hit(0, t.time);
        expect(t.cars).toHaveLength(0);
        if (n % 120 === 0) walked += t.peds.filter((p) => p.walking).length;
      }
      expect(t.peds).toHaveLength(40);
      expect(JSON.stringify(t.peds)).not.toBe(peds0);
      expect(walked).toBeGreaterThan(0);
      expect(['green', 'amber', 'red']).toContain(t.signalState(fourWay(30, 40).signals[0].id).car);
      return JSON.stringify(t.peds);
    };
    expect(run()).toBe(run());
  });

  it('steps 40 cars and 60 peds fast', () => {
    const t = createTraffic(fourWay(40, 60), 9);
    const t0 = performance.now();
    for (let n = 0; n < 120 * 10; n++) t.step(DT, IDLE);
    // 10 s of sim at 120 Hz well under 1 s of wall time
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
