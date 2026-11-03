/** Garage cosmetics: ids, display names and colours. Cosmetic only, no performance effect. */

/** Per-car look, stored opaque in progress; values are the ids below. */
export interface Look {
  paint?: string;
  skin?: string;
  underglow?: string;
  smoke?: string;
  spoiler?: 'ducktail' | 'gt';
  hood?: boolean;
  tint?: string;
}

export interface Item {
  id: string;
  name: string;
  /** body / glow / smoke / glass colour (hex); none for shape-only parts */
  color?: string;
}

export const PAINTS: Item[] = [
  { id: 'concrete-grey', name: 'CONCRETE GREY', color: '#8a8d90' },
  { id: 'b2-violet', name: 'B2 VIOLET', color: '#6a3fb5' },
  { id: 'harbor-teal', name: 'HARBOR TEAL', color: '#1f8a8a' },
  { id: 'crane-yellow', name: 'CRANE YELLOW', color: '#f2b705' },
  { id: 'neon-pink', name: 'NEON PINK', color: '#ff3fa4' },
  { id: 'midnight-blue', name: 'MIDNIGHT BLUE', color: '#16245a' },
  { id: 'moon-gold', name: 'MOON GOLD', color: '#d9a929' },
  { id: 'ketchup-red', name: 'KETCHUP RED', color: '#c4161c' },
];

/** Paint unlocks per racing map: [3rd, 2nd]. */
const MAP_PAINTS: Record<string, [string, string]> = {
  'B2 MEET': ['concrete-grey', 'b2-violet'],
  'WANGAN DOCKS': ['harbor-teal', 'crane-yellow'],
  'TOKYO NIGHTS': ['neon-pink', 'midnight-blue'],
  'MIDNIGHT DRIVE-THRU': ['moon-gold', 'ketchup-red'],
};

export const COSMETICS: Item[] = [
  { id: 'underglow-pink', name: 'PINK UNDERGLOW', color: '#ff3fbf' },
  { id: 'underglow-cyan', name: 'CYAN UNDERGLOW', color: '#22e4ff' },
  { id: 'underglow-green', name: 'GREEN UNDERGLOW', color: '#39ff6a' },
  { id: 'underglow-purple', name: 'PURPLE UNDERGLOW', color: '#a24bff' },
  { id: 'smoke-pink', name: 'PINK SMOKE', color: '#ff8cd2' },
  { id: 'smoke-cyan', name: 'CYAN SMOKE', color: '#8ceaff' },
  { id: 'smoke-yellow', name: 'YELLOW SMOKE', color: '#ffe680' },
  { id: 'smoke-purple', name: 'PURPLE SMOKE', color: '#c49cff' },
  { id: 'spoiler-ducktail', name: 'DUCKTAIL SPOILER' },
  { id: 'spoiler-gt', name: 'GT WING' },
  { id: 'hood-carbon', name: 'CARBON HOOD' },
  { id: 'tint-dark', name: 'DARK TINT', color: '#060709' },
  { id: 'tint-limo', name: 'LIMO TINT', color: '#000000' },
];

export const SKINS: (Item & { car: string })[] = [
  { id: 'fortune-orange', name: 'FORTUNE ORANGE', color: '#ff6a00', car: 'rx7' },
];

const ALL = new Map([...PAINTS, ...COSMETICS, ...SKINS].map((i) => [i.id, i]));

export const itemById = (id: string | undefined): Item | undefined =>
  id ? ALL.get(id) : undefined;

export const paintsForMap = (mapName: string): [string, string] | undefined => MAP_PAINTS[mapName];

/** Default tyre smoke, same 'r,g,b' format as SMOKE_RGB in particles.ts (keep in sync). */
export const DEFAULT_SMOKE = '214,214,220';

/** Tyre smoke colour as 'r,g,b' for the puff sprites. */
export function smokeColor(look?: Look): string {
  const hex = itemById(look?.smoke)?.color;
  if (!hex) return DEFAULT_SMOKE;
  const n = parseInt(hex.slice(1), 16);
  return `${n >> 16},${(n >> 8) & 255},${n & 255}`;
}
