import { describe, expect, it } from 'vitest';
import { nearestIndex } from './clips';

describe('nearestIndex', () => {
  it('picks the time nearest the target', () => {
    expect(nearestIndex([0, 200, 400, 600], 430)).toBe(2);
    expect(nearestIndex([0, 200], 5000)).toBe(1);
  });
  it('returns -1 when empty', () => expect(nearestIndex([], 1)).toBe(-1));
});
