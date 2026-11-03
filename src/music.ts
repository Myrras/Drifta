/** Procedural PHONK track plus MY MUSIC (library MP3s). Pattern logic is pure (testable); createMusic wires it to Web Audio. */
import { createShuffleBag, getBlob, listTracks } from './musicLibrary';

export const STEPS_PER_BAR = 16;

/** Deterministic hash in [0,1) from integers. */
function hash(a: number, b: number): number {
  let h = (Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 7, 0x85ebca6b) ^ 0xc0ffee) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

export const TRACKS = ['phonk', 'mine'] as const;
export type Track = (typeof TRACKS)[number];
export const TRACK_LABELS: Record<Track, string> = {
  phonk: 'PHONK',
  mine: 'MY MUSIC',
};

/* ---- PHONK: drift phonk in F# phrygian. Original patterns, style only, no samples. ---- */

export const PHONK_BPM = 130;
export const PHONK_SCALE = [0, 1, 3, 5, 7, 8, 10]; // F# G A B C# D E
const PHONK_ROOT = 42; // F#2

const mod = (a: number, n: number) => ((a % n) + n) % n;
/** Scale degree to MIDI note; degree 7 is the root an octave up. */
export const phonkDegree = (d: number) =>
  PHONK_ROOT + 12 * Math.floor(d / 7) + PHONK_SCALE[mod(d, 7)];

export type PhonkPart = 'intro' | 'dropA' | 'dropB' | 'break';
/** 4-bar intro once, then a 24-bar loop: drop A (8), drop B (8), breakdown (4), intro reprise (4). */
export function phonkPart(bar: number): PhonkPart {
  if (bar < 4) return 'intro';
  const c = mod(bar - 4, 24);
  return c < 8 ? 'dropA' : c < 16 ? 'dropB' : c < 20 ? 'break' : 'intro';
}

/** Bar roots per 4-bar phrase as scale degrees (negative = below F#). */
const ROOTS: Record<PhonkPart, number[]> = {
  intro: [0, 0, -2, -1], // F# F# D E
  dropA: [0, 0, -2, -1],
  dropB: [0, 1, -2, -3], // F# G D C#
  break: [0, -2, -1, -3],
};
const rootAt = (bar: number) => ROOTS[phonkPart(bar)][mod(bar, 4)];

/** Cowbell melody bars as scale degrees above F#4 per 16th (null = rest). */
const _ = null;
const A0 = [7, _, _, 7, _, _, 6, _, 4, _, 5, 4, 2, _, 4, _];
const A1 = [7, _, _, 7, _, _, 8, _, 7, _, 6, _, 5, 4, 2, _];
const B0 = [9, _, 7, 9, _, _, 8, _, 7, _, 4, _, 5, _, 6, _];
const B1 = [7, _, 7, 4, _, _, 5, _, 4, _, 2, 1, 0, _, _, _];
const COWBELL: Record<PhonkPart, (number | null)[][]> = {
  intro: [A0, A1, A0, B1],
  dropA: [A0, A1, A0, B1],
  dropB: [B0, B1, B0, A1],
  break: [A0, A1, A0, A1],
};

export interface PhonkDrums {
  kick: boolean;
  clap: boolean;
  snare: boolean;
  /** 0 none, 1 one hit, 2 a 1/32 roll (two hits in the step) */
  hat: 0 | 1 | 2;
}

/** Half-time trap groove: clap on beat 3, hat rolls; the intro builds, the breakdown drops the kick. */
export function phonkDrumsAt(bar: number, step: number, intensity: number): PhonkDrums {
  const s = mod(step, STEPS_PER_BAR);
  const l = mod(bar, 4);
  const part = phonkPart(bar);
  if (part === 'intro') {
    const build = l === 3 && s >= 8; // snare + 1/32 hat roll into the drop
    return {
      kick: false,
      clap: false,
      snare: build,
      hat: build ? 2 : l > 0 && s % 2 === 0 ? 1 : 0,
    };
  }
  if (part === 'break') return { kick: false, clap: s === 8, snare: false, hat: 0 };
  const hot = intensity > 0.6;
  const roll32 =
    (l % 2 === 1 && s >= 14) ||
    (part === 'dropB' && l === 2 && s >= 6 && s < 8) ||
    (hot && s === 15);
  const roll16 = hot || (l === 1 && s >= 12) || (intensity > 0.3 && l === 2 && s >= 4 && s < 8);
  return {
    kick: s === 0 || s === 10 || (l % 2 === 1 && s === 6),
    clap: s === 8,
    snare: l === 3 && s >= 13 && s % 2 === 1,
    hat: roll32 ? 2 : s % 2 === 0 || roll16 ? 1 : 0,
  };
}

/** Distorted 808 on the kick hits with slides; long held notes in the breakdown, none in the intro. */
export function phonkBassAt(bar: number, step: number): number | null {
  const s = mod(step, STEPS_PER_BAR);
  const l = mod(bar, 4);
  const part = phonkPart(bar);
  if (part === 'intro') return null;
  const n = phonkDegree(rootAt(bar));
  if (part === 'break') return s === 0 ? n : s === 8 && l % 2 === 1 ? n + 12 : null;
  if (s === 0 || s === 10 || (l % 2 === 1 && s === 6)) return n;
  if (l === 1 && s === 13) return phonkDegree(rootAt(bar) + 2);
  return l === 3 && s === 14 ? n + 12 : null; // octave flip, slides down into the next bar
}

/** Memphis cowbell lead; only the beats in the breakdown. */
export function phonkCowbellAt(bar: number, step: number): number | null {
  const s = mod(step, STEPS_PER_BAR);
  const part = phonkPart(bar);
  if (part === 'break' && s % 4 !== 0) return null;
  const d = COWBELL[part][mod(bar, 4)][s];
  return d === null ? null : phonkDegree(14 + d);
}

/** Dark pad triad an octave above the bass, intro and breakdown only. */
export const phonkPadAt = (bar: number): number[] =>
  phonkPart(bar).startsWith('drop') ? [] : [0, 2, 4].map((i) => phonkDegree(rootAt(bar) + 7 + i));

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

  // 808 chain: tanh saturation, then a tone filter to keep the fizz down; bypasses lp like the kick
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++)
    curve[i] = Math.tanh(3 * ((i / (curve.length - 1)) * 2 - 1));
  shaper.curve = curve;
  shaper.oversample = '2x';
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 1800;
  const bassOut = ctx.createGain();
  bassOut.gain.value = 0.45;
  shaper.connect(tone).connect(bassOut).connect(bus);

  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = hash(i, 99) * 2 - 1;

  const stepSec = 60 / PHONK_BPM / 4;
  let intensity = 0;
  let track: Track = 'phonk';
  let lastBass = 0;
  let bassGate: GainNode | null = null;
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
    track = 'phonk';
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

  /** Hard clap: three noise bursts plus a short tonal snare body. */
  function clap(t: number): void {
    for (const dt of [0, 0.012, 0.024]) noiseHit(t + dt, 0.15, 0.45, 'bandpass', 1500);
    osc('triangle', 185, t, 0.09, lp, 0.3);
  }

  /** Synth cowbell: two square partials (ratio ~800/540) through a bandpass, fast decay. */
  function cowbell(n: number, t: number, dest: AudioNode, vol: number): void {
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    const hz = mtof(n);
    f.type = 'bandpass';
    f.frequency.value = hz * 1.8;
    f.Q.value = 1.2;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.002);
    g.gain.exponentialRampToValueAtTime(vol * 0.25, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    f.connect(g).connect(dest);
    for (const k of [1, 1.48]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = hz * k;
      o.connect(f);
      o.start(t);
      o.stop(t + 0.37);
    }
  }

  /** Monophonic distorted 808: glides from the last note, gates the previous one. */
  function bass808(n: number, t: number, len: number): void {
    if (bassGate) {
      bassGate.gain.setValueAtTime(1, t);
      bassGate.gain.linearRampToValueAtTime(0, t + 0.015);
    }
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const gate = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(mtof(lastBass || n), t);
    o.frequency.exponentialRampToValueAtTime(mtof(n), t + 0.11);
    env(g, t, 0.9, len + 0.1);
    o.connect(g).connect(gate).connect(shaper);
    o.start(t);
    o.stop(t + len + 0.12);
    bassGate = gate;
    lastBass = n;
  }

  function phonkStep(t: number, idx: number): void {
    const bar = Math.floor(idx / STEPS_PER_BAR);
    const step = idx % STEPS_PER_BAR;
    const d = phonkDrumsAt(bar, step, intensity);
    if (d.kick) kick(t);
    if (d.clap) clap(t);
    if (d.snare) noiseHit(t, 0.08, 0.3, 'bandpass', 1800);
    if (d.hat) noiseHit(t, 0.03, step % 4 === 2 ? 0.2 : 0.12, 'highpass', 8000);
    if (d.hat === 2) noiseHit(t + stepSec / 2, 0.025, 0.1, 'highpass', 8000);
    const bassAt = (i: number) => phonkBassAt(Math.floor(i / STEPS_PER_BAR), i);
    const b = bassAt(idx);
    if (b !== null) {
      let n = 1;
      while (n < STEPS_PER_BAR && bassAt(idx + n) === null) n++;
      bass808(b, t, n * stepSec);
    }
    const pad = step === 0 ? phonkPadAt(bar) : [];
    if (pad.length) {
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter();
      const dur = stepSec * STEPS_PER_BAR;
      f.type = 'lowpass';
      f.frequency.value = 900;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.04, t + 0.3);
      g.gain.linearRampToValueAtTime(0, t + dur);
      f.connect(g).connect(lp);
      for (const n of pad)
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
    const c = phonkCowbellAt(bar, step);
    if (c !== null) {
      cowbell(c, t, lp, 0.1);
      cowbell(c + 12, t, leadBus, 0.035); // octave double, audible only above 0.6
    }
    const e = idx >= 3 ? phonkCowbellAt(Math.floor((idx - 3) / STEPS_PER_BAR), idx - 3) : null;
    if (e !== null) cowbell(e, t, stabBus, 0.035); // dotted-8th echo, audible above 0.3
  }

  function tick(): void {
    if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.05; // stalled timer: skip missed steps
    if (track === 'mine') return;
    while (nextTime < ctx.currentTime + 0.1) {
      phonkStep(nextTime, stepIdx);
      stepIdx++;
      nextTime += stepSec;
    }
  }

  const beat = 60 / PHONK_BPM;
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
