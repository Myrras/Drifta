/** Procedural eurobeat-style drift track. Pattern logic is pure (testable); createMusic wires it to Web Audio. */

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
  let timer: ReturnType<typeof setInterval> | null = null;
  let nextTime = 0;
  let stepIdx = 0;

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

  function tick(): void {
    while (nextTime < ctx.currentTime + 0.1) {
      scheduleStep(nextTime, stepIdx);
      stepIdx++;
      nextTime += STEP_SEC;
    }
  }

  const beat = 60 / BPM;
  return {
    start(): void {
      if (timer) return;
      nextTime = ctx.currentTime + 0.05;
      stepIdx = 0;
      timer = setInterval(tick, 25);
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
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
      const len = 8 * STEP_SEC;
      for (let i = 0; i < 8; i++)
        noiseHit(t0 + i * STEP_SEC, 0.08, 0.25 + i * 0.05, 'bandpass', 1800);
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
