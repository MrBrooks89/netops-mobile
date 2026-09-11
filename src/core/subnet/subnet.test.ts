import { parseV4 } from '../ip/ip';
import { unwrap } from '../result/result';
import type { Ipv4Cidr } from '../ip/cidr';
import {
  binaryOctets,
  broadcastIntV4,
  legacyClassOf,
  networkIntV4,
  scopeOf,
  subnetReport,
  totalAddressCount,
  usableHostCount,
} from './subnet';

const cidr = (addr: string, prefix: number): Ipv4Cidr => ({
  address: unwrap(parseV4(addr)),
  prefixLength: prefix,
});

const rep = (addr: string, prefix: number) => subnetReport(cidr(addr, prefix));

describe('subnetReport — golden fixtures', () => {
  it('192.168.1.10/24 (class C private)', () => {
    const r = rep('192.168.1.10', 24);
    expect(r.netmask).toBe('255.255.255.0');
    expect(r.wildcardMask).toBe('0.0.0.255');
    expect(r.networkAddress).toBe('192.168.1.0');
    expect(r.broadcastAddress).toBe('192.168.1.255');
    expect(r.firstHost).toBe('192.168.1.1');
    expect(r.lastHost).toBe('192.168.1.254');
    expect(r.hostRange).toBe('192.168.1.1 - 192.168.1.254');
    expect(r.hostCount).toBe(254);
    expect(r.totalAddresses).toBe(256);
    expect(r.classLegacy).toBe('C');
    expect(r.scope).toBe('private');
    expect(r.binaryView).toEqual(['11000000', '10101000', '00000001', '00001010']);
    expect(r.netmaskBinary).toEqual(['11111111', '11111111', '11111111', '00000000']);
    expect(r.cidrText).toBe('192.168.1.10/24');
    expect(r.notes.join(' ')).toContain('masked');
    expect(r.notes.join(' ')).toContain('RFC 1918');
  });

  it('10.0.0.5/8 (class A private)', () => {
    const r = rep('10.0.0.5', 8);
    expect(r.networkAddress).toBe('10.0.0.0');
    expect(r.broadcastAddress).toBe('10.255.255.255');
    expect(r.firstHost).toBe('10.0.0.1');
    expect(r.lastHost).toBe('10.255.255.254');
    expect(r.hostCount).toBe(16777214);
    expect(r.classLegacy).toBe('A');
    expect(r.scope).toBe('private');
  });

  it('172.16.32.7/12 (class B private)', () => {
    const r = rep('172.16.32.7', 12);
    expect(r.networkAddress).toBe('172.16.0.0');
    expect(r.broadcastAddress).toBe('172.31.255.255');
    expect(r.hostCount).toBe(1048574);
    expect(r.classLegacy).toBe('B');
    expect(r.scope).toBe('private');
  });

  it('203.0.113.9/26 (documentation range, partial last octet)', () => {
    const r = rep('203.0.113.9', 26);
    expect(r.netmask).toBe('255.255.255.192');
    expect(r.wildcardMask).toBe('0.0.0.63');
    expect(r.networkAddress).toBe('203.0.113.0');
    expect(r.broadcastAddress).toBe('203.0.113.63');
    expect(r.firstHost).toBe('203.0.113.1');
    expect(r.lastHost).toBe('203.0.113.62');
    expect(r.hostCount).toBe(62);
    expect(r.scope).toBe('documentation');
  });

  it('0.0.0.0/0 — default route edge case', () => {
    const r = rep('0.0.0.0', 0);
    expect(r.netmask).toBe('0.0.0.0');
    expect(r.wildcardMask).toBe('255.255.255.255');
    expect(r.networkAddress).toBe('0.0.0.0');
    expect(r.broadcastAddress).toBe('255.255.255.255');
    expect(r.firstHost).toBe('0.0.0.1');
    expect(r.lastHost).toBe('255.255.255.254');
    expect(r.hostCount).toBe(4294967294);
    expect(r.totalAddresses).toBe(4294967296);
    expect(r.scope).toBe('this-network');
    expect(r.notes.join(' ')).toContain('Default route');
  });

  it('192.168.1.1/31 — RFC 3021 point-to-point, no broadcast', () => {
    const r = rep('192.168.1.1', 31);
    expect(r.netmask).toBe('255.255.255.254');
    expect(r.broadcastAddress).toBeNull();
    expect(r.networkAddress).toBe('192.168.1.0');
    expect(r.firstHost).toBe('192.168.1.0');
    expect(r.lastHost).toBe('192.168.1.1');
    expect(r.hostCount).toBe(2);
    expect(r.totalAddresses).toBe(2);
    expect(r.notes.join(' ')).toContain('RFC 3021');
  });

  it('192.168.1.7/32 — single host route, no broadcast', () => {
    const r = rep('192.168.1.7', 32);
    expect(r.netmask).toBe('255.255.255.255');
    expect(r.wildcardMask).toBe('0.0.0.0');
    expect(r.broadcastAddress).toBeNull();
    expect(r.networkAddress).toBe('192.168.1.7');
    expect(r.firstHost).toBe('192.168.1.7');
    expect(r.lastHost).toBe('192.168.1.7');
    expect(r.hostRange).toBe('192.168.1.7');
    expect(r.hostCount).toBe(1);
    expect(r.totalAddresses).toBe(1);
  });

  it('8.8.8.8/32 — public host route', () => {
    const r = rep('8.8.8.8', 32);
    expect(r.scope).toBe('public');
    expect(r.classLegacy).toBe('A');
    expect(r.hostCount).toBe(1);
  });

  it('224.0.0.1/4 — class D multicast', () => {
    const r = rep('224.0.0.1', 4);
    expect(r.networkAddress).toBe('224.0.0.0');
    expect(r.broadcastAddress).toBe('239.255.255.255');
    expect(r.classLegacy).toBe('D');
    expect(r.scope).toBe('multicast');
  });

  it('255.255.255.255/32 — limited broadcast', () => {
    const r = rep('255.255.255.255', 32);
    expect(r.scope).toBe('broadcast');
  });

  it('100.64.5.5/10 — CGNAT space', () => {
    const r = rep('100.64.5.5', 10);
    expect(r.networkAddress).toBe('100.64.0.0');
    expect(r.broadcastAddress).toBe('100.127.255.255');
    expect(r.scope).toBe('cgnat');
  });

  it('169.254.10.10/16 — link-local APIPA', () => {
    const r = rep('169.254.10.10', 16);
    expect(r.networkAddress).toBe('169.254.0.0');
    expect(r.scope).toBe('link-local');
  });

  it('127.0.0.1/8 — loopback', () => {
    const r = rep('127.0.0.1', 8);
    expect(r.scope).toBe('loopback');
  });

  it('198.18.0.1/15 — benchmarking range', () => {
    const r = rep('198.18.0.1', 15);
    expect(r.networkAddress).toBe('198.18.0.0');
    expect(r.broadcastAddress).toBe('198.19.255.255');
    expect(r.scope).toBe('benchmark');
  });

  it('rejects an out-of-range prefix as a programmer error', () => {
    expect(() => rep('1.2.3.4', 33)).toThrow(RangeError);
    expect(() => rep('1.2.3.4', -1)).toThrow(RangeError);
  });
});

describe('usableHostCount', () => {
  it.each([
    [0, 4294967294],
    [8, 16777214],
    [16, 65534],
    [24, 254],
    [25, 126],
    [30, 2],
    [31, 2], // RFC 3021
    [32, 1],
  ])('/%i → %i usable hosts', (prefix, expected) => {
    expect(usableHostCount(prefix)).toBe(expected);
  });

  it('total addresses is always 2^(32-prefix)', () => {
    for (let p = 0; p <= 32; p++) {
      expect(totalAddressCount(p)).toBe(2 ** (32 - p));
    }
  });
});

describe('network/broadcast bit math', () => {
  it('clears host bits for the network and sets them for broadcast', () => {
    const addr = unwrap(parseV4('192.168.1.130')).int;
    expect(networkIntV4(addr, 25)).toBe(unwrap(parseV4('192.168.1.128')).int);
    expect(broadcastIntV4(addr, 25)).toBe(unwrap(parseV4('192.168.1.255')).int);
  });

  it('is identity at /32 and full-range at /0', () => {
    const addr = unwrap(parseV4('203.0.113.7')).int;
    expect(networkIntV4(addr, 32)).toBe(addr);
    expect(broadcastIntV4(addr, 32)).toBe(addr);
    expect(networkIntV4(addr, 0)).toBe(0n);
    expect(broadcastIntV4(addr, 0)).toBe(4294967295n);
  });
});

describe('legacyClassOf', () => {
  it.each([
    ['1.0.0.0', 'A'],
    ['127.0.0.1', 'A'],
    ['128.0.0.1', 'B'],
    ['191.255.0.1', 'B'],
    ['192.0.0.1', 'C'],
    ['223.255.255.255', 'C'],
    ['224.0.0.1', 'D'],
    ['239.255.255.255', 'D'],
    ['240.0.0.1', 'E'],
    ['255.255.255.255', 'E'],
  ])('%s → class %s', (addr, expected) => {
    expect(legacyClassOf(unwrap(parseV4(addr)).int)).toBe(expected);
  });
});

describe('scopeOf', () => {
  it.each([
    ['8.8.8.8', 'public'],
    ['10.1.1.1', 'private'],
    ['172.20.0.1', 'private'],
    ['192.168.5.5', 'private'],
    ['0.0.0.0', 'this-network'],
    ['100.100.0.1', 'cgnat'],
    ['255.255.255.255', 'broadcast'],
    ['240.0.0.1', 'reserved'],
  ])('%s → %s', (addr, expected) => {
    expect(scopeOf(unwrap(parseV4(addr)).int)).toBe(expected);
  });
});

describe('binaryOctets', () => {
  it('pads each octet to 8 bits', () => {
    expect(binaryOctets(unwrap(parseV4('1.2.3.4')).int)).toEqual([
      '00000001',
      '00000010',
      '00000011',
      '00000100',
    ]);
  });

  it('renders the all-ones address', () => {
    expect(binaryOctets(unwrap(parseV4('255.255.255.255')).int)).toEqual([
      '11111111',
      '11111111',
      '11111111',
      '11111111',
    ]);
  });
});
