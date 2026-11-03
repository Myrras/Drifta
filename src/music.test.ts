import { describe, expect, it } from 'vitest';
import {
  PHONK_BPM,
  PHONK_SCALE,
  phonkBassAt,
  phonkCowbellAt,
  phonkDrumsAt,
  phonkPadAt,
  phonkPart,
  TRACKS,
} from './music';

const steps = [...Array(16).keys()];
const bars = [...Array(56).keys()];

describe('phonk patterns', () => {
  const inScale = (n: number) => PHONK_SCALE.includes((((n - 42) % 12) + 12) % 12);
  it('only PHONK and MY MUSIC remain', () => {
    expect(TRACKS).toEqual(['phonk', 'mine']);
  });
  it('is 130 BPM half-time: clap on beat 3 only in a drop', () => {
    expect(PHONK_BPM).toBe(130);
    expect(steps.filter((s) => phonkDrumsAt(4, s, 0).clap)).toEqual([8]);
    expect(phonkDrumsAt(4, 0, 0).kick).toBe(true);
  });
  it('arranges intro, two drops, breakdown, intro reprise and loops every 24 bars', () => {
    expect([0, 4, 12, 20, 24, 28].map(phonkPart)).toEqual([
      'intro',
      'dropA',
      'dropB',
      'break',
      'intro',
      'dropA',
    ]);
    const run = (b: number) =>
      steps.map((s) => [phonkBassAt(b, s), phonkCowbellAt(b, s), phonkDrumsAt(b, s, 1)]);
    expect(run(9)).toEqual(run(33));
    expect(run(4)).not.toEqual(run(12));
  });
  it('keeps every note in F# phrygian', () => {
    for (const b of bars)
      for (const s of steps) {
        const notes = [phonkBassAt(b, s), phonkCowbellAt(b, s), ...phonkPadAt(b)];
        for (const n of notes) if (n !== null) expect(inScale(n)).toBe(true);
      }
  });
  it('intro and breakdown drop the kick; the intro has no 808, the breakdown holds it', () => {
    for (const b of [0, 1, 2, 3, 20, 21])
      expect(steps.some((s) => phonkDrumsAt(b, s, 1).kick)).toBe(false);
    expect(steps.some((s) => phonkBassAt(0, s) !== null)).toBe(false);
    expect(steps.filter((s) => phonkBassAt(20, s) !== null)).toEqual([0]);
  });
  it('808 slides between pitches and hats roll in 1/32', () => {
    const pitches = new Set(
      [4, 5, 6, 7].flatMap((b) => steps.map((s) => phonkBassAt(b, s))).filter((n) => n !== null),
    );
    expect(pitches.size).toBeGreaterThan(3);
    expect(steps.some((s) => phonkDrumsAt(5, s, 0).hat === 2)).toBe(true);
  });
  it('hats get busier with intensity', () => {
    const hats = (i: number) => steps.filter((s) => phonkDrumsAt(6, s, i).hat).length;
    expect(hats(1)).toBeGreaterThan(hats(0));
  });
});
