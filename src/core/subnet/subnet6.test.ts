/**
 * IPv6 subnet maths tests — the parts that are easy to get subtly wrong:
 * masking, exact block sizes beyond 2^53, scope classification, the /64 and
 * /127 rules, and the expanded/binary views.
 */

import { parseCidr, asV6Cidr, type Ipv6Cidr } from '../ip/cidr';
import { unwrap } from '../result/result';
import {
  addressCountText,
  addressCountV6,
  binaryHextetsV6,
  expandV6,
  lastIntV6,
  networkIntV6,
  scopeOfV6,
  subnet6Report,
} from './subnet6';

const cidrOf = (text: string): Ipv6Cidr => unwrap(asV6Cidr(unwrap(parseCidr(text))));
const report = (text: string) => subnet6Report(cidrOf(text));

describe('v6 network maths', () => {
  it('masks host bits to the network address', () => {
    const report = subnet6Report(cidrOf('2001:db8:1:2:3:4:5:6/64'));
    expect(report.networkAddress).toBe('2001:db8:1:2::');
    // cidrText labels the report with the input as written, like the v4 tool.
    expect(report.cidrText).toBe('2001:db8:1:2:3:4:5:6/64');
    expect(report.address).toBe('2001:db8:1:2:3:4:5:6');
    expect(report.notes.join(' ')).toMatch(/masked to its network address/);
  });

  it('keeps a /128 as the single address it is', () => {
    const single = report('2001:db8::1/128');
    expect(single.networkAddress).toBe('2001:db8::1');
    expect(single.lastAddress).toBe('2001:db8::1');
    expect(single.addressCount).toBe(1n);
    expect(single.notes.join(' ')).toMatch(/only address in the block/);
  });

  it('counts a block exactly, past what a number can hold', () => {
    expect(addressCountV6(128)).toBe(1n);
    expect(addressCountV6(127)).toBe(2n);
    expect(addressCountV6(64)).toBe(18_446_744_073_709_551_616n);
    expect(addressCountV6(0)).toBe(1n << 128n);
    expect(report('2001:db8::/64').lastAddress).toBe('2001:db8::ffff:ffff:ffff:ffff');
  });

  it('rejects an impossible prefix instead of inventing an answer', () => {
    expect(() => addressCountV6(129)).toThrow(RangeError);
    expect(() => networkIntV6(0n, -1)).toThrow(RangeError);
  });

  it('computes first and last for the extremes', () => {
    const everything = report('::/0');
    expect(everything.networkAddress).toBe('::');
    expect(everything.lastAddress).toBe('ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff');
    expect(everything.notes.join(' ')).toMatch(/entire IPv6 address space/);

    // lastIntV6 of a /0 must be the top of the space, not wrapped.
    expect(lastIntV6(0n, 0)).toBe((1n << 128n) - 1n);
  });
});

describe('v6 scope classification', () => {
  it.each([
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['::ffff:192.168.1.1', 'ipv4-mapped'],
    ['64:ff9b::1', 'nat64'],
    ['100::1', 'discard'],
    ['2001:db8::1', 'documentation'],
    ['2001::1', 'transition'],
    ['2002::1', 'transition'],
    ['fc00::1', 'unique-local'],
    ['fd12:3456::1', 'unique-local'],
    ['fe80::1', 'link-local'],
    ['febf::1', 'link-local'],
    ['ff02::1', 'multicast'],
    ['2606:4700::1111', 'global-unicast'],
    ['100:0:0:1::1', 'reserved'],
    ['4000::1', 'reserved'],
  ])('classifies %s as %s', (address, expected) => {
    expect(scopeOfV6(unwrap(parseCidr(`${address}/128`)).address.int)).toBe(expected);
  });

  it('explains the scope in the notes', () => {
    expect(report('fe80::/64').notes.join(' ')).toMatch(/never routed/);
    expect(report('fc00::/7').notes.join(' ')).toMatch(/RFC 1918/);
  });
});

describe('v6 presentation fields', () => {
  it('expands to eight four-digit hextets', () => {
    expect(expandV6(unwrap(parseCidr('2001:db8::1/128')).address.int)).toBe(
      '2001:0db8:0000:0000:0000:0000:0000:0001',
    );
  });

  it('shows eight 16-bit binary groups', () => {
    const groups = binaryHextetsV6(unwrap(parseCidr('2001:db8::1/128')).address.int);
    expect(groups).toHaveLength(8);
    expect(groups[0]).toBe('0010000000000001');
    expect(groups[1]).toBe('0000110110111000');
    expect(groups[7]).toBe('0000000000000001');
  });

  it('renders the prefix as a 128-bit mask', () => {
    expect(report('2001:db8::/64').prefixMask).toBe('ffff:ffff:ffff:ffff::');
    expect(report('2001:db8::/128').prefixMask).toBe('ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff');
    expect(report('::/0').prefixMask).toBe('::');
  });

  it('formats counts in full only while they stay readable', () => {
    expect(addressCountText(18_446_744_073_709_551_616n, 64)).toBe('18,446,744,073,709,551,616');
    expect(addressCountText(1n << 96n, 32)).toBe('2^96');
    expect(report('2001:db8::/48').addressCountText).toBe('2^80');
  });
});

describe('v6 notes that encode the RFC rules', () => {
  it('calls out the /64 SLAAC rule and warns below it', () => {
    expect(report('2001:db8::/64').notes.join(' ')).toMatch(/standard subnet size/);
    expect(report('2001:db8::/72').notes.join(' ')).toMatch(/break SLAAC/);
  });

  it('recommends /127 for point-to-point links', () => {
    expect(report('2001:db8::/127').notes.join(' ')).toMatch(/RFC 6164/);
  });

  it('never subtracts a network or broadcast address', () => {
    const notes = report('2001:db8::/64').notes.join(' ');
    expect(notes).toMatch(/no network or broadcast address to subtract/);
    expect(notes).toMatch(/subnet-router anycast/);
  });
});
