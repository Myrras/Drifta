/** Procedural drift tracks (tokyo, eurobeat) plus MY MUSIC (library MP3s). Pattern logic is pure (testable); createMusic wires it to Web Audio. */
import { createShuffleBag, getBlob, listTracks } from './musicLibrary';

export const BPM = 155;
export const STEPS_PER_BAR = 16;
const STEP_SEC = 60 / BPM / 4;

/** A minor, 8 bars: i VI VII i | iv VI VII V. Root MIDI note + triad intervals. */
const MAJ = [0, 4, 7];
const MIN = [0, 3, 7];
const PROG: { root: number; tri: number[] }[] = [
  { root: 57, tri: MIN }, // Am
  { root: 53, tri: MAJ }, // F
  { root: 55, tri: MAJ }, // G
  { root: 57, tri: MIN }, // Am
  { root: 50, tri: MIN }, // Dm
  { root: 53, tri: MAJ }, // F
  { root: 55, tri: MAJ }, // G
  { root: 52, tri: MAJ }, // E
];
const STAB_STEPS = [0, 3, 6, 10, 12];

export const chordAt = (bar: number) => PROG[((bar % 8) + 8) % 8];
export const chordNotes = (bar: number): number[] => {
  const c = chordAt(bar);
  return c.tri.map((i) => c.root + i);
};

export interface Drums {
  kick: boolean;
  clap: boolean;
  hat: boolean;
}

/** Kick on every beat, clap on 2 & 4, closed hat on 8ths (all intensities). */
export function drumsAt(step: number): Drums {
  const s = step % STEPS_PER_BAR;
  return { kick: s % 4 === 0, clap: s === 4 || s === 12, hat: s % 2 === 0 };
}

/** Offbeat 8th bass (steps 2,6,10,14), octave-jumping on the second offbeat of each half bar. */
export function bassAt(bar: number, step: number): number | null {
  const s = step % STEPS_PER_BAR;
  if (s % 4 !== 2) return null;
  return chordAt(bar).root - 24 + (s % 8 === 6 ? 12 : 0);
}

export function stabAt(bar: number, step: number, intensity: number): number[] | null {
  if (intensity <= 0.3 || !STAB_STEPS.includes(step % STEPS_PER_BAR)) return null;
  return chordNotes(bar).map((n) => n + 12);
}

/** Deterministic hash in [0,1) from integers. */
function hash(a: number, b: number): number {
  let h = (Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 7, 0x85ebca6b) ^ 0xc0ffee) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Fixed-seed 16th-note arpeggio from chord tones; same output for the same bar every time. */
export function leadAt(bar: number, step: number, intensity: number): number | null {
  if (intensity <= 0.6) return null;
  const s = step % STEPS_PER_BAR;
  const b = ((bar % 8) + 8) % 8;
  if (s % 2 === 1 && hash(b, s) < 0.45) return null; // rests on weak 16ths
  const tones = chordNotes(b);
  const idx = Math.floor(hash(b * 31 + 5, s) * 4); // 3 tones + octave
  return tones[idx % 3] + 24 + (idx === 3 ? 12 : 0);
}

/* ---- Tokyo: dark half-time hip-hop, D in-scale (miyako-bushi). Original patterns, style only. ---- */

export const TRACKS = ['tokyo', 'eurobeat', 'mine'] as const;
export type Track = (typeof TRACKS)[number];
export const TRACK_LABELS: Record<Track, string> = {
  tokyo: 'TOKYO',
  eurobeat: 'EUROBEAT',
  mine: 'MY MUSIC',
};
export const TOKYO_BPM = 130;
export const TOKYO_SCALE = [0, 1, 5, 7, 8]; // D Eb G A Bb
const TOKYO_ROOT = 50; // D3
/** Bar roots as scale degrees: D D Bb A | D D G A (negative = below the root). */
const TOKYO_PROG = [0, 0, -1, -2, 0, 0, -3, -2];
/** Koto riff as scale degrees per 16th (null = rest); A answers on bars 0-1, B on bars 2-3. */
const RIFF_A = [5, null, 7, null, 8, 9, null, 8, null, 7, null, 6, 5, null, null, null];
const RIFF_B = [10, null, 9, 8, null, 9, null, 7, 8, null, 6, null, 5, null, 4, null];

const mod = (a: number, n: number) => ((a % n) + n) % n;
/** Scale degree to MIDI note; degree 5 is the root an octave up. */
export const tokyoDegree = (d: number) =>
  TOKYO_ROOT + 12 * Math.floor(d / 5) + TOKYO_SCALE[mod(d, 5)];
const tokyoRoot = (bar: number) => TOKYO_PROG[mod(bar, 8)];
/** Last bar of every 8 is a stop bar: one taiko, silence, two "hey" stabs back in. */
export const tokyoStop = (bar: number) => mod(bar, 8) === 7;

export interface TokyoDrums {
  kick: boolean;
  clap: boolean;
  taiko: boolean;
  hat: boolean;
  hey: boolean;
}

/** Half-time: clap on beat 3, sparse kick, taiko accents; rolls and extra hits with intensity. */
export function tokyoDrumsAt(bar: number, step: number, intensity: number): TokyoDrums {
  const s = mod(step, STEPS_PER_BAR);
  const b = mod(bar, 8);
  if (tokyoStop(bar))
    return { kick: false, clap: false, taiko: s === 0, hat: false, hey: s === 12 || s === 14 };
  const hot = intensity > 0.6;
  return {
    kick: s === 0 || s === 10 || (b % 2 === 1 && s === 7),
    clap: s === 8,
    taiko: (b % 4 === 0 && s === 0) || (b % 2 === 1 && (s === 12 || s === 14)) || (hot && s === 4),
    hat: s % 2 === 0 || (hot && b % 4 === 2 && s >= 12),
    hey: intensity > 0.3 && b % 4 === 3 && s === 6,
  };
}

/** Sliding 808: root on the kick hits, octave flip at the end of odd bars to slide back down. */
export function tokyoBassAt(bar: number, step: number): number | null {
  const s = mod(step, STEPS_PER_BAR);
  const n = tokyoDegree(tokyoRoot(bar)) - 12;
  if (tokyoStop(bar)) return s === 0 ? n : null;
  if (s === 0 || s === 10) return n;
  return s === 14 && mod(bar, 2) === 1 ? n + 12 : null;
}

/** Plucked koto/shamisen riff; needs intensity > 0.3. */
export function tokyoRiffAt(bar: number, step: number, intensity: number): number | null {
  if (intensity <= 0.3 || tokyoStop(bar)) return null;
  const d = (mod(bar, 4) < 2 ? RIFF_A : RIFF_B)[mod(step, STEPS_PER_BAR)];
  return d === null ? null : tokyoDegree(d);
}

/** Dark pad: root, 2nd and 4th scale degree above it, once per bar. */
export const tokyoPadAt = (bar: number): number[] =>
  [0, 2, 4].map((i) => tokyoDegree(tokyoRoot(bar) + i));

const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const cutoff = (i: number) => 3500 + 12000 * clamp01((i - 0.7) / 0.3);

export function createMusic(ctx: AudioContext, out: AudioNode) {
  const bus = ctx.createGain();
  bus.gain.value = 0.25;
  bus.connect(out);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = cutoff(0);
  lp.connect(bus);
  const stabBus = ctx.createGain();
  const leadBus = ctx.createGain();
  stabBus.gain.value = 0;
  leadBus.gain.value = 0;
  stabBus.connect(lp);
  leadBus.connect(lp);

  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = hash(i, 99) * 2 - 1;

  let intensity = 0;
  let track: Track = 'tokyo';
  let stepSec = 60 / TOKYO_BPM / 4;
  let lastBass = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let nextTime = 0;
  let stepIdx = 0;

  // MY MUSIC: library MP3s via an <audio> element into `out` (same bus as procedural music)
  let el: HTMLAudioElement | null = null;
  let url: string | null = null;
  let bag: ReturnType<typeof createShuffleBag<string>> | null = null;
  let mineCount = 0;
  let running = false;
  let loading = false;
  let fails = 0;

  function fallback(): void {
    track = 'tokyo';
    stepSec = 60 / TOKYO_BPM / 4;
    stepIdx = 0;
    el?.pause();
  }

  async function reload(): Promise<number> {
    const ids = (await listTracks()).map((t) => t.id);
    mineCount = ids.length;
    bag = ids.length ? createShuffleBag(ids) : null;
    return mineCount;
  }

  async function playNext(): Promise<void> {
    if (loading) return;
    loading = true;
    let retry = false;
    try {
      if (!bag) await reload();
      if (track !== 'mine' || !running) return;
      const id = bag?.next();
      const blob = id ? await getBlob(id) : undefined;
      if (track !== 'mine' || !running) return;
      if (!blob || fails > mineCount) return fallback();
      if (!el) {
        el = new Audio();
        el.addEventListener('ended', () => void playNext());
        el.addEventListener('error', () => {
          fails++;
          void playNext();
        });
        const g = ctx.createGain();
        g.gain.value = 0.3; // match the procedural bus level
        ctx.createMediaElementSource(el).connect(g).connect(out);
      }
      const old = url;
      url = URL.createObjectURL(blob);
      el.src = url;
      if (old) URL.revokeObjectURL(old);
      await el.play();
      fails = 0;
    } catch {
      fails++;
      retry = true;
    } finally {
      loading = false;
    }
    if (retry && track === 'mine' && running) {
      if (fails > mineCount + 1) fallback();
      else void playNext();
    }
  }

  function startMine(): void {
    if (el?.src && el.paused && !el.ended) el.play().catch(() => {});
    else if (!el?.src || el.ended) void playNext();
  }

  function env(g: GainNode, t: number, peak: number, dur: number): void {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  function osc(
    type: OscillatorType,
    f: number,
    t: number,
    dur: number,
    dest: AudioNode,
    vol: number,
    detune = 0,
  ): void {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    env(g, t, vol, dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noiseHit(t: number, dur: number, vol: number, type: BiquadFilterType, f: number): void {
    const s = ctx.createBufferSource();
    const fl = ctx.createBiquadFilter();
    const g = ctx.createGain();
    s.buffer = noise;
    fl.type = type;
    fl.frequency.value = f;
    env(g, t, vol, dur);
    s.connect(fl).connect(g).connect(lp);
    s.start(t, hash(Math.floor(t * 1000), 3) * 0.5);
    s.stop(t + dur + 0.02);
  }

  function kick(t: number): void {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    env(g, t, 1, 0.22);
    o.connect(g).connect(bus); // bypasses the filter so drops keep the kick
    o.start(t);
    o.stop(t + 0.25);
  }

  function scheduleStep(t: number, idx: number): void {
    const bar = Math.floor(idx / STEPS_PER_BAR);
    const step = idx % STEPS_PER_BAR;
    const d = drumsAt(step);
    if (d.kick) kick(t);
    if (d.clap) noiseHit(t, 0.12, 0.5, 'bandpass', 1800);
    if (d.hat) noiseHit(t, 0.04, step % 4 === 2 ? 0.28 : 0.16, 'highpass', 7000);
    const b = bassAt(bar, step);
    if (b !== null) {
      const o = ctx.createOscillator();
      const f = ctx.createBiquadFilter();
      const g = ctx.createGain();
      const dur = STEP_SEC * 1.8;
      o.type = 'sawtooth';
      o.frequency.value = mtof(b);
      f.type = 'lowpass';
      f.frequency.value = 600;
      env(g, t, 0.45, dur);
      o.connect(f).connect(g).connect(lp);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
    const st = stabAt(bar, step, intensity);
    if (st) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 3000;
      f.connect(stabBus);
      for (const n of st)
        for (const dt of [-12, 0, 12]) osc('sawtooth', mtof(n), t, STEP_SEC * 1.5, f, 0.05, dt);
    }
    const ld = leadAt(bar, step, intensity);
    if (ld !== null) osc('square', mtof(ld), t, STEP_SEC * 1.2, leadBus, 0.07);
  }

  function taiko(t: number): void {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.25);
    env(g, t, 0.9, 0.6);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + 0.65);
    noiseHit(t, 0.08, 0.4, 'lowpass', 400);
  }

  /** Synth "hey": bright square fifth plus a falling bandpassed noise burst. No voice. */
  function hey(t: number): void {
    for (const n of [62, 69]) osc('square', mtof(n), t, 0.14, lp, 0.06);
    const s = ctx.createBufferSource();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    s.buffer = noise;
    f.type = 'bandpass';
    f.Q.value = 4;
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(700, t + 0.15);
    env(g, t, 0.6, 0.16);
    s.connect(f).connect(g).connect(lp);
    s.start(t);
    s.stop(t + 0.2);
  }

  /** Pluck: saw with a falling filter and a slight downward pitch bend at the attack. */
  function pluck(n: number, t: number, dest: AudioNode, vol: number): void {
    const o = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = mtof(n);
    o.detune.setValueAtTime(40, t);
    o.detune.linearRampToValueAtTime(0, t + 0.05);
    f.type = 'lowpass';
    f.Q.value = 6;
    f.frequency.setValueAtTime(4000, t);
    f.frequency.exponentialRampToValueAtTime(700, t + 0.25);
    env(g, t, vol, 0.45);
    o.connect(f).connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.5);
  }

  function tokyoStep(t: number, idx: number): void {
    const bar = Math.floor(idx / STEPS_PER_BAR);
    const step = idx % STEPS_PER_BAR;
    const d = tokyoDrumsAt(bar, step, intensity);
    if (d.kick) kick(t);
    if (d.taiko) taiko(t);
    if (d.clap) for (const dt of [0, 0.012, 0.024]) noiseHit(t + dt, 0.15, 0.45, 'bandpass', 1500);
    if (d.hat) noiseHit(t, 0.03, step % 4 === 2 ? 0.22 : 0.12, 'highpass', 8000);
    if (d.hey) hey(t);
    const b = tokyoBassAt(bar, step);
    if (b !== null) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const dur = stepSec * 6;
      o.type = 'sine';
      o.frequency.setValueAtTime(mtof(lastBass || b), t);
      o.frequency.exponentialRampToValueAtTime(mtof(b), t + 0.08); // 808 glide from the last note
      env(g, t, 0.8, dur);
      o.connect(g).connect(bus);
      o.start(t);
      o.stop(t + dur + 0.02);
      lastBass = b;
    }
    if (step === 0 && !tokyoStop(bar)) {
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter();
      const dur = stepSec * STEPS_PER_BAR;
      f.type = 'lowpass';
      f.frequency.value = 900;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.04, t + 0.3);
      g.gain.linearRampToValueAtTime(0, t + dur);
      f.connect(g).connect(lp);
      for (const n of tokyoPadAt(bar))
        for (const dt of [-8, 8]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = mtof(n);
          o.detune.value = dt;
          o.connect(f);
          o.start(t);
          o.stop(t + dur + 0.02);
        }
    }
    const r = tokyoRiffAt(bar, step, intensity);
    if (r !== null) {
      pluck(r, t, stabBus, 0.12);
      pluck(r + 12, t, leadBus, 0.05); // octave double, audible only above 0.6
    }
  }

  function tick(): void {
    if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.05; // stalled timer: skip missed steps
    if (track === 'mine') return;
    while (nextTime < ctx.currentTime + 0.1) {
      (track === 'tokyo' ? tokyoStep : scheduleStep)(nextTime, stepIdx);
      stepIdx++;
      nextTime += stepSec;
    }
  }

  const beat = 60 / BPM;
  return {
    start(): void {
      running = true;
      if (track === 'mine') startMine();
      if (timer) return;
      nextTime = ctx.currentTime + 0.05;
      stepIdx = 0;
      timer = setInterval(tick, 25);
    },
    stop(): void {
      running = false;
      el?.pause();
      if (timer) clearInterval(timer);
      timer = null;
    },
    /** Switches on the next step, restarting at bar 0. */
    setTrack(t: Track): void {
      if (t === track) return;
      track = t;
      if (t === 'mine') {
        fails = 0;
        void reload().then(() => running && startMine());
        return;
      }
      el?.pause();
      stepSec = 60 / (t === 'tokyo' ? TOKYO_BPM : BPM) / 4;
      stepIdx = 0;
      lastBass = 0;
    },
    /** Re-read the library (after import/clear); returns the track count. */
    reload,
    myMusicCount: () => mineCount,
    skip(): void {
      if (track === 'mine' && running) void playNext();
    },
    setIntensity(x: number): void {
      intensity = clamp01(x);
      const t = ctx.currentTime;
      stabBus.gain.setTargetAtTime(intensity > 0.3 ? 1 : 0, t, beat / 3);
      leadBus.gain.setTargetAtTime(intensity > 0.6 ? 1 : 0, t, beat / 3);
      lp.frequency.setTargetAtTime(cutoff(intensity), t, beat / 3);
    },
    /** Snare roll + noise riser over the next 8 steps. */
    fill(): void {
      const t0 = Math.max(nextTime, ctx.currentTime);
      const len = 8 * stepSec;
      for (let i = 0; i < 8; i++)
        noiseHit(t0 + i * stepSec, 0.08, 0.25 + i * 0.05, 'bandpass', 1800);
      const s = ctx.createBufferSource();
      const f = ctx.createBiquadFilter();
      const g = ctx.createGain();
      s.buffer = noise;
      s.loop = true;
      f.type = 'bandpass';
      f.Q.value = 2;
      f.frequency.setValueAtTime(400, t0);
      f.frequency.exponentialRampToValueAtTime(6000, t0 + len);
      g.gain.setValueAtTime(0.05, t0);
      g.gain.linearRampToValueAtTime(0.35, t0 + len);
      g.gain.linearRampToValueAtTime(0, t0 + len + 0.02);
      s.connect(f).connect(g).connect(lp);
      s.start(t0);
      s.stop(t0 + len + 0.05);
    },
    /** Quick filter sweep down, then recover to the intensity-based cutoff. */
    drop(): void {
      const t = ctx.currentTime;
      lp.frequency.cancelScheduledValues(t);
      lp.frequency.setValueAtTime(lp.frequency.value, t);
      lp.frequency.exponentialRampToValueAtTime(250, t + 0.15);
      lp.frequency.setTargetAtTime(cutoff(intensity), t + 0.6, beat);
    },
  };
}
