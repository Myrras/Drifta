import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeCode } from './codes';
import { createConnector } from './link';
import { encode, LinkError, type LinkState, type Msg } from './protocol';

class FakeChannel extends EventTarget {
  readyState: RTCDataChannelState = 'connecting';
  sent: string[] = [];
  constructor(
    readonly label: string,
    readonly opts: RTCDataChannelInit,
  ) {
    super();
  }
  send(d: string) {
    this.sent.push(d);
  }
  open() {
    this.readyState = 'open';
    this.dispatchEvent(new Event('open'));
  }
  close() {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    this.dispatchEvent(new Event('close'));
  }
  receive(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
}

class FakePc extends EventTarget {
  channels: FakeChannel[] = [];
  connectionState: RTCPeerConnectionState = 'new';
  iceGatheringState: RTCIceGatheringState = 'complete';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  createDataChannel(label: string, opts: RTCDataChannelInit) {
    const ch = new FakeChannel(label, opts);
    this.channels.push(ch);
    return ch;
  }
  async createOffer() {
    return { type: 'offer' as const, sdp: 'v=0 offer' };
  }
  async createAnswer() {
    return { type: 'answer' as const, sdp: 'v=0 answer' };
  }
  async setLocalDescription(d: RTCSessionDescriptionInit) {
    this.localDescription = d;
  }
  async setRemoteDescription(d: RTCSessionDescriptionInit) {
    this.remoteDescription = d;
  }
  setConn(s: RTCPeerConnectionState) {
    this.connectionState = s;
    this.dispatchEvent(new Event('connectionstatechange'));
  }
  close() {
    this.connectionState = 'closed';
  }
}

async function setup() {
  const pc = new FakePc();
  const h = await createConnector(() => pc as unknown as RTCPeerConnection).host();
  const states: LinkState[] = [];
  h.link.onState((s) => states.push(s));
  const [ctl, pose] = pc.channels;
  return { pc, h, ctl, pose, states };
}

const ping: Msg = { t: 'ping', id: 1, at: 5 };
const poseMsg: Msg = { t: 'pose', time: 1, x: 2, y: 3, angle: 0, floor: 0 };

afterEach(() => vi.useRealTimers());

describe('link', () => {
  it('creates negotiated channels and exchanges codes', async () => {
    const { pc, h, ctl, pose } = await setup();
    expect(ctl.opts).toEqual({ negotiated: true, id: 0 });
    expect(pose.opts).toEqual({ negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
    expect(h.invite.startsWith('DRIFTA-I-')).toBe(true);

    const gpc = new FakePc();
    const g = await createConnector(() => gpc as unknown as RTCPeerConnection).join(h.invite);
    expect(gpc.remoteDescription).toEqual({ type: 'offer', sdp: 'v=0 offer' });
    await h.accept(g.reply);
    expect(pc.remoteDescription).toEqual({ type: 'answer', sdp: 'v=0 answer' });
    await expect(h.accept(h.invite)).rejects.toMatchObject({ reason: 'wrong-kind' });
  });

  it('join rejects bad codes before creating a peer connection', async () => {
    const make = vi.fn();
    const err = await createConnector(make)
      .join('nope')
      .catch((e) => e);
    expect(err).toBeInstanceOf(LinkError);
    expect(err.reason).toBe('bad-code');
    const reply = await makeCode('reply', 'v=0');
    await expect(createConnector(make).join(reply)).rejects.toMatchObject({ reason: 'wrong-kind' });
    expect(make).not.toHaveBeenCalled();
  });

  it('opens when both channels open and routes sends', async () => {
    const { h, ctl, pose, states } = await setup();
    h.link.send(ping);
    ctl.open();
    expect(h.link.state).toBe('connecting');
    pose.open();
    expect(states).toEqual(['open']);
    expect(ctl.sent).toEqual([]);
    h.link.send(ping);
    h.link.send(poseMsg);
    expect(ctl.sent).toEqual([encode(ping)]);
    expect(pose.sent).toEqual([encode(poseMsg)]);
  });

  it('decodes incoming data and drops invalid messages', async () => {
    const { h, ctl, pose } = await setup();
    const a: Msg[] = [];
    const b: Msg[] = [];
    h.link.onMessage((m) => a.push(m));
    h.link.onMessage((m) => b.push(m));
    ctl.receive(encode(ping));
    ctl.receive('{"t":"bogus"}');
    ctl.receive('not json');
    pose.receive(new ArrayBuffer(4));
    pose.receive(encode(poseMsg));
    expect(a).toEqual([ping, poseMsg]);
    expect(b).toEqual(a);
  });

  it('fails after 15 s without opening', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { pc, h, states } = await setup();
    vi.advanceTimersByTime(14999);
    expect(h.link.state).toBe('connecting');
    vi.advanceTimersByTime(1);
    expect(states).toEqual(['failed']);
    expect(pc.connectionState).toBe('closed');
  });

  it('fails on pc failure', async () => {
    const { pc, states } = await setup();
    pc.setConn('failed');
    expect(states).toEqual(['failed']);
  });

  it('closes on channel close, long disconnect, or close()', async () => {
    let s = await setup();
    s.ctl.open();
    s.pose.open();
    s.pose.close();
    expect(s.states).toEqual(['open', 'closed']);
    s.h.link.send(ping);
    expect(s.ctl.sent).toEqual([]);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    s = await setup();
    s.ctl.open();
    s.pose.open();
    s.pc.setConn('disconnected');
    vi.advanceTimersByTime(2000);
    s.pc.setConn('connected');
    vi.advanceTimersByTime(5000);
    expect(s.h.link.state).toBe('open');
    s.pc.setConn('disconnected');
    vi.advanceTimersByTime(3000);
    expect(s.states).toEqual(['open', 'closed']);

    s = await setup();
    s.h.link.close();
    expect(s.states).toEqual(['closed']);
    expect(s.ctl.readyState).toBe('closed');
    expect(s.pc.connectionState).toBe('closed');
  });
});
