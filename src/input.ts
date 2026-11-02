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

export function createInput(win: Window): { poll(): InputState } {
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
      const kb = keyboardInput(held);
      const gp = gamepadInput(pad);
      const m = mergeInput(kb, gp);
      return {
        ...m,
        pause: kbEdge.pause.poll(kb.pause) || padEdge.pause(gp.pause),
        restart: kbEdge.restart.poll(kb.restart) || padEdge.restart(gp.restart),
        confirm: kbEdge.confirm.poll(kb.confirm) || padEdge.confirm(gp.confirm),
      };
    },
  };
}
