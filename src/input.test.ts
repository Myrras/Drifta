import { describe, expect, it } from 'vitest';
import {
  deadzone,
  edgeTracker,
  keyboardSmoother,
  latchedEdge,
  mergeInput,
  rampToward,
  type RawInput,
} from './input';

const base: RawInput = {
  steer: 0,
  throttle: 0,
  brake: 0,
  handbrake: false,
  pause: false,
  restart: false,
  confirm: false,
};

describe('deadzone', () => {
  it('zeroes inside', () => expect(deadzone(0.1, 0.15)).toBe(0));
  it('rescales edges', () => {
    expect(deadzone(1, 0.15)).toBe(1);
    expect(deadzone(0.575, 0.15)).toBeCloseTo(0.5);
  });
  it('keeps sign', () => expect(deadzone(-1, 0.15)).toBe(-1));
});

describe('mergeInput', () => {
  it('picks larger |steer| and maxes throttle', () => {
    const m = mergeInput(
      { ...base, steer: 0.3, throttle: 1 },
      { ...base, steer: -0.8, throttle: 0.4 },
    );
    expect(m.steer).toBe(-0.8);
    expect(m.throttle).toBe(1);
  });
});

describe('edgeTracker', () => {
  it('fires once per press', () => {
    const e = edgeTracker();
    expect([e(true), e(true), e(false), e(true)]).toEqual([true, false, false, true]);
  });
});

describe('latchedEdge', () => {
  it('tap between polls fires once', () => {
    const e = latchedEdge();
    e.latch();
    expect([e.poll(false), e.poll(false)]).toEqual([true, false]);
  });
  it('hold fires once', () => {
    const e = latchedEdge();
    expect([e.poll(true), e.poll(true), e.poll(false)]).toEqual([true, false, false]);
  });
  it('tap + hold does not double-fire', () => {
    const e = latchedEdge();
    e.latch();
    expect([e.poll(true), e.poll(true), e.poll(false)]).toEqual([true, false, false]);
  });
});

describe('keyboard smoothing', () => {
  const run = (
    sm: ReturnType<typeof keyboardSmoother>,
    raw: Partial<RawInput>,
    dt: number,
    n: number,
  ) => {
    let o = base;
    for (let i = 0; i < n; i++) o = sm({ ...base, ...raw }, dt);
    return o;
  };
  it('rampToward does not overshoot', () => expect(rampToward(0.9, 1, 5, 8, 1)).toBe(1));
  it('steer reaches 1 after 0.2s', () => {
    expect(run(keyboardSmoother(), { steer: 1 }, 0.05, 4).steer).toBeCloseTo(1);
  });
  it('steer returns to 0 after 0.125s', () => {
    const sm = keyboardSmoother();
    run(sm, { steer: 1 }, 0.05, 4);
    expect(run(sm, {}, 0.025, 5).steer).toBeCloseTo(0);
  });
  it('reversal snaps through 0', () => {
    const sm = keyboardSmoother();
    run(sm, { steer: 1 }, 0.05, 4);
    expect(run(sm, { steer: -1 }, 0.02, 1).steer).toBeCloseTo(-0.1);
  });
  it('throttle ramps 4/s up, brake instant', () => {
    const o = run(keyboardSmoother(), { throttle: 1, brake: 1 }, 0.05, 1);
    expect(o.throttle).toBeCloseTo(0.2);
    expect(o.brake).toBe(1);
  });
  it('clamps dt to 0.1s', () => {
    expect(run(keyboardSmoother(), { steer: 1 }, 5, 1).steer).toBeCloseTo(0.5);
  });
});
