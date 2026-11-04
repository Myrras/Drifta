import { describe, expect, it } from 'vitest';
import { glyph, hintLine } from './prompts';

describe('prompts', () => {
  it('glyph by device and style', () => {
    expect(glyph('confirm', 'kb', 'ps')).toBe('ENTER');
    expect(glyph('confirm', 'pad', 'xbox')).toBe('A');
    expect(glyph('confirm', 'pad', 'ps')).toBe('✕');
    expect(glyph('skip', 'pad', 'ps')).toBe('R1');
  });
  it('tabs and rev glyphs', () => {
    expect(glyph('tabs', 'kb', 'xbox')).toBe('Q/E');
    expect(glyph('tabs', 'pad', 'xbox')).toBe('LB/RB');
    expect(glyph('tabs', 'pad', 'ps')).toBe('L1/R1');
    expect(glyph('rev', 'kb', 'ps')).toBe('R');
    expect(glyph('rev', 'pad', 'xbox')).toBe('RT');
  });
  it('title shortcut glyphs', () => {
    expect(
      (['tabPrev', 'tabNext', 'multiplayer', 'pause'] as const).map((a) => glyph(a, 'kb', 'ps')),
    ).toEqual(['Q', 'E', 'M', 'ESC']);
    expect(glyph('tabPrev', 'pad', 'ps')).toBe('L1');
    expect(glyph('tabNext', 'pad', 'xbox')).toBe('RB');
    expect(glyph('multiplayer', 'pad', 'ps')).toBe('△');
    expect(glyph('multiplayer', 'pad', 'xbox')).toBe('Y');
    expect(glyph('pause', 'pad', 'xbox')).toBe('START');
  });
  it('hintLine shows only the active device', () => {
    const line = hintLine(
      [
        ['tabs', 'tab'],
        ['back', 'back'],
      ],
      'pad',
      'ps',
    );
    expect(line).toBe('L1/R1 tab · ○ back');
    expect(line).not.toContain('Q/E');
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
