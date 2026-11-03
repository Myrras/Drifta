import type { ClipRecorder } from './game';
import type { ClipQuality } from './settings';

const ROTATE_MS = 1000; // a fresh rolling take every second, so the oldest always has ~1-2 s lead-in
const ROLLING = 2;
const TAIL_MS = 1000; // keep recording after the combo banks
/** recorded size cap (px, long x short side), frame rate and video bitrate per quality */
const PRESETS: Record<Exclude<ClipQuality, 'off'>, [number, number, number, number]> = {
  low: [854, 480, 24, 1_500_000],
  medium: [1280, 720, 30, 4_000_000],
  high: [1920, 1080, 60, 8_000_000],
};
// vp8 first: much cheaper to encode than vp9 with several takes running
const TYPES = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'];

interface Take {
  rec: MediaRecorder;
  chunks: Blob[];
  done: Promise<Blob>;
  discard: boolean;
  kept: boolean;
  tail?: ReturnType<typeof setTimeout>;
  start: number;
  still?: HTMLCanvasElement;
}

const STILL_MS = 200;
const STILL_MAX = 32; // ring cap: stills spread over the whole current drift
const STILL_W = 320;

/** index of the time nearest to target, -1 if none */
export function nearestIndex(times: number[], target: number): number {
  let best = -1;
  for (let i = 0; i < times.length; i++)
    if (best < 0 || Math.abs(times[i] - target) < Math.abs(times[best] - target)) best = i;
  return best;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Records drift clips from a downscaled copy of the canvas (incl. HUD) and the game audio as WebM. */
export function createClipRecorder(
  canvas: HTMLCanvasElement,
  audio: () => MediaStream | null,
): ClipRecorder & { frame(): void; still(id: number): HTMLCanvasElement | undefined } {
  const out = document.createElement('canvas');
  const octx = out.getContext('2d');
  const ok = typeof MediaRecorder !== 'undefined' && 'captureStream' in out && !!octx;
  const mimeType = ok ? TYPES.find((t) => MediaRecorder.isTypeSupported(t)) : undefined;
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let paused = false;
  let rolling: Take[] = [];
  let [maxLong, maxShort, fps, bitrate] = PRESETS.medium;
  const clips = new Map<number, Take>();
  let ring: { t: number; c: HTMLCanvasElement }[] = [];
  let spare: HTMLCanvasElement[] = []; // canvases freed by decimation, reused
  let gap = STILL_MS;
  let lastStill = 0;

  /** new drift: start the stills over at the finest interval */
  function resetStills(): void {
    spare.push(...ring.map((e) => e.c));
    ring = [];
    gap = STILL_MS;
    lastStill = 0;
  }

  function snap(): void {
    const now = performance.now();
    if (now - lastStill < gap) return;
    lastStill = now;
    if (ring.length >= STILL_MAX) {
      // full: keep every other still and halve the rate, so any drift length fits
      spare.push(...ring.filter((_, i) => i % 2).map((e) => e.c));
      ring = ring.filter((_, i) => !(i % 2));
      gap *= 2;
    }
    const c = spare.pop() ?? document.createElement('canvas');
    ring.push({ t: now, c });
    c.width = STILL_W;
    c.height = Math.max(1, Math.round((out.height * STILL_W) / out.width));
    c.getContext('2d')!.drawImage(out, 0, 0, c.width, c.height);
  }

  function pickStill(t: Take): void {
    const i = nearestIndex(
      ring.map((e) => e.t),
      (t.start + performance.now()) / 2,
    );
    if (i < 0) return;
    const c = document.createElement('canvas');
    c.width = ring[i].c.width;
    c.height = ring[i].c.height;
    c.getContext('2d')!.drawImage(ring[i].c, 0, 0);
    t.still = c;
  }

  function release(): void {
    stream?.getVideoTracks().forEach((v) => v.stop());
    stream = null;
    paused = false;
  }

  /** after the run: free the stream once the last tail has finished */
  function releaseIfIdle(): void {
    if (timer || [...clips.values()].some((t) => t.rec.state !== 'inactive')) return;
    release();
  }

  function take(): Take | null {
    if (!stream) return null;
    try {
      const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate });
      const t: Take = { rec, chunks: [], done: null!, discard: false, kept: false, start: 0 };
      t.done = new Promise((resolve) => {
        rec.ondataavailable = (e) => !t.discard && e.data.size && t.chunks.push(e.data);
        rec.onstop = () => resolve(new Blob(t.chunks, { type: rec.mimeType || 'video/webm' }));
      });
      rec.start();
      if (paused) rec.pause();
      return t;
    } catch {
      return null;
    }
  }

  function finish(t: Take, discard = false): void {
    clearTimeout(t.tail);
    t.discard ||= discard;
    if (t.discard) t.chunks = [];
    if (t.rec.state !== 'inactive') t.rec.stop();
  }

  function rotate(): void {
    const t = take();
    if (t) rolling.push(t);
    while (rolling.length > ROLLING) finish(rolling.shift()!, true);
  }

  function stopRolling(): void {
    if (timer) clearInterval(timer);
    timer = null;
    rolling.forEach((t) => finish(t, true));
    rolling = [];
  }

  function draw(): void {
    const k = Math.min(
      1,
      maxLong / Math.max(canvas.width, canvas.height),
      maxShort / Math.min(canvas.width, canvas.height),
    );
    const w = even(canvas.width * k);
    const h = even(canvas.height * k);
    if (out.width !== w || out.height !== h) Object.assign(out, { width: w, height: h });
    octx!.drawImage(canvas, 0, 0, w, h);
  }

  return {
    /** call after each rendered frame */
    frame() {
      if (stream) {
        draw();
        snap();
      }
    },
    begin(quality) {
      this.clear();
      ring = [];
      spare = [];
      gap = STILL_MS;
      lastStill = 0;
      if (!mimeType || quality === 'off') return;
      [maxLong, maxShort, fps, bitrate] = PRESETS[quality];
      try {
        draw(); // size the copy before the first take
        stream = out.captureStream(fps);
        audio()
          ?.getAudioTracks()
          .forEach((a) => stream!.addTrack(a));
      } catch {
        stream = null;
        return;
      }
      rotate();
      timer = setInterval(rotate, ROTATE_MS);
    },
    mark(id) {
      const t = rolling.shift() ?? take();
      if (t) {
        t.start = performance.now(); // drift start, not take start
        resetStills();
        clips.set(id, t);
      }
      if (!rolling.length) rotate();
    },
    keep(id) {
      const t = clips.get(id);
      if (!t || t.kept) return;
      t.kept = true;
      pickStill(t);
      t.tail = setTimeout(() => {
        finish(t);
        releaseIfIdle();
      }, TAIL_MS);
    },
    drop(id) {
      const t = clips.get(id);
      if (t) finish(t, true);
      clips.delete(id);
    },
    pause(on) {
      paused = on;
      for (const t of [...rolling, ...clips.values()]) {
        if (on && t.rec.state === 'recording') t.rec.pause();
        else if (!on && t.rec.state === 'paused') t.rec.resume();
      }
    },
    stop() {
      stopRolling();
      for (const [id, t] of clips) if (!t.kept && t.rec.state !== 'inactive') this.drop(id);
      releaseIfIdle();
    },
    clear() {
      stopRolling();
      clips.forEach((t) => finish(t, true));
      clips.clear();
      release();
    },
    still(id) {
      return clips.get(id)?.still;
    },
    has(id) {
      return clips.has(id);
    },
    save(id, name) {
      void clips.get(id)?.done.then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      });
    },
  };
}
