import { describe, expect, it } from 'vitest';
import { EngineDSP, ENGINE_PROFILES, engineProfile, engineRpm, type EngineProfile } from './engine';
import { PLAYER_MODELS } from './models';

const SR = 48000;
const CARS = Object.entries(ENGINE_PROFILES);
const NA = CARS.filter(([, p]) => !p.turbo);

function render(dsp: EngineDSP, rpm: number, throttle: number, seconds: number): Float32Array {
  const out = new Float32Array(Math.round(SR * seconds));
  for (let i = 0; i < out.length; i += 128) {
    dsp.setParams({ rpm, throttle });
    dsp.process(out.subarray(i, i + 128));
  }
  return out;
}

const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

/** Shortest lag whose autocorrelation is within 10% of the max (avoids subharmonic picks). */
function fundamental(x: Float32Array): number {
  const minL = Math.floor(SR / 500);
  const maxL = Math.floor(SR / 20);
  const r: number[] = [];
  for (let L = minL; L <= maxL; L++) {
    let s = 0;
    for (let i = 0; i + L < x.length; i++) s += x[i] * x[i + L];
    r.push(s);
  }
  const max = Math.max(...r);
  for (let k = 1; k < r.length - 1; k++)
    if (r[k] >= 0.9 * max && r[k] >= r[k - 1] && r[k] >= r[k + 1]) return SR / (k + minL);
  return 0;
}

function steady(rpm: number, throttle: number, p?: EngineProfile): Float32Array {
  const dsp = new EngineDSP(SR, p);
  render(dsp, rpm, throttle, 0.4);
  return render(dsp, rpm, throttle, 0.2);
}

/** Combustion events in one second at a steady rpm. */
function firesPerSec(p: EngineProfile, rpm: number, throttle = 0.5): number {
  const dsp = new EngineDSP(SR, p);
  render(dsp, rpm, throttle, 0.5);
  dsp.fires = 0;
  render(dsp, rpm, throttle, 1);
  return dsp.fires;
}

/** Full throttle at `rpm`, then a sharp lift; returns the DSP and the lift-off audio. */
/** power per band over 1024-sample windows, Goertzel on the bins inside [f0, f1) */
function band(x: Float32Array, f0: number, f1: number): number {
  let e = 0;
  for (let w = 0; w + 1024 <= x.length; w += 1024)
    for (let k = Math.ceil((f0 * 1024) / SR); k < (f1 * 1024) / SR; k++) {
      const c = 2 * Math.cos((2 * Math.PI * k) / 1024);
      let s1 = 0;
      let s2 = 0;
      for (let n = 0; n < 1024; n++) {
        const s0 = x[w + n] + c * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      e += s1 * s1 + s2 * s2 - c * s1 * s2;
    }
  return e;
}

function lift(p: EngineProfile, rpm: number, seconds = 0.6) {
  const dsp = new EngineDSP(SR, p);
  render(dsp, rpm, 1, 1.5);
  return { dsp, out: render(dsp, rpm, 0, seconds) };
}

describe('EngineDSP', () => {
  it('outputs finite, non-silent samples within [-1, 1]', () => {
    const x = steady(4000, 0.7);
    expect(x.every(Number.isFinite)).toBe(true);
    expect(peak(x)).toBeLessThanOrEqual(1);
    expect(rms(x)).toBeGreaterThan(0.01);
  });

  it('fires at rpm / 60 * 2 Hz', () => {
    expect(Math.abs(fundamental(steady(3000, 0.5)) - 100)).toBeLessThan(10);
    expect(Math.abs(fundamental(steady(6000, 0.5)) - 200)).toBeLessThan(20);
  });

  it('is louder on throttle', () => {
    expect(rms(steady(4000, 1))).toBeGreaterThan(rms(steady(4000, 0)) * 1.5);
  });

  // MX-5 and NSX are near-silent on overrun by design
  it.each(CARS.filter(([, p]) => p.pops[0] >= 6))('%s pops on lift-off from high rpm', (_, p) => {
    const base = peak(steady(6000, 0, p));
    const dsp = new EngineDSP(SR, p);
    render(dsp, 6000, 1, 0.5);
    render(dsp, 6000, 0, 0.08); // let the throttle settle
    expect(peak(render(dsp, 6000, 0, 0.42))).toBeGreaterThan(base * 1.5);
  });
});

describe('engine profiles', () => {
  it('cover every player car', () => {
    expect(Object.keys(ENGINE_PROFILES).sort()).toEqual(Object.keys(PLAYER_MODELS).sort());
  });

  it.each(CARS)('%s has one timing and amp entry per firing, timing summing to 0', (_, p) => {
    expect(p.fireAmp.length).toBe(p.fireDt.length);
    expect(Math.abs(p.fireDt.reduce((a, b) => a + b, 0))).toBeLessThan(1e-9);
  });

  it('map game rpm to each car idle..limiter', () => {
    for (const [, p] of CARS) {
      expect(engineRpm(0, p)).toBe(p.idle);
      expect(engineRpm(1, p)).toBe(p.limit);
      expect(engineRpm(2, p)).toBe(p.limit);
    }
    expect(engineRpm(1, ENGINE_PROFILES.civic)).toBe(8400);
    expect(engineRpm(0, ENGINE_PROFILES.supra)).toBe(750);
    expect(engineRpm(1, ENGINE_PROFILES.mx5)).toBe(7400);
  });
});

describe('firing scheduler', () => {
  it('fires 2/rev for I4 and rotary, 3/rev for I6 and V6', () => {
    const at6k = (k: keyof typeof ENGINE_PROFILES) => firesPerSec(ENGINE_PROFILES[k], 6000);
    expect(at6k('mx5')).toBeCloseTo(200, -1);
    expect(at6k('wrx')).toBeCloseTo(200, -1);
    expect(at6k('rx7')).toBeCloseTo(200, -1);
    expect(at6k('rx8')).toBeCloseTo(200, -1);
    expect(at6k('celica')).toBeCloseTo(200, -1);
    expect(at6k('supra')).toBeCloseTo(300, -1);
    expect(at6k('nsx')).toBeCloseTo(300, -1);
  });

  it('I6 pitch is 1.5x an I4 at the same rpm', () => {
    const i6 = fundamental(steady(3000, 0.5, ENGINE_PROFILES.supra));
    expect(Math.abs(i6 - 150)).toBeLessThan(15);
  });
});

describe('limiter', () => {
  it.each(CARS)('%s cuts firings when pinned at the limiter (clutch kick)', (_, p) => {
    const free = (engineRpm(1, p) / 60) * (p.fireAmp.length / 2);
    const n = firesPerSec(p, engineRpm(1, p), 1);
    expect(n).toBeLessThan(free * 0.8);
    expect(n).toBeGreaterThan(free * 0.15);
  });

  it('does not cut just below the limiter', () => {
    const p = ENGINE_PROFILES.civic;
    const rpm = p.limit - 400;
    expect(firesPerSec(p, rpm, 1)).toBeCloseTo((rpm / 60) * 2, -1);
  });

  it('ignition cut bangs on the limiter, louder than a fuel cut', () => {
    const atLimit = (p: EngineProfile) => {
      const dsp = new EngineDSP(SR, p);
      render(dsp, p.limit, 1, 0.5);
      return rms(render(dsp, p.limit, 1, 1));
    };
    const rx7 = { ...ENGINE_PROFILES.rx7, turbo: undefined }; // turbo noise would mask the cut
    expect(atLimit(rx7)).toBeGreaterThan(atLimit({ ...rx7, limiter: 'fuel' }) * 1.08);
  });
});

describe('vtec', () => {
  it('switches on above rpmOn with hysteresis, only on cars that have it', () => {
    const dsp = new EngineDSP(SR, ENGINE_PROFILES.civic);
    render(dsp, 5000, 1, 0.3);
    expect(dsp.vt).toBeLessThan(0.01);
    render(dsp, 6000, 1, 0.3);
    expect(dsp.vt).toBeGreaterThan(0.99);
    render(dsp, 5300, 1, 0.3); // between rpmOff and rpmOn: stays on
    expect(dsp.vt).toBeGreaterThan(0.99);
    render(dsp, 5000, 1, 0.3);
    expect(dsp.vt).toBeLessThan(0.01);
    const ae = new EngineDSP(SR, ENGINE_PROFILES.ae86);
    render(ae, 7000, 1, 0.3);
    expect(ae.vt).toBe(0);
  });
});

describe('turbo', () => {
  it.each(NA)('%s has no turbo layer', (_, p) => {
    const { dsp } = lift(p, 6000);
    expect(dsp.spool).toBe(0);
    expect(dsp.bovs).toBe(0);
    expect(dsp.flutters).toBe(0);
  });

  it('spools up on throttle at high rpm, not off throttle or at low rpm', () => {
    const p = ENGINE_PROFILES.supra;
    const dsp = new EngineDSP(SR, p);
    render(dsp, 1500, 1, 1.5);
    expect(dsp.spool).toBeLessThan(0.05);
    render(dsp, 6000, 0, 1.5);
    expect(dsp.spool).toBeLessThan(0.05);
    render(dsp, 6000, 1, 1.5);
    expect(dsp.spool).toBeGreaterThan(0.9);
  });

  it('turbo cars blow off on a lift at boost', () => {
    for (const [, p] of CARS.filter(([, q]) => q.turbo)) expect(lift(p, 6000).dsp.bovs).toBe(1);
  });

  it('no BOV below boost or without a lift', () => {
    const p = ENGINE_PROFILES.supra;
    expect(lift(p, 1800).dsp.bovs).toBe(0); // below spool rpm
    const dsp = new EngineDSP(SR, p);
    render(dsp, 6000, 1, 1.5);
    render(dsp, 6000, 0.6, 0.5); // partial lift stays above the trigger
    expect(dsp.bovs).toBe(0);
  });

  it('Evo flutters on every lift at boost, not below boost', () => {
    expect(lift(ENGINE_PROFILES.evo4, 6000).dsp.flutters).toBe(1);
    expect(lift(ENGINE_PROFILES.evo4, 2500).dsp.flutters).toBe(0);
  });

  it('BOV is louder than an NA lift-off', () => {
    const turbo = rms(lift(ENGINE_PROFILES.supra, 6000, 0.3).out);
    const na = rms(lift({ ...ENGINE_PROFILES.supra, turbo: undefined }, 6000, 0.3).out);
    expect(turbo).toBeGreaterThan(na * 1.3);
  });
});

describe('all cars', () => {
  it.each(CARS)('%s output is finite, in [-1, 1] and in a loudness band', (_, p) => {
    for (const [n, thr] of [
      [0, 0],
      [0.6, 0.7],
      [0.8, 1],
      [1, 1],
    ]) {
      const x = steady(engineRpm(n, p), thr, p);
      expect(x.every(Number.isFinite)).toBe(true);
      expect(peak(x)).toBeLessThanOrEqual(1);
      if (n > 0) {
        expect(rms(x)).toBeGreaterThan(0.12);
        expect(rms(x)).toBeLessThan(0.5);
      } else expect(rms(x)).toBeGreaterThan(0.02);
    }
    expect(lift(p, engineRpm(0.8, p)).out.every(Number.isFinite)).toBe(true);
  });
});

/** Share of spectral energy above 1 kHz (naive DFT over 2048 samples, 3 windows averaged). */
function highShare(x: Float32Array): number {
  const N = 2048;
  let hi = 0;
  let all = 0;
  for (let w = 0; w < 3; w++) {
    for (let k = 1; k < N / 2; k++) {
      let re = 0;
      let im = 0;
      for (let n = 0; n < N; n++) {
        const a = (2 * Math.PI * k * n) / N;
        re += x[w * N + n] * Math.cos(a);
        im -= x[w * N + n] * Math.sin(a);
      }
      const e = re * re + im * im;
      all += e;
      if ((k * SR) / N > 1000) hi += e;
    }
  }
  return hi / all;
}

describe('rasp', () => {
  it('has a lower >1 kHz energy share at full throttle', () => {
    const share = highShare(steady(5000, 1).subarray(0, 6144));
    // old fixed inline-4 before the rasp reduction: 0.151; MX-5 profile: ~0.14
    expect(share).toBeLessThan(0.145);
  });

  it('rotary and Civic are brighter than the Supra', () => {
    const at = (p: EngineProfile) => highShare(steady(5000, 1, p).subarray(0, 6144));
    const supra = at({ ...ENGINE_PROFILES.supra, turbo: undefined });
    expect(at({ ...ENGINE_PROFILES.rx7, turbo: undefined })).toBeGreaterThan(supra);
    expect(at(ENGINE_PROFILES.rx8)).toBeGreaterThan(supra);
    expect(at(ENGINE_PROFILES.civic)).toBeGreaterThan(supra);
  });
});

describe('rx8 and celica', () => {
  it('RX-8: NA rotary to 9000, no turbo layer', () => {
    const p = ENGINE_PROFILES.rx8;
    expect(p.rotary).toBe(true);
    expect(p.turbo).toBeUndefined();
    expect(engineRpm(1, p)).toBe(9000);
    expect(engineProfile('rx8', 'street')).toBe(p);
  });

  // side exhaust ports: few partial burns and no reflux doublets, so idle firings stay even
  it('RX-8 idles smoother than the RX-7 brap', () => {
    const spread = (p: EngineProfile) => {
      const x = steady(1100, 0, { ...p, turbo: undefined });
      const n = Math.round((SR * 60) / 1100 / 2); // one firing
      const w = [];
      for (let i = 0; i + n <= x.length; i += n) w.push(rms(x.subarray(i, i + n)));
      const m = w.reduce((a, b) => a + b, 0) / w.length;
      return Math.sqrt(w.reduce((s, v) => s + (v - m) ** 2, 0) / w.length) / m;
    };
    const rx7 = ENGINE_PROFILES.rx7;
    expect(spread({ ...rx7, brap: ENGINE_PROFILES.rx8.brap })).toBeLessThan(spread(rx7) * 0.5);
  });

  it('Celica: single turbo sized between the S13 T25 and the 180SX GT28, redline 7000', () => {
    const t = (m: 's13' | 'celica' | '180sx') => ENGINE_PROFILES[m].turbo!;
    const c = t('celica');
    expect(c.seq ?? c.par).toBeUndefined();
    for (const i of [0, 1, 4]) {
      expect(c.tu[i]).toBeGreaterThan(t('s13').tu[i]);
      expect(c.tu[i]).toBeLessThan(t('180sx').tu[i]);
    }
    expect(c.tu[2]).toBeLessThan(t('s13').tu[2]);
    expect(c.tu[2]).toBeGreaterThan(t('180sx').tu[2]);
    expect(engineRpm(1, ENGINE_PROFILES.celica)).toBeGreaterThanOrEqual(7000);
  });
});

describe('tunes', () => {
  const MODELS = Object.keys(PLAYER_MODELS) as (keyof typeof ENGINE_PROFILES)[];
  const TURBO = MODELS.filter((m) => ENGINE_PROFILES[m].turbo);

  it('engineProfile covers every model for both tunes', () => {
    for (const m of MODELS) {
      expect(engineProfile(m, 'performance')).toBe(ENGINE_PROFILES[m]);
      const street = engineProfile(m, 'street');
      expect(street.turbo?.surge).toBe(ENGINE_PROFILES[m].turbo ? true : undefined);
    }
  });

  it('NA cars sound the same on both tunes', () => {
    for (const m of MODELS.filter((k) => !ENGINE_PROFILES[k].turbo))
      expect(engineProfile(m, 'street')).toBe(engineProfile(m, 'performance'));
  });

  // "s" burst, ~200 ms, then the car's chirps going from tu[0] to tu[1] ms apart (reference: 155 -> ~85)
  it.each(TURBO)('%s street: lift at boost gives an "s" then its own chirp train, no BOV', (m) => {
    const [g0, g1, , n] = ENGINE_PROFILES[m].turbo!.tu;
    const dsp = new EngineDSP(SR, engineProfile(m, 'street'));
    render(dsp, 6000, 1, 1.5);
    const at: number[] = []; // ms after the lift
    for (let i = 0; i < 250; i++) {
      const c = dsp.chirps;
      render(dsp, 6000, 0, 0.01);
      if (dsp.chirps > c) at.push(i * 10);
    }
    const gaps = at.slice(1).map((t, i) => t - at[i]);
    expect(at.length).toBeGreaterThanOrEqual(n);
    expect(at.length).toBeLessThanOrEqual(n + 2);
    expect(gaps[0]).toBeGreaterThanOrEqual(170);
    expect(gaps[0]).toBeLessThanOrEqual(230);
    expect(gaps[1]).toBeGreaterThanOrEqual(g0 * 0.85 - 10);
    expect(gaps[1]).toBeLessThanOrEqual(g0 * 1.15 + 10);
    const last = gaps.slice(-3).reduce((a, b) => a + b, 0) / 3;
    expect(last).toBeGreaterThanOrEqual(g1 * 0.85);
    expect(last).toBeLessThanOrEqual(g1 * 1.15 + 10);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(60); // never a 25 Hz burble
    expect(dsp.flutters).toBe(1);
    expect(dsp.bovs).toBe(0);
  });

  it('each turbo car has its own surge, inside the reference band, slower and lower on big turbos', () => {
    const tu = (m: (typeof TURBO)[number]) => ENGINE_PROFILES[m].turbo!.tu;
    expect(new Set(TURBO.map((m) => String(tu(m)))).size).toBe(TURBO.length);
    for (const m of TURBO) {
      const [g0, g1, wf, n] = tu(m);
      expect(1000 / g0).toBeGreaterThan(5);
      expect(1000 / g1).toBeGreaterThanOrEqual(8);
      expect(1000 / g1).toBeLessThanOrEqual(13);
      expect(wf).toBeGreaterThanOrEqual(3500);
      expect(wf).toBeLessThanOrEqual(5500);
      expect(n).toBeGreaterThanOrEqual(12);
      expect(n).toBeLessThanOrEqual(20);
    }
    for (const big of ['supra', '180sx', 'r32'] as const)
      for (const small of ['s13', 'evo4', 'wrx'] as const) {
        expect(tu(big)[0]).toBeGreaterThan(tu(small)[0]);
        expect(tu(big)[2]).toBeLessThan(tu(small)[2]);
        expect(tu(big)[4]).toBeGreaterThan(tu(small)[4]);
      }
  });

  // the template's air pulse carries more power than the hiss (recording: ~4 dB at its peak)
  it('street surge has the air pulse under the hiss, lower and heavier on big turbos', () => {
    const at = (m: (typeof TURBO)[number]) => {
      const { out } = lift({ ...engineProfile(m, 'street'), gain: 0 }, 6000, 1.2); // turbo layer only
      expect(out.every(Number.isFinite)).toBe(true);
      const air = band(out, 150, 800);
      return {
        air: air / band(out, 3000, 8000),
        low: band(out, 1000, 3000) / band(out, 5000, 10000),
      };
    };
    const [supra, rx7, s13] = [at('supra'), at('rx7'), at('s13')];
    expect(rx7.air).toBeGreaterThan(1);
    expect(supra.air).toBeGreaterThan(rx7.air);
    expect(rx7.air).toBeGreaterThan(s13.air);
    expect(supra.low).toBeGreaterThan(rx7.low); // hiss centre lower
    expect(rx7.low).toBeGreaterThan(s13.low);
  });

  // bypass whistle: a narrow tone at 3500 Hz x the car's warp, street surge only
  it('street surge whistles through the bypass, performance and NA do not', () => {
    const run = (p: EngineProfile, flute: boolean) => {
      const dsp = new EngineDSP(SR, p);
      if (!flute) (dsp as unknown as { flute: number }).flute = 0;
      render(dsp, 6000, 1, 1.5);
      return render(dsp, 6000, 0, 1.2);
    };
    for (const m of TURBO) {
      const p = { ...engineProfile(m, 'street'), gain: 0 }; // turbo layer only
      const f = (3500 * p.turbo!.tu[2]) / 4450;
      const [on, off] = [run(p, true), run(p, false)];
      const gain = (f0: number, f1: number) => band(on, f0, f1) / band(off, f0, f1);
      expect(gain(0.99 * f, 1.01 * f)).toBeGreaterThan(1.4); // subtle: ~14 dB under the hiss peak
      expect(gain(0.65 * f, 0.75 * f)).toBeLessThan(1.02); // narrow, nothing off its pitch
      expect(run(ENGINE_PROFILES[m], true)).toEqual(run(ENGINE_PROFILES[m], false));
    }
    for (const [, p] of NA) expect(run(p, true)).toEqual(run(p, false));
  }, 30000);

  it('street surge stops when the throttle opens again', () => {
    const { dsp } = lift(engineProfile('s13', 'street'), 6000, 0.5);
    render(dsp, 6000, 1, 0.05); // smoothed throttle passes 0.5
    const n = dsp.chirps;
    render(dsp, 6000, 1, 1);
    expect(n).toBeLessThan(10);
    expect(dsp.chirps).toBe(n);
  });

  it('street surge mutes overrun pops', () => {
    const p = engineProfile('180sx', 'street');
    expect(lift(p, 6000, 1).out).toEqual(lift({ ...p, pops: [0, 0, 0] }, 6000, 1).out);
    const perf = ENGINE_PROFILES['180sx'];
    expect(lift(perf, 6000, 1).out).not.toEqual(lift({ ...perf, pops: [0, 0, 0] }, 6000, 1).out);
  });

  // a NaN from the surge filters reaches the master bus and mutes every sound
  it.each(TURBO)('%s street: lift-off stays finite at 44.1, 48 and 96 kHz', (m) => {
    for (const sr of [44100, 48000, 96000]) {
      const dsp = new EngineDSP(sr, engineProfile(m, 'street'));
      const out = new Float32Array(Math.round(sr * 2.5));
      for (let i = 0; i < out.length; i += 128) {
        dsp.setParams({ rpm: 6000, throttle: i < sr ? 1 : 0 });
        dsp.process(out.subarray(i, i + 128));
      }
      expect(dsp.chirps).toBeGreaterThan(0);
      expect(out.every(Number.isFinite)).toBe(true);
      expect(peak(out)).toBeLessThanOrEqual(1);
    }
  });

  it('performance turbo cars still blow off', () => {
    for (const m of TURBO) {
      const { dsp } = lift(engineProfile(m, 'performance'), 6000);
      expect(dsp.bovs).toBe(1);
      expect(dsp.chirps).toBe(0);
    }
  });

  it('whine fundamental at full spool stays below 2.5 kHz (incl. second stage)', () => {
    for (const m of TURBO) {
      const t = ENGINE_PROFILES[m].turbo!;
      expect(t.whine[1] * (t.seq ? 1.25 : t.par ? 1.03 : 1)).toBeLessThan(2500);
    }
  });
});
