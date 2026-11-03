import { createRenderer } from './render';
import { drawHud } from './hud';
import { createGame } from './game';
import { createInput } from './input';
import { createAudio } from './audio';
import { createClipRecorder } from './clips';
import { garage } from './maps/garage';
import { docks } from './maps/docks';
import { testpad } from './maps/testpad';
import { tokyo } from './maps/tokyo';
import { BEST_SCORE_KEY, DT } from './config';
import { clearLibrary, importFiles, libraryBytes, MAX_BYTES } from './musicLibrary';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = createRenderer(canvas);
window.addEventListener('resize', () => renderer.resize());

const input = createInput(window);
const audio = createAudio();
const legacy = ['JAPAN GARAGE', 'Parking Garage'];
const bestFor = (name: string) => {
  let mem = 0;
  const key = `drifta.best.${name}`;
  return {
    get() {
      try {
        const read = (k: string) => Number(localStorage.getItem(k)) || 0;
        const n = Math.max(read(key), legacy.includes(name) ? read(BEST_SCORE_KEY) : 0);
        return Math.max(mem, n);
      } catch {
        return mem;
      }
    },
    set(v: number) {
      mem = v;
      try {
        localStorage.setItem(key, String(v));
        if (!v) localStorage.removeItem(BEST_SCORE_KEY); // reset also clears the legacy score
      } catch {
        /* in-memory fallback */
      }
    },
  };
};
const clips = createClipRecorder(canvas, () => audio.stream());
const picker = document.createElement('input');
picker.type = 'file';
picker.multiple = true;
picker.accept = '.mp3,audio/mpeg';
let pickDone: (summary: string) => void = () => {};
picker.addEventListener('change', async () => {
  const files = [...(picker.files ?? [])];
  picker.value = '';
  if (!files.length) return;
  const r = await importFiles(files);
  const why = r.reason?.replace(/ \(.*\)/, '').toUpperCase();
  const count = r.added ? `+${r.added} ADDED` : why ? '' : `${r.skipped} SKIPPED`;
  pickDone([count, why].filter(Boolean).join(' · '));
});
const musicHost = {
  // runs in the frame loop right after the keydown; transient user activation still holds
  pick(done: (summary: string) => void) {
    pickDone = done;
    picker.click();
  },
  clear: clearLibrary,
  size: async () => `${Math.round((await libraryBytes()) / 2 ** 20)} / ${MAX_BYTES / 2 ** 20} MB`,
};
const game = createGame(
  [garage, docks, tokyo, testpad],
  audio,
  bestFor,
  undefined,
  clips,
  musicHost,
);

const resume = () => audio.resume();
window.addEventListener('keydown', resume);
window.addEventListener('pointerdown', resume);
window.addEventListener('blur', () => game.pause());
document.addEventListener('visibilitychange', () => document.hidden && game.pause());

let last = performance.now();
let acc = 0;
/** edges latched across frames without a physics step */
const EDGES = [
  'pause',
  'restart',
  'confirm',
  'left',
  'right',
  'up',
  'down',
  'save',
  'tune',
  'tabPrev',
  'tabNext',
  'skip',
] as const;
const pending = Object.fromEntries(EDGES.map((k) => [k, false])) as Record<
  (typeof EDGES)[number],
  boolean
>;
function frame(now: number) {
  const frameDt = Math.min((now - last) / 1000, 0.25);
  last = now;
  acc += frameDt;
  const s = input.poll();
  for (const k of EDGES) pending[k] ||= !!s[k];
  if (s.confirm) resume();
  while (acc >= DT) {
    game.update({ ...s, ...pending }, DT);
    for (const k of EDGES) pending[k] = false;
    acc -= DT;
  }
  const v = game.view();
  renderer.draw(v.render, frameDt);
  drawHud(renderer.ctx, v.hud, renderer.width(), renderer.height());
  clips.frame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
