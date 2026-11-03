/**
 * Offline listening renders: 16-bit mono 48 kHz WAVs of every turbo car x tune, plus one NA car.
 * Clip: 0.5 s idle, full-throttle rev to 85% over 2.5 s, hold 0.5 s, lift, 2 s lift-off.
 * Usage: npm run render:engine -- <out dir>   (default: ./renders)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EngineDSP, ENGINE_PROFILES, engineProfile, engineRpm, type Tune } from '../src/engine.ts';

const SR = 48000;
const BLOCK = 128;
const dir = process.argv[2] ?? 'renders';
mkdirSync(dir, { recursive: true });

/** rpm (0..1) and throttle at time s */
function drive(s: number): [number, number] {
  if (s < 0.5) return [0, 0];
  if (s < 3) return [(0.85 * (s - 0.5)) / 2.5, 1];
  if (s < 3.5) return [0.85, 1];
  return [0.85 * Math.exp(-(s - 3.5) / 0.8), 0];
}

function wav(x: Float32Array): Buffer {
  const b = Buffer.alloc(44 + 2 * x.length);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + 2 * x.length, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(2 * x.length, 40);
  x.forEach((v, i) => b.writeInt16LE(Math.round(32767 * Math.max(-1, Math.min(1, v))), 44 + 2 * i));
  return b;
}

type Model = keyof typeof ENGINE_PROFILES;
const turbo = (Object.keys(ENGINE_PROFILES) as Model[]).filter((m) => ENGINE_PROFILES[m].turbo);
const jobs: [Model, Tune][] = turbo.flatMap((m): [Model, Tune][] => [
  [m, 'performance'],
  [m, 'street'],
]);
jobs.push(['civic', 'performance']);

for (const [model, tune] of jobs) {
  const p = engineProfile(model, tune);
  const dsp = new EngineDSP(SR, p);
  const out = new Float32Array(SR * 5.5);
  for (let i = 0; i < out.length; i += BLOCK) {
    const [n, throttle] = drive(i / SR);
    dsp.setParams({ rpm: engineRpm(n, p), throttle });
    dsp.process(out.subarray(i, i + BLOCK));
  }
  const file = join(dir, `${model}-${tune}.wav`);
  writeFileSync(file, wav(out));
  const peak = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  console.log(
    `${file}  bov ${dsp.bovs}  flutter ${dsp.flutters}  chirps ${dsp.chirps}  peak ${peak.toFixed(2)}`,
  );
}
