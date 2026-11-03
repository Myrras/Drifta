import { APP_VERSION, LinkError } from './protocol';

type Kind = 'invite' | 'reply';

const tag = (k: Kind) => (k === 'invite' ? 'I' : 'R');
const PREFIX = 'DRIFTA-';

async function pipe(data: Uint8Array, t: CompressionStream | DecompressionStream) {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(t);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toB64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new LinkError('bad-code');
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function makeCode(kind: Kind, sdp: string): Promise<string> {
  const json = JSON.stringify({ v: APP_VERSION, k: tag(kind), s: sdp });
  const packed = await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw'));
  return `${PREFIX}${tag(kind)}-${toB64url(packed)}`;
}

export async function readCode(code: string, want: Kind): Promise<string> {
  const m = /^DRIFTA-([IR])-(.+)$/.exec(code.replace(/[\s`]+/g, ''));
  if (!m) throw new LinkError('bad-code');
  let o: unknown;
  try {
    const raw = await pipe(fromB64url(m[2]), new DecompressionStream('deflate-raw'));
    o = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch {
    throw new LinkError('bad-code');
  }
  if (typeof o !== 'object' || o === null) throw new LinkError('bad-code');
  const { v, k, s } = o as Record<string, unknown>;
  if ((k !== 'I' && k !== 'R') || typeof s !== 'string' || k !== m[1])
    throw new LinkError('bad-code');
  if (k !== tag(want)) throw new LinkError('wrong-kind');
  if (v !== APP_VERSION) throw new LinkError('version');
  return s;
}
