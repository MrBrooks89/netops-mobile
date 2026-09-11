/**
 * IPv4 subnet math: netmask, wildcard, network/broadcast, host range,
 * host count, binary view, legacy class, and address scope.
 *
 * Semantics that matter (and are asserted in the fixture tests):
 *  - `/31` uses RFC 3021: both addresses are usable, no broadcast.
 *  - `/32` is a single-host route: the address is the only usable host.
 *  - `/0` covers the whole IPv4 space (4294967294 usable hosts).
 *
 * Pure TS — no React Native imports. Invalid prefix lengths are programmer
 * errors (assertions); invalid *user input* is caught by core/ip/cidr.ts and
 * surfaces as a `Result`.
 */

import { formatV4 } from '../ip/ip';
import { assertV4Prefix, prefixToMaskV4, wildcardMaskV4, V4_MAX, type Ipv4Cidr } from '../ip/cidr';

export type LegacyClass = 'A' | 'B' | 'C' | 'D' | 'E';

/** What kind of address space this network belongs to (RFC-derived). */
export type IpScope =
  | 'public'
  | 'private'
  | 'cgnat'
  | 'loopback'
  | 'link-local'
  | 'multicast'
  | 'broadcast'
  | 'documentation'
  | 'benchmark'
  | 'reserved'
  | 'this-network';

export interface SubnetReport {
  readonly cidr: Ipv4Cidr;
  readonly cidrText: string;
  readonly netmask: string;
  readonly wildcardMask: string;
  readonly networkAddress: string;
  /** null for /31 and /32 — RFC 3021 has no broadcast reservation. */
  readonly broadcastAddress: string | null;
  readonly firstHost: string | null;
  readonly lastHost: string | null;
  /** "first - last", or the single address for /32. */
  readonly hostRange: string | null;
  /** Usable host addresses (RFC 3021 for /31,/32). */
  readonly hostCount: number;
  /** All addresses in the block, including network/broadcast. */
  readonly totalAddresses: number;
  /** Input address as four 8-bit strings, MSB first. */
  readonly binaryView: string[];
  /** Netmask as four 8-bit strings, MSB first. */
  readonly netmaskBinary: string[];
  readonly classLegacy: LegacyClass;
  readonly scope: IpScope;
  readonly notes: string[];
}

const ip4 = (a: number, b: number, c: number, d: number): bigint =>
  (BigInt(a) << 24n) | (BigInt(b) << 16n) | (BigInt(c) << 8n) | BigInt(d);

/** [first, last, scope] — checked in order, first match wins. */
const SCOPE_RANGES: readonly (readonly [bigint, bigint, IpScope])[] = [
  [ip4(0, 0, 0, 0), ip4(0, 255, 255, 255), 'this-network'],
  [ip4(10, 0, 0, 0), ip4(10, 255, 255, 255), 'private'],
  [ip4(100, 64, 0, 0), ip4(100, 127, 255, 255), 'cgnat'],
  [ip4(127, 0, 0, 0), ip4(127, 255, 255, 255), 'loopback'],
  [ip4(169, 254, 0, 0), ip4(169, 254, 255, 255), 'link-local'],
  [ip4(172, 16, 0, 0), ip4(172, 31, 255, 255), 'private'],
  [ip4(192, 0, 2, 0), ip4(192, 0, 2, 255), 'documentation'],
  [ip4(192, 168, 0, 0), ip4(192, 168, 255, 255), 'private'],
  [ip4(198, 18, 0, 0), ip4(198, 19, 255, 255), 'benchmark'],
  [ip4(198, 51, 100, 0), ip4(198, 51, 100, 255), 'documentation'],
  [ip4(203, 0, 113, 0), ip4(203, 0, 113, 255), 'documentation'],
  [ip4(224, 0, 0, 0), ip4(239, 255, 255, 255), 'multicast'],
  [ip4(240, 0, 0, 0), ip4(255, 255, 255, 254), 'reserved'],
];

const SCOPE_NOTES: Partial<Record<IpScope, string>> = {
  private: 'RFC 1918 private address space.',
  cgnat: 'RFC 6598 carrier-grade NAT space (not private, not public).',
  loopback: 'Loopback range — never routable beyond the host.',
  'link-local': 'RFC 3927 link-local (APIPA) range — self-assigned when DHCP fails.',
  multicast: 'Multicast range — one-to-many delivery, not host addresses.',
  broadcast: 'Limited broadcast address.',
  documentation: 'RFC 5737 documentation range: safe for examples, never routable.',
  benchmark: 'RFC 2544 benchmarking range.',
  reserved: 'Reserved space (RFC 1112) — not assignable to hosts.',
  'this-network': 'RFC 1122 "this network" range.',
};

const maskBits = (prefix: number): bigint =>
  prefix === 0 ? 0n : (V4_MAX << BigInt(32 - prefix)) & V4_MAX;

/** Network address (host bits cleared). */
export const networkIntV4 = (int: bigint, prefix: number): bigint => {
  assertV4Prefix(prefix);
  return int & maskBits(prefix);
};

/** Highest address in the block (host bits set). */
export const broadcastIntV4 = (int: bigint, prefix: number): bigint => {
  assertV4Prefix(prefix);
  return (int & maskBits(prefix)) | (V4_MAX ^ maskBits(prefix));
};

/**
 * Usable host addresses for a prefix.
 *  - /0../30: 2^(32-p) - 2 (network + broadcast reserved)
 *  - /31: 2 (RFC 3021 point-to-point)
 *  - /32: 1 (single host)
 */
export function usableHostCount(prefix: number): number {
  assertV4Prefix(prefix);
  if (prefix === 31) return 2;
  if (prefix === 32) return 1;
  return 2 ** (32 - prefix) - 2;
}

/** All addresses in the block, including network and broadcast. */
export function totalAddressCount(prefix: number): number {
  assertV4Prefix(prefix);
  return 2 ** (32 - prefix);
}

/** Legacy (classful) class from the first octet's bit pattern, RFC 791. */
export function legacyClassOf(int: bigint): LegacyClass {
  const first = Number((int >> 24n) & 255n);
  if (first <= 127) return 'A';
  if (first <= 191) return 'B';
  if (first <= 223) return 'C';
  if (first <= 239) return 'D';
  return 'E';
}

/** Address scope for a 32-bit value (RFC-derived; see SCOPE_RANGES). */
export function scopeOf(int: bigint): IpScope {
  if (int === V4_MAX) return 'broadcast';
  for (const [first, last, scope] of SCOPE_RANGES) {
    if (int >= first && int <= last) return scope;
  }
  return 'public';
}

/** Four 8-bit binary strings, MSB first (e.g. 192 → "11000000"). */
export function binaryOctets(int: bigint): string[] {
  return [24, 16, 8, 0].map((shift) =>
    ((int >> BigInt(shift)) & 255n).toString(2).padStart(8, '0'),
  );
}

/** Build the full subnet report. Asserts the prefix, never returns Result. */
export function subnetReport(cidr: Ipv4Cidr): SubnetReport {
  const { prefixLength, address } = cidr;
  assertV4Prefix(prefixLength);

  const netInt = networkIntV4(address.int, prefixLength);
  const bcastInt = broadcastIntV4(address.int, prefixLength);
  const networkAddress = formatV4(netInt);
  const notes: string[] = [];

  // RFC 3021 (/31) and host routes (/32) have no reserved addresses.
  const noReservation = prefixLength >= 31;
  const broadcastAddress = noReservation ? null : formatV4(bcastInt).value;
  const firstHostInt = noReservation ? netInt : netInt + 1n;
  const lastHostInt = noReservation ? bcastInt : bcastInt - 1n;

  let hostRange: string | null;
  if (prefixLength === 32) {
    hostRange = networkAddress.value;
  } else {
    hostRange = `${formatV4(firstHostInt).value} - ${formatV4(lastHostInt).value}`;
  }

  if (prefixLength === 0) {
    notes.push('Default route: covers the entire IPv4 address space.');
  }
  if (prefixLength === 31) {
    notes.push(
      'RFC 3021 point-to-point link: both addresses are usable and there is no broadcast reservation.',
    );
  }
  if (prefixLength === 32) {
    notes.push('Single-host route: the address itself is the only usable host.');
  }
  if (prefixLength <= 30 && netInt !== address.int) {
    notes.push('Host bits were set — the address has been masked to its network address.');
  }

  const scope = scopeOf(netInt);
  const scopeNote = SCOPE_NOTES[scope];
  if (scopeNote) notes.push(scopeNote);

  return {
    cidr,
    cidrText: `${address.value}/${prefixLength}`,
    netmask: prefixToMaskV4(prefixLength).value,
    wildcardMask: wildcardMaskV4(prefixLength).value,
    networkAddress: networkAddress.value,
    broadcastAddress,
    firstHost: formatV4(firstHostInt).value,
    lastHost: formatV4(lastHostInt).value,
    hostRange,
    hostCount: usableHostCount(prefixLength),
    totalAddresses: totalAddressCount(prefixLength),
    binaryView: binaryOctets(address.int),
    netmaskBinary: binaryOctets(maskBits(prefixLength)),
    classLegacy: legacyClassOf(address.int),
    scope,
    notes,
  };
}
