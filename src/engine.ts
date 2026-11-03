/** Physically flavoured inline-4 engine sound: ignition pulses -> exhaust waveguides -> muffler. Pure DSP, no DOM. */

const RPM_MIN = 900;
const RPM_MAX = 7600;
const C_SOUND = 343; // m/s
const HEADER_M = 0.45; // header length, sets the first pipe resonance
const PIPE_M = 1.9; // mid pipe length
const HEADER_REFL = -0.45; // open-ish end inverts the reflection
const PIPE_REFL = -0.55;
const CYL_TIMING = [0.025, -0.02, 0.01, -0.015]; // per-cylinder firing offset (fraction of firing period), sums to 0
const CYL_AMP = [1.03, 0.97, 1.01, 0.99];
const POP_RPM = 3500;

/** Game rpm (0..1) to crank rpm. */
export function engineRpm(norm: number): number {
  return RPM_MIN + Math.min(Math.max(norm, 0), 1) * (RPM_MAX - RPM_MIN);
}

/** RBJ biquad, direct form I. */
class Biquad {
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(
    private readonly sr: number,
    private readonly type: 'lp' | 'bp' | 'hp',
    f: number,
    q: number,
  ) {
    this.set(f, q);
  }

  set(f: number, q: number): void {
    const w = (2 * Math.PI * Math.min(f, this.sr * 0.45)) / this.sr;
    const cw = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    const a0 = 1 + al;
    let b0: number, b1: number, b2: number;
    if (this.type === 'lp') [b0, b1, b2] = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2];
    else if (this.type === 'hp') [b0, b1, b2] = [(1 + cw) / 2, -1 - cw, (1 + cw) / 2];
    else [b0, b1, b2] = [al, 0, -al];
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cw) / a0;
    this.a2 = (1 - al) / a0;
  }

  run(x: number): number {
    const y =
      this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Pipe section: y = x + refl * lowpass(y delayed by the round trip). */
class Waveguide {
  private readonly buf: Float32Array;
  private i = 0;
  private lp = 0;
  private readonly a: number;

  constructor(
    sr: number,
    lengthM: number,
    private readonly refl: number,
    lossHz: number,
  ) {
    this.buf = new Float32Array(Math.max(1, Math.round(((2 * lengthM) / C_SOUND) * sr)));
    this.a = 1 - Math.exp((-2 * Math.PI * lossHz) / sr);
  }

  run(x: number): number {
    this.lp += this.a * (this.buf[this.i] - this.lp);
    const y = x + this.refl * this.lp;
    this.buf[this.i] = y;
    this.i = (this.i + 1) % this.buf.length;
    return y;
  }
}

export class EngineDSP {
  private rpmTarget = RPM_MIN;
  private thrTarget = 0;
  private rpm = RPM_MIN;
  private thr = 0;
  private readonly kRpm: number;
  private readonly kThr: number;

  private seed = 0x1234567;
  private firePhase = 0;
  private fireAt = 1;
  private cyl = 0;
  private s1 = 0; // cascaded leaky integrators -> t*exp(-t/tau) pulse
  private s2 = 0;
  private envFollow = 0;

  private armed = false;
  private popTime = 0; // seconds of overrun left
  private popEnv = 0;
  private readonly popDecay: number;

  private readonly header: Waveguide;
  private readonly pipe: Waveguide;
  private readonly mufLp: Biquad;
  private readonly mufBody: Biquad;
  private readonly mufRasp: Biquad;
  private readonly intake: Biquad;
  private readonly mech: Biquad;
  private readonly popHp: Biquad;
  private dcX = 0;
  private dcY = 0;
  private readonly dcA: number;
  private ctl = 0;

  constructor(private readonly sr: number) {
    this.kRpm = 1 - Math.exp(-1 / (0.04 * sr));
    this.kThr = 1 - Math.exp(-1 / (0.025 * sr));
    this.popDecay = Math.exp(-1 / (0.006 * sr));
    this.dcA = Math.exp((-2 * Math.PI * 25) / sr);
    this.header = new Waveguide(sr, HEADER_M, HEADER_REFL, 3500);
    this.pipe = new Waveguide(sr, PIPE_M, PIPE_REFL, 1800);
    this.mufLp = new Biquad(sr, 'lp', 1500, 0.7);
    this.mufBody = new Biquad(sr, 'bp', 140, 1.4);
    this.mufRasp = new Biquad(sr, 'bp', 1700, 2.5);
    this.intake = new Biquad(sr, 'bp', 600, 1.2);
    this.mech = new Biquad(sr, 'hp', 4500, 0.7);
    this.popHp = new Biquad(sr, 'hp', 700, 0.7);
  }

  setParams(p: { rpm: number; throttle: number }): void {
    this.rpmTarget = Math.min(Math.max(p.rpm, RPM_MIN * 0.5), RPM_MAX * 1.1);
    this.thrTarget = Math.min(Math.max(p.throttle, 0), 1);
  }

  /** xorshift32 in [-1, 1); seeded so renders are deterministic. */
  private rand(): number {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 2147483648 - 1;
  }

  process(out: Float32Array): void {
    const sr = this.sr;
    for (let n = 0; n < out.length; n++) {
      this.rpm += this.kRpm * (this.rpmTarget - this.rpm);
      this.thr += this.kThr * (this.thrTarget - this.thr);
      const rpm = this.rpm;
      const thr = this.thr;
      const rpmN = (rpm - RPM_MIN) / (RPM_MAX - RPM_MIN);
      const bright = Math.min(1, 0.65 * thr + 0.35 * Math.max(rpmN, 0));

      // control rate: filter coefficients every 16 samples from the smoothed values
      if (this.ctl-- <= 0) {
        this.ctl = 16;
        this.mufLp.set(900 + 2600 * bright, 0.8);
        this.intake.set(500 + 1800 * thr * Math.max(rpmN, 0.1), 1.2);
      }

      // overrun pops: arm on throttle, fire a burst window on lift-off at high rpm
      if (thr > 0.15) this.armed = true;
      else if (thr < 0.1 && this.armed) {
        this.armed = false;
        if (rpm > POP_RPM) this.popTime = 0.3 + 0.5 * (0.5 + 0.5 * this.rand());
      }
      if (this.popTime > 0) this.popTime -= 1 / sr;

      // 4-stroke inline-4: two firings per crank revolution
      this.firePhase += ((rpm / 60) * 2) / sr;
      let impulse = 0;
      if (this.firePhase >= this.fireAt) {
        this.firePhase -= this.fireAt;
        this.cyl = (this.cyl + 1) & 3;
        this.fireAt = 1 + CYL_TIMING[this.cyl] + 0.01 * this.rand();
        const amp = (0.25 + 0.75 * thr) * (0.85 + 0.15 * rpmN) * CYL_AMP[this.cyl];
        impulse = amp * (1 + 0.03 * this.rand());
        if (this.popTime > 0 && rpm > 3000 && this.rand() > 0.75) {
          this.popEnv = 1.2 + 1.3 * (0.5 + 0.5 * this.rand());
          impulse += 0.8 * this.popEnv;
        }
      }

      // blowdown pulse, shorter (brighter) under load
      const tau = (0.7 - 0.45 * thr) * 0.001 * sr;
      const d = Math.exp(-1 / tau);
      this.s1 = this.s1 * d + impulse;
      this.s2 = this.s2 * d + this.s1;
      const pulse = (this.s2 * Math.E) / tau;
      this.envFollow += 0.01 * (pulse - this.envFollow);

      // combustion turbulence rides on the pulse: the rasp
      const raspy = pulse * (1 + (0.35 + 0.65 * thr) * this.rand());

      // exhaust: header -> mid pipe -> muffler
      const p = this.pipe.run(this.header.run(raspy));
      const muf =
        this.mufLp.run(p) +
        0.6 * this.mufBody.run(p) +
        (0.22 + 0.65 * bright) * this.mufRasp.run(p);

      // intake roar pulsed by the cylinder events, and valvetrain hiss
      const intake =
        this.intake.run(this.rand()) * 0.25 * thr * (0.3 + rpmN) * (0.6 + 0.8 * this.envFollow);
      const mech = this.mech.run(this.rand()) * 0.015 * (0.2 + rpmN);

      // pop crackle: a noise burst at the tailpipe
      const r = this.rand();
      const pop = this.popHp.run(r * r * r) * this.popEnv; // cubed noise is spiky: crackle, not hiss
      this.popEnv *= this.popDecay;

      // tailpipe DC blocker, then soft clip
      const x = 0.6 * muf + intake + mech + 0.5 * pop;
      this.dcY = x - this.dcX + this.dcA * this.dcY;
      this.dcX = x;
      out[n] = Math.tanh(1.2 * this.dcY);
    }
  }
}
