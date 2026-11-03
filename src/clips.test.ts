import { describe, expect, it } from 'vitest';
import { nearestIndex } from './clips';

describe('nearestIndex', () => {
  it('picks the time nearest the target', () => {
    expect(nearestIndex([0, 200, 400, 600], 430)).toBe(2);
    expect(nearestIndex([0, 200], 5000)).toBe(1);
  });
  it('finds the midpoint of a decimated, evenly spread set', () => {
    const times = Array.from({ length: 32 }, (_, i) => 1000 + i * 1600); // long drift
    expect(times[nearestIndex(times, (1000 + 60000) / 2)]).toBe(29800);
  });
  it('returns -1 when empty', () => expect(nearestIndex([], 1)).toBe(-1));
});
