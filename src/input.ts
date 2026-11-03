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
  clutch: boolean;
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
    clutch: a.clutch || b.clutch,
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

/** OR two edge results; both are evaluated before the call so each tracker always updates. */
const pick = (a: boolean, b: boolean) => a || b;

const any = (keys: Set<string>, ...codes: string[]) => codes.some((c) => keys.has(c));

export function keyboardInput(k: Set<string>): RawInput {
  return {
    steer: (any(k, 'KeyD', 'ArrowRight') ? 1 : 0) - (any(k, 'KeyA', 'ArrowLeft') ? 1 : 0),
    throttle: any(k, 'KeyW', 'ArrowUp') ? 1 : 0,
    brake: any(k, 'KeyS', 'ArrowDown') ? 1 : 0,
    handbrake: k.has('Space'),
    clutch: any(k, 'ShiftLeft', 'ShiftRight'),
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
    clutch: b(4)?.pressed ?? false, // LB
    pause: (b(9)?.pressed ?? false) || (b(1)?.pressed ?? false),
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
  'ShiftLeft',
  'ShiftRight',
  'Escape',
  'KeyR',
  'KeyT',
  'KeyN',
  'KeyQ',
  'KeyE',
  'KeyP',
  'KeyZ',
  'KeyX',
  'KeyM',
  'Enter',
  'NumpadEnter',
]);

export const KONAMI = ['up', 'up', 'down', 'down', 'left', 'right', 'left', 'right', 'a'];

/** Konami matcher fed with pad presses; true when the sequence completes. A wrong press resets. */
export function konami(): (press: string) => boolean {
  let i = 0;
  return (p) => {
    if (p === KONAMI[i]) i++;
    else i = p === 'up' ? (i === 2 ? 2 : 1) : 0; // a stray 'up' may still start (or keep) the run
    if (i < KONAMI.length) return false;
    i = 0;
    return true;
  };
}

export type InputDevice = 'kb' | 'pad';
export type PadStyle = 'ps' | 'xbox';
/** InputState with the last-used device always set. */
export type PolledInput = InputState & { device: InputDevice; padStyle: PadStyle; skip: boolean };

export const padStyleOf = (id: string): PadStyle =>
  /xbox|045e/i.test(id) ? 'xbox' : /054c|dualshock|dualsense|playstation/i.test(id) ? 'ps' : 'xbox';

const busy = (p: Gamepad) =>
  Array.from(p.buttons).some((x) => x.pressed || x.value > 0.15) ||
  Array.from(p.axes).some((a) => Math.abs(a) > 0.5); // drift must not steal the device

export function createInput(
  win: Window,
  now: () => number = () => performance.now(),
): { poll(): PolledInput } {
  let device: InputDevice = 'kb';
  let padStyle: PadStyle = 'xbox';
  const smooth = keyboardSmoother();
  let last = now();
  const held = new Set<string>();
  const kbEdge = {
    pause: latchedEdge(),
    restart: latchedEdge(),
    confirm: latchedEdge(),
    left: latchedEdge(),
    right: latchedEdge(),
    up: latchedEdge(),
    down: latchedEdge(),
    tune: latchedEdge(),
    save: latchedEdge(),
    skip: latchedEdge(),
    tabPrev: latchedEdge(),
    tabNext: latchedEdge(),
    photo: latchedEdge(),
    mp: latchedEdge(),
  };
  const latchFor: Record<string, { latch(): void }> = {
    Escape: kbEdge.pause,
    KeyR: kbEdge.restart,
    Enter: kbEdge.confirm,
    NumpadEnter: kbEdge.confirm,
    KeyA: kbEdge.left,
    ArrowLeft: kbEdge.left,
    KeyD: kbEdge.right,
    ArrowRight: kbEdge.right,
    KeyW: kbEdge.up,
    ArrowUp: kbEdge.up,
    KeyT: kbEdge.tune,
    KeyN: kbEdge.skip,
    KeyQ: kbEdge.tabPrev,
    KeyE: kbEdge.tabNext,
    KeyP: kbEdge.photo,
    KeyM: kbEdge.mp,
    KeyS: kbEdge.down,
    ArrowDown: kbEdge.down,
  };
  win.addEventListener('keydown', (e) => {
    device = 'kb';
    if (!MAPPED.has(e.code)) return;
    e.preventDefault();
    held.add(e.code);
    if (!e.repeat) latchFor[e.code]?.latch();
    if (!e.repeat && e.code === 'KeyS') kbEdge.save.latch(); // S is also menu down
  });
  win.addEventListener('keyup', (e) => held.delete(e.code));
  win.addEventListener('blur', () => held.clear());

  const padEdge = {
    pause: edgeTracker(),
    restart: edgeTracker(),
    confirm: edgeTracker(),
    left: edgeTracker(),
    right: edgeTracker(),
    up: edgeTracker(),
    down: edgeTracker(),
    tune: edgeTracker(),
    save: edgeTracker(),
    skip: edgeTracker(),
    tabPrev: edgeTracker(),
    tabNext: edgeTracker(),
    photo: edgeTracker(),
    mp: edgeTracker(),
  };
  const cheat = konami();
  let prevButtons: boolean[] = [];
  let padIndex = -1;

  return {
    poll() {
      // the last pad with input wins, so an idle pad (or dongle) in slot 0 cannot hide another
      const pads = Array.from(win.navigator?.getGamepads?.() ?? []).filter(
        (p): p is Gamepad => !!p && p.connected,
      );
      const pad = pads.find(busy) ?? pads.find((p) => p.index === padIndex) ?? pads[0] ?? null;
      if (pad) padIndex = pad.index;
      const t = now();
      const dt = (t - last) / 1000;
      last = t;
      const kbRaw = keyboardInput(held);
      const kb = smooth(kbRaw, dt);
      const gp = gamepadInput(pad);
      if (pad) {
        padStyle = padStyleOf(pad.id ?? '');
        if (busy(pad)) device = 'pad';
      }
      const m = mergeInput(kb, gp);
      const padLeft = padEdge.left((pad?.buttons[14]?.pressed ?? false) || gp.steer <= -0.5);
      const padRight = padEdge.right((pad?.buttons[15]?.pressed ?? false) || gp.steer >= 0.5);
      const padUp = padEdge.up((pad?.buttons[12]?.pressed ?? false) || (pad?.axes[1] ?? 0) <= -0.5);
      const padDown = padEdge.down(
        (pad?.buttons[13]?.pressed ?? false) || (pad?.axes[1] ?? 0) >= 0.5,
      );
      // the cheat reads pad presses only: d-pad / stick edges and A; any other button resets it
      const presses: string[] = [];
      if (padUp) presses.push('up');
      if (padDown) presses.push('down');
      if (padLeft) presses.push('left');
      if (padRight) presses.push('right');
      const buttons = pad ? Array.from(pad.buttons, (x) => x.pressed) : [];
      buttons.forEach((on, i) => {
        if (on && !prevButtons[i] && (i < 12 || i > 15)) presses.push(i === 0 ? 'a' : 'other');
      });
      prevButtons = buttons;
      return {
        ...m,
        device,
        padStyle,
        skip: pick(
          kbEdge.skip.poll(held.has('KeyN')),
          padEdge.skip(pad?.buttons[5]?.pressed ?? false),
        ),
        // LB / RB are clutch / skip in-game; only the title (daily / garage) and settings read them
        tabPrev: pick(
          kbEdge.tabPrev.poll(held.has('KeyQ')),
          padEdge.tabPrev(pad?.buttons[4]?.pressed ?? false),
        ),
        tabNext: pick(
          kbEdge.tabNext.poll(held.has('KeyE')),
          padEdge.tabNext(pad?.buttons[5]?.pressed ?? false),
        ),
        photo: pick(
          kbEdge.photo.poll(held.has('KeyP')),
          padEdge.photo(pad?.buttons[11]?.pressed ?? false), // R3
        ),
        mp: pick(kbEdge.mp.poll(held.has('KeyM')), padEdge.mp(pad?.buttons[3]?.pressed ?? false)),
        photoPan: {
          x: clamp(
            gp.steer +
              (any(held, 'KeyD', 'ArrowRight') ? 1 : 0) -
              (any(held, 'KeyA', 'ArrowLeft') ? 1 : 0),
            -1,
            1,
          ),
          y: clamp(
            deadzone(pad?.axes[1] ?? 0, 0.15) +
              (any(held, 'KeyS', 'ArrowDown') ? 1 : 0) -
              (any(held, 'KeyW', 'ArrowUp') ? 1 : 0),
            -1,
            1,
          ),
        },
        photoRot: clamp(
          deadzone(pad?.axes[2] ?? 0, 0.15) +
            (held.has('KeyX') ? 1 : 0) -
            (held.has('KeyZ') ? 1 : 0),
          -1,
          1,
        ),
        photoZoom: clamp(
          gp.throttle - gp.brake + (held.has('KeyE') ? 1 : 0) - (held.has('KeyQ') ? 1 : 0),
          -1,
          1,
        ),
        pause: pick(kbEdge.pause.poll(kbRaw.pause), padEdge.pause(gp.pause)),
        restart: pick(kbEdge.restart.poll(kbRaw.restart), padEdge.restart(gp.restart)),
        confirm: pick(kbEdge.confirm.poll(kbRaw.confirm), padEdge.confirm(gp.confirm)),
        cheat: presses.map(cheat).includes(true),
        left: pick(kbEdge.left.poll(any(held, 'KeyA', 'ArrowLeft')), padLeft),
        right: pick(kbEdge.right.poll(any(held, 'KeyD', 'ArrowRight')), padRight),
        up: pick(kbEdge.up.poll(any(held, 'KeyW', 'ArrowUp')), padUp),
        rev: held.has('KeyR') || (pad?.buttons[7]?.value ?? 0) > 0.5,
        tune: pick(
          kbEdge.tune.poll(held.has('KeyT')),
          padEdge.tune(pad?.buttons[2]?.pressed ?? false),
        ),
        save: pick(
          kbEdge.save.poll(held.has('KeyS')),
          padEdge.save(pad?.buttons[2]?.pressed ?? false),
        ),
        down: pick(kbEdge.down.poll(any(held, 'KeyS', 'ArrowDown')), padDown),
      };
    },
  };
}
