import { describe, expect, it } from 'vitest';
import { comboString, formatScore, formatTime } from './hud';

describe('hud formatting', () => {
  it('formatTime', () => {
    expect(formatTime(42.375)).toBe('0:42.37');
    expect(formatTime(75)).toBe('1:15.00');
    expect(formatTime(0)).toBe('0:00.00');
  });
  it('formatScore', () => {
    expect(formatScore(12345)).toBe('12,345');
    expect(formatScore(999)).toBe('999');
    expect(formatScore(1234567)).toBe('1,234,567');
  });
  it('comboString', () => {
    expect(comboString([])).toBe('');
    expect(comboString(['DRIFT', 'DRIFT', 'DRIFT'])).toBe('DRIFT ×3');
    expect(comboString(['A', 'B', 'B'])).toBe('A + B ×2');
    expect(comboString(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])).toBe('… + C + D + E + F + G + H');
  });
});
