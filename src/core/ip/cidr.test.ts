import { parseV4 } from './ip';
import { unwrap } from '../result/result';
import {
  asV4Cidr,
  asV6Cidr,
  assertV4Prefix,
  cidrToString,
  isV4HostMask,
  maskToPrefix,
  parseCidr,
  prefixToMaskV4,
  v4CidrOf,
  wildcardMaskV4,
} from './cidr';

const v4 = (s: string) => unwrap(parseV4(s));

describe('prefix ↔ netmask round-trip', () => {
  it.each([
    [0, '0.0.0.0'],
    [1, '128.0.0.0'],
    [8, '255.0.0.0'],
    [16, '255.255.0.0'],
    [24, '255.255.255.0'],
    [25, '255.255.255.128'],
    [30, '255.255.255.252'],
    [31, '255.255.255.254'],
    [32, '255.255.255.255'],
  ])('/%i → %s', (prefix, mask) => {
    expect(prefixToMaskV4(prefix).value).toBe(mask);
  });

  it('round-trips every IPv4 prefix', () => {
    for (let p = 0; p <= 32; p++) {
      expect(maskToPrefix(prefixToMaskV4(p).int)).toBe(p);
    }
  });

  it('every generated mask is contiguous', () => {
    for (let p = 0; p <= 32; p++) {
      expect(isV4HostMask(prefixToMaskV4(p).int)).toBe(false);
    }
  });
});

describe('wildcardMaskV4', () => {
  it.each([
    [0, '255.255.255.255'],
    [24, '0.0.0.255'],
    [25, '0.0.0.127'],
    [30, '0.0.0.3'],
    [32, '0.0.0.0'],
  ])('/%i → %s', (prefix, mask) => {
    expect(wildcardMaskV4(prefix).value).toBe(mask);
  });

  it('is the bitwise inverse of the netmask', () => {
    for (let p = 0; p <= 32; p++) {
      expect(wildcardMaskV4(p).int ^ prefixToMaskV4(p).int).toBe(4294967295n);
    }
  });
});

describe('isV4HostMask', () => {
  it.each([
    ['255.255.255.0', false],
    ['255.255.255.255', false],
    ['0.0.0.0', false],
    ['128.0.0.0', false],
    ['255.255.254.0', false],
    ['255.0.255.0', true],
    ['255.255.255.253', true],
    ['0.255.0.0', true],
  ])('%s → non-contiguous=%s', (addr, expected) => {
    expect(isV4HostMask(v4(addr).int)).toBe(expected);
  });
});

describe('assertV4Prefix', () => {
  it('accepts 0..32 and rejects everything else', () => {
    expect(() => assertV4Prefix(0)).not.toThrow();
    expect(() => assertV4Prefix(32)).not.toThrow();
    expect(() => assertV4Prefix(33)).toThrow(RangeError);
    expect(() => assertV4Prefix(-1)).toThrow(RangeError);
    expect(() => assertV4Prefix(24.5)).toThrow(RangeError);
  });
});

describe('v4CidrOf', () => {
  it('masks host bits into the network', () => {
    expect(cidrToString(v4CidrOf(v4('192.168.1.130').int, 25))).toBe('192.168.1.128/25');
  });

  it('is identity at /32', () => {
    expect(cidrToString(v4CidrOf(v4('10.1.2.3').int, 32))).toBe('10.1.2.3/32');
  });
});

describe('parseCidr', () => {
  it('parses address/prefix and address+netmask forms', () => {
    expect(unwrap(parseCidr('192.168.1.0/24')).prefixLength).toBe(24);
    expect(unwrap(parseCidr('192.168.1.0 255.255.255.0')).prefixLength).toBe(24);
    expect(unwrap(parseCidr('  10.0.0.0/8  ')).prefixLength).toBe(8);
  });

  it('accepts /0 and /32 boundaries', () => {
    expect(unwrap(parseCidr('0.0.0.0/0')).prefixLength).toBe(0);
    expect(unwrap(parseCidr('10.0.0.1/32')).prefixLength).toBe(32);
  });

  it('rejects malformed input with INVALID_INPUT', () => {
    for (const bad of [
      'nonsense',
      '192.168.1.0',
      '192.168.1.0/',
      '/24',
      '10.0.0.0/33',
      '999.1.1.1/24',
    ]) {
      const r = parseCidr(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('INVALID_INPUT');
    }
  });

  it('rejects non-contiguous netmasks', () => {
    expect(parseCidr('10.0.0.0 255.0.255.0').ok).toBe(false);
    expect(parseCidr('10.0.0.0 255.255.255.253').ok).toBe(false);
  });

  it('parses IPv6 CIDRs and enforces the 128 limit', () => {
    expect(unwrap(parseCidr('2001:db8::/32')).prefixLength).toBe(32);
    expect(parseCidr('::/129').ok).toBe(false);
  });
});

describe('asV4Cidr', () => {
  it('passes IPv4 through and explains IPv6 clearly', () => {
    const good = asV4Cidr(unwrap(parseCidr('192.168.1.0/24')));
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.value.address.value).toBe('192.168.1.0');

    const bad = asV4Cidr(unwrap(parseCidr('2001:db8::/32')));
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error.code).toBe('INVALID_INPUT');
      expect(bad.error.message).toContain('IPv4');
      // Names the tool that does handle it, now that the tool exists.
      expect(bad.error.message).toContain('IPv6 Calculator');
    }
  });
});

describe('asV6Cidr', () => {
  it('passes IPv6 through and points IPv4 at the subnet calculator', () => {
    const good = asV6Cidr(unwrap(parseCidr('2001:db8::/32')));
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.value.address.value).toBe('2001:db8::');

    const bad = asV6Cidr(unwrap(parseCidr('192.168.1.0/24')));
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error.code).toBe('INVALID_INPUT');
      expect(bad.error.message).toContain('IPv6');
      expect(bad.error.message).toContain('Subnet Calculator');
    }
  });
});
