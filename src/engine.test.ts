import { describe, expect, it } from 'vitest';
import { EngineDSP, engineRpm } from './engine';

const SR = 48000;

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

function steady(rpm: number, throttle: number): Float32Array {
  const dsp = new EngineDSP(SR);
  render(dsp, rpm, throttle, 0.4);
  return render(dsp, rpm, throttle, 0.2);
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

  it('pops on lift-off from high rpm', () => {
    const base = peak(steady(6000, 0));
    const dsp = new EngineDSP(SR);
    render(dsp, 6000, 1, 0.5);
    render(dsp, 6000, 0, 0.08); // let the throttle settle
    expect(peak(render(dsp, 6000, 0, 0.42))).toBeGreaterThan(base * 1.5);
  });

  it('maps game rpm to 900..7600', () => {
    expect(engineRpm(0)).toBe(900);
    expect(engineRpm(1)).toBe(7600);
  });
});
