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
  clutch: false,
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

  it('S fires save and down; ArrowDown fires only down', () => {
    const w = new EventTarget() as unknown as Window;
    const input = createInput(w);
    const tap = (code: string) => {
      w.dispatchEvent(Object.assign(new Event('keydown'), { code, repeat: false }));
      w.dispatchEvent(Object.assign(new Event('keyup'), { code }));
      return input.poll();
    };
    const s = tap('KeyS');
    expect([s.save, s.down]).toEqual([true, true]);
    const d = tap('ArrowDown');
    expect([d.save, d.down]).toEqual([false, true]);
  });
});

describe('createInput pad edge tracking', () => {
  type Pad = {
    id?: string;
    connected: boolean;
    buttons: { pressed: boolean; value: number }[];
    axes: number[];
  };
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
  it('switches kb <-> pad and is sticky', () => {
    const { w, buttons, state, input } = setup();
    state.pad = { connected: true, buttons, axes: [0, 0] };
    expect(input.poll().device).toBe('kb');
    buttons[0].pressed = true;
    expect(input.poll().device).toBe('pad');
    buttons[0].pressed = false;
    expect(input.poll().device).toBe('pad');
    buttons[7].value = 0.5;
    expect(input.poll().device).toBe('pad');
    buttons[7].value = 0;
    w.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyQ', repeat: false }));
    expect(input.poll().device).toBe('kb');
  });
  it('mouse move and click do not change the device', () => {
    const { w, buttons, state, input } = setup();
    state.pad = { connected: true, buttons, axes: [0, 0] };
    buttons[0].pressed = true;
    expect(input.poll().device).toBe('pad');
    buttons[0].pressed = false;
    w.dispatchEvent(new Event('mousemove'));
    expect(input.poll().device).toBe('pad');
    w.dispatchEvent(new Event('mousedown'));
    expect(input.poll().device).toBe('pad');
  });
  it('deadzone noise stays kb; stick past it flips to pad', () => {
    const { buttons, state, input } = setup();
    state.pad = { connected: true, buttons, axes: [0.1, -0.14] };
    expect(input.poll().device).toBe('kb');
    state.pad.axes = [0.2, 0];
    expect(input.poll().device).toBe('kb');
    state.pad.axes = [0.6, 0];
    expect(input.poll().device).toBe('pad');
  });
  it('detects padStyle', () => {
    const style = (id: string) => {
      const { buttons, state, input } = setup();
      state.pad = { id, connected: true, buttons, axes: [0, 0] } as Pad;
      return input.poll().padStyle;
    };
    expect(style('Xbox 360 Controller (STANDARD GAMEPAD)')).toBe('xbox');
    expect(style('Wireless Controller (STANDARD GAMEPAD Vendor: 054c)')).toBe('ps');
    expect(style('DualSense')).toBe('ps');
    expect(style('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)')).toBe(
      'xbox',
    );
  });
  it('uses the last pad with input, not just the first connected one', () => {
    const w = new EventTarget() as unknown as Window;
    const mk = (index: number, id: string) => ({
      index,
      id,
      connected: true,
      buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })),
      axes: [0, 0],
    });
    const idle = mk(0, 'Xbox 360 Controller (XInput STANDARD GAMEPAD)');
    const ds = mk(1, 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c)');
    (w as unknown as { navigator: unknown }).navigator = { getGamepads: () => [idle, ds] };
    const input = createInput(w);
    ds.buttons[9].pressed = true;
    expect(input.poll()).toMatchObject({ pause: true, device: 'pad', padStyle: 'ps' });
    ds.buttons[9].pressed = false;
    expect(input.poll().padStyle).toBe('ps'); // both idle: stays on the DualSense
    ds.buttons[7].value = 1;
    expect(input.poll()).toMatchObject({ throttle: 1, padStyle: 'ps' });
    ds.buttons[7].value = 0;
    idle.buttons[0].pressed = true;
    expect(input.poll()).toMatchObject({ handbrake: true, padStyle: 'xbox' });
  });
  it('skip is edge-triggered for N and RB', () => {
    const { w, buttons, state, input } = setup();
    w.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyN', repeat: false }));
    w.dispatchEvent(Object.assign(new Event('keyup'), { code: 'KeyN' }));
    expect([input.poll().skip, input.poll().skip]).toEqual([true, false]);
    buttons[5].pressed = true;
    state.pad = { connected: true, buttons, axes: [0, 0] };
    expect([input.poll().skip, input.poll().skip]).toEqual([true, false]);
  });
  it('tab edges fire once for Q/E and LB/RB', () => {
    const { w, buttons, state, input } = setup();
    const tabs = () => {
      const p = input.poll();
      return [p.tabPrev, p.tabNext];
    };
    w.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyQ', repeat: false }));
    w.dispatchEvent(Object.assign(new Event('keyup'), { code: 'KeyQ' }));
    expect([tabs(), tabs()]).toEqual([
      [true, false],
      [false, false],
    ]);
    w.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyE', repeat: false }));
    expect([tabs(), tabs()]).toEqual([
      [false, true],
      [false, false],
    ]);
    state.pad = { connected: true, buttons, axes: [0, 0] };
    buttons[4].pressed = true;
    expect([tabs(), tabs()]).toEqual([
      [true, false],
      [false, false],
    ]);
    buttons[4].pressed = false;
    buttons[5].pressed = true;
    expect([tabs(), tabs()]).toEqual([
      [false, true],
      [false, false],
    ]);
  });
  it('mp edge fires once for M and pad Y (button 3)', () => {
    const { w, buttons, state, input } = setup();
    w.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyM', repeat: false }));
    w.dispatchEvent(Object.assign(new Event('keyup'), { code: 'KeyM' }));
    expect([input.poll().mp, input.poll().mp]).toEqual([true, false]);
    buttons[3].pressed = true;
    state.pad = { connected: true, buttons, axes: [0, 0] };
    expect([input.poll().mp, input.poll().mp]).toEqual([true, false]);
  });
  it('pad B (button 1) fires pause once', () => {
    const { buttons, state, input } = setup();
    buttons[1].pressed = true;
    state.pad = { connected: true, buttons, axes: [0, 0] };
    expect([input.poll().pause, input.poll().pause]).toEqual([true, false]);
  });

  describe('Konami cheat', () => {
    const BTN = { up: 12, down: 13, left: 14, right: 15, a: 0, b: 1 } as const;
    const CODE = ['up', 'up', 'down', 'down', 'left', 'right', 'left', 'right', 'a'] as const;
    const padRig = () => {
      const r = setup();
      r.state.pad = { connected: true, buttons: r.buttons, axes: [0, 0] };
      /** press and release one pad button; returns the cheat flag of the press poll */
      const press = (k: keyof typeof BTN) => {
        r.buttons[BTN[k]].pressed = true;
        const fired = !!r.input.poll().cheat;
        r.buttons[BTN[k]].pressed = false;
        r.input.poll();
        return fired;
      };
      return { ...r, press };
    };

    it('fires once on the full pad sequence, with confirm on the final A', () => {
      const { press, buttons, input } = padRig();
      expect(CODE.slice(0, -1).map(press)).not.toContain(true);
      buttons[0].pressed = true;
      const last = input.poll();
      expect([last.cheat, last.confirm]).toEqual([true, true]);
    });

    it('accepts stick edges for the directions', () => {
      const { press, state, input } = padRig();
      const stick = (x: number, y: number) => {
        state.pad!.axes = [x, y];
        const fired = !!input.poll().cheat;
        state.pad!.axes = [0, 0];
        input.poll();
        return fired;
      };
      const dirs: [number, number][] = [
        [0, -1],
        [0, -1],
        [0, 1],
        [0, 1],
        [-1, 0],
        [1, 0],
        [-1, 0],
        [1, 0],
      ];
      expect(dirs.map(([x, y]) => stick(x, y))).not.toContain(true);
      expect(press('a')).toBe(true);
    });

    it('a wrong press resets the sequence', () => {
      const { press } = padRig();
      for (const k of CODE.slice(0, 5)) press(k);
      press('b');
      expect(CODE.slice(5).map(press)).not.toContain(true);
      expect(CODE.map(press).at(-1)).toBe(true);
      // an extra up at the start still counts
      expect((['up', ...CODE] as const).map(press).at(-1)).toBe(true);
    });

    it('the keyboard never triggers it', () => {
      const { w, input } = setup();
      const keys = [
        'ArrowUp',
        'ArrowUp',
        'ArrowDown',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'ArrowLeft',
        'ArrowRight',
        'Enter',
      ];
      const fired = keys.map((code) => {
        w.dispatchEvent(Object.assign(new Event('keydown'), { code, repeat: false }));
        w.dispatchEvent(Object.assign(new Event('keyup'), { code }));
        return input.poll().cheat;
      });
      expect(fired).not.toContain(true);
    });
  });
});
