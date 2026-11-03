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
        { car: 'red', ped: true, dur: 6 },
      ]
    : [
        { car: 'red', ped: false, dur: 15 },
        { car: 'green', ped: false, dur: 12 },
        { car: 'amber', ped: false, dur: 3 },
        { car: 'red', ped: true, dur: 6 },
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

  it('steps 40 cars and 60 peds fast', () => {
    const t = createTraffic(fourWay(40, 60), 9);
    const t0 = performance.now();
    for (let n = 0; n < 120 * 10; n++) t.step(DT, IDLE);
    // 10 s of sim at 120 Hz well under 1 s of wall time
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
