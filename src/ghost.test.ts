import { describe, expect, it } from 'vitest';
import { createRecorder, deserialize, GHOST_MAX_BYTES, sample, serialize, type Ghost } from './ghost';

const ghost = (n: number): Ghost => ({
  car: 'mx5',
  frames: Array.from({ length: n }, (_, i) => ({
    t: i / 20,
    x: Math.sin(i / 7) * 300 + i * 0.37,
    y: Math.cos(i / 5) * 200,
    angle: (i * 0.3) % (2 * Math.PI),
    floor: i % 100 < 50 ? 0 : 1,
  })),
});

describe('ghost', () => {
  it('roundtrips within quantization', () => {
    const g = ghost(200);
    const r = deserialize(serialize(g))!;
    expect(r.car).toBe('mx5');
    expect(r.frames).toHaveLength(200);
    r.frames.forEach((f, i) => {
      const o = g.frames[i];
      expect(f.t).toBeCloseTo(o.t, 1);
      expect(f.x).toBeCloseTo(o.x, 1);
      expect(f.y).toBeCloseTo(o.y, 1);
      expect(Math.cos(f.angle)).toBeCloseTo(Math.cos(o.angle), 2);
      expect(f.floor).toBe(o.floor);
    });
  });
  it('rejects garbage', () => {
    expect(deserialize('nope')).toBeNull();
    expect(deserialize(null)).toBeNull();
    expect(deserialize('{"car":"mx5","d":[1,2]}')).toBeNull();
  });
  it('interpolates and ends', () => {
    const g: Ghost = {
      car: 'mx5',
      frames: [
        { t: 0, x: 0, y: 0, angle: 0, floor: 0 },
        { t: 1, x: 10, y: -4, angle: 1, floor: 0 },
      ],
    };
    expect(sample(g, 0.5)).toMatchObject({ x: 5, y: -2, angle: 0.5 });
    expect(sample(g, 1.01)).toBeNull();
  });
  it('wraps angle the short way', () => {
    const g: Ghost = {
      car: 'mx5',
      frames: [
        { t: 0, x: 0, y: 0, angle: 3.0, floor: 0 },
        { t: 1, x: 0, y: 0, angle: -3.0, floor: 0 },
      ],
    };
    const a = sample(g, 0.5)!.angle;
    expect(Math.abs(Math.cos(a) + 1)).toBeLessThan(1e-6);
  });
  it('caps size', () => {
    const s = serialize(ghost(40000));
    expect(s.length).toBeLessThanOrEqual(GHOST_MAX_BYTES);
    expect(deserialize(s)!.frames.length).toBeGreaterThan(1000);
  });
  it('recorder samples at ~20 Hz', () => {
    const r = createRecorder();
    for (let i = 0; i < 120; i++) r.add(i / 60, 0, 0, 0, 0);
    expect(r.frames.length).toBe(40);
  });
});
