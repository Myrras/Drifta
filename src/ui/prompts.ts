import type { InputDevice, PadStyle } from '../input';

export type Action =
  | 'confirm'
  | 'back'
  | 'handbrake'
  | 'throttle'
  | 'brake'
  | 'clutch'
  | 'steer'
  | 'tune'
  | 'restart'
  | 'pause'
  | 'skip'
  | 'navigate'
  | 'adjust'
  | 'tabs'
  | 'rev'
  | 'pick'
  | 'save'
  | 'photo'
  | 'rotate'
  | 'zoom';

// Keyboard bindings mirror keyboardInput()/createInput() in input.ts.
const KB: Record<Action, string> = {
  confirm: 'ENTER',
  back: 'ESC',
  handbrake: 'SPACE',
  throttle: 'W',
  brake: 'S',
  clutch: 'SHIFT',
  steer: 'A/D',
  tune: 'T',
  restart: 'R',
  pause: 'ESC',
  skip: 'N',
  navigate: '↑↓',
  adjust: '←→',
  tabs: 'Q/E',
  rev: 'R',
  pick: '←→',
  save: 'S', // results: save the selected clip
  photo: 'P',
  rotate: 'Z/X',
  zoom: 'Q/E',
};

// Pad mapping mirrors gamepadInput()/createInput(): [xbox, ps].
const PAD: Record<Action, [string, string]> = {
  confirm: ['A', '✕'],
  back: ['B', '○'],
  handbrake: ['A', '✕'],
  throttle: ['RT', 'R2'],
  brake: ['LT', 'L2'],
  clutch: ['LB', 'L1'],
  steer: ['STICK', 'STICK'],
  tune: ['X', '□'],
  restart: ['BACK', 'SHARE'],
  pause: ['START', 'OPTIONS'],
  skip: ['RB', 'R1'],
  navigate: ['D-PAD ↑↓', 'D-PAD ↑↓'],
  adjust: ['D-PAD ←→', 'D-PAD ←→'],
  tabs: ['LB/RB', 'L1/R1'],
  rev: ['RT', 'R2'], // garage rev reads pad button 7
  pick: ['D-PAD ←→', 'D-PAD ←→'],
  save: ['X', '□'],
  photo: ['R3', 'R3'],
  rotate: ['R-STICK', 'R-STICK'],
  zoom: ['LT/RT', 'L2/R2'],
};

export function glyph(a: Action, device: InputDevice, padStyle: PadStyle): string {
  return device === 'kb' ? KB[a] : PAD[a][padStyle === 'ps' ? 1 : 0];
}

export function hintLine(
  items: [Action, string][],
  device: InputDevice,
  padStyle: PadStyle,
): string {
  return items.map(([a, label]) => `${glyph(a, device, padStyle)} ${label}`).join(' · ');
}
