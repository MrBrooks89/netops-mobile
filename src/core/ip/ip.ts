/**
 * IP address model: address-family-aware from day one.
 *
 * IPv4 and IPv6 are modelled as one union type so core code never needs
 * `family === 4` special cases outside this module. Numeric work uses
 * bigint (128-bit-safe for IPv6). Parsing is strict; formatting is canonical.
 */

import { err, ok, type Result } from '../result/result';
import { toolError } from '../result/toolError';

export type IpFamily = 4 | 6;

export interface IpV4Address {
  readonly family: 4;
  /** Canonical dotted-quad, e.g. "192.168.1.1" */
  readonly value: string;
  readonly int: bigint; // 0 .. 2^32-1
}

export interface IpV6Address {
  readonly family: 6;
  /** Canonical compressed lowercase form, e.g. "2001:db8::1" */
  readonly value: string;
  readonly int: bigint; // 0 .. 2^128-1
}

export type IpAddress = IpV4Address | IpV6Address;

// ---------------------------------------------------------------------------
// IPv4
// ---------------------------------------------------------------------------

const V4_MAX = (1n << 32n) - 1n;

export function parseV4(input: string): Result<IpV4Address> {
  const s = input.trim();
  const parts = s.split('.');
  if (parts.length !== 4) {
    return invalid4(s, 'expected exactly four dot-separated octets');
  }
  let n = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || (part.length > 1 && part.startsWith('0'))) {
      return invalid4(s, `invalid octet "${part}"`);
    }
    const v = Number(part);
    if (v > 255) return invalid4(s, `octet ${part} out of range`);
    n = (n << 8n) | BigInt(v);
  }
  return ok({ family: 4, value: s, int: n });
}

function invalid4(input: string, why: string) {
  return err(
    toolError('INVALID_INPUT', `Invalid IPv4 address "${input}": ${why}.`, {
      technical: `parseV4("${input}") failed: ${why}`,
    }),
  );
}

export function formatV4(int: bigint): IpV4Address {
  if (int < 0n || int > V4_MAX) throw new Error(`v4 int out of range: ${int}`);
  const a = Number((int >> 24n) & 255n);
  const b = Number((int >> 16n) & 255n);
  const c = Number((int >> 8n) & 255n);
  const d = Number(int & 255n);
  return { family: 4, value: `${a}.${b}.${c}.${d}`, int };
}

// ---------------------------------------------------------------------------
// IPv6 (parse + canonical format via Node-style normalization)
// ---------------------------------------------------------------------------

const V6_MAX = (1n << 128n) - 1n;

export function parseV6(input: string): Result<IpV6Address> {
  const s = input.trim().toLowerCase();
  if (s === '') return invalid6(input, 'empty');

  // Handle embedded IPv4 ("::ffff:192.168.1.1") by converting the tail.
  let text = s;
  const lastColon = s.lastIndexOf(':');
  if (s.includes('.')) {
    const tail = s.slice(lastColon + 1);
    const v4 = parseV4(tail);
    if (!v4.ok) return invalid6(input, `embedded IPv4 "${tail}" invalid`);
    const hi = v4.value.int >> 16n;
    const lo = v4.value.int & 0xffffn;
    text = s.slice(0, lastColon + 1) + hextet(hi) + ':' + hextet(lo);
  }

  const doubleColonCount = (text.match(/::/g) || []).length;
  if (doubleColonCount > 1) return invalid6(input, 'multiple "::"');

  const [head, tail] = doubleColonCount === 1 ? text.split('::') : [text, ''];
  // Each side of "::" (when non-empty) must be plain colon-separated hextets —
  // a stray leading/trailing single colon (":::") must fail, not be filtered.
  const splitSide = (side: string): string[] => {
    if (side === '') return [];
    if (side.startsWith(':') || side.endsWith(':')) throw new Error('stray colon');
    return side.split(':');
  };
  let headGroups: string[];
  let tailGroups: string[];
  try {
    headGroups = splitSide(head);
    tailGroups = splitSide(tail);
  } catch {
    return invalid6(input, 'stray colon');
  }

  // reject stray single colons
  if (doubleColonCount === 0 && (text.match(/:/g) || []).length !== 7) {
    return invalid6(input, 'wrong group count');
  }
  if (
    headGroups.some((g) => !/^[0-9a-f]{1,4}$/.test(g)) ||
    tailGroups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))
  ) {
    return invalid6(input, 'invalid hextet');
  }

  let groups: bigint[];
  if (doubleColonCount === 1) {
    const missing = 8 - headGroups.length - tailGroups.length;
    if (missing < 1) return invalid6(input, '"::" must compress at least one group');
    groups = [
      ...headGroups.map((g) => BigInt('0x' + g)),
      ...Array(missing).fill(0n),
      ...tailGroups.map((g) => BigInt('0x' + g)),
    ];
  } else {
    groups = text.split(':').map((g) => BigInt('0x' + g));
  }

  let n = 0n;
  for (const g of groups) n = (n << 16n) | g;
  return ok({ family: 6, value: formatV6(n).value, int: n });
}

function invalid6(input: string, why: string) {
  return err(
    toolError('INVALID_INPUT', `Invalid IPv6 address "${input}": ${why}.`, {
      technical: `parseV6("${input}") failed: ${why}`,
    }),
  );
}

function hextet(n: bigint): string {
  return n.toString(16);
}

export function formatV6(int: bigint): IpV6Address {
  if (int < 0n || int > V6_MAX) throw new Error(`v6 int out of range: ${int}`);
  const groups: string[] = [];
  let rest = int;
  for (let i = 0; i < 8; i++) {
    groups.unshift((rest & 0xffffn).toString(16));
    rest >>= 16n;
  }
  // RFC 5952: longest run of 2+ zeros, leftmost on tie
  let bestStart = -1,
    bestLen = 0,
    curStart = -1,
    curLen = 0;
  groups.forEach((g, i) => {
    if (g === '0') {
      if (curLen === 0) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestStart = curStart;
        bestLen = curLen;
      }
    } else {
      curLen = 0;
    }
  });
  let value: string;
  if (bestLen >= 2) {
    const head = groups.slice(0, bestStart).join(':');
    const tail = groups.slice(bestStart + bestLen).join(':');
    value = head + '::' + tail;
  } else {
    value = groups.join(':');
  }
  return { family: 6, value, int };
}

// ---------------------------------------------------------------------------
// Family-agnostic helpers
// ---------------------------------------------------------------------------

/** Parse either family, detecting the dotted quad / colon syntax. */
export function parseIp(input: string): Result<IpAddress> {
  const s = input.trim();
  if (s.includes(':')) return parseV6(s);
  return parseV4(s);
}

/** Re-format any address into canonical form. */
export function canonicalIp(a: IpAddress): IpAddress {
  return a.family === 4 ? formatV4(a.int) : formatV6(a.int);
}

export function ipToString(a: IpAddress): string {
  return a.value;
}

export function sameIp(a: IpAddress, b: IpAddress): boolean {
  return a.family === b.family && a.int === b.int;
}

/** Address-family-aware comparison for sorting. */
export function compareIp(a: IpAddress, b: IpAddress): number {
  if (a.family !== b.family) return a.family - b.family;
  return a.int < b.int ? -1 : a.int > b.int ? 1 : 0;
}
