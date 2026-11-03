import { describe, expect, it } from 'vitest';
import { glyph, hintLine } from './prompts';

describe('prompts', () => {
  it('glyph by device and style', () => {
    expect(glyph('confirm', 'kb', 'ps')).toBe('ENTER');
    expect(glyph('confirm', 'pad', 'xbox')).toBe('A');
    expect(glyph('confirm', 'pad', 'ps')).toBe('✕');
    expect(glyph('skip', 'pad', 'ps')).toBe('R1');
  });
  it('hintLine joins with " · "', () => {
    expect(
      hintLine(
        [
          ['confirm', 'play'],
          ['back', 'back'],
        ],
        'kb',
        'xbox',
      ),
    ).toBe('ENTER play · ESC back');
  });
});
