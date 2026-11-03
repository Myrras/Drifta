import type { GameMap, Solid, Vec } from '../types';
import type { Decor, DecoratedMap } from './decor';
import { docks } from './docks';
import { garage } from './garage';
import { tokyo } from './tokyo';

export type MapOption = 'traffic' | 'pillars';
export const OPTION_LABEL: Record<MapOption, string> = { traffic: 'TRAFFIC', pillars: 'PILLARS' };

const OPTIONS: Record<string, MapOption> = {
  [tokyo.name]: 'traffic',
  [garage.name]: 'pillars',
  [docks.name]: 'pillars',
};

/** The toggleable option a map offers, keyed by map name; null = none. */
export function mapOption(map: GameMap): MapOption | null {
  return OPTIONS[map.name] ?? null;
}

const center = (s: Solid): Vec => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 });
const near = (a: Vec, b: Vec, d: number) => Math.hypot(a.x - b.x, a.y - b.y) < d;

/** Decor drawn on or around a pillar centered at c (docks: bollards, rope coils, crane legs, keep-clear hatching). */
function onPillar(d: Decor, cs: Vec[]): boolean {
  const hit = (p: Vec, r: number) => cs.some((c) => near(p, c, r));
  switch (d.kind) {
    case 'bollard':
      return hit(d, 0.05);
    case 'coil':
      return hit(d, 1.5);
    case 'hatch':
      return hit({ x: d.x + d.w / 2, y: d.y + d.h / 2 }, 0.05);
    case 'crane': {
      const [c, s] = [Math.cos(d.angle), Math.sin(d.angle)];
      return [-d.len / 2, d.len / 2].some((lx) =>
        [-d.span / 2, d.span / 2].some((ly) =>
          hit({ x: d.x + lx * c - ly * s, y: d.y + lx * s + ly * c }, 0.5),
        ),
      );
    }
    default:
      return false;
  }
}

const pillarFree = new WeakMap<GameMap, GameMap>();

/** Copy of the map with every pillar solid and the decor drawn on those pillars removed; cached per map. */
export function withoutPillars(map: GameMap): GameMap {
  const hit = pillarFree.get(map);
  if (hit) return hit;
  const removed = map.floors.map((f) => f.solids.filter((s) => s.kind === 'pillar').map(center));
  const copy: DecoratedMap = {
    ...map,
    floors: map.floors.map((f) => ({ ...f, solids: f.solids.filter((s) => s.kind !== 'pillar') })),
  };
  const decor = (map as DecoratedMap).decor;
  if (decor) copy.decor = decor.filter((d) => !onPillar(d, removed[d.floor] ?? []));
  pillarFree.set(map, copy);
  return copy;
}
