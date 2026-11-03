import { describe, expect, it } from 'vitest';
import { APP_VERSION, decode, encode, type Msg } from './protocol';

const info = {
  name: 'DRIFT_99',
  car: 'ae86' as const,
  color: '#ff0044',
  look: { paint: 'red', spoiler: 'gt', hood: true },
};

const all: Msg[] = [
  { t: 'hello', v: APP_VERSION, info },
  { t: 'hello', v: APP_VERSION, info: { name: 'A', car: 'celica', color: '#fff' } },
  { t: 'ping', id: 3, at: 1234.5 },
  { t: 'pong', id: 3, at: 1234.5 },
  { t: 'map', map: 'Harbor' },
  { t: 'ready', ready: true },
  { t: 'ready', ready: false },
  { t: 'start', map: 'Harbor', delay: 3000 },
  { t: 'pose', time: 12.5, x: -40.25, y: 300, angle: 1.57, floor: 1 },
  { t: 'score', banked: 12000, combo: 450 },
  { t: 'finish', total: 54321, time: 88.2 },
  { t: 'lobby' },
  { t: 'leave' },
];

const hello = (i: Record<string, unknown>) =>
  JSON.stringify({ t: 'hello', v: '1', info: { ...info, ...i } });

describe('protocol', () => {
  it('exposes the app version', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('roundtrips every message kind', () => {
    for (const m of all) expect(decode(encode(m))).toEqual(m);
  });

  it('drops unknown extra fields', () => {
    expect(decode('{"t":"leave","x":1}')).toEqual({ t: 'leave' });
  });

  it.each([
    ['bad JSON', '{"t":"ping",'],
    ['non-string input', { t: 'leave' }],
    ['non-object JSON', '[1,2]'],
    ['null JSON', 'null'],
    ['unknown t', '{"t":"teleport"}'],
    ['missing field', '{"t":"ping","id":1}'],
    ['string number', '{"t":"ping","id":"1","at":2}'],
    ['NaN number', encode({ t: 'pose', time: 1, x: NaN, y: 0, angle: 0, floor: 0 })],
    ['Infinity number', '{"t":"finish","total":1e999,"time":3}'],
    ['non-boolean ready', '{"t":"ready","ready":1}'],
    ['long map name', JSON.stringify({ t: 'map', map: 'x'.repeat(65) })],
    ['long version', JSON.stringify({ t: 'hello', v: 'x'.repeat(65), info })],
    ['lowercase name', hello({ name: 'drift' })],
    ['empty name', hello({ name: '' })],
    ['too long name', hello({ name: 'ABCDEFGHIJKLM' })],
    ['unknown car', hello({ car: 'f40' })],
    ['inherited car key', hello({ car: 'toString' })],
    ['long color', hello({ color: '#'.repeat(65) })],
    ['array look', hello({ look: ['rays'] })],
    ['string look', hello({ look: 'rays' })],
    ['null look', hello({ look: null })],
    ['missing info', '{"t":"hello","v":"1"}'],
  ])('rejects %s', (_, raw) => {
    expect(decode(raw)).toBeNull();
  });

  const lookOf = (raw: string) => {
    const m = decode(raw);
    return m?.t === 'hello' ? m.info.look : null;
  };

  it('keeps only known look keys', () => {
    expect(lookOf(hello({ look: { paint: 'red', wheels: 'rays' } }))).toEqual({ paint: 'red' });
  });

  it('drops look values of the wrong type', () => {
    const look = { paint: 1, skin: true, hood: 'yes', tint: 'x'.repeat(65), smoke: 'blue' };
    expect(lookOf(hello({ look }))).toEqual({ smoke: 'blue' });
  });

  it('omits look when nothing valid remains', () => {
    const m = decode(hello({ look: { wheels: 'rays', hood: 1 } }));
    expect(m?.t === 'hello' && 'look' in m.info).toBe(false);
  });

  it('does not carry __proto__ or constructor look keys', () => {
    const raw = hello({}).replace(
      /"look":\{/,
      '"look":{"__proto__":{"polluted":true},"constructor":{"x":1},',
    );
    const look = lookOf(raw);
    expect(look).toEqual(info.look);
    expect(Object.getPrototypeOf(look)).toBe(Object.prototype);
    expect(Object.hasOwn(look!, '__proto__')).toBe(false);
    expect(Object.hasOwn(look!, 'constructor')).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('keeps a long but valid map name at the limit', () => {
    const m: Msg = { t: 'map', map: 'x'.repeat(64) };
    expect(decode(encode(m))).toEqual(m);
  });
});
