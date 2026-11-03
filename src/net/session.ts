import { sample, type GhostFrame } from '../ghost';
import {
  APP_VERSION,
  POSE_HZ,
  SCORE_HZ,
  type Link,
  type LinkState,
  type Msg,
  type PlayerInfo,
} from './protocol';

export const START_DELAY_MS = 1500;
export const INTERP_DELAY = 0.1; // s
const PING_MS = 1000;
const BUFFER_S = 10;
const BUFFER_MAX = 400;

export type SessionPhase = 'handshake' | 'lobby' | 'race' | 'closed';

export interface Rival {
  info: PlayerInfo | null;
  ready: boolean;
  banked: number;
  combo: number;
  total: number | null;
  time: number | null;
  connected: boolean;
}

export interface Session {
  readonly role: 'host' | 'guest';
  readonly phase: SessionPhase;
  readonly rival: Rival;
  readonly map: string | null;
  /** Host-chosen per-map hazards toggle; applies to both players. */
  readonly hazards: boolean;
  readonly ready: boolean;
  readonly rtt: number;
  readonly error: 'version' | null;
  /** Replaces my info; re-sent as hello before the race. */
  setInfo(info: PlayerInfo): void;
  pickMap(name: string, hazards?: boolean): void;
  setHazards(on: boolean): void;
  setReady(r: boolean): void;
  canStart(): boolean;
  start(): void;
  onStart(cb: (map: string, inMs: number, hazards: boolean) => void): void;
  sendPose(time: number, x: number, y: number, angle: number, floor: number): void;
  sendScore(banked: number, combo: number): void;
  finish(total: number, time: number): void;
  /** Rival pose INTERP_DELAY behind runTime; holds the last frame while connected. */
  rivalPose(runTime: number): GhostFrame | null;
  backToLobby(): void;
  leave(): void;
  tick(): void;
  onChange(cb: () => void): void;
}

export function createSession(
  link: Link,
  role: 'host' | 'guest',
  me: PlayerInfo,
  now: () => number = () => performance.now(),
): Session {
  let phase: SessionPhase = 'handshake';
  let map: string | null = null;
  let hazards = true;
  let ready = false;
  let rtt = 0;
  let error: 'version' | null = null;
  const rival: Rival = {
    info: null,
    ready: false,
    banked: 0,
    combo: 0,
    total: null,
    time: null,
    connected: false,
  };
  let frames: GhostFrame[] = [];
  let lastPose = -Infinity;
  let lastScore = -Infinity;
  let finished = false;
  let pingId = 0;
  let lastPing = -Infinity;
  const startCbs: ((map: string, inMs: number, hazards: boolean) => void)[] = [];
  const changeCbs: (() => void)[] = [];
  const changed = () => changeCbs.forEach((cb) => cb());

  const resetRace = () => {
    frames = [];
    lastPose = -Infinity;
    lastScore = -Infinity;
    finished = false;
    Object.assign(rival, { banked: 0, combo: 0, total: null, time: null });
  };
  const enterRace = (m: string, inMs: number, hz: boolean) => {
    map = m;
    hazards = hz;
    phase = 'race';
    resetRace();
    startCbs.forEach((cb) => cb(m, inMs, hz));
    changed();
  };
  const enterLobby = () => {
    phase = 'lobby';
    ready = false;
    rival.ready = false;
    resetRace();
    changed();
  };
  const close = () => {
    if (phase === 'closed') return;
    phase = 'closed';
    rival.connected = false;
    changed();
  };
  const canStart = () =>
    role === 'host' && phase === 'lobby' && map !== null && ready && rival.ready && rival.connected;
  const pushFrame = (f: GhostFrame) => {
    if (frames.length && f.t <= frames[frames.length - 1].t) return;
    frames.push(f);
    const cut = f.t - BUFFER_S;
    let i = 0;
    while (i < frames.length - 1 && frames[i].t < cut) i++;
    i = Math.max(i, frames.length - BUFFER_MAX);
    if (i) frames.splice(0, i);
  };

  const handle = (m: Msg) => {
    if (phase === 'closed') return;
    switch (m.t) {
      case 'hello':
        if (m.v !== APP_VERSION) {
          error = 'version';
          close();
          link.close();
          return;
        }
        rival.info = m.info;
        rival.connected = true;
        if (phase === 'handshake') phase = 'lobby';
        return changed();
      case 'ping':
        return link.send({ t: 'pong', id: m.id, at: m.at });
      case 'pong': {
        const s = now() - m.at;
        rtt = rtt === 0 ? s : rtt * 0.8 + s * 0.2;
        return;
      }
      case 'map':
        if (role !== 'guest' || phase !== 'lobby') return;
        map = m.map;
        hazards = m.hazards;
        ready = false;
        rival.ready = false;
        return changed();
      case 'ready':
        if (phase !== 'lobby') return;
        rival.ready = m.ready;
        return changed();
      case 'start':
        if (role !== 'guest' || phase !== 'lobby') return;
        return enterRace(m.map, Math.max(0, m.delay - rtt / 2), m.hazards);
      case 'pose':
        if (phase !== 'race') return;
        return pushFrame({ t: m.time, x: m.x, y: m.y, angle: m.angle, floor: m.floor });
      case 'score':
        if (phase !== 'race') return;
        rival.banked = m.banked;
        rival.combo = m.combo;
        return changed();
      case 'finish':
        if (phase !== 'race') return;
        rival.total = m.total;
        rival.time = m.time;
        return changed();
      case 'lobby':
        if (role !== 'guest' || phase === 'handshake') return;
        return enterLobby();
      case 'leave':
        return close();
    }
  };

  const onState = (s: LinkState) => {
    if (s === 'open') link.send({ t: 'hello', v: APP_VERSION, info: me });
    else if (s === 'closed' || s === 'failed') close();
  };
  link.onMessage(handle);
  link.onState(onState);
  if (link.state === 'open') onState('open');

  return {
    role,
    get phase() {
      return phase;
    },
    rival,
    get map() {
      return map;
    },
    get hazards() {
      return hazards;
    },
    get ready() {
      return ready;
    },
    get rtt() {
      return rtt;
    },
    get error() {
      return error;
    },
    setInfo(info) {
      me = info;
      if (link.state === 'open' && (phase === 'handshake' || phase === 'lobby'))
        link.send({ t: 'hello', v: APP_VERSION, info });
    },
    pickMap(name, hz = true) {
      if (role !== 'host' || phase !== 'lobby') return;
      map = name;
      hazards = hz;
      ready = false;
      rival.ready = false;
      link.send({ t: 'map', map: name, hazards: hz });
      changed();
    },
    setHazards(on) {
      if (role !== 'host' || phase !== 'lobby' || map === null || on === hazards) return;
      hazards = on;
      ready = false;
      rival.ready = false;
      link.send({ t: 'map', map, hazards: on });
      changed();
    },
    setReady(r) {
      if (phase !== 'lobby') return;
      ready = r;
      link.send({ t: 'ready', ready: r });
      changed();
    },
    canStart,
    start() {
      if (!canStart() || map === null) return;
      link.send({ t: 'start', map, delay: START_DELAY_MS, hazards });
      enterRace(map, START_DELAY_MS, hazards);
    },
    onStart(cb) {
      startCbs.push(cb);
    },
    sendPose(time, x, y, angle, floor) {
      if (phase !== 'race') return;
      if (time < lastPose) lastPose = -Infinity;
      if (time - lastPose < 1 / POSE_HZ - 1e-9) return;
      lastPose = time;
      link.send({ t: 'pose', time, x, y, angle, floor });
    },
    sendScore(banked, combo) {
      if (phase !== 'race') return;
      const t = now();
      if (t - lastScore < 1000 / SCORE_HZ) return;
      lastScore = t;
      link.send({ t: 'score', banked, combo });
    },
    finish(total, time) {
      if (phase !== 'race' || finished) return;
      finished = true;
      link.send({ t: 'finish', total, time });
    },
    rivalPose(runTime) {
      if (!rival.connected || !frames.length) return null;
      const t = runTime - INTERP_DELAY;
      if (t < frames[0].t) return null;
      const last = frames[frames.length - 1];
      if (t >= last.t) return { ...last };
      return sample({ car: rival.info?.car ?? me.car, frames }, t);
    },
    backToLobby() {
      if (role !== 'host' || phase !== 'race') return;
      link.send({ t: 'lobby' });
      enterLobby();
    },
    leave() {
      if (phase === 'closed') return;
      link.send({ t: 'leave' });
      close();
      link.close();
    },
    tick() {
      if (phase === 'closed' || link.state !== 'open') return;
      const t = now();
      if (t - lastPing < PING_MS) return;
      lastPing = t;
      link.send({ t: 'ping', id: ++pingId, at: t });
    },
    onChange(cb) {
      changeCbs.push(cb);
    },
  };
}
