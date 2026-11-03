import type { CarState, DriftInfo, PlayerModel, Solid, Vec } from './types';
import { engineProfile, engineRpm } from './engine';
import engineWorkletUrl from './engineWorklet.ts?worker&url';
import { createMusic, type Track } from './music';
import { listTracks } from './musicLibrary';
import type { Tune } from './settings';

const FILES = { squeal: 'squeal.mp3', hit: 'hit.ogg', bank: 'bank.ogg' };
type Name = keyof typeof FILES;

export type UiSound = 'move' | 'adjust' | 'confirm' | 'back' | 'tab' | 'count' | 'go';
/** menu blips: wave, start Hz, end Hz, seconds, peak gain */
const UI_BLIPS: Record<UiSound, [OscillatorType, number, number, number, number]> = {
  move: ['square', 880, 880, 0.035, 0.05],
  adjust: ['square', 660, 990, 0.045, 0.05],
  confirm: ['square', 660, 1320, 0.1, 0.07],
  back: ['square', 880, 440, 0.09, 0.06],
  tab: ['triangle', 520, 780, 0.06, 0.12],
  count: ['square', 440, 440, 0.12, 0.07],
  go: ['square', 880, 880, 0.45, 0.08],
};

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

export const BOOM_RANGE = 45; // m, silent beyond
const BOOM_NEAR = 4; // m, full level inside
/** Subwoofer level 0..1 at distance d (m): full inside BOOM_NEAR, squared fade to 0 at BOOM_RANGE. */
export function boomGain(d: number): number {
  const t = Math.min(1, Math.max(0, (d - BOOM_NEAR) / (BOOM_RANGE - BOOM_NEAR)));
  return (1 - t) ** 2;
}
/** Centers of the parked boom cars among a floor's solids. */
export function boomCars(solids: Solid[]): Vec[] {
  return solids.filter((s) => s.boom).map((s) => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 }));
}
const BOOM_BAR = 2; // s, kick pattern length
const BOOM_KICKS = [0, 0.75, 1, 1.5]; // kick times within the bar
/** Kick envelope 0..1 at time t, for visuals that follow the bass (decays ~0.15 s after each kick). */
export function boomPulse(t: number): number {
  const ph = ((t % BOOM_BAR) + BOOM_BAR) % BOOM_BAR;
  let m = 0;
  for (const k of BOOM_KICKS) {
    const a = (ph - k + BOOM_BAR) % BOOM_BAR;
    m = Math.max(m, Math.exp(-a / 0.15));
  }
  return m;
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
  let track: Track = 'phonk';
  let vols = { master: 0.8, music: 0.6, sfx: 0.8, engine: 0.8 };
  let tap: MediaStreamAudioDestinationNode | null = null;
  // boom cars: one voice (wobbling lowpass -> level -> pan) per car, one shared kick scheduler
  let boomBus: GainNode | null = null;
  const booms: { kick: GainNode; level: GainNode; pan: StereoPannerNode }[] = [];
  let boomT = 0; // next kick time
  let boomI = 0; // next kick index in the bar

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

  function boomVoice(i: number) {
    const c = ctx!;
    if (!boomBus) {
      const comp = c.createDynamicsCompressor(); // gain ceiling
      comp.threshold.value = -12;
      comp.ratio.value = 12;
      boomBus = c.createGain();
      boomBus.gain.value = 0.6;
      boomBus.connect(comp).connect(sfxBus);
    }
    const kick = c.createGain();
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 140;
    lp.Q.value = 4;
    const lfo = c.createOscillator(); // the wub
    lfo.frequency.value = 2.5 + (i % 3) * 0.7;
    const depth = c.createGain();
    depth.gain.value = 70;
    lfo.connect(depth).connect(lp.frequency);
    lfo.start();
    const level = c.createGain();
    level.gain.value = 0;
    const pan = c.createStereoPanner();
    kick.connect(lp).connect(level).connect(pan).connect(boomBus);
    return (booms[i] = { kick, level, pan });
  }

  /** One 808-style kick (sine 55 -> 40 Hz plus a quiet octave up so small speakers hear it). */
  function boomKick(out: GainNode, t: number): void {
    const env = ctx!.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.9, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    env.connect(out);
    for (const [type, mul, vol] of [
      ['sine', 1, 1],
      ['triangle', 2, 0.3],
    ] as const) {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = type;
      o.frequency.setValueAtTime(55 * mul, t);
      o.frequency.exponentialRampToValueAtTime(40 * mul, t + 0.18);
      g.gain.value = vol;
      o.connect(g).connect(env);
      o.start(t);
      o.stop(t + 0.5);
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
    /** Call every frame of a run with the player and the floor's boom car centers; silent when not called. */
    boom(player: Vec, cars: Vec[]): void {
      if (!ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      const live: GainNode[] = [];
      cars.forEach((c, i) => {
        const g = boomGain(Math.hypot(c.x - player.x, c.y - player.y));
        if (g < 0.01 && !booms[i]) return;
        const v = booms[i] ?? boomVoice(i);
        set(v.level.gain, g * 0.8, 0.05);
        set(v.pan.pan, Math.max(-1, Math.min(1, (c.x - player.x) / 20)) * 0.7, 0.05);
        if (g >= 0.01) live.push(v.kick);
      });
      for (let i = cars.length; i < booms.length; i++) set(booms[i].level.gain, 0, 0.05);
      if (boomT < now - 0.1) [boomT, boomI] = [now + 0.02, 0]; // first call, or back after a pause
      while (boomT < now + 0.12) {
        for (const k of live) boomKick(k, boomT);
        const n = (boomI + 1) % BOOM_KICKS.length;
        boomT += (n ? BOOM_KICKS[n] : BOOM_BAR) - BOOM_KICKS[boomI];
        boomI = n;
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
    /** short synthesized menu blip on the sfx bus */
    ui(kind: UiSound): void {
      if (!ctx) return;
      const [type, from, to, dur, vol] = UI_BLIPS[kind];
      try {
        const t = ctx.currentTime;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(from, t);
        o.frequency.exponentialRampToValueAtTime(to, t + dur);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(vol, t + 0.003);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g).connect(sfxBus);
        o.start(t);
        o.stop(t + dur);
      } catch {
        /* ignore */
      }
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
    /** Skip to the next MY MUSIC song (no-op for other tracks). */
    skipTrack(): void {
      mus?.skip();
    },
    /** Songs in the library as of the last refresh; 0 means show '(empty)'. */
    myMusicCount(): number {
      return mus?.myMusicCount() ?? 0;
    },
    /** Re-read the library after import/clear; resolves to the song count. */
    async refreshMyMusic(): Promise<number> {
      return mus ? mus.reload() : (await listTracks()).length;
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
