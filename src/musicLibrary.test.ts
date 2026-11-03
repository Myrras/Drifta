import { describe, expect, it } from 'vitest';
import { createShuffleBag, planImport } from './musicLibrary';

const mp3 = (name: string, size: number) => ({ name, size, type: 'audio/mpeg' });

describe('createShuffleBag', () => {
  it('plays every item once per cycle and never repeats across a reshuffle', () => {
    const items = [1, 2, 3, 4];
    const bag = createShuffleBag(items);
    let prev = -1;
    for (let c = 0; c < 200; c++) {
      const cycle = items.map(() => bag.next());
      expect([...cycle].sort()).toEqual(items);
      expect(cycle[0]).not.toBe(prev);
      prev = cycle[cycle.length - 1];
    }
  });
  it('handles a single item', () => {
    const bag = createShuffleBag(['a']);
    expect([bag.next(), bag.next()]).toEqual(['a', 'a']);
  });
});

describe('planImport', () => {
  it('skips non-mp3 and duplicates, accepts .mp3 by name', () => {
    const p = planImport(
      [
        mp3('a.mp3', 1),
        { name: 'b.wav', size: 1, type: 'audio/wav' },
        mp3('c.mp3', 1),
        { name: 'd.MP3', size: 1, type: '' },
      ],
      [{ name: 'c.mp3', size: 1 }],
      0,
    );
    expect(p.accept).toEqual([0, 3]);
    expect(p.skipped).toBe(2);
    expect(p.reason).toBeUndefined();
  });
  it('enforces the cap', () => {
    const p = planImport([mp3('a.mp3', 6), mp3('b.mp3', 5), mp3('c.mp3', 4)], [], 0, 10);
    expect(p.accept).toEqual([0, 2]);
    expect(p.reason).toBe('library full (500 MB)');
  });
  it('dedupes within one batch', () => {
    expect(planImport([mp3('a.mp3', 1), mp3('a.mp3', 1)], [], 0).accept).toEqual([0]);
  });
});
