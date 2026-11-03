import { describe, expect, it } from 'vitest';
import { smokeColor } from '../cosmetics';
import { defaultProgress } from '../progress';
import { currentIndex, earnHint, equip, ownedLook, slotOptions } from './garage';

const colors = ['#111111', '#222222'];

describe('garage customise', () => {
  it('locks unowned items with how to earn them', () => {
    const p = defaultProgress();
    const paint = slotOptions('paint', 'rx7', colors, p);
    expect(paint.slice(0, 2).every((o) => !o.lock)).toBe(true); // stock colours
    expect(paint.find((o) => o.id === 'harbor-teal')?.lock).toBe('3RD on WANGAN DOCKS');
    expect(paint.find((o) => o.id === 'crane-yellow')?.lock).toBe('2ND on WANGAN DOCKS');
    expect(earnHint('fortune-orange')).toBe('LEGEND challenge');
    expect(slotOptions('skin', 'rx7', colors, p)[1].lock).toBe('LEGEND challenge');
    expect(slotOptions('skin', 'civic', colors, p)).toHaveLength(1);
    expect(slotOptions('hood', 'rx7', colors, p)[1].lock).toBe('daily challenge');
  });

  it('owned items and the cheat unlock', () => {
    const p = defaultProgress();
    p.cosmetics.push('hood-carbon');
    expect(slotOptions('hood', 'rx7', colors, p)[1].lock).toBeUndefined();
    expect(slotOptions('spoiler', 'rx7', colors, p, true).every((o) => !o.lock)).toBe(true);
  });

  it('equip refuses locked options and keeps the look', () => {
    const p = defaultProgress();
    const look = { hood: true };
    expect(
      equip('spoiler', slotOptions('spoiler', 'rx7', colors, p)[1], look, '#111111').look,
    ).toBe(look);
    p.cosmetics.push('spoiler-gt');
    const gt = slotOptions('spoiler', 'rx7', colors, p)[2];
    expect(equip('spoiler', gt, look, '#111111').look).toEqual({ hood: true, spoiler: 'gt' });
  });

  it('stock paint clears the paint and sets the colour; currentIndex finds it', () => {
    const p = defaultProgress();
    p.paints.push('harbor-teal');
    const opts = slotOptions('paint', 'rx7', colors, p);
    const teal = opts.find((o) => o.id === 'harbor-teal')!;
    const a = equip('paint', teal, {}, colors[0]);
    expect(a.look.paint).toBe('harbor-teal');
    expect(currentIndex('paint', opts, a.look, a.color)).toBe(opts.indexOf(teal));
    const b = equip('paint', opts[1], a.look, a.color);
    expect(b).toEqual({ look: {}, color: '#222222' });
    expect(currentIndex('paint', opts, b.look, b.color)).toBe(1);
  });

  it('ownedLook drops items that are not owned; smoke colour follows the look', () => {
    const p = defaultProgress();
    p.cosmetics.push('smoke-pink');
    const look = ownedLook(
      { smoke: 'smoke-pink', underglow: 'underglow-cyan', hood: true },
      'rx7',
      colors,
      p,
    );
    expect(look).toEqual({ smoke: 'smoke-pink' });
    expect(smokeColor(look)).toBe('255,140,210');
  });
});
