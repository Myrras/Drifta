import { describe, expect, it } from 'vitest';
import { makeCode, readCode } from './codes';
import { LinkError } from './protocol';

const SDP = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 54321 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 203.0.113.45',
  'a=candidate:1467250027 1 udp 2122260223 192.168.1.23 54321 typ host generation 0 network-id 1 network-cost 10',
  'a=candidate:2999745851 1 udp 2122194687 172.17.0.1 54322 typ host generation 0 network-id 2',
  'a=candidate:3348829419 1 udp 1686052607 203.0.113.45 54321 typ srflx raddr 192.168.1.23 rport 54321 generation 0 network-id 1 network-cost 10',
  'a=candidate:3724681102 1 udp 2122129151 2001:db8:85a3:4e1c:9a2b:3c4d:5e6f:7a8b 54323 typ host generation 0 network-id 3 network-cost 10',
  'a=candidate:842163049 1 udp 2122063615 4f3a9c2e-1b7d-4e8a-9c0f-2d6b5a8e1f34.local 54324 typ host generation 0 network-id 4',
  'a=candidate:1236473947 1 tcp 1518280447 192.168.1.23 9 typ host tcptype active generation 0 network-id 1 network-cost 10',
  'a=candidate:4233069003 1 tcp 1518214911 172.17.0.1 9 typ host tcptype active generation 0 network-id 2',
  'a=candidate:2541209731 1 tcp 1518149375 2001:db8:85a3:4e1c:9a2b:3c4d:5e6f:7a8b 9 typ host tcptype active generation 0 network-id 3 network-cost 10',
  'a=ice-ufrag:Hq3x',
  'a=ice-pwd:k2L7fJd9sQw1zXc8vBn4mR0t',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 7B:8C:2F:9A:41:D3:6E:05:B7:1C:88:F2:3A:9D:E4:60:1F:C5:72:0B:AE:93:4D:16:58:E7:2C:B9:03:6F:D1:8A',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
  '',
].join('\r\n');

async function rawCode(prefix: string, payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const buf = new Uint8Array(await new Response(s).arrayBuffer());
  const b64 = btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return prefix + b64;
}

async function reason(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(LinkError);
    return (e as LinkError).reason;
  }
  throw new Error('expected rejection');
}

describe('codes', () => {
  it('roundtrips both kinds', async () => {
    const inv = await makeCode('invite', SDP);
    const rep = await makeCode('reply', SDP);
    expect(inv.startsWith('DRIFTA-I-')).toBe(true);
    expect(rep.startsWith('DRIFTA-R-')).toBe(true);
    expect(await readCode(inv, 'invite')).toBe(SDP);
    expect(await readCode(rep, 'reply')).toBe(SDP);
  });

  it('keeps a realistic SDP short', async () => {
    const code = await makeCode('invite', SDP);
    console.log(`sdp ${SDP.length} chars -> code ${code.length} chars`);
    expect(code.length).toBeLessThan(1000);
  });

  it('tolerates whitespace, newlines and backticks', async () => {
    const code = await makeCode('invite', SDP);
    const mangled = '```\n' + code.match(/.{1,40}/g)!.join('\r\n ') + '\n```  ';
    expect(await readCode(mangled, 'invite')).toBe(SDP);
    expect(await readCode('`' + code + '`', 'invite')).toBe(SDP);
  });

  it('rejects the wrong kind', async () => {
    expect(await reason(readCode(await makeCode('reply', SDP), 'invite'))).toBe('wrong-kind');
    expect(await reason(readCode(await makeCode('invite', SDP), 'reply'))).toBe('wrong-kind');
  });

  it('rejects another version', async () => {
    const code = await rawCode('DRIFTA-I-', { v: '0.0.1-other', k: 'I', s: SDP });
    expect(await reason(readCode(code, 'invite'))).toBe('version');
  });

  it('rejects garbage as bad-code', async () => {
    const valid = await makeCode('invite', SDP);
    const cases = [
      '',
      'hello',
      valid.slice('DRIFTA-I-'.length),
      'DRIFTA-I-',
      'DRIFTA-I-!!!!',
      'DRIFTA-I-AAAA',
      valid.slice(0, 40),
      await rawCode('DRIFTA-I-', 'not an object'),
      await rawCode('DRIFTA-I-', { v: 'x', k: 'X', s: SDP }),
      await rawCode('DRIFTA-R-', { v: 'x', k: 'I', s: SDP }),
    ];
    for (const c of cases) expect(await reason(readCode(c, 'invite'))).toBe('bad-code');
  });
});
