import type { CarState, DriftInfo } from './types';

const FILES = { engine: 'engine.ogg', squeal: 'squeal.ogg', hit: 'hit.ogg', bank: 'bank.ogg' };
type Name = keyof typeof FILES;

export function createAudio() {
  let ctx: AudioContext | null = null;
  let master: GainNode;
  let engGain: GainNode;
  let sqGain: GainNode;
  let engSrc: AudioBufferSourceNode | null = null;
  let sqSrc: AudioBufferSourceNode | null = null;
  const bufs: Partial<Record<Name, AudioBuffer>> = {};
  let started = false;

  function loop(buf: AudioBuffer, gain: GainNode): AudioBufferSourceNode {
    const s = ctx!.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.connect(gain);
    s.start();
    return s;
  }

  async function load(name: Name): Promise<void> {
    try {
      const res = await fetch(new URL(`sounds/${FILES[name]}`, document.baseURI));
      if (!res.ok) return;
      const buf = await ctx!.decodeAudioData(await res.arrayBuffer());
      bufs[name] = buf;
      if (name === 'engine') engSrc = loop(buf, engGain);
      if (name === 'squeal') sqSrc = loop(buf, sqGain);
    } catch {
      /* sample stays missing; its method is a no-op */
    }
  }

  function init(): void {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const c = new AC();
    ctx = c;
    master = c.createGain();
    master.gain.value = 0.5;
    master.connect(c.destination);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4000;
    lp.connect(master);
    engGain = c.createGain();
    engGain.gain.value = 0;
    engGain.connect(lp);
    sqGain = c.createGain();
    sqGain.gain.value = 0;
    sqGain.connect(master);
  }

  function set(p: AudioParam, v: number, tc: number): void {
    p.setTargetAtTime(v, ctx!.currentTime, tc);
  }

  function shot(name: Name, vol: number, rate = 1): void {
    const buf = bufs[name];
    if (!ctx || !buf) return;
    try {
      const s = ctx.createBufferSource();
      const g = ctx.createGain();
      s.buffer = buf;
      s.playbackRate.value = rate;
      g.gain.value = vol;
      s.connect(g).connect(master);
      s.start();
    } catch {
      /* ignore */
    }
  }

  return {
    resume(): void {
      try {
        if (!ctx) {
          init();
          if (!ctx) return;
        }
        if (ctx.state === 'suspended') void ctx.resume();
        if (!started) {
          started = true;
          for (const n of Object.keys(FILES) as Name[]) void load(n);
        }
      } catch {
        ctx = null;
      }
    },
    update(car: CarState, drift: DriftInfo, throttle: number): void {
      if (!ctx) return;
      if (engSrc) {
        set(engSrc.playbackRate, 0.7 + car.rpm * 1.3, 0.08);
        set(engGain.gain, 0.15 + throttle * 0.25, 0.05);
      }
      if (sqSrc) {
        const slip = Math.min(Math.abs(drift.slip) / 0.6, 1);
        const speed = Math.min(drift.speedKmh / 60, 1);
        const on = drift.drifting;
        set(sqGain.gain, on ? slip * speed * 0.6 : 0, on ? 0.06 : 0.15);
        set(sqSrc.playbackRate, 0.9 + slip * 0.2, 0.1);
      }
    },
    hit(): void {
      shot('hit', 0.9);
    },
    bank(): void {
      shot('bank', 0.7);
    },
    fail(): void {
      shot('hit', 0.5, 0.6);
    },
    stop(): void {
      if (!ctx) return;
      set(engGain.gain, 0, 0.1);
      set(sqGain.gain, 0, 0.1);
    },
  };
}
