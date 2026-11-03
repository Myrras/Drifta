import { makeCode, readCode } from './codes';
import {
  decode,
  encode,
  LinkError,
  type Connector,
  type Link,
  type LinkState,
  type Msg,
} from './protocol';

const GATHER_MS = 4000;
const OPEN_MS = 15000;
const GUEST_OPEN_MS = 180_000;
const DISCONNECT_MS = 3000;

function createLink(pc: RTCPeerConnection): { link: Link; arm(ms: number): void } {
  const ctl = pc.createDataChannel('ctl', { negotiated: true, id: 0 });
  const pose = pc.createDataChannel('pose', {
    negotiated: true,
    id: 1,
    ordered: false,
    maxRetransmits: 0,
  });
  const msgCbs: ((m: Msg) => void)[] = [];
  const stateCbs: ((s: LinkState) => void)[] = [];
  let state: LinkState = 'connecting';
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let dropTimer: ReturnType<typeof setTimeout> | undefined;

  function set(s: LinkState) {
    if (state === s || state === 'failed' || state === 'closed') return;
    state = s;
    if (s !== 'connecting') clearTimeout(openTimer);
    if (s === 'failed' || s === 'closed') {
      clearTimeout(dropTimer);
      ctl.close();
      pose.close();
      pc.close();
    }
    for (const cb of stateCbs) cb(s);
  }

  for (const ch of [ctl, pose]) {
    ch.addEventListener('open', () => {
      if (ctl.readyState === 'open' && pose.readyState === 'open' && state === 'connecting')
        set('open');
    });
    ch.addEventListener('close', () => {
      if (state === 'open') set('closed');
    });
    ch.addEventListener('message', (e) => {
      const m = decode((e as MessageEvent).data);
      if (m) for (const cb of msgCbs) cb(m);
    });
  }

  pc.addEventListener('connectionstatechange', () => {
    const c = pc.connectionState;
    clearTimeout(dropTimer);
    if (c === 'failed') set('failed');
    else if (state !== 'open') return;
    else if (c === 'closed') set('closed');
    else if (c === 'disconnected') dropTimer = setTimeout(() => set('closed'), DISCONNECT_MS);
  });

  const link: Link = {
    get state() {
      return state;
    },
    send(m) {
      if (state !== 'open') return;
      (m.t === 'pose' ? pose : ctl).send(encode(m));
    },
    onMessage(cb) {
      msgCbs.push(cb);
    },
    onState(cb) {
      stateCbs.push(cb);
    },
    close() {
      set('closed');
    },
  };

  return {
    link,
    arm(ms) {
      clearTimeout(openTimer);
      if (state === 'connecting') openTimer = setTimeout(() => set('failed'), ms);
    },
  };
}

async function gather(pc: RTCPeerConnection): Promise<string> {
  if (pc.iceGatheringState !== 'complete') {
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(t);
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      };
      const check = () => {
        if (pc.iceGatheringState === 'complete') done();
      };
      const t = setTimeout(done, GATHER_MS);
      pc.addEventListener('icegatheringstatechange', check);
    });
  }
  return pc.localDescription!.sdp;
}

async function remote(pc: RTCPeerConnection, type: RTCSdpType, sdp: string) {
  try {
    await pc.setRemoteDescription({ type, sdp });
  } catch {
    throw new LinkError('bad-code');
  }
}

export function createConnector(
  make: () => RTCPeerConnection = () =>
    new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }),
): Connector {
  return {
    async host() {
      const pc = make();
      const { link, arm } = createLink(pc);
      await pc.setLocalDescription(await pc.createOffer());
      const invite = await makeCode('invite', await gather(pc));
      return {
        link,
        invite,
        async accept(reply) {
          await remote(pc, 'answer', await readCode(reply, 'reply'));
          arm(OPEN_MS);
        },
      };
    },
    async join(invite) {
      const sdp = await readCode(invite, 'invite');
      const pc = make();
      const { link, arm } = createLink(pc);
      try {
        await remote(pc, 'offer', sdp);
        await pc.setLocalDescription(await pc.createAnswer());
        const reply = await makeCode('reply', await gather(pc));
        arm(GUEST_OPEN_MS);
        return { link, reply };
      } catch (e) {
        link.close();
        throw e instanceof LinkError ? e : new LinkError('failed');
      }
    },
  };
}
