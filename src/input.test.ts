import { describe, expect, it } from 'vitest';
import {
  createInput,
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

describe('createInput left/right edges', () => {
  it('a tap between polls fires once', () => {
    const w = new EventTarget() as unknown as Window;
    const input = createInput(w);
    const key = (type: string) =>
      w.dispatchEvent(Object.assign(new Event(type), { code: 'ArrowLeft', repeat: false }));
    key('keydown');
    key('keyup');
    expect([input.poll().left, input.poll().left]).toEqual([true, false]);
  });
  it('up/down taps fire once', () => {
    const w = new EventTarget() as unknown as Window;
    const input = createInput(w);
    for (const code of ['KeyW', 'ArrowDown']) {
      w.dispatchEvent(Object.assign(new Event('keydown'), { code, repeat: false }));
      w.dispatchEvent(Object.assign(new Event('keyup'), { code }));
    }
    const a = input.poll();
    expect([a.up, a.down, input.poll().up]).toEqual([true, true, false]);
  });
});

describe('createInput pad edge tracking', () => {
  type Pad = { connected: boolean; buttons: { pressed: boolean; value: number }[]; axes: number[] };
  const setup = () => {
    const w = new EventTarget() as unknown as Window;
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
    const state: { pad: Pad | null } = { pad: null };
    (w as unknown as { navigator: unknown }).navigator = { getGamepads: () => [state.pad] };
    return { w, buttons, state, input: createInput(w) };
  };
  it('keyboard and pad edge in the same poll: pad tracker still updates', () => {
    const { w, buttons, state, input } = setup();
    // Escape tapped and pad Start pressed in the same poll
    w.dispatchEvent(Object.assign(new Event('keydown'), { code: 'Escape', repeat: false }));
    w.dispatchEvent(Object.assign(new Event('keyup'), { code: 'Escape' }));
    buttons[9].pressed = true;
    state.pad = { connected: true, buttons, axes: [0, 0] };
    expect(input.poll().pause).toBe(true);
    // pad still held, no new press: no phantom edge
    expect(input.poll().pause).toBe(false);
  });
  it('pad B (button 1) fires pause once', () => {
    const { buttons, state, input } = setup();
    buttons[1].pressed = true;
    state.pad = { connected: true, buttons, axes: [0, 0] };
    expect([input.poll().pause, input.poll().pause]).toEqual([true, false]);
  });
});
