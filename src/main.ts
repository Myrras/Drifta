import { createRenderer } from './render';
import { drawHud } from './hud';
import { createGame } from './game';
import { createInput } from './input';
import { createAudio } from './audio';
import { garage } from './maps/garage';
import { BEST_SCORE_KEY, DT } from './config';

const renderer = createRenderer(document.getElementById('game') as HTMLCanvasElement);
window.addEventListener('resize', () => renderer.resize());

const input = createInput(window);
const audio = createAudio();
let mem = 0;
const best = {
  get() {
    try {
      const n = Number(localStorage.getItem(BEST_SCORE_KEY));
      return Math.max(mem, Number.isNaN(n) ? 0 : n);
    } catch {
      return mem;
    }
  },
  set(v: number) {
    mem = v;
    try {
      localStorage.setItem(BEST_SCORE_KEY, String(v));
    } catch {
      /* in-memory fallback */
    }
  },
};
const game = createGame(garage, audio, best);

const resume = () => audio.resume();
window.addEventListener('keydown', resume);
window.addEventListener('pointerdown', resume);
window.addEventListener('blur', () => game.pause());
document.addEventListener('visibilitychange', () => document.hidden && game.pause());

let last = performance.now();
let acc = 0;
const pending = { pause: false, restart: false, confirm: false };
function frame(now: number) {
  const frameDt = Math.min((now - last) / 1000, 0.25);
  last = now;
  acc += frameDt;
  const s = input.poll();
  pending.pause ||= s.pause;
  pending.restart ||= s.restart;
  pending.confirm ||= s.confirm;
  if (s.confirm) resume();
  while (acc >= DT) {
    game.update({ ...s, ...pending }, DT);
    pending.pause = pending.restart = pending.confirm = false;
    acc -= DT;
  }
  const v = game.view();
  renderer.draw(v.render, frameDt);
  drawHud(renderer.ctx, v.hud, renderer.width(), renderer.height());
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
