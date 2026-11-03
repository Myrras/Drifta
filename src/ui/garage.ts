/** Garage customise panel: slot options, ownership/lock rules, equip, and row drawing. */
import { COSMETICS, PAINTS, SKINS, type Look } from '../cosmetics';
import { MAP_PAINTS, ownsCosmetic, type Progress } from '../progress';
import type { PlayerModel } from '../types';
import type { Theme } from './theme';

export const SLOTS = ['paint', 'skin', 'underglow', 'smoke', 'spoiler', 'hood', 'tint'] as const;
export type Slot = (typeof SLOTS)[number];
export const SLOT_LABELS: Record<Slot, string> = {
  paint: 'PAINT',
  skin: 'SKIN',
  underglow: 'UNDERGLOW',
  smoke: 'SMOKE',
  spoiler: 'SPOILER',
  hood: 'HOOD',
  tint: 'TINT',
};

export interface Opt {
  name: string;
  color?: string;
  /** cosmetic id (ownership); none for the free default */
  id?: string;
  /** what goes in look[slot]; undefined removes it */
  value?: string | boolean;
  /** stock body colour (paint slot only) */
  stock?: string;
  /** how to earn it, set when not owned */
  lock?: string;
}

/** Where an item comes from, shown on locked options. */
export function earnHint(id: string): string {
  for (const [map, [third, second]] of Object.entries(MAP_PAINTS)) {
    if (id === third) return `3RD on ${map}`;
    if (id === second) return `2ND on ${map}`;
  }
  return SKINS.some((s) => s.id === id) ? 'LEGEND challenge' : 'daily challenge';
}

export function slotOptions(
  slot: Slot,
  car: PlayerModel,
  stockColors: string[],
  p: Progress,
  cheat = false,
): Opt[] {
  const item = (o: Opt): Opt =>
    o.id && !ownsCosmetic(p, o.id, cheat) ? { ...o, lock: earnHint(o.id) } : o;
  const byId = (i: { id: string; name: string; color?: string }): Opt =>
    item({ name: i.name, color: i.color, id: i.id, value: i.id });
  const part = (prefix: string) => COSMETICS.filter((c) => c.id.startsWith(prefix)).map(byId);
  switch (slot) {
    case 'paint':
      return [
        ...stockColors.map((c, i) => ({ name: `STOCK ${i + 1}`, color: c, stock: c })),
        ...PAINTS.map(byId),
      ];
    case 'skin':
      return [{ name: 'NONE' }, ...SKINS.filter((s) => s.car === car).map(byId)];
    case 'underglow':
      return [{ name: 'NONE' }, ...part('underglow-')];
    case 'smoke':
      return [{ name: 'STOCK' }, ...part('smoke-')];
    case 'tint':
      return [{ name: 'NONE' }, ...part('tint-')];
    case 'spoiler':
      return [
        { name: 'NONE' },
        item({ name: 'DUCKTAIL', id: 'spoiler-ducktail', value: 'ducktail' }),
        item({ name: 'GT WING', id: 'spoiler-gt', value: 'gt' }),
      ];
    case 'hood':
      return [{ name: 'STOCK' }, item({ name: 'CARBON', id: 'hood-carbon', value: true })];
  }
}

/** Index of the option matching the current look (0 if none does). */
export function currentIndex(slot: Slot, opts: Opt[], look: Look, color: string): number {
  const i = opts.findIndex((o) =>
    slot === 'paint' && !look.paint ? o.stock === color : o.value === look[slot] && !o.stock,
  );
  return Math.max(0, i);
}

/** Look and stock colour after the cursor lands on o: locked options show but are never equipped. */
export function equip(
  slot: Slot,
  o: Opt,
  look: Look,
  color: string,
): { look: Look; color: string } {
  if (o.lock) return { look, color };
  const next: Look = { ...look };
  if (o.value === undefined) delete next[slot];
  else (next as Record<string, unknown>)[slot] = o.value;
  return { look: next, color: o.stock ?? color };
}

/** Drops anything the player does not own (e.g. a look saved under the session cheat). */
export function ownedLook(
  look: Look,
  car: PlayerModel,
  stockColors: string[],
  p: Progress,
  cheat = false,
): Look {
  const out: Look = { ...look };
  for (const s of SLOTS) {
    if (look[s] === undefined) continue;
    const o = slotOptions(s, car, stockColors, p, cheat).find((x) => x.value === look[s]);
    if (!o || o.lock) delete out[s];
  }
  return out;
}

function padlock(g: CanvasRenderingContext2D, x: number, y: number, u: number, col: string): void {
  g.fillStyle = col;
  g.fillRect(x - 0.9 * u, y - 0.1 * u, 1.8 * u, 1.4 * u);
  g.strokeStyle = col;
  g.lineWidth = Math.max(1, 0.28 * u);
  g.beginPath();
  g.arc(x, y - 0.1 * u, 0.6 * u, Math.PI, 0);
  g.stroke();
}

export interface SlotRow {
  label: string;
  name: string;
  color?: string;
  locked: boolean;
}

/** One slot row centred on y between x0 and x1. */
export function drawSlot(
  g: CanvasRenderingContext2D,
  th: Theme,
  u: number,
  r: SlotRow,
  sel: boolean,
  x0: number,
  x1: number,
  y: number,
  accent: string,
): void {
  if (sel) {
    g.globalAlpha = 0.2;
    g.fillStyle = accent;
    g.fillRect(x0 - 1.2 * u, y - 2 * u, x1 - x0 + 2.4 * u, 4 * u);
    g.globalAlpha = 1;
  }
  g.textBaseline = 'middle';
  g.font = th.font(700, 2.4 * u);
  g.textAlign = 'left';
  g.fillStyle = sel ? th.text : th.dim;
  g.fillText(r.label, x0, y);
  const s = sel ? `◀ ${r.name} ▶` : r.name;
  g.font = th.font(700, 2.6 * u);
  g.textAlign = 'right';
  g.fillStyle = r.locked ? th.dim : th.text;
  g.fillText(s, x1, y);
  const sx = x1 - g.measureText(s).width - 2 * u;
  if (r.locked) padlock(g, sx, y - 0.5 * u, u, th.dim);
  else if (r.color) {
    g.fillStyle = r.color;
    g.fillRect(sx - 0.9 * u, y - 0.9 * u, 1.8 * u, 1.8 * u);
  }
}
