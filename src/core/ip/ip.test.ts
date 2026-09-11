import {
  canonicalIp,
  compareIp,
  formatV4,
  formatV6,
  ipToString,
  parseIp,
  parseV4,
  parseV6,
  sameIp,
} from './ip';
import { unwrap } from '../result/result';

describe('parseV4', () => {
  it.each([
    ['0.0.0.0', 0n],
    ['192.168.1.1', 0xc0a80101n],
    ['255.255.255.255', 0xffffffffn],
    ['10.0.0.1', 0x0a000001n],
    ['1.2.3.4', 0x01020304n],
  ])('parses %s', (input, expected) => {
    const r = parseV4(input);
    expect(r.ok).toBe(true);
    expect(unwrap(r).int).toBe(expected);
    expect(unwrap(r).family).toBe(4);
  });

  it.each([
    ['256.1.1.1'],
    ['1.2.3'],
    ['1.2.3.4.5'],
    ['a.b.c.d'],
    ['01.2.3.4'], // leading zeros rejected
    ['1..2.3'],
    [''],
  ])('rejects %s', (input) => {
    expect(parseV4(input).ok).toBe(false);
  });

  it('trims surrounding whitespace', () => {
    expect(parseV4(' 10.0.0.1 ').ok).toBe(true);
  });

  it('rejects with INVALID_INPUT taxonomy code', () => {
    const r = parseV4('999.1.1.1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_INPUT');
  });
});

describe('formatV4', () => {
  it('round-trips through parseV4', () => {
    for (let i = 0; i < 500; i++) {
      const n = BigInt(Math.floor(Math.random() * 0xffffffff));
      const a = formatV4(n);
      const r = parseV4(a.value);
      expect(r.ok).toBe(true);
      expect(unwrap(r).int).toBe(n);
    }
  });
});

describe('parseV6', () => {
  it.each([
    ['::', 0n],
    ['::1', 1n],
    ['2001:db8::1', 0x20010db8000000000000000000000001n],
    ['2001:0db8:0000:0000:0000:0000:0000:0001', 0x20010db8000000000000000000000001n],
    ['fe80::', 0xfe800000000000000000000000000000n],
    ['::ffff:192.168.1.1', 0n + (0xffffn << 32n) + 0xc0a80101n],
    ['2001:db8:85a3:0:0:8a2e:370:7334', 0x20010db885a3000000008a2e03707334n],
  ])('parses %s', (input, expected) => {
    const r = parseV6(input);
    expect(r.ok).toBe(true);
    expect(unwrap(r).int).toBe(expected);
    expect(unwrap(r).family).toBe(6);
  });

  it.each([
    ['12345::'],
    ['1:2:3:4:5:6:7:8:9'], // too many groups
    [':::'],
    ['gg::1'],
    ['1:2:3:4:5:6:7'], // too few, no ::
    ['1:2:3:4:5:6:7:8:9'],
  ])('rejects %s', (input) => {
    expect(parseV6(input).ok).toBe(false);
  });

  it('compresses per RFC 5952 (longest run, leftmost on tie)', () => {
    expect(formatV6(0x20010db8000000000000000000000001n).value).toBe('2001:db8::1');
    expect(formatV6(1n).value).toBe('::1');
    expect(formatV6(0n).value).toBe('::');
    // tie: two runs of length 1 — no compression with runs < 2
    expect(formatV6(0x00010002000300040005000600070008n).value).toBe('1:2:3:4:5:6:7:8');
  });
});

describe('family-agnostic helpers', () => {
  it('parseIp dispatches by syntax', () => {
    expect(unwrap(parseIp('1.2.3.4')).family).toBe(4);
    expect(unwrap(parseIp('::1')).family).toBe(6);
  });

  it('canonicalIp re-formats', () => {
    const a = unwrap(parseIp('2001:0DB8::0:1'));
    expect(canonicalIp(a).value).toBe('2001:db8::1');
  });

  it('sameIp and compareIp', () => {
    const a = unwrap(parseIp('10.0.0.1'));
    const b = unwrap(parseIp('10.0.0.2'));
    const c = unwrap(parseIp('10.0.0.1'));
    expect(sameIp(a, c)).toBe(true);
    expect(sameIp(a, b)).toBe(false);
    expect(compareIp(a, b)).toBeLessThan(0);
    expect(compareIp(b, a)).toBeGreaterThan(0);
    expect(compareIp(a, unwrap(parseIp('::1')))).toBeLessThan(0); // v4 sorts before v6
  });

  it('ipToString returns canonical text', () => {
    expect(ipToString(unwrap(parseIp('192.168.001.1'.replace('001', '1'))))).toBe('192.168.1.1');
  });
});
