import { describe, expect, it } from 'vitest';
import type { GameMap } from '../types';
import type { DecoratedMap } from './decor';
import { docks } from './docks';
import { drivethru } from './drivethru';
import { garage } from './garage';
import { mapOption, OPTION_LABEL, withoutPillars } from './options';
import { testpad } from './testpad';
import { tokyo } from './tokyo';

const count = (m: GameMap, kind: string) =>
  m.floors.reduce((n, f) => n + f.solids.filter((s) => s.kind === kind).length, 0);
const decorOf = (m: GameMap) => (m as DecoratedMap).decor ?? [];

describe('mapOption', () => {
  it('maps tokyo to traffic, garage and docks to pillars, the rest to none', () => {
    expect(mapOption(tokyo)).toBe('traffic');
    expect(mapOption(garage)).toBe('pillars');
    expect(mapOption(docks)).toBe('pillars');
    expect(mapOption(drivethru)).toBeNull();
    expect(mapOption(testpad)).toBeNull();
    expect(OPTION_LABEL).toEqual({ traffic: 'TRAFFIC', pillars: 'PILLARS' });
  });
});

describe('withoutPillars', () => {
  for (const map of [garage, docks]) {
    describe(map.name, () => {
      const snapshot = JSON.stringify(map);
      const out = withoutPillars(map);

      it('removes every pillar solid, keeps walls, cars and circles', () => {
        expect(count(map, 'pillar')).toBeGreaterThan(0);
        expect(count(out, 'pillar')).toBe(0);
        expect(count(out, 'wall')).toBe(count(map, 'wall'));
        expect(count(out, 'car')).toBe(count(map, 'car'));
        out.floors.forEach((f, i) => expect(f.circles).toEqual(map.floors[i].circles));
      });

      it('drops decor drawn on removed pillars', () => {
        const pillars = map.floors.flatMap((f, floor) =>
          f.solids
            .filter((s) => s.kind === 'pillar')
            .map((s) => ({ floor, x: s.x + s.w / 2, y: s.y + s.h / 2 })),
        );
        for (const d of decorOf(out)) {
          const at =
            d.kind === 'bollard'
              ? { x: d.x, y: d.y }
              : d.kind === 'hatch'
                ? { x: d.x + d.w / 2, y: d.y + d.h / 2 }
                : null;
          if (!at) continue;
          const hit = pillars.some(
            (p) => p.floor === d.floor && Math.hypot(p.x - at.x, p.y - at.y) < 0.05,
          );
          expect(hit).toBe(false);
        }
        expect(decorOf(out).length).toBeLessThanOrEqual(decorOf(map).length);
      });

      it('keeps everything else identical and does not mutate the original', () => {
        expect(out).not.toBe(map);
        expect(out.name).toBe(map.name);
        expect(out.start).toBe(map.start);
        expect(out.finish).toBe(map.finish);
        expect(out.helixes).toBe(map.helixes);
        out.floors.forEach((f, i) => {
          const o = map.floors[i];
          expect({ ...f, solids: null }).toEqual({ ...o, solids: null });
          expect(f.solids).toEqual(o.solids.filter((s) => s.kind !== 'pillar'));
        });
        expect(JSON.stringify(map)).toBe(snapshot);
      });

      it('returns the cached copy on a second call', () => {
        expect(withoutPillars(map)).toBe(out);
      });
    });
  }

  it('docks: drops the bollards, coils, crane and hatching over pillars, keeps quay-wall bollards', () => {
    const kinds = (m: GameMap, k: string) => decorOf(m).filter((d) => d.kind === k).length;
    const out = withoutPillars(docks);
    expect(kinds(out, 'bollard')).toBe(9);
    expect(kinds(docks, 'bollard')).toBeGreaterThan(9);
    expect(kinds(out, 'coil')).toBe(0);
    expect(kinds(out, 'hatch')).toBe(0);
    expect(kinds(out, 'crane')).toBe(kinds(docks, 'crane') - 1);
    expect(kinds(out, 'container')).toBe(kinds(docks, 'container'));
  });

  it('leaves maps without pillars unchanged in content', () => {
    for (const map of [drivethru, testpad]) {
      expect(count(map, 'pillar')).toBe(0);
      expect(withoutPillars(map)).toEqual(map);
    }
  });
});
