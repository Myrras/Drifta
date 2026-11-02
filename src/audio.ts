import type { CarState, DriftInfo } from './types';

export function createAudio() {
  let ctx: AudioContext | null = null;
  let master: GainNode;
  let engGain: GainNode;
  let engFilter: BiquadFilterNode;
  let saw: OscillatorNode;
  let sq: OscillatorNode;
  let sqGain: GainNode;
  let squealGain: GainNode;
  let squealFilter: BiquadFilterNode;
  let noise: AudioBuffer;
  let wobble = 0;

  function init(): void {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const c = new AC();
    master = c.createGain();
    master.gain.value = 0.35;
    master.connect(c.destination);

    engGain = c.createGain();
    engGain.gain.value = 0;
    engFilter = c.createBiquadFilter();
    engFilter.type = 'lowpass';
    engFilter.frequency.value = 900;
    saw = c.createOscillator();
    saw.type = 'sawtooth';
    sq = c.createOscillator();
    sq.type = 'square';
    sqGain = c.createGain();
    sqGain.gain.value = 0.5;
    saw.connect(engFilter);
    sq.connect(sqGain).connect(engFilter);
    engFilter.connect(engGain).connect(master);
    saw.start();
    sq.start();

    noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    squealFilter = c.createBiquadFilter();
    squealFilter.type = 'bandpass';
    squealFilter.frequency.value = 2500;
    squealFilter.Q.value = 6;
    squealGain = c.createGain();
    squealGain.gain.value = 0;
    src.connect(squealFilter).connect(squealGain).connect(master);
    src.start();
    ctx = c;
  }

  function set(p: AudioParam, v: number, tc: number): void {
    p.setTargetAtTime(v, ctx!.currentTime, tc);
  }

  /** one-shot oscillator with exponential decay; optional glide to freqEnd */
  function tone(
    type: OscillatorType,
    f: number,
    at: number,
    dur: number,
    vol: number,
    freqEnd = f,
  ): void {
    const c = ctx!;
    const o = c.createOscillator();
    const g = c.createGain();
    const t = c.currentTime + at;
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur);
  }

  return {
    resume(): void {
      try {
        if (!ctx) init();
        if (ctx && ctx.state === 'suspended') void ctx.resume();
      } catch {
        ctx = null;
      }
    },
    update(car: CarState, drift: DriftInfo, throttle: number): void {
      if (!ctx) return;
      wobble += 0.05;
      const f = (55 + car.rpm * 220) * (1 + Math.sin(wobble) * 0.01);
      set(saw.frequency, f, 0.05);
      set(sq.frequency, f / 2, 0.05);
      set(engFilter.frequency, 900 + car.rpm * 1500, 0.05);
      set(engGain.gain, 0.08 + throttle * 0.12, 0.05);
      const slip = Math.min(Math.abs(drift.slip) / 0.6, 1);
      const speed = Math.min(drift.speedKmh / 60, 1);
      set(squealGain.gain, drift.drifting ? slip * speed * 0.3 : 0, 0.05);
      set(squealFilter.frequency, 2500 + Math.sin(wobble * 3) * 150, 0.03);
    },
    hit(): void {
      if (!ctx) return;
      const c = ctx;
      const src = c.createBufferSource();
      const lp = c.createBiquadFilter();
      const g = c.createGain();
      src.buffer = noise;
      lp.type = 'lowpass';
      lp.frequency.value = 600;
      g.gain.setValueAtTime(0.8, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.2);
      src.connect(lp).connect(g).connect(master);
      src.start(c.currentTime, 0, 0.2);
      tone('sine', 70, 0, 0.2, 0.9);
    },
    bank(): void {
      if (!ctx) return;
      tone('sine', 880, 0, 0.08, 0.5);
      tone('sine', 1320, 0.08, 0.1, 0.5);
    },
    fail(): void {
      if (!ctx) return;
      tone('square', 220, 0, 0.3, 0.15, 110);
    },
    stop(): void {
      if (!ctx) return;
      set(engGain.gain, 0, 0.05);
      set(squealGain.gain, 0, 0.05);
    },
  };
}
