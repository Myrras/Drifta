import type { CarState, DriftInfo, PlayerModel } from './types';
import { engineProfile, engineRpm } from './engine';
import engineWorkletUrl from './engineWorklet.ts?worker&url';
import { createMusic, type Track } from './music';
import type { Tune } from './settings';

const FILES = { squeal: 'squeal.mp3', hit: 'hit.ogg', bank: 'bank.ogg' };
type Name = keyof typeof FILES;

/** Loop window [startSec, endSec] of `seconds` with high, steady RMS (50 ms blocks). */
export function pickLoopWindow(
  samples: Float32Array,
  sampleRate: number,
  seconds: number,
): [number, number] {
  const blk = Math.max(1, Math.floor(sampleRate * 0.05));
  const rms: number[] = [];
  for (let i = 0; i + blk <= samples.length; i += blk) {
    let s = 0;
    for (let j = i; j < i + blk; j++) s += samples[j] * samples[j];
    rms.push(Math.sqrt(s / blk));
  }
  const w = Math.max(1, Math.round(seconds / 0.05));
  if (rms.length <= w) return [0, samples.length / sampleRate];
  let best = 0;
  let bestScore = -Infinity;
  for (let a = 0; a + w <= rms.length; a++) {
    let m = 0;
    for (let k = a; k < a + w; k++) m += rms[k];
    m /= w;
    let v = 0;
    for (let k = a; k < a + w; k++) v += (rms[k] - m) ** 2;
    const score = m - Math.sqrt(v / w);
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return [(best * blk) / sampleRate, ((best + w) * blk) / sampleRate];
}

export function createAudio() {
  let ctx: AudioContext | null = null;
  let master: GainNode;
  let engGain: GainNode;
  let sqGain: GainNode;
  let engNode: AudioWorkletNode | null = null;
  let lastPost = -1;
  let engKey = ''; // model+tune whose profile the worklet has
  let sqSrc: AudioBufferSourceNode | null = null;
  const bufs: Partial<Record<Name, AudioBuffer>> = {};
  let started = false;
  let musicBus: GainNode;
  let sfxBus: GainNode;
  let engBus: GainNode;
  let mus: ReturnType<typeof createMusic> | null = null;
  let musicOn = false;
  let intensity = 0.15;
  let track: Track = 'tokyo';
  let vols = { master: 0.8, music: 0.6, sfx: 0.8, engine: 0.8 };
  let tap: MediaStreamAudioDestinationNode | null = null;

  function applyVolumes(): void {
    if (!ctx) return;
    master.gain.value = vols.master;
    musicBus.gain.value = vols.music;
    sfxBus.gain.value = vols.sfx;
    engBus.gain.value = vols.engine;
  }

  function loop(buf: AudioBuffer, gain: GainNode, win?: [number, number]): AudioBufferSourceNode {
    const s = ctx!.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    let from = 0;
    if (win) {
      [s.loopStart, s.loopEnd] = win;
      from = win[0];
    }
    s.connect(gain);
    s.start(0, from);
    return s;
  }

  async function load(name: Name): Promise<void> {
    try {
      const res = await fetch(new URL(`sounds/${FILES[name]}`, document.baseURI));
      if (!res.ok) return;
      const buf = await ctx!.decodeAudioData(await res.arrayBuffer());
      bufs[name] = buf;
      if (name === 'squeal')
        sqSrc = loop(buf, sqGain, pickLoopWindow(buf.getChannelData(0), buf.sampleRate, 2));
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
    master.gain.value = vols.master;
    master.connect(c.destination);
    engGain = c.createGain();
    engGain.gain.value = 0;
    engBus = c.createGain();
    engBus.connect(master);
    engGain.connect(engBus);
    sfxBus = c.createGain();
    sfxBus.connect(master);
    musicBus = c.createGain();
    musicBus.connect(master);
    mus = createMusic(c, musicBus);
    mus.setTrack(track);
    mus.setIntensity(intensity);
    applyVolumes();
    sqGain = c.createGain();
    sqGain.gain.value = 0;
    sqGain.connect(sfxBus);
  }

  async function startEngine(): Promise<void> {
    try {
      if (!ctx?.audioWorklet) return; // no worklet support: engine stays silent
      await ctx.audioWorklet.addModule(engineWorkletUrl);
      engNode = new AudioWorkletNode(ctx, 'engine', { numberOfInputs: 0, outputChannelCount: [1] });
      engNode.connect(engGain);
    } catch {
      engNode = null;
    }
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
      s.connect(g).connect(sfxBus);
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
          if (musicOn) mus?.start();
          void startEngine();
          for (const n of Object.keys(FILES) as Name[]) void load(n);
        }
      } catch {
        ctx = null;
      }
    },
    update(
      car: CarState,
      drift: DriftInfo,
      throttle: number,
      model: PlayerModel,
      tune: Tune,
    ): void {
      if (!ctx) return;
      if (engNode && ctx.currentTime - lastPost >= 1 / 60) {
        lastPost = ctx.currentTime;
        const prof = engineProfile(model, tune);
        if (`${model}/${tune}` !== engKey) {
          engKey = `${model}/${tune}`;
          engNode.port.postMessage({ profile: prof });
        }
        engNode.port.postMessage({ rpm: engineRpm(car.rpm, prof), throttle });
        set(engGain.gain, 0.35, 0.05);
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
      mus?.fill();
    },
    fail(): void {
      shot('hit', 0.5, 0.6);
      mus?.drop();
    },
    music(on: boolean): void {
      musicOn = on;
      if (on) mus?.start();
      else mus?.stop();
    },
    setIntensity(x: number): void {
      intensity = x;
      mus?.setIntensity(x);
    },
    setTrack(t: Track): void {
      track = t;
      mus?.setTrack(t);
    },
    setVolumes(v: typeof vols): void {
      vols = { ...v };
      applyVolumes();
    },
    stop(): void {
      if (!ctx) return;
      set(engGain.gain, 0, 0.1);
      set(sqGain.gain, 0, 0.1);
    },
    /** master mix as a MediaStream for clip recording; null before the context exists */
    stream(): MediaStream | null {
      if (!ctx) return null;
      try {
        if (!tap) {
          tap = ctx.createMediaStreamDestination();
          master.connect(tap);
        }
        return tap.stream;
      } catch {
        return null;
      }
    },
  };
}
