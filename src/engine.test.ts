import { describe, expect, it } from 'vitest';
import { EngineDSP, ENGINE_PROFILES, engineRpm, type EngineProfile } from './engine';
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
    const rx7 = ENGINE_PROFILES.rx7;
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
    expect(at(ENGINE_PROFILES.civic)).toBeGreaterThan(supra);
  });
});
