/**
 * Parameterised engine sound: ignition pulses -> exhaust waveguides -> muffler, plus a turbo layer.
 * One EngineProfile per car (see docs/sound-research.md). Pure DSP, no DOM.
 */
import type { PlayerModel } from './types';

const C_SOUND = 550; // m/s, hot exhaust gas: same as real pipe length x 0.62 at 343 m/s
const POP_RPM = 3500;
const TURBO_MIX = 4; // turbo layer level against the exhaust (profile gains are "of engine level")
const WHOOSH = 4; // band-passed noise at the whine pitch, about as loud as the tone
const SURGE_WHINE = 0.3; // whine level while the surge train runs (the recording's whine is ~7 dB under ours)

/**
 * Street surge template, fitted to the reference recording: LPC (48 kHz) of the power each chirp adds over the
 * floor, averaged over its 17 chirps. Frame: [level dB (from the 1 ms band envelope), reflection coefficients].
 * Hiss above 1 kHz (order 16) and the air pulse ("whoomph", 150 Hz-1 kHz, order 8, _LO) are separate fits, so
 * each keeps its own envelope.
 * Chirp: every 12 ms from 20 ms before the hiss peak; the air pulse peaks 16-28 ms after it, 4 dB over the hiss.
 * "s": every 35 ms from 30 ms before its peak, sliding down to the lift whoomph. Floor: the hiss between chirps.
 */
const TU_CHIRP = [
  [
    -28.4, -0.7873, 0.5622, -0.2712, 0.4887, -0.3507, 0.3715, -0.2374, 0.2044, 0.0061, 0.05, 0.2264,
    -0.0189, 0.1762, 0.0919, 0.0481, 0.1568,
  ],
  [
    -25.5, -0.7243, 0.5743, -0.3156, 0.5159, -0.3723, 0.4248, -0.2791, 0.2763, -0.0933, 0.1265,
    0.1744, -0.0474, 0.1918, 0.0248, 0.1099, 0.1411,
  ],
  [
    -24.5, -0.7349, 0.6376, -0.2634, 0.511, -0.3839, 0.3741, -0.2547, 0.2128, -0.057, -0.001,
    0.1382, -0.0722, 0.1674, 0.077, 0.0832, 0.1681,
  ],
  [
    -28.9, -0.6852, 0.6138, -0.2984, 0.4858, -0.4011, 0.3995, -0.2967, 0.3041, -0.0662, 0.1243,
    0.1172, -0.0735, 0.1914, 0.018, 0.1117, 0.1333,
  ],
  [
    -35.2, -0.7796, 0.5157, -0.4535, 0.4155, -0.3167, 0.3399, -0.1206, 0.0557, 0.1499, -0.0003,
    0.1919, 0.0555, 0.1067, 0.1977, 0.0826, 0.1622,
  ],
  [
    -46.4, -0.6648, 0.4879, -0.4911, 0.4253, -0.294, 0.4293, -0.2525, 0.1909, -0.0666, -0.0014,
    0.1457, -0.0698, 0.1596, 0.0409, 0.028, 0.1273,
  ],
];
const TU_S = [
  [
    -20.7, -0.6192, 0.6425, -0.1404, 0.4379, -0.3906, 0.5672, -0.2534, 0.3185, -0.0965, 0.2422,
    -0.0153, -0.0972, 0.2287, 0.0203, 0.1423, 0.0574,
  ],
  [
    -14.9, -0.7029, 0.8939, -0.5577, 0.3783, -0.0554, 0.125, -0.08, 0.2715, 0.2482, -0.2333, 0.1307,
    0.2943, -0.0191, 0.0091, 0.1802, 0.1756,
  ],
  [
    -15.5, -0.7579, 0.5299, -0.2935, 0.5884, -0.3146, 0.4056, -0.266, 0.19, -0.068, 0.0004, 0.1764,
    -0.0263, 0.1863, 0.0722, 0.0506, 0.1352,
  ],
  [
    -15.6, -0.8902, 0.4316, -0.366, 0.4886, -0.1105, 0.1011, 0.1359, 0.0116, 0.1965, 0.1003, 0.1023,
    0.1953, 0.1191, 0.1515, 0.1298, 0.0453,
  ],
  [
    -18.4, -0.7816, 0.4085, -0.4737, 0.6063, -0.2368, 0.3865, -0.1543, 0.082, 0.1154, -0.0189,
    0.2123, 0.0544, 0.0969, 0.1364, 0.0112, 0.1043,
  ],
  [
    -20.8, -0.8969, 0.5553, -0.297, 0.4912, -0.1391, 0.1746, 0.0756, -0.0163, 0.1764, 0.0211,
    0.0737, 0.1291, 0.0517, 0.1418, 0.1069, 0.0611,
  ],
];
const TU_CHIRP_LO = [
  [-28.6, -0.991, -0.2628, 0.093, 0.2358, 0.2685, 0.2581, 0.2325, 0.2014],
  [-28.0, -0.9909, -0.1728, 0.1918, 0.2989, 0.3031, 0.276, 0.24, 0.2013],
  [-25.2, -0.9908, -0.2635, 0.0918, 0.2346, 0.2671, 0.256, 0.2292, 0.1963],
  [-20.5, -0.9899, -0.3459, -0.0226, 0.1463, 0.2135, 0.2286, 0.2209, 0.204],
  [-21.6, -0.9897, -0.3542, -0.036, 0.1344, 0.2054, 0.2235, 0.2179, 0.2023],
  [-35.1, -0.9877, -0.3851, -0.0892, 0.0831, 0.1667, 0.1961, 0.1973, 0.1848],
];
const TU_S_LO = [
  [-120.0, 0, 0, 0, 0, 0, 0, 0, 0],
  [-36.1, -0.9821, 0.1606, 0.4259, 0.4172, 0.3662, 0.3169, 0.2746, 0.2381],
  [-25.6, -0.9902, 0.1316, 0.408, 0.4008, 0.3395, 0.2681, 0.1922, 0.1135],
  [-40.6, -0.9862, 0.0989, 0.3928, 0.4017, 0.3562, 0.3068, 0.2612, 0.2187],
  [-18.6, -0.9881, -0.0418, 0.3027, 0.359, 0.3343, 0.2928, 0.2494, 0.206],
  [-20.6, -0.9906, -0.072, 0.2799, 0.3471, 0.3275, 0.2879, 0.2447, 0.2005],
];
const TU_FLOOR = [
  -28.7, -0.8516, 0.6491, -0.3665, 0.4426, -0.3127, 0.2305, -0.0042, 0.0109, 0.174, -0.0166, 0.1256,
  0.1051, 0.0408, 0.142, 0.0519, 0.0606,
];
const TU_P = 16;
const TU_PL = 8;
/** per-chirp spread in the reference (sd x sqrt 3, uniform): level dB, centre octaves, low / high balance dB */
const TU_SPREAD = [2.8, 0.23, 6.9];
const TU_GAIN = 0.21; // recording level -> turbo layer (TURBO_MIX and the output drive)
const TU_AIR = 1.6; // air pulse over its recorded level: our engine is louder under it than the recording's
const TU_FLUTE = 0.26; // bypass whistle under the chirp hiss: ~14 dB below its peak

export interface TurboProfile {
  /** rpm where boost starts / is full */
  spool: [number, number];
  /** s, spool-up / spool-down time constants */
  tau: [number, number];
  /** whine Hz at spool 0 / 1, whine gain */
  whine: [number, number, number];
  hiss: number;
  /** blow-off valve gain, length ms */
  bov: [number, number];
  /** compressor surge on lift: pulses, Hz, chance per lift */
  flutter: [number, number, number];
  /** street surge: first / last chirp gap ms, hiss centre Hz (template warp: / 4450, the reference rx7), chirps at full boost, weight (air pulse depth) */
  tu: [number, number, number, number, number];
  /** sequential twin: second turbo cuts in at this rpm (tone x1.25), boost dip at changeover */
  seq?: [number, number];
  /** parallel twin: two whines detuned +-3% */
  par?: boolean;
  /** external wastegate: chatter Hz, gain */
  wg?: [number, number];
  /** street tune: no BOV, a compressor surge chirp train ("s-tu-tu-tu") on every lift at boost, no overrun pops over it */
  surge?: boolean;
}

export interface EngineProfile {
  /** per firing over 720 deg, in firing order: timing offset (fraction of a firing period, sums to 0); length / 2 = firings per rev */
  fireDt: number[];
  fireAmp: number[];
  /** Wankel: sharp single-integrator pulse, partial burns and reflux doublets at low rpm */
  rotary?: boolean;
  idle: number;
  limit: number;
  /** hard fuel cut, hard ignition cut (bangs) or staged soft cut; bounce Hz for the hard cuts */
  limiter: 'fuel' | 'ign' | 'soft';
  limHz: number;
  /** cam switch: on rpm, off rpm, step size */
  vtec?: [number, number, number];
  /** real m; firings alternate between the two runners / banks */
  headers: [number, number];
  /** refl, loss Hz */
  header: [number, number];
  /** real m, refl, loss Hz */
  pipe: [number, number, number];
  /** muffler lowpass Hz at idle / wot */
  lp: [number, number];
  body: number;
  /** rasp band Hz, gain */
  rasp: [number, number];
  /** pulse turbulence, 1 = default */
  turb: number;
  /** pulse tau ms at wot / idle */
  tau: [number, number];
  /** intake band Hz lo / hi, gain */
  intake: [number, number, number];
  mech: number;
  /** overrun pops: rate per s, window s, gain */
  pops: [number, number, number];
  turbo?: TurboProfile;
  /** output gain: equal loudness across cars */
  gain: number;
}

/** Tuned street-drift targets from docs/sound-research.md. */
export const ENGINE_PROFILES: Record<PlayerModel, EngineProfile> = {
  mx5: {
    fireDt: [0.02, -0.02, 0.01, -0.01],
    fireAmp: [1, 0.99, 1.01, 1],
    idle: 850,
    limit: 7400,
    limiter: 'fuel',
    limHz: 20,
    headers: [0.5, 0.5],
    header: [-0.45, 3800],
    pipe: [1.5, -0.5, 2000],
    lp: [1000, 3200],
    body: 140,
    rasp: [1900, 1],
    turb: 1,
    tau: [0.35, 0.7],
    intake: [500, 1200, 0.2],
    mech: 0.005,
    pops: [4, 0.3, 0.12],
    gain: 1.23,
  },
  civic: {
    fireDt: [0.02, -0.015, 0.01, -0.015],
    fireAmp: [1.03, 0.97, 1.01, 0.99],
    idle: 800,
    limit: 8400,
    limiter: 'fuel',
    limHz: 22,
    vtec: [5500, 5200, 1],
    headers: [0.65, 0.65],
    header: [-0.5, 4000],
    pipe: [1.6, -0.5, 2200],
    lp: [1100, 3800],
    body: 150,
    rasp: [2200, 1.2],
    turb: 1.3,
    tau: [0.28, 0.65],
    intake: [500, 1500, 0.3],
    mech: 0.03,
    pops: [6, 0.4, 0.15],
    gain: 0.92,
  },
  supra: {
    fireDt: [0.01, -0.01, 0.008, -0.008, 0.01, -0.01],
    fireAmp: [1, 0.98, 1.02, 0.99, 1.01, 0.97],
    idle: 750,
    limit: 7200,
    limiter: 'fuel',
    limHz: 14,
    headers: [0.4, 0.4],
    header: [-0.35, 2800],
    pipe: [2.4, -0.5, 1500],
    lp: [700, 2400],
    body: 90,
    rasp: [1500, 0.7],
    turb: 0.6,
    tau: [0.4, 0.9],
    intake: [300, 1000, 0.18],
    mech: 0.005,
    pops: [10, 0.6, 0.25],
    turbo: {
      spool: [2000, 4200],
      tau: [0.35, 0.9],
      whine: [560, 1900, 0.05],
      hiss: 0.06,
      bov: [0.8, 350],
      flutter: [3, 9, 0.25],
      tu: [175, 100, 3800, 15, 1.25], // sequential twin, big total
      seq: [4000, 0],
    },
    gain: 0.94,
  },
  rx7: {
    fireDt: [0.03, -0.03, 0.03, -0.03],
    fireAmp: [1.1, 0.9, 1.1, 0.9],
    rotary: true,
    idle: 1100,
    limit: 7800,
    limiter: 'ign',
    limHz: 12,
    headers: [0.3, 0.3],
    header: [-0.3, 5000],
    pipe: [1.9, -0.3, 3000],
    lp: [1800, 5000],
    body: 100,
    rasp: [2600, 1.3],
    turb: 1.3,
    tau: [0.18, 0.4],
    intake: [600, 1800, 0.12],
    mech: 0,
    pops: [18, 1, 0.4],
    turbo: {
      spool: [2500, 4500],
      tau: [0.3, 0.7],
      whine: [700, 1950, 0.05],
      hiss: 0.05,
      bov: [0.6, 250],
      flutter: [4, 12, 0.35],
      tu: [155, 88, 4450, 15, 1], // sequential twin, small: the reference
      seq: [4500, 0.15],
    },
    gain: 3.4,
  },
  r32: {
    fireDt: [0.015, -0.01, 0.01, -0.015, 0.01, -0.01],
    fireAmp: [1, 1, 0.97, 1.03, 0.98, 1.02],
    idle: 850,
    limit: 8200,
    limiter: 'fuel',
    limHz: 15,
    headers: [0.4, 0.4],
    header: [-0.4, 3200],
    pipe: [2.2, -0.5, 1800],
    lp: [800, 3000],
    body: 110,
    rasp: [1800, 1.2],
    turb: 1.3,
    tau: [0.35, 0.75],
    intake: [700, 2200, 0.28],
    mech: 0.03,
    pops: [12, 0.7, 0.3],
    turbo: {
      spool: [3000, 4800],
      tau: [0.4, 0.8],
      whine: [600, 2100, 0.05],
      hiss: 0.07,
      bov: [0.9, 400],
      flutter: [4, 10, 0.35],
      tu: [165, 95, 4150, 15, 1.15], // parallel twin
      par: true,
      wg: [18, 0.03],
    },
    gain: 0.94,
  },
  s13: {
    fireDt: [0.025, -0.02, 0.01, -0.015],
    fireAmp: [1.03, 0.97, 1.01, 0.99],
    idle: 850,
    limit: 7600,
    limiter: 'soft',
    limHz: 0,
    headers: [0.35, 0.35],
    header: [-0.45, 3500],
    pipe: [1.8, -0.55, 1800],
    lp: [900, 3200],
    body: 130,
    rasp: [1700, 1],
    turb: 1,
    tau: [0.4, 0.7],
    intake: [500, 1800, 0.22],
    mech: 0.015,
    pops: [14, 0.7, 0.3],
    turbo: {
      spool: [2800, 4300],
      tau: [0.3, 0.7],
      whine: [700, 2300, 0.06],
      hiss: 0.07,
      bov: [0.9, 330],
      flutter: [5, 11, 0.35],
      tu: [135, 80, 5100, 14, 0.85], // small single T25
    },
    gain: 1.11,
  },
  '180sx': {
    fireDt: [-0.02, 0.025, -0.015, 0.01],
    fireAmp: [0.99, 1.01, 0.97, 1.03],
    idle: 850,
    limit: 7600,
    limiter: 'ign',
    limHz: 14,
    headers: [0.35, 0.35],
    header: [-0.4, 3800],
    pipe: [2.2, -0.3, 2800],
    lp: [1200, 4200],
    body: 140,
    rasp: [2000, 1.3],
    turb: 1.2,
    tau: [0.35, 0.65],
    intake: [500, 1800, 0.22],
    mech: 0.015,
    pops: [18, 0.9, 0.38],
    turbo: {
      spool: [3000, 4500],
      tau: [0.35, 0.8],
      whine: [600, 2100, 0.07],
      hiss: 0.08,
      bov: [1, 450],
      flutter: [5, 10, 0.35],
      tu: [170, 98, 3950, 15, 1.2], // big single GT28
      wg: [22, 0.04],
    },
    gain: 1.02,
  },
  ae86: {
    fireDt: [0.015, -0.02, 0.015, -0.01],
    fireAmp: [1, 1, 0.98, 1.02],
    idle: 950,
    limit: 8200,
    limiter: 'fuel',
    limHz: 20,
    headers: [0.6, 0.6],
    header: [-0.5, 4500],
    pipe: [1.5, -0.5, 2400],
    lp: [1300, 4200],
    body: 160,
    rasp: [2400, 1.2],
    turb: 1.2,
    tau: [0.22, 0.5],
    intake: [600, 1500, 0.3],
    mech: 0.03,
    pops: [8, 0.5, 0.2],
    gain: 1.13,
  },
  nsx: {
    fireDt: [0.01, -0.01, 0.01, -0.01, 0.01, -0.01],
    fireAmp: [1.03, 0.97, 1.03, 0.97, 1.03, 0.97],
    idle: 800,
    limit: 8000,
    limiter: 'fuel',
    limHz: 18,
    vtec: [5800, 5500, 0.8],
    headers: [0.39, 0.51],
    header: [-0.4, 3500],
    pipe: [1.7, -0.45, 2000],
    lp: [900, 3200],
    body: 120,
    rasp: [1900, 0.8],
    turb: 0.6,
    tau: [0.32, 0.75],
    intake: [400, 1200, 0.3],
    mech: 0.005,
    pops: [3, 0.3, 0.1],
    gain: 0.92,
  },
  evo4: {
    fireDt: [0.02, -0.02, 0.015, -0.015],
    fireAmp: [1.04, 0.96, 1.02, 0.98],
    idle: 850,
    limit: 7700,
    limiter: 'ign',
    limHz: 13,
    headers: [0.35, 0.35],
    header: [-0.45, 3500],
    pipe: [2, -0.55, 1700],
    lp: [800, 2800],
    body: 130,
    rasp: [1500, 1],
    turb: 1,
    tau: [0.45, 0.8],
    intake: [400, 1400, 0.2],
    mech: 0.015,
    pops: [16, 0.8, 0.35],
    turbo: {
      spool: [3200, 4300],
      tau: [0.35, 0.85],
      whine: [640, 2250, 0.07],
      hiss: 0.09,
      bov: [0.5, 300],
      flutter: [6, 14, 1],
      tu: [140, 82, 4900, 15, 0.9], // small single TD05
    },
    gain: 0.77,
  },
  wrx: {
    fireDt: [0, 0, 0, 0],
    fireAmp: [1, 0.65, 1, 0.65],
    idle: 850,
    limit: 7600,
    limiter: 'fuel',
    limHz: 14,
    headers: [0.55, 0.3],
    header: [-0.45, 3000],
    pipe: [1.9, -0.55, 1600],
    lp: [800, 2800],
    body: 120,
    rasp: [1500, 0.8],
    turb: 1,
    tau: [0.45, 0.85],
    intake: [400, 1400, 0.2],
    mech: 0.015,
    pops: [14, 0.7, 0.32],
    turbo: {
      spool: [3200, 4400],
      tau: [0.35, 0.8],
      whine: [600, 2100, 0.06],
      hiss: 0.07,
      bov: [0.8, 320],
      flutter: [4, 9, 0.35],
      tu: [145, 85, 4700, 14, 0.9], // small single TD05/VF
    },
    gain: 0.86,
  },
};

export type Tune = 'performance' | 'street';

/** Performance = the tuned profile; street turbo cars swap the BOV for surge flutter. NA: same for both. */
export function engineProfile(model: PlayerModel, tune: Tune): EngineProfile {
  const p = ENGINE_PROFILES[model];
  return tune === 'street' && p.turbo ? { ...p, turbo: { ...p.turbo, surge: true } } : p;
}

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Game rpm (0..1) to crank rpm: idle..limiter of the car. */
export function engineRpm(norm: number, p: EngineProfile): number {
  return p.idle + clamp01(norm) * (p.limit - p.idle);
}

/** Levinson step: order i-1 -> i with reflection k, in place (a[0] = 1). */
function lpcStep(a: Float64Array, i: number, k: number): void {
  for (let j = 1; 2 * j <= i; j++) {
    const x = a[j];
    const y = a[i - j];
    a[j] = x + k * y;
    if (2 * j < i) a[i - j] = y + k * x;
  }
  a[i] = k;
}

/**
 * Template frame [dB, k1..kP at 48 kHz] -> reflection coefficients at `sr` with every frequency x `warp`,
 * refit (Levinson) from the warped power spectrum into k[o..o+P). Returns the gain for rand() noise that
 * gives the frame's rms. Constructor only: allocates.
 */
function lpcRefit(
  fr: readonly number[],
  sr: number,
  warp: number,
  k: Float64Array,
  o: number,
): number {
  const P = fr.length - 1;
  const a = new Float64Array(P + 1);
  a[0] = 1;
  for (let i = 1; i <= P; i++) lpcStep(a, i, fr[i]);
  const M = 1024;
  const r = new Float64Array(P + 1);
  for (let q = 0; q <= M && (q * sr) / (2 * M) / warp < 24000; q++) {
    // A at the template frequency heard at bin q (powers of e^-jw by rotation), then cos(m pi q / M) by recurrence
    const w = (Math.PI * q * sr) / M / warp / 48000;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    let c = 1;
    let sn = 0;
    let re = 0;
    let im = 0;
    for (let j = 0; j <= P; j++) {
      re += a[j] * c;
      im -= a[j] * sn;
      const c2 = c * cw - sn * sw;
      sn = sn * cw + c * sw;
      c = c2;
    }
    const s = (q === 0 || q === M ? 0.5 : 1) / (re * re + im * im);
    const c1 = Math.cos((Math.PI * q) / M);
    let cPrev = 1;
    let cm = c1;
    r[0] += s;
    for (let m = 1; m <= P; m++) {
      r[m] += s * cm;
      const next = 2 * c1 * cm - cPrev;
      cPrev = cm;
      cm = next;
    }
  }
  a.fill(0);
  a[0] = 1;
  let e = r[0];
  for (let i = 1; i <= P; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
    k[o + i - 1] = -acc / e;
    lpcStep(a, i, k[o + i - 1]);
    e *= 1 - k[o + i - 1] ** 2;
  }
  return Math.sqrt((3 * e) / r[0]) * 10 ** (fr[0] / 20);
}

/** All-pole lattice, reflection k[o..o+P), state b[0..P). */
function lattice(k: Float64Array, o: number, b: Float64Array, x: number): number {
  const P = b.length;
  let f = x - k[o + P - 1] * b[P - 1];
  for (let i = P - 1; i >= 1; i--) {
    f -= k[o + i - 1] * b[i - 1];
    b[i] = b[i - 1] + k[o + i - 1] * f;
  }
  b[0] = f;
  return f;
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

  /** Called at control rate inside process(): no allocation. */
  set(f: number, q: number): void {
    const w = (2 * Math.PI * Math.min(f, this.sr * 0.45)) / this.sr;
    const cw = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    const a0 = 1 + al;
    if (this.type === 'bp') {
      this.b0 = al / a0;
      this.b1 = 0;
      this.b2 = -al / a0;
    } else {
      const s = this.type === 'lp' ? 1 : -1;
      this.b0 = (1 - s * cw) / 2 / a0;
      this.b1 = (s * (1 - s * cw)) / a0;
      this.b2 = this.b0;
    }
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
  private rpmTarget: number;
  private thrTarget = 0;
  private rpm: number;
  private thr = 0;
  private readonly kRpm: number;
  private readonly kThr: number;
  private readonly k25ms: number;
  private readonly k10ms: number;
  private readonly k150ms: number;
  private readonly kUp: number;
  private readonly kDown: number;
  private readonly perRev: number;

  private seed = 0x1234567;
  private firePhase = 0;
  private fireAt = 1;
  private cyl = 0;
  private readonly s1 = [0, 0]; // per runner/bank: cascaded leaky integrators -> t*exp(-t/tau) pulse
  private readonly s2 = [0, 0];
  private readonly imp = [0, 0];
  private readonly pend: Float32Array; // impulses scheduled a few ms ahead (rotary echoes)
  private pi = 0;
  private envFollow = 0;

  private armed = false;
  private popTime = 0; // seconds of overrun left
  private popEnv = 0;
  private readonly popDecay: number;

  private vtOn = false;
  /** VTEC state 0..1 */
  vt = 0;
  private limPh = 1;

  /** turbo speed 0..1 (boost) */
  spool = 0;
  private stage2 = false;
  private st2 = 0;
  private bovArm = false;
  private liftT = 1;
  private bovT = 1;
  private bovEnv = 0;
  private bovDecay = 0;
  private bovLen = 0;
  private chuffPh = 0;
  private flN = 0;
  private flPh = 0;
  private flHz = 0;
  private flEnv = 0;
  private flAmp = 0;
  private flN0 = 1;
  private readonly kFlAmp: number;
  // street surge: template frames refit for this car and sample rate. Slots: chirp hiss 3 centre variants x 6
  // frames (0-17), "s" hiss (18-23), floor (24), chirp air pulse (25-30), "s" air pulse (31-36).
  private readonly tuK = new Float64Array(37 * TU_P);
  private readonly tuG = new Float64Array(37);
  private readonly tuNow = new Float64Array(TU_P);
  private readonly tuNowLo = new Float64Array(TU_PL);
  private readonly tuB = new Float64Array(TU_P);
  private readonly tuBLo = new Float64Array(TU_PL);
  private readonly tuFb = new Float64Array(TU_P);
  private readonly tuHp: Biquad;
  private readonly tuUmph: number;
  private chT = 1; // s since the "s"/chirp started
  private chEnd = 0; // its length, s
  private chS = false; // "s" (else a chirp)
  private chDt = 0.012; // frame spacing, s
  private chU = 0; // centre variant, -1..1
  private chAmp = 0;
  private chG = 0; // current frame gains, hiss / air pulse
  private chGLo = 0;
  private chLo = 1; // air pulse / hiss balance of this chirp
  private chHi = 1;
  private tuFloor = 0;
  // bypass whistle: own noise seed so the chirps' rand() sequence is untouched
  private flute = TU_FLUTE;
  private readonly fluteBp: Biquad;
  private readonly fluteHz: number;
  private fluteSeed = 0x2545f49;
  private fluteLev = 0; // hiss level of the current frame
  private fluteEnv = 0;
  private flutePh = 0;
  private fluteT = 0;
  private duck = 1; // whine gain, dips during the surge train
  private wPh = 0;
  private w2Ph = 0;
  private fmPh = 0;
  private wgPh = 0;
  private wgEnv = 0;
  /** counters for tests: combustion events, BOV and flutter triggers */
  fires = 0;
  bovs = 0;
  flutters = 0;
  /** street surge chirps */
  chirps = 0;

  private readonly header: [Waveguide, Waveguide];
  private readonly pipe: Waveguide;
  private readonly mufLp: Biquad;
  private readonly mufBody: Biquad;
  private readonly mufRasp: Biquad;
  private readonly intake: Biquad;
  private readonly mech: Biquad;
  private readonly popHp: Biquad;
  private readonly hissBp: Biquad;
  private readonly bovBp: Biquad;
  private readonly flBp: Biquad;
  private readonly whooshBp: Biquad;
  private readonly wgBp: Biquad;
  private dcX = 0;
  private dcY = 0;
  private readonly dcA: number;
  private ctl = 0;

  constructor(
    private readonly sr: number,
    private readonly p: EngineProfile = ENGINE_PROFILES.mx5,
  ) {
    this.rpm = this.rpmTarget = p.idle;
    this.perRev = p.fireAmp.length / 2;
    this.kRpm = 1 - Math.exp(-1 / (0.04 * sr));
    this.kThr = 1 - Math.exp(-1 / (0.025 * sr));
    this.k25ms = Math.exp(-1 / (0.025 * sr));
    this.k10ms = Math.exp(-1 / (0.01 * sr));
    this.kFlAmp = Math.exp(-1 / (0.35 * sr));
    this.k150ms = 1 - Math.exp(-1 / (0.15 * sr));
    this.kUp = 1 - Math.exp(-1 / ((p.turbo?.tau[0] ?? 1) * sr));
    this.kDown = 1 - Math.exp(-1 / ((p.turbo?.tau[1] ?? 1) * sr));
    this.popDecay = Math.exp(-1 / (0.006 * sr));
    this.dcA = Math.exp((-2 * Math.PI * 25) / sr);
    this.pend = new Float32Array(Math.ceil(0.01 * sr));
    this.header = [
      new Waveguide(sr, p.headers[0], p.header[0], p.header[1]),
      new Waveguide(sr, p.headers[1], p.header[0], p.header[1]),
    ];
    this.pipe = new Waveguide(sr, p.pipe[0], p.pipe[1], p.pipe[2]);
    this.mufLp = new Biquad(sr, 'lp', p.lp[0], 0.7);
    this.mufBody = new Biquad(sr, 'bp', p.body, 1.4);
    this.mufRasp = new Biquad(sr, 'bp', p.rasp[0], 2.5);
    this.intake = new Biquad(sr, 'bp', p.intake[0], 1.2);
    this.mech = new Biquad(sr, 'hp', 4500, 0.7);
    this.popHp = new Biquad(sr, 'hp', 700, 0.7);
    this.hissBp = new Biquad(sr, 'bp', 1000, 1.5);
    this.bovBp = new Biquad(sr, 'bp', 4500, 0.7);
    this.flBp = new Biquad(sr, 'bp', 3000, 1.2);
    this.whooshBp = new Biquad(sr, 'bp', 1000, 3);
    this.wgBp = new Biquad(sr, 'bp', 2200, 1.5);
    // street surge: the reference template warped to this turbo (rx7 = 1), heavier turbos get more air pulse
    const t = p.turbo;
    const warp = (t?.tu[2] ?? 4450) / 4450;
    this.tuHp = new Biquad(sr, 'hp', 150 * warp, 0.7); // nothing chirp-synchronous under 150 Hz in the recording
    this.tuUmph = (t?.tu[4] ?? 1) ** 2;
    this.fluteHz = 3500 * warp;
    this.fluteBp = new Biquad(sr, 'bp', this.fluteHz, 6);
    if (t?.surge) {
      const fit = (j: number, fr: readonly number[], w = warp) =>
        (this.tuG[j] = lpcRefit(fr, sr, w, this.tuK, j * TU_P));
      for (let i = 0; i < 6; i++) {
        fit(i, TU_CHIRP[i]);
        fit(6 + i, TU_CHIRP[i], warp * 2 ** -TU_SPREAD[1]);
        fit(12 + i, TU_CHIRP[i], warp * 2 ** TU_SPREAD[1]);
        fit(18 + i, TU_S[i]);
        fit(25 + i, TU_CHIRP_LO[i]);
        fit(31 + i, TU_S_LO[i]);
      }
      fit(24, TU_FLOOR);
    }
  }

  setParams(q: { rpm: number; throttle: number }): void {
    this.rpmTarget = Math.min(Math.max(q.rpm, this.p.idle * 0.5), this.p.limit * 1.02);
    this.thrTarget = clamp01(q.throttle);
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

  private rand01(): number {
    return 0.5 + 0.5 * this.rand();
  }

  private schedule(amp: number, seconds: number): void {
    const len = this.pend.length;
    this.pend[(this.pi + Math.min(len - 1, Math.round(seconds * this.sr))) % len] += amp;
  }

  private popLevel(): number {
    return (this.p.pops[2] / 0.25) * (1.2 + 1.3 * this.rand01());
  }

  process(out: Float32Array): void {
    const sr = this.sr;
    const p = this.p;
    const t = p.turbo;
    const vk = p.vtec ? p.vtec[2] : 0;
    for (let n = 0; n < out.length; n++) {
      this.rpm += this.kRpm * (this.rpmTarget - this.rpm);
      this.thr += this.kThr * (this.thrTarget - this.thr);
      const thr = this.thr;

      // VTEC with hysteresis, 40 ms crossfade
      if (p.vtec) {
        this.vtOn = this.rpm > p.vtec[0] || (this.vtOn && this.rpm > p.vtec[1]);
        this.vt += this.kRpm * ((this.vtOn ? 1 : 0) - this.vt);
      }
      const vt = vk * this.vt;

      // hard limiter: cut/fuel gate at limHz while rpm is pinned (clutch kick or top of a gear)
      let cut = false;
      let bounce = 0;
      if (p.limiter !== 'soft' && this.rpm >= p.limit * 0.99 && thr > 0.3) {
        this.limPh += p.limHz / sr;
        if (this.limPh >= 1) {
          this.limPh -= 1;
          if (p.limiter === 'ign' && this.rand() > 0) this.popEnv = this.popLevel();
        }
        cut = this.limPh < 0.55;
        bounce = 150 * (cut ? this.limPh / 0.55 : (1 - this.limPh) / 0.45);
      } else this.limPh = 1;
      const rpm = this.rpm - bounce;
      const rpmN = clamp01((rpm - p.idle) / (p.limit - p.idle));
      const bright = Math.min(1, 0.65 * thr + 0.35 * rpmN) + 0.25 * vt;

      // turbo: spool follows exhaust energy (throttle x rpm), slow to fall
      let S = this.spool;
      if (t) {
        const tgt = thr * smoothstep(t.spool[0], t.spool[1], rpm) ** 1.3;
        S += (tgt - S) * (tgt > S ? this.kUp : this.kDown);
        if (t.seq) {
          const on = this.stage2 ? rpm > t.seq[0] - 300 && thr > 0.3 : rpm > t.seq[0] && thr > 0.5;
          if (on && !this.stage2) S *= 1 - t.seq[1]; // changeover boost dip
          this.stage2 = on;
          this.st2 += this.k150ms * ((on ? 1 : 0) - this.st2);
        }
        // BOV on a quick lift at boost
        if (thr > 0.5) {
          this.liftT = 0;
          this.bovArm = true;
          if (t.surge) this.flN = 0; // throttle open again: no more surge
        } else this.liftT += 1 / sr;
        if (thr < 0.2 && this.bovArm) {
          this.bovArm = false;
          if (this.liftT < 0.12 && S > 0.35 && t.surge) {
            // street: an "s" burst then half to all of the car's tu[3] chirps, more with more boost
            const b = clamp01((S - 0.35) / 0.65);
            this.flutters++;
            this.flN = this.flN0 = 1 + Math.round(t.tu[3] * (0.47 + 0.53 * b));
            this.flPh = 0; // s to the next chirp
            this.flAmp = 0.6 + 0.4 * S;
          } else if (this.liftT < 0.12 && S > 0.35) {
            this.bovs++;
            this.bovT = 0;
            this.bovEnv = 0.6 * t.bov[0] * S ** 0.7;
            this.bovLen = t.bov[1] / 1000;
            this.bovDecay = Math.exp(-1 / (((this.bovLen - 0.043) / 3) * (0.5 + 0.5 * S) * sr));
            this.chuffPh = 0;
            if (this.rand01() < t.flutter[2]) {
              this.flutters++;
              this.flN = this.flN0 = t.flutter[0];
              this.flHz = t.flutter[1];
              this.flPh = 1;
              this.flAmp = S;
            }
          }
        }
        this.spool = S;
      }

      // control rate: filter coefficients every 16 samples from the smoothed values
      if (this.ctl-- <= 0) {
        this.ctl = 16;
        this.mufLp.set(p.lp[0] + (p.lp[1] - p.lp[0]) * Math.min(bright, 1), 0.8);
        this.intake.set(p.intake[0] + (p.intake[1] - p.intake[0]) * thr * Math.max(rpmN, 0.1), 1.2);
        if (t) {
          const wf = t.whine[0] + (t.whine[1] - t.whine[0]) * S ** 0.8;
          this.hissBp.set(1.5 * wf, 1.5); // same absolute band as before the whine was lowered
          this.whooshBp.set(wf, 3);
          this.bovBp.set(4500 - 2500 * clamp01(this.bovT / this.bovLen), 0.7);
          if (t.surge && this.chT < this.chEnd) this.tuFrame();
        }
      }

      // overrun pops: arm on throttle, open a burst window on lift-off at high rpm
      if (thr > 0.15) this.armed = true;
      else if (thr < 0.1 && this.armed) {
        this.armed = false;
        if (rpm > POP_RPM) this.popTime = p.pops[1] * (0.7 + 0.6 * this.rand01());
      }
      if (this.popTime > 0) this.popTime -= 1 / sr;

      // firing scheduler: n firings per 720 deg, alternating runner / bank
      const fireHz = (rpm / 60) * this.perRev;
      this.firePhase += fireHz / sr;
      this.imp[0] = this.pend[this.pi];
      this.imp[1] = 0;
      this.pend[this.pi] = 0;
      this.pi = (this.pi + 1) % this.pend.length;
      if (this.firePhase >= this.fireAt) {
        this.firePhase -= this.fireAt;
        this.cyl = (this.cyl + 1) % p.fireAmp.length;
        const bank = this.cyl & 1;
        this.fireAt = 1 + p.fireDt[this.cyl] + (p.rotary ? 0.03 : 0.01) * this.rand();
        const soft =
          p.limiter === 'soft' && thr > 0.3 ? clamp01((rpm - (p.limit - 200)) / 200) * 0.75 : 0;
        if (!cut && this.rand01() >= soft) {
          this.fires++;
          let amp =
            (0.25 + 0.75 * thr) * (0.85 + 0.15 * rpmN) * p.fireAmp[this.cyl] * (1 + 0.15 * vt);
          if (p.rotary) {
            amp *= 1 + (0.03 + 0.09 * (1 - rpmN)) * this.rand();
            // brap: partial burns and an overlap reflux doublet at low rpm
            if (this.rand01() < 0.25 * clamp01(1 - (rpm - 900) / 2600) ** 1.5)
              amp *= 0.15 + 0.35 * this.rand01();
            this.schedule(-0.15 * amp, 0.0012);
            const rf = clamp01((4500 - rpm) / 1000);
            if (rf > 0) this.schedule(0.25 * rf * amp, 0.004 + 0.003 * this.rand01());
          } else amp *= 1 + 0.03 * this.rand();
          this.imp[bank] += amp;
        }
        // street surge: pops would mask the chirp train (the recording has none)
        const surging = t?.surge && this.flN > 0;
        if (this.popTime > 0 && rpm > 3000 && !surging && this.rand01() < p.pops[0] / fireHz) {
          this.popEnv = this.popLevel();
          this.imp[bank] += 0.8 * this.popEnv;
        }
      }

      // blowdown pulse, shorter (brighter) under load; rotary: instant attack, single decay
      const tau = (p.tau[1] + (p.tau[0] - p.tau[1]) * thr) * (1 - 0.3 * vt) * 0.001 * sr;
      const d = Math.exp(-1 / tau);
      const turb = p.turb * (0.35 + 0.65 * thr);
      const r = this.rand();
      let hdr = 0;
      let pulseSum = 0;
      for (let b = 0; b < 2; b++) {
        this.s1[b] = this.s1[b] * d + this.imp[b];
        this.s2[b] = this.s2[b] * d + this.s1[b];
        const pulse = p.rotary ? this.s1[b] : (this.s2[b] * Math.E) / tau;
        pulseSum += pulse;
        // combustion turbulence rides on the pulse: the rasp
        hdr += this.header[b].run(pulse * (1 + turb * r));
      }
      this.envFollow += 0.01 * (pulseSum - this.envFollow);

      // exhaust: headers -> mid pipe -> muffler
      const pp = this.pipe.run(hdr);
      const muf =
        this.mufLp.run(pp) +
        0.6 * this.mufBody.run(pp) +
        (0.22 + 0.65 * bright) * p.rasp[1] * (1 + 0.5 * vt) * this.mufRasp.run(pp);

      // intake roar pulsed by the cylinder events, and valvetrain hiss
      const intake =
        this.intake.run(this.rand()) *
        p.intake[2] *
        (1 + 0.6 * vt) *
        thr *
        (0.3 + rpmN) *
        (0.6 + 0.8 * this.envFollow);
      const mech = this.mech.run(this.rand()) * p.mech * (0.2 + rpmN);

      // pop crackle: a noise burst at the tailpipe
      const rc = this.rand();
      const pop = this.popHp.run(rc * rc * rc) * this.popEnv; // cubed noise is spiky: crackle, not hiss
      this.popEnv *= this.popDecay;

      let turbo = 0;
      if (t) turbo = TURBO_MIX * this.turbo(t, S, thr);

      // tailpipe DC blocker, then soft clip
      const x = p.gain * (0.6 * muf + intake + mech + 0.5 * pop) + turbo;
      this.dcY = x - this.dcX + this.dcA * this.dcY;
      this.dcX = x;
      out[n] = Math.tanh(1.2 * this.dcY);
    }
  }

  /** One sample of whine, hiss, BOV, flutter and wastegate. */
  private turbo(t: TurboProfile, S: number, thr: number): number {
    const sr = this.sr;
    if (this.flN > 0 && t.surge) {
      // street surge: "s" burst, 200 ms, then chirps speeding up from tu[0] to tu[1] ms apart, shorter and 8 dB quieter by the end
      this.flPh -= 1 / sr;
      if (this.flPh <= 0) {
        const [g0, g1] = t.tu;
        const k = this.flN0 - this.flN;
        this.flN--;
        const left = this.flN / this.flN0;
        this.flEnv = this.flAmp;
        this.chirps++;
        this.flPh =
          (k ? g1 + (g0 - g1) * Math.exp(-(k - 1) / 2.5) : 200) * 0.001 * (1 + 0.1 * this.rand());
        // the chirp template is the reference's average chirp, ~100 ms apart: stretch it to this gap
        this.chS = !k;
        this.chDt = k ? 0.12 * this.flPh : 0.035;
        this.chEnd = 2 * (k ? this.chDt : 0.012) + 5 * this.chDt;
        this.chT = 0;
        this.chU = k ? this.rand() : 0;
        const tilt = k ? 10 ** ((TU_SPREAD[2] * this.rand()) / 40) : 1;
        this.chLo = this.tuUmph * tilt;
        this.chHi = 1 / tilt;
        this.chAmp =
          this.flAmp *
          (k ? ((0.4 + 0.6 * left) / 0.7) * 10 ** ((TU_SPREAD[0] * this.rand()) / 20) : 1);
        this.tuFrame();
      }
    } else if (this.flN > 0) {
      // flutter: compressor surge pulses, rate falling 25% over the burst
      this.flPh += (this.flHz * (0.75 + (0.25 * this.flN) / this.flN0)) / sr;
      if (this.flPh >= 1) {
        this.flPh -= 1;
        this.flN--;
        this.flEnv = this.flAmp;
      }
    }
    this.flEnv *= this.k25ms;
    if (!t.surge) this.flAmp *= this.kFlAmp;

    // whine: sine + a little 2nd harmonic + band-passed noise (airy spool), 7 Hz wobble, sags in surge
    this.duck += this.kThr * ((t.surge && this.flN > 0 ? SURGE_WHINE : 1) - this.duck);
    this.fmPh = (this.fmPh + 7 / sr) % 1;
    const f =
      (t.whine[0] + (t.whine[1] - t.whine[0]) * S ** 0.8) *
      (1 + 0.01 * Math.sin(2 * Math.PI * this.fmPh)) *
      (1 - 0.12 * this.flEnv);
    const f1 = t.par ? f * 0.97 : f;
    const f2 = t.par ? f * 1.03 : f * 1.25;
    this.wPh = (this.wPh + f1 / sr) % 1;
    this.w2Ph = (this.w2Ph + f2 / sr) % 1;
    const a2 = t.par ? 1 : t.seq ? 0.6 * this.st2 : 0;
    const whine =
      this.duck *
      t.whine[2] *
      S ** 1.5 *
      (0.7 * (tone(this.wPh) + (a2 > 0.001 ? a2 * tone(this.w2Ph) : 0)) +
        WHOOSH * this.whooshBp.run(this.rand()));
    const hiss = this.hissBp.run(this.rand()) * t.hiss * S * thr;

    // blow-off valve: 3 ms attack, 40 ms hold, decay; 120 Hz chuff at the start
    let bov = 0;
    if (this.bovEnv > 1e-4) {
      this.bovT += 1 / sr;
      const att = Math.min(1, this.bovT / 0.003);
      if (this.bovT > 0.043) this.bovEnv *= this.bovDecay;
      this.chuffPh += 120 / sr;
      bov =
        this.bovEnv *
        (att * this.bovBp.run(this.rand()) +
          0.5 * Math.sin(2 * Math.PI * this.chuffPh) * Math.exp(-this.bovT / 0.025));
    }
    const flutter = t.surge ? this.chirp() : this.flBp.run(this.rand()) * this.flEnv * 0.6;

    // external wastegate chatter near full boost
    let wg = 0;
    if (t.wg) {
      if (S > 0.9 && thr > 0.8) {
        this.wgPh += (t.wg[0] * (1 + 0.2 * this.rand())) / sr;
        if (this.wgPh >= 1) {
          this.wgPh -= 1;
          this.wgEnv = 1;
        }
      }
      this.wgEnv *= this.k10ms;
      wg = this.wgBp.run(this.rand()) * this.wgEnv * t.wg[1] * 10 * Math.max(0, S - 0.9);
    }
    return whine + hiss + bov + flutter + wg;
  }

  /** Control rate: the "s"/chirp template frame at chT (k and gain interpolated), one-frame fades at the ends. */
  private tuFrame(): void {
    const lead = this.chS ? 0.012 : this.chDt;
    const q = (this.chT - lead) / this.chDt;
    const i = Math.min(Math.max(Math.floor(q), 0), 4);
    const x = clamp01(q - i);
    const base = this.chS ? 18 : 0;
    const v = (this.chU < 0 ? 6 : 12) - base; // centre variant, chirps only
    const a = this.chS ? 0 : Math.abs(this.chU);
    const K = this.tuK;
    for (let m = 0; m < TU_P; m++) {
      const j0 = (base + i) * TU_P + m;
      const k0 = K[j0] + a * (K[j0 + v * TU_P] - K[j0]);
      const k1 = K[j0 + TU_P] + a * (K[j0 + (v + 1) * TU_P] - K[j0 + TU_P]);
      this.tuNow[m] = k0 + x * (k1 - k0);
    }
    const lo = (this.chS ? 31 : 25) + i; // air pulse: no centre variants
    for (let m = 0; m < TU_PL; m++) {
      const j0 = lo * TU_P + m;
      this.tuNowLo[m] = K[j0] + x * (K[j0 + TU_P] - K[j0]);
    }
    const G = this.tuG;
    const g0 = G[base + i] + a * (G[base + v + i] - G[base + i]);
    const g1 = G[base + i + 1] + a * (G[base + v + i + 1] - G[base + i + 1]);
    const fade = Math.min(1, Math.max(0, q < 0 ? this.chT / lead : (this.chEnd - this.chT) / lead));
    this.chG = fade * this.chHi * (g0 + x * (g1 - g0));
    this.chGLo = fade * TU_AIR * this.chLo * (G[lo] + x * (G[lo + 1] - G[lo]));
    const fr = this.chS ? TU_S : TU_CHIRP;
    const db = fr[i][0] + x * (fr[i + 1][0] - fr[i][0]);
    this.fluteLev = fade * this.chHi * 10 ** (db / 20) * (this.chS ? 0.2 : 1); // quieter under the "s"
  }

  /**
   * One sample of street surge: the "s"/chirp is one noise through the template's two all-pole filters (hiss and
   * air pulse), on the floor hiss; the floor follows the chirp level while the train runs, then fades.
   */
  private chirp(): number {
    let y = 0;
    const on = this.chT < this.chEnd;
    if (on) {
      this.chT += 1 / this.sr;
      const n = this.rand();
      y =
        this.chAmp *
        (this.chG * lattice(this.tuNow, 0, this.tuB, n) +
          this.chGLo * lattice(this.tuNowLo, 0, this.tuBLo, n));
    }
    const tgt = this.flN > 0 ? (this.flAmp * (0.4 + (0.6 * this.flN) / this.flN0)) / 0.7 : 0;
    this.tuFloor += this.kThr * (tgt - this.tuFloor);
    if (this.tuFloor > 1e-4)
      y += this.tuFloor * this.tuG[24] * lattice(this.tuK, 24 * TU_P, this.tuFb, this.rand());
    const fl = this.whistle(on ? this.chAmp * this.fluteLev : 0);
    return (y === 0 ? 0 : TU_GAIN * this.tuHp.run(y)) + fl;
  }

  /**
   * One sample of the bypass whistle: a breathy flute at fluteHz following the chirp hiss level `tgt`, soft
   * attack, slower release. Sine + weak 2nd/3rd harmonics, Q 6 breath noise, 0.4% vibrato plus slow drift.
   */
  private whistle(tgt: number): number {
    const sr = this.sr;
    this.fluteEnv += (tgt - this.fluteEnv) / ((tgt > this.fluteEnv ? 0.008 : 0.035) * sr);
    if (this.fluteEnv < 1e-6) return 0;
    this.fluteT += 1 / sr;
    const ft = 2 * Math.PI * this.fluteT;
    const vib = 1 + 0.004 * Math.sin(5.2 * ft) + 0.004 * Math.sin(0.7 * ft);
    this.flutePh = (this.flutePh + (this.fluteHz * vib) / sr) % 1;
    const w = 2 * Math.PI * this.flutePh;
    let x = this.fluteSeed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.fluteSeed = x >>> 0;
    const breath = this.fluteBp.run(this.fluteSeed / 2147483648 - 1);
    const tone = Math.sin(w) + 0.12 * Math.sin(2 * w) + 0.04 * Math.sin(3 * w);
    return TU_GAIN * this.flute * this.fluteEnv * (tone + 3 * breath);
  }
}

/** Whine waveform: fundamental + 0.15 x 2nd harmonic. */
function tone(ph: number): number {
  const s = Math.sin(2 * Math.PI * ph);
  return s + 0.3 * s * Math.cos(2 * Math.PI * ph);
}
