import { createRenderer } from './render';
import { drawHud } from './hud';
import { createGame } from './game';
import { createInput } from './input';
import { createAudio } from './audio';
import { createClipRecorder } from './clips';
import { garage } from './maps/garage';
import { docks } from './maps/docks';
import { testpad } from './maps/testpad';
import { BEST_SCORE_KEY, DT } from './config';

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
const game = createGame([garage, docks, testpad], audio, bestFor, undefined, clips);

const resume = () => audio.resume();
window.addEventListener('keydown', resume);
window.addEventListener('pointerdown', resume);
window.addEventListener('blur', () => game.pause());
document.addEventListener('visibilitychange', () => document.hidden && game.pause());

let last = performance.now();
let acc = 0;
const pending = {
  pause: false,
  restart: false,
  confirm: false,
  left: false,
  right: false,
  up: false,
  down: false,
  save: false,
};
function frame(now: number) {
  const frameDt = Math.min((now - last) / 1000, 0.25);
  last = now;
  acc += frameDt;
  const s = input.poll();
  pending.pause ||= s.pause;
  pending.restart ||= s.restart;
  pending.confirm ||= s.confirm;
  pending.left ||= s.left;
  pending.right ||= s.right;
  pending.up ||= !!s.up;
  pending.down ||= !!s.down;
  pending.save ||= !!s.save;
  if (s.confirm) resume();
  while (acc >= DT) {
    game.update({ ...s, ...pending }, DT);
    pending.pause =
      pending.restart =
      pending.confirm =
      pending.left =
      pending.right =
      pending.up =
      pending.down =
      pending.save =
        false;
    acc -= DT;
  }
  const v = game.view();
  renderer.draw(v.render, frameDt);
  drawHud(renderer.ctx, v.hud, renderer.width(), renderer.height());
  clips.frame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
