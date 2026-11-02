import type { InputState } from './types';

export function deadzone(v: number, dz: number): number {
  const a = Math.abs(v);
  if (a <= dz) return 0;
  return Math.sign(v) * Math.min(1, (a - dz) / (1 - dz));
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Raw (level) input from one source; edges are applied separately. */
export interface RawInput {
  steer: number;
  throttle: number;
  brake: number;
  handbrake: boolean;
  pause: boolean;
  restart: boolean;
  confirm: boolean;
}

export function mergeInput(a: RawInput, b: RawInput): RawInput {
  return {
    steer: clamp(Math.abs(a.steer) >= Math.abs(b.steer) ? a.steer : b.steer, -1, 1),
    throttle: Math.max(a.throttle, b.throttle),
    brake: Math.max(a.brake, b.brake),
    handbrake: a.handbrake || b.handbrake,
    pause: a.pause || b.pause,
    restart: a.restart || b.restart,
    confirm: a.confirm || b.confirm,
  };
}

/** Returns a function that is true only on the first call after `down` goes true. */
export function edgeTracker(): (down: boolean) => boolean {
  let prev = false;
  return (down) => {
    const fire = down && !prev;
    prev = down;
    return fire;
  };
}

/** Edge tracker that also reports presses latched since the last poll (catches taps between polls). */
export function latchedEdge(): { latch(): void; poll(down: boolean): boolean } {
  const edge = edgeTracker();
  let latched = false;
  return {
    latch() {
      latched = true;
    },
    poll(down) {
      const fire = edge(down) || latched; // always run edge() to keep its state current
      latched = false;
      return fire;
    },
  };
}

const any = (keys: Set<string>, ...codes: string[]) => codes.some((c) => keys.has(c));

export function keyboardInput(k: Set<string>): RawInput {
  return {
    steer: (any(k, 'KeyD', 'ArrowRight') ? 1 : 0) - (any(k, 'KeyA', 'ArrowLeft') ? 1 : 0),
    throttle: any(k, 'KeyW', 'ArrowUp') ? 1 : 0,
    brake: any(k, 'KeyS', 'ArrowDown') ? 1 : 0,
    handbrake: k.has('Space'),
    pause: k.has('Escape'),
    restart: k.has('KeyR'),
    confirm: any(k, 'Enter', 'NumpadEnter'),
  };
}

/** Move `current` toward `target`; `upRate` when growing in magnitude, else `downRate` (units/s). */
export function rampToward(
  current: number,
  target: number,
  upRate: number,
  downRate: number,
  dt: number,
): number {
  const rate = Math.abs(target) > Math.abs(current) ? upRate : downRate;
  const step = rate * dt;
  return Math.abs(target - current) <= step ? target : current + Math.sign(target - current) * step;
}

const MAX_DT = 0.1;

/** Smooths keyboard steer/throttle; brake and buttons pass through. */
export function keyboardSmoother(): (raw: RawInput, dt: number) => RawInput {
  let steer = 0;
  let throttle = 0;
  return (raw, dt) => {
    const d = clamp(dt, 0, MAX_DT);
    if (raw.steer * steer < 0) steer = 0; // reversing: snap through 0 for quick countersteer
    steer = rampToward(steer, raw.steer, 5, 8, d);
    throttle = rampToward(throttle, raw.throttle, 4, 8, d);
    return { ...raw, steer, throttle };
  };
}

export function gamepadInput(p: Gamepad | null): RawInput {
  const b = (i: number) => p?.buttons[i];
  return {
    steer: p ? deadzone(p.axes[0] ?? 0, 0.15) : 0,
    throttle: b(7)?.value ?? 0,
    brake: b(6)?.value ?? 0,
    handbrake: b(0)?.pressed ?? false,
    pause: b(9)?.pressed ?? false,
    restart: b(8)?.pressed ?? false,
    confirm: (b(9)?.pressed ?? false) || (b(0)?.pressed ?? false),
  };
}

const MAPPED = new Set([
  'KeyA',
  'ArrowLeft',
  'KeyD',
  'ArrowRight',
  'KeyW',
  'ArrowUp',
  'KeyS',
  'ArrowDown',
  'Space',
  'Escape',
  'KeyR',
  'Enter',
  'NumpadEnter',
]);

export function createInput(
  win: Window,
  now: () => number = () => performance.now(),
): { poll(): InputState } {
  const smooth = keyboardSmoother();
  let last = now();
  const held = new Set<string>();
  const kbEdge = { pause: latchedEdge(), restart: latchedEdge(), confirm: latchedEdge() };
  const latchFor: Record<string, { latch(): void }> = {
    Escape: kbEdge.pause,
    KeyR: kbEdge.restart,
    Enter: kbEdge.confirm,
    NumpadEnter: kbEdge.confirm,
  };
  win.addEventListener('keydown', (e) => {
    if (!MAPPED.has(e.code)) return;
    e.preventDefault();
    held.add(e.code);
    if (!e.repeat) latchFor[e.code]?.latch();
  });
  win.addEventListener('keyup', (e) => held.delete(e.code));
  win.addEventListener('blur', () => held.clear());

  const padEdge = { pause: edgeTracker(), restart: edgeTracker(), confirm: edgeTracker() };

  return {
    poll() {
      const pads = win.navigator?.getGamepads?.() ?? [];
      const pad = Array.from(pads).find((p) => p && p.connected) ?? null;
      const t = now();
      const dt = (t - last) / 1000;
      last = t;
      const kbRaw = keyboardInput(held);
      const kb = smooth(kbRaw, dt);
      const gp = gamepadInput(pad);
      const m = mergeInput(kb, gp);
      return {
        ...m,
        pause: kbEdge.pause.poll(kbRaw.pause) || padEdge.pause(gp.pause),
        restart: kbEdge.restart.poll(kbRaw.restart) || padEdge.restart(gp.restart),
        confirm: kbEdge.confirm.poll(kbRaw.confirm) || padEdge.confirm(gp.confirm),
      };
    },
  };
}
