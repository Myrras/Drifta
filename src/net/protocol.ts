import { PLAYER_MODELS } from '../models';
import type { Look } from '../cosmetics';
import type { PlayerModel } from '../types';

export const APP_VERSION: string = __APP_VERSION__;
export const POSE_HZ = 20;
export const SCORE_HZ = 4;

export interface PlayerInfo {
  name: string;
  car: PlayerModel;
  color: string;
  look?: Record<string, unknown>;
}

export type Msg =
  | { t: 'hello'; v: string; info: PlayerInfo }
  // at: sender performance.now() ms
  | { t: 'ping'; id: number; at: number }
  // echoes ping id + at
  | { t: 'pong'; id: number; at: number }
  // host -> guest: chosen map name and hazards toggle
  | { t: 'map'; map: string; hazards: boolean }
  | { t: 'ready'; ready: boolean }
  // host -> guest: countdown begins in `delay` ms (host side); guest subtracts rtt/2
  | { t: 'start'; map: string; delay: number; hazards: boolean }
  // time: run time s; sent on the unreliable channel
  | { t: 'pose'; time: number; x: number; y: number; angle: number; floor: number }
  | { t: 'score'; banked: number; combo: number }
  | { t: 'finish'; total: number; time: number }
  // host -> guest: back to map pick (rematch)
  | { t: 'lobby' }
  // peer quits multiplayer
  | { t: 'leave' };

export function encode(m: Msg): string {
  return JSON.stringify(m);
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length <= 64;
const nums = (o: Obj, keys: string[]) => keys.every((k) => num(o[k]));

const LOOK_KEYS: Record<keyof Look, 'string' | 'boolean'> = {
  paint: 'string',
  skin: 'string',
  underglow: 'string',
  smoke: 'string',
  spoiler: 'string',
  hood: 'boolean',
  tint: 'string',
};

function lookOf(o: Obj): Obj | undefined {
  const out: Obj = {};
  for (const [k, kind] of Object.entries(LOOK_KEYS)) {
    if (!Object.hasOwn(o, k)) continue;
    const v = o[k];
    if (kind === 'string' ? str(v) : typeof v === 'boolean') out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

function info(v: unknown): PlayerInfo | null {
  if (!isObj(v)) return null;
  const { name, car, color, look } = v;
  if (typeof name !== 'string' || !/^[A-Z0-9_]{1,12}$/.test(name)) return null;
  if (typeof car !== 'string' || !Object.hasOwn(PLAYER_MODELS, car)) return null;
  if (!str(color)) return null;
  if (look !== undefined && !isObj(look)) return null;
  const out: PlayerInfo = { name, car: car as PlayerModel, color };
  const l = look === undefined ? undefined : lookOf(look);
  if (l) out.look = l;
  return out;
}

function check(o: Obj): Msg | null {
  switch (o.t) {
    case 'hello': {
      const i = info(o.info);
      return str(o.v) && i ? { t: 'hello', v: o.v, info: i } : null;
    }
    case 'ping':
    case 'pong':
      return nums(o, ['id', 'at']) ? { t: o.t, id: o.id as number, at: o.at as number } : null;
    case 'map':
      return str(o.map) && typeof o.hazards === 'boolean'
        ? { t: 'map', map: o.map, hazards: o.hazards }
        : null;
    case 'ready':
      return typeof o.ready === 'boolean' ? { t: 'ready', ready: o.ready } : null;
    case 'start':
      return str(o.map) && num(o.delay) && typeof o.hazards === 'boolean'
        ? { t: 'start', map: o.map, delay: o.delay, hazards: o.hazards }
        : null;
    case 'pose':
      return nums(o, ['time', 'x', 'y', 'angle', 'floor'])
        ? {
            t: 'pose',
            time: o.time as number,
            x: o.x as number,
            y: o.y as number,
            angle: o.angle as number,
            floor: o.floor as number,
          }
        : null;
    case 'score':
      return nums(o, ['banked', 'combo'])
        ? { t: 'score', banked: o.banked as number, combo: o.combo as number }
        : null;
    case 'finish':
      return nums(o, ['total', 'time'])
        ? { t: 'finish', total: o.total as number, time: o.time as number }
        : null;
    case 'lobby':
    case 'leave':
      return { t: o.t };
    default:
      return null;
  }
}

export function decode(raw: unknown): Msg | null {
  if (typeof raw !== 'string') return null;
  try {
    const o: unknown = JSON.parse(raw);
    return isObj(o) ? check(o) : null;
  } catch {
    return null;
  }
}

export type LinkState = 'connecting' | 'open' | 'failed' | 'closed';

export interface Link {
  readonly state: LinkState;
  /** 'pose' goes unreliable/unordered, everything else reliable+ordered; no-op unless open */
  send(m: Msg): void;
  onMessage(cb: (m: Msg) => void): void;
  onState(cb: (s: LinkState) => void): void;
  close(): void;
}

export type LinkErrorReason = 'bad-code' | 'version' | 'wrong-kind' | 'timeout' | 'failed';

export class LinkError extends Error {
  constructor(readonly reason: LinkErrorReason) {
    super(reason);
  }
}

export interface HostHandle {
  link: Link;
  invite: string;
  /** rejects with LinkError */
  accept(reply: string): Promise<void>;
}

export interface GuestHandle {
  link: Link;
  reply: string;
}

export interface Connector {
  host(): Promise<HostHandle>;
  /** rejects with LinkError */
  join(invite: string): Promise<GuestHandle>;
}
