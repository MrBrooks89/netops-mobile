/**
 * IPv6 subnet math: network, first/last address, block size, scope, and the
 * expanded/binary views the calculator shows.
 *
 * Where IPv6 differs from the IPv4 sibling in `subnet.ts`, deliberately:
 *  - **128-bit counts are bigints.** `2^64` addresses in a /64 is not a number
 *    a JS `number` can hold, so counts stay exact and are formatted (grouped
 *    digits when short enough, `2^n` beyond that).
 *  - **Nothing is reserved.** IPv4 subtracts network and broadcast addresses;
 *    IPv6 has no broadcast at all, and the all-zero interface identifier is
 *    *reserved for use* as the subnet-router anycast address (RFC 4291 §2.6.1)
 *    rather than removed from the block. So "addresses in the block" is the
 *    only count the calculator reports, with the anycast reservation as a note.
 *  - **No netmask/wildcard/legacy class.** A prefix length is the notation,
 *    and classful addressing never existed here.
 *
 * Pure TS — no React Native imports. Invalid prefix lengths are programmer
 * errors (assertions); invalid user input is rejected by `core/ip/cidr.ts`.
 */

import { formatV6 } from '../ip/ip';
import { V6_MAX, assertV6Prefix, prefixToMaskV6, type Ipv6Cidr } from '../ip/cidr';
import { groupDigitsBig } from '../util/format';

/** RFC-derived kind of address space, checked in order (first match wins). */
export type Ipv6Scope =
  | 'unspecified'
  | 'loopback'
  | 'ipv4-mapped'
  | 'nat64'
  | 'discard'
  | 'documentation'
  | 'unique-local'
  | 'link-local'
  | 'multicast'
  | 'global-unicast'
  | 'transition'
  | 'reserved';

export interface Subnet6Report {
  readonly cidr: Ipv6Cidr;
  readonly cidrText: string;
  readonly prefixLength: number;
  /** Canonical (RFC 5952) form of the *input* address. */
  readonly address: string;
  /**
   * Network address: the input masked to the prefix. In IPv6 this is also the
   * lowest address of the block (its all-zero interface identifier is the
   * subnet-router anycast address, so there is no separate "first address").
   */
  readonly networkAddress: string;
  /** Highest address in the block. */
  readonly lastAddress: string;
  /** Exact block size, as a bigint (2^(128-prefix)). */
  readonly addressCount: bigint;
  /** Display form: grouped digits when short, `2^n` when huge. */
  readonly addressCountText: string;
  /** Full eight-hextet form of the network address. */
  readonly expanded: string;
  /** The prefix as a 128-bit mask, canonical form. */
  readonly prefixMask: string;
  /** Eight 16-bit binary strings, MSB first (one per hextet). */
  readonly binaryView: string[];
  readonly scope: Ipv6Scope;
  readonly notes: string[];
}

/** `hexDigits` of 4-bit groups, e.g. 0x2001 → "0010 0000 0000 0001". */
function hexetBinary(hextet: bigint): string {
  return hextet.toString(2).padStart(16, '0');
}

/** Network address (host bits cleared). */
export const networkIntV6 = (int: bigint, prefix: number): bigint => {
  assertV6Prefix(prefix);
  const mask = prefix === 0 ? 0n : (V6_MAX << BigInt(128 - prefix)) & V6_MAX;
  return int & mask;
};

/** Highest address in the block (host bits set). */
export const lastIntV6 = (int: bigint, prefix: number): bigint => {
  assertV6Prefix(prefix);
  const mask = prefix === 0 ? 0n : (V6_MAX << BigInt(128 - prefix)) & V6_MAX;
  return (int & mask) | (V6_MAX ^ mask);
};

/** Exact number of addresses in the block: 2^(128-prefix). */
export function addressCountV6(prefix: number): bigint {
  assertV6Prefix(prefix);
  return 1n << BigInt(128 - prefix);
}

/** Eight hextets, four hex digits each, no compression. */
export function expandV6(int: bigint): string {
  const groups: string[] = [];
  let rest = int;
  for (let i = 0; i < 8; i++) {
    groups.unshift((rest & 0xffffn).toString(16).padStart(4, '0'));
    rest >>= 16n;
  }
  return groups.join(':');
}

/** Eight 16-bit binary strings, MSB first. */
export function binaryHextetsV6(int: bigint): string[] {
  const groups: bigint[] = [];
  let rest = int;
  for (let i = 0; i < 8; i++) {
    groups.unshift(rest & 0xffffn);
    rest >>= 16n;
  }
  return groups.map(hexetBinary);
}

/**
 * Build a 128-bit value from eight hextets.
 *
 * Written this way on purpose: a hex literal silently loses a leading zero
 * (`0x64ff9b…` is not `0x0064ff9b…`), which is exactly the bug this table had
 * first — every IPv4-mapped and NAT64 address fell through to "reserved".
 */
const v6 = (...hextets: readonly number[]): bigint =>
  hextets.reduce((acc, hextet) => (acc << 16n) | BigInt(hextet), 0n);

/** [first, last, scope] as 128-bit bounds — checked in order, first match wins. */
const SCOPE_RANGES: readonly (readonly [bigint, bigint, Ipv6Scope])[] = [
  [v6(0, 0, 0, 0, 0, 0, 0, 0), v6(0, 0, 0, 0, 0, 0, 0, 0), 'unspecified'],
  [v6(0, 0, 0, 0, 0, 0, 0, 1), v6(0, 0, 0, 0, 0, 0, 0, 1), 'loopback'],
  // ::ffff:0:0/96 — 80 zero bits, then ffff, then the embedded IPv4 address.
  [v6(0, 0, 0, 0, 0, 0xffff, 0, 0), v6(0, 0, 0, 0, 0, 0xffff, 0xffff, 0xffff), 'ipv4-mapped'],
  // 64:ff9b::/96 — the well-known NAT64 prefix (RFC 6052).
  [v6(0x64, 0xff9b, 0, 0, 0, 0, 0, 0), v6(0x64, 0xff9b, 0, 0, 0, 0, 0xffff, 0xffff), 'nat64'],
  // 100::/64 — discard-only (RFC 6666).
  [v6(0x100, 0, 0, 0, 0, 0, 0, 0), v6(0x100, 0, 0, 0, 0xffff, 0xffff, 0xffff, 0xffff), 'discard'],
  // 2001:db8::/32 — documentation (RFC 3849). Must precede 2001::/32 below,
  // which contains it.
  [
    v6(0x2001, 0xdb8, 0, 0, 0, 0, 0, 0),
    v6(0x2001, 0xdb8, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff),
    'documentation',
  ],
  // 2001::/32 — Teredo.
  [
    v6(0x2001, 0, 0, 0, 0, 0, 0, 0),
    v6(0x2001, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff),
    'transition',
  ],
  // 2002::/16 — 6to4.
  [
    v6(0x2002, 0, 0, 0, 0, 0, 0, 0),
    v6(0x2002, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff),
    'transition',
  ],
  // fc00::/7 — unique local addresses (RFC 4193).
  [
    v6(0xfc00, 0, 0, 0, 0, 0, 0, 0),
    v6(0xfdff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff),
    'unique-local',
  ],
  // fe80::/10 — link-local.
  [
    v6(0xfe80, 0, 0, 0, 0, 0, 0, 0),
    v6(0xfebf, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff),
    'link-local',
  ],
  // ff00::/8 — multicast.
  [
    v6(0xff00, 0, 0, 0, 0, 0, 0, 0),
    v6(0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff),
    'multicast',
  ],
  // 2000::/3 — the global unicast range.
  [
    v6(0x2000, 0, 0, 0, 0, 0, 0, 0),
    v6(0x3fff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff),
    'global-unicast',
  ],
];

const SCOPE_NOTES: Partial<Record<Ipv6Scope, string>> = {
  unspecified: 'The unspecified address (::) — never assigned to an interface.',
  loopback: 'Loopback (::1) — never routable beyond the host.',
  'ipv4-mapped': 'IPv4-mapped address: an IPv4 address carried inside IPv6.',
  nat64: 'RFC 6052 IPv4/IPv6 translation prefix (NAT64 well-known prefix).',
  discard: 'RFC 6666 discard-only prefix — traffic here is dropped by design.',
  documentation: 'RFC 3849 documentation prefix: safe for examples, never routable.',
  'unique-local': 'RFC 4193 unique local address (ULA) — the IPv6 equivalent of RFC 1918.',
  'link-local': 'Link-local (fe80::/10) — valid only on one link, never routed.',
  multicast: 'Multicast — one-to-many delivery, not a host address.',
  'global-unicast': 'Global unicast (2000::/3) — the routable public space.',
  transition: 'Transition/legacy mechanism space (Teredo or 6to4).',
  reserved: 'Outside the global unicast range: reserved or not yet allocated.',
};

/** Address scope for a 128-bit value (RFC-derived; see SCOPE_RANGES). */
export function scopeOfV6(int: bigint): Ipv6Scope {
  for (const [first, last, scope] of SCOPE_RANGES) {
    if (int >= first && int <= last) return scope;
  }
  return 'reserved';
}

/**
 * Display form for an exact address count.
 *
 * A /64 (18,446,744,073,709,551,616 addresses) is worth showing in full — it is
 * the number IPv6 planning conversations actually cite — while a /32 or shorter
 * is not, so those keep the 2^n form.
 */
export function addressCountText(count: bigint, prefix: number): string {
  if (count < 10n ** 21n) return groupDigitsBig(count);
  return `2^${128 - prefix}`;
}

/** Build the full report. Asserts the prefix, never returns Result. */
export function subnet6Report(cidr: Ipv6Cidr): Subnet6Report {
  const { prefixLength, address } = cidr;
  assertV6Prefix(prefixLength);

  const networkInt = networkIntV6(address.int, prefixLength);
  const lastInt = lastIntV6(address.int, prefixLength);
  const networkAddress = formatV6(networkInt);
  const notes: string[] = [];

  if (networkInt !== address.int) {
    notes.push('Host bits were set — the address has been masked to its network address.');
  }
  if (prefixLength === 0) {
    notes.push('Default route: covers the entire IPv6 address space.');
  }
  if (prefixLength === 64) {
    notes.push(
      'A /64 is the standard subnet size: the low 64 bits are the interface identifier, which is what stateless address autoconfiguration (SLAAC) requires.',
    );
  }
  if (prefixLength > 64 && prefixLength < 127) {
    notes.push(
      'Prefixes longer than /64 leave less than a full interface identifier; they are valid but break SLAAC on that link.',
    );
  }
  if (prefixLength === 127) {
    notes.push('RFC 6164 recommends /127 for point-to-point links (no address is wasted).');
  }
  if (prefixLength === 128) {
    notes.push('Single-host route: the address itself is the only address in the block.');
  }
  if (prefixLength <= 64) {
    notes.push(
      'IPv6 has no network or broadcast address to subtract, and the all-zero interface identifier is reserved as the subnet-router anycast address (RFC 4291 §2.6.1) rather than removed from the block.',
    );
  }

  const scope = scopeOfV6(networkInt);
  const scopeNote = SCOPE_NOTES[scope];
  if (scopeNote) notes.push(scopeNote);

  const count = addressCountV6(prefixLength);

  return {
    cidr,
    cidrText: `${address.value}/${prefixLength}`,
    prefixLength,
    address: address.value,
    networkAddress: networkAddress.value,
    lastAddress: formatV6(lastInt).value,
    addressCount: count,
    addressCountText: addressCountText(count, prefixLength),
    expanded: expandV6(networkInt),
    prefixMask: prefixToMaskV6(prefixLength).value,
    binaryView: binaryHextetsV6(address.int),
    scope,
    notes,
  };
}
