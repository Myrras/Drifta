import { beforeEach, describe, expect, it } from 'vitest';
import { APP_VERSION, type Link, type LinkState, type Msg, type PlayerInfo } from './protocol';
import { createSession, START_DELAY_MS, type Session } from './session';

interface End extends Link {
  state: LinkState;
  peer: End;
  inbox: Msg[];
  hold: boolean;
  queue: Msg[];
  emit(m: Msg): void;
  setState(s: LinkState): void;
  flush(): void;
}

function end(): End {
  const msgs: ((m: Msg) => void)[] = [];
  const states: ((s: LinkState) => void)[] = [];
  const deliver = (to: End, m: Msg) => {
    to.inbox.push(m);
    to.emit(m);
  };
  const e = {
    state: 'connecting' as LinkState,
    inbox: [] as Msg[],
    hold: false,
    queue: [] as Msg[],
    emit: (m: Msg) => msgs.forEach((cb) => cb(m)),
    send(m: Msg) {
      if (e.state !== 'open') return;
      if (e.hold) e.queue.push(m);
      else deliver(e.peer, m);
    },
    flush() {
      e.hold = false;
      e.queue.splice(0).forEach((m) => deliver(e.peer, m));
    },
    onMessage: (cb: (m: Msg) => void) => void msgs.push(cb),
    onState: (cb: (s: LinkState) => void) => void states.push(cb),
    setState(s: LinkState) {
      e.state = s;
      states.forEach((cb) => cb(s));
    },
    close() {
      e.setState('closed');
      e.peer.setState('closed');
    },
  } as End;
  return e;
}

function pair(): [End, End] {
  const a = end();
  const b = end();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

const hostInfo: PlayerInfo = { name: 'HOST', car: 'ae86', color: '#f00' };
const guestInfo: PlayerInfo = { name: 'GUEST', car: 'celica', color: '#0f0' };

let t = 0;
const now = () => t;
let a: End, b: End, h: Session, g: Session;

beforeEach(() => {
  t = 0;
  [a, b] = pair();
  h = createSession(a, 'host', hostInfo, now);
  g = createSession(b, 'guest', guestInfo, now);
});

const connect = () => {
  a.state = b.state = 'open';
  a.setState('open');
  b.setState('open');
};
const toRace = () => {
  connect();
  h.pickMap('Harbor');
  h.setReady(true);
  g.setReady(true);
  h.start();
};

describe('session', () => {
  it('handshakes into lobby on both sides', () => {
    expect(h.phase).toBe('handshake');
    connect();
    expect(h.phase).toBe('lobby');
    expect(g.phase).toBe('lobby');
    expect(h.rival.info?.name).toBe('GUEST');
    expect(g.rival.info?.name).toBe('HOST');
    expect(g.rival.connected).toBe(true);
  });

  it('sends hello immediately when the link is already open', () => {
    const [x, y] = pair();
    x.state = y.state = 'open';
    const s = createSession(x, 'host', hostInfo, now);
    expect(y.inbox[0]).toEqual({ t: 'hello', v: APP_VERSION, info: hostInfo });
    y.send({ t: 'hello', v: APP_VERSION, info: guestInfo });
    expect(s.phase).toBe('lobby');
  });

  it('closes on version mismatch', () => {
    a.state = b.state = 'open';
    b.send({ t: 'hello', v: '0.0.0-old', info: guestInfo });
    expect(h.error).toBe('version');
    expect(h.phase).toBe('closed');
    expect(a.state).toBe('closed');
  });

  it('host pickMap sets guest map and clears ready flags', () => {
    connect();
    h.setReady(true);
    g.setReady(true);
    expect(h.rival.ready).toBe(true);
    h.pickMap('Harbor');
    expect(g.map).toBe('Harbor');
    expect([h.ready, h.rival.ready, g.ready, g.rival.ready]).toEqual([false, false, false, false]);
    g.pickMap('Other');
    expect(h.map).toBe('Harbor');
  });

  it('ignores map from the guest side', () => {
    connect();
    b.send({ t: 'map', map: 'Evil' });
    expect(h.map).toBeNull();
  });

  it('canStart requires host, map, both ready, rival connected', () => {
    connect();
    expect(h.canStart()).toBe(false);
    h.pickMap('Harbor');
    h.setReady(true);
    expect(h.canStart()).toBe(false);
    g.setReady(true);
    expect(h.canStart()).toBe(true);
    expect(g.canStart()).toBe(false);
    a.setState('closed');
    expect(h.canStart()).toBe(false);
  });

  it('start fires onStart on both sides with rtt compensation', () => {
    connect();
    b.hold = true;
    g.tick();
    t = 40;
    b.flush();
    expect(g.rtt).toBe(40);
    const hs: [string, number][] = [];
    const gs: [string, number][] = [];
    h.onStart((m, ms) => hs.push([m, ms]));
    g.onStart((m, ms) => gs.push([m, ms]));
    h.pickMap('Harbor');
    h.setReady(true);
    g.setReady(true);
    h.start();
    expect(hs).toEqual([['Harbor', START_DELAY_MS]]);
    expect(gs).toEqual([['Harbor', START_DELAY_MS - 20]]);
    expect(h.phase).toBe('race');
    expect(g.phase).toBe('race');
  });

  it('pings once per second and smooths rtt', () => {
    connect();
    a.hold = true;
    h.tick();
    t = 500;
    h.tick();
    expect(a.queue.filter((m) => m.t === 'ping')).toHaveLength(1);
    t = 100;
    a.flush();
    expect(h.rtt).toBe(100);
    t = 1000;
    a.hold = true;
    h.tick();
    t = 1200;
    a.flush();
    expect(h.rtt).toBeCloseTo(120);
  });

  it('throttles poses to 20 Hz of run time', () => {
    toRace();
    for (const time of [0, 0.01, 0.05, 0.08, 0.1, 0.149, 0.15]) h.sendPose(time, 1, 2, 0, 0);
    expect(b.inbox.filter((m) => m.t === 'pose').map((m) => (m.t === 'pose' ? m.time : 0))).toEqual(
      [0, 0.05, 0.1, 0.15],
    );
  });

  it('interpolates rival pose with delay and drops out-of-order frames', () => {
    toRace();
    expect(h.rivalPose(5)).toBeNull();
    b.send({ t: 'pose', time: 1, x: 0, y: 0, angle: 0, floor: 0 });
    b.send({ t: 'pose', time: 1.2, x: 10, y: 20, angle: 0, floor: 0 });
    b.send({ t: 'pose', time: 1.1, x: 99, y: 99, angle: 0, floor: 0 });
    b.send({ t: 'pose', time: 1.2, x: 99, y: 99, angle: 0, floor: 0 });
    const p = h.rivalPose(1.2);
    expect(p?.x).toBeCloseTo(5);
    expect(p?.y).toBeCloseTo(10);
    expect(h.rivalPose(1.05)).toBeNull();
    expect(h.rivalPose(1.3)?.x).toBeCloseTo(10);
  });

  it('holds the last rival frame while connected, null after disconnect', () => {
    toRace();
    b.send({ t: 'pose', time: 1, x: 0, y: 0, angle: 0, floor: 0 });
    b.send({ t: 'pose', time: 1.2, x: 10, y: 20, angle: 1, floor: 1 });
    expect(h.rivalPose(5)).toEqual({ t: 1.2, x: 10, y: 20, angle: 1, floor: 1 });
    expect(h.rivalPose(60)?.x).toBe(10);
    a.setState('closed');
    expect(h.rivalPose(5)).toBeNull();
  });

  it('caps the pose buffer to about 10 s', () => {
    toRace();
    for (let i = 0; i <= 400; i++)
      b.send({ t: 'pose', time: i / 20, x: i, y: 0, angle: 0, floor: 0 });
    expect(h.rivalPose(1)).toBeNull();
    expect(h.rivalPose(15.1)?.x).toBeCloseTo(300);
  });

  it('throttles score by wall clock', () => {
    toRace();
    h.sendScore(1, 1);
    t = 100;
    h.sendScore(2, 2);
    expect(g.rival.banked).toBe(1);
    t = 250;
    h.sendScore(3, 3);
    expect([g.rival.banked, g.rival.combo]).toEqual([3, 3]);
  });

  it('sends finish once per race', () => {
    toRace();
    h.finish(5000, 61.5);
    h.finish(9999, 70);
    expect(g.rival.total).toBe(5000);
    expect(g.rival.time).toBe(61.5);
    expect(b.inbox.filter((m) => m.t === 'finish')).toHaveLength(1);
  });

  it('keeps rival total on disconnect', () => {
    toRace();
    h.finish(5000, 61.5);
    b.setState('failed');
    expect(g.phase).toBe('closed');
    expect(g.rival.connected).toBe(false);
    expect(g.rival.total).toBe(5000);
    expect(g.rivalPose(1)).toBeNull();
  });

  it('backToLobby resets both sides and allows a rematch', () => {
    toRace();
    b.send({ t: 'pose', time: 1, x: 0, y: 0, angle: 0, floor: 0 });
    h.sendScore(10, 2);
    g.finish(100, 50);
    h.backToLobby();
    for (const s of [h, g]) {
      expect(s.phase).toBe('lobby');
      expect(s.ready).toBe(false);
      expect(s.rival).toMatchObject({ ready: false, banked: 0, combo: 0, total: null, time: null });
    }
    expect(h.rivalPose(1.1)).toBeNull();
    g.setReady(true);
    h.setReady(true);
    expect(h.canStart()).toBe(true);
    h.start();
    g.finish(200, 40);
    expect(h.rival.total).toBe(200);
  });

  it('leave closes both sides', () => {
    connect();
    g.leave();
    expect(g.phase).toBe('closed');
    expect(h.phase).toBe('closed');
    expect(h.rival.connected).toBe(false);
    expect(b.state).toBe('closed');
  });
});
