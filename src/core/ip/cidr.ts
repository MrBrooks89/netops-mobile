/**
 * CIDR value objects + prefix↔netmask conversion.
 *
 * This module is the single owner of the "prefix length ↔ dotted netmask"
 * rules for the whole app: every calculator (subnet, CIDR, wildcard, VLSM)
 * builds on it, so the conversion can never drift between tools.
 *
 * Pure TS — no React Native imports.
 */

import { formatV4, parseIp, parseV4, type IpAddress, type IpV4Address } from './ip';
import { err, ok, type Result } from '../result/result';
import { toolError } from '../result/toolError';

/** A network in CIDR notation, family-agnostic. */
export interface IpCidr {
  readonly address: IpAddress;
  readonly prefixLength: number;
}

/** A CIDR known to be IPv4 — what all M1 calculators operate on. */
export interface Ipv4Cidr {
  readonly address: IpV4Address;
  readonly prefixLength: number;
}

export const cidrToString = (c: IpCidr): string => `${c.address.value}/${c.prefixLength}`;

export const V4_MAX = (1n << 32n) - 1n;

export const maxPrefixFor = (family: 4 | 6): number => (family === 4 ? 32 : 128);

// ---------------------------------------------------------------------------
// Prefix ↔ mask
// ---------------------------------------------------------------------------

/** Validate a prefix length for IPv4. Out-of-range is a programmer error. */
export function assertV4Prefix(prefix: number): void {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new RangeError(`invalid IPv4 prefix length: ${prefix}`);
  }
}

/** Netmask bits for a prefix (the top `prefix` bits set). */
const maskBits = (prefix: number): bigint =>
  prefix === 0 ? 0n : (V4_MAX << BigInt(32 - prefix)) & V4_MAX;

/** Dotted netmask for a prefix, e.g. 24 → 255.255.255.0 */
export function prefixToMaskV4(prefix: number): IpV4Address {
  assertV4Prefix(prefix);
  return formatV4(maskBits(prefix));
}

/** Cisco-style wildcard mask for a prefix, e.g. 24 → 0.0.0.255 */
export function wildcardMaskV4(prefix: number): IpV4Address {
  assertV4Prefix(prefix);
  return formatV4(V4_MAX ^ maskBits(prefix));
}

/** True when the 32-bit value is NOT a contiguous netmask (1s then 0s). */
export function isV4HostMask(int: bigint): boolean {
  let seenZero = false;
  for (let bit = 31; bit >= 0; bit--) {
    const b = (int >> BigInt(bit)) & 1n;
    if (b === 0n) seenZero = true;
    else if (seenZero) return true; // 1 after 0 → non-contiguous
  }
  return false;
}

/** Count the leading 1 bits of a contiguous IPv4 netmask. */
export function maskToPrefix(int: bigint): number {
  let p = 0;
  for (let bit = 31; bit >= 0; bit--) {
    if (((int >> BigInt(bit)) & 1n) === 1n) p++;
  }
  return p;
}

/** Build an IPv4 CIDR from a raw 32-bit value (masked to the prefix). */
export function v4CidrOf(int: bigint, prefix: number): Ipv4Cidr {
  assertV4Prefix(prefix);
  return { address: formatV4(int & maskBits(prefix)), prefixLength: prefix };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse "a.b.c.d/n" or "a.b.c.d m.m.m.m" — the mask form is converted to a
 * prefix length. Non-contiguous masks are rejected.
 */
export function parseCidr(input: string): Result<IpCidr> {
  const s = input.trim();
  const sep = s.includes('/') ? '/' : ' ';
  const i = s.indexOf(sep);
  if (i === -1) {
    return err(
      toolError('INVALID_INPUT', `Invalid CIDR "${input}": expected "address/prefix".`, {
        technical: `parseCidr("${input}"): no separator`,
      }),
    );
  }
  const addr = parseIp(s.slice(0, i));
  if (!addr.ok) return addr;
  const rest = s.slice(i + 1).trim();

  let prefix: number;
  if (rest.includes('.')) {
    // dotted netmask form — count bits
    const mask = parseV4(rest);
    if (!mask.ok || isV4HostMask(mask.value.int)) {
      return err(
        toolError('INVALID_INPUT', `Invalid netmask "${rest}".`, {
          technical: `parseCidr: netmask "${rest}" is not a contiguous mask`,
        }),
      );
    }
    prefix = maskToPrefix(mask.value.int);
  } else {
    if (!/^\d{1,3}$/.test(rest)) {
      return err(
        toolError('INVALID_INPUT', `Invalid prefix length "${rest}".`, {
          technical: `parseCidr: bad prefix "${rest}"`,
        }),
      );
    }
    prefix = Number(rest);
  }

  const maxPrefix = maxPrefixFor(addr.value.family);
  if (prefix > maxPrefix) {
    return err(
      toolError('INVALID_INPUT', `Prefix /${prefix} is invalid for IPv${addr.value.family}.`, {
        technical: `parseCidr: prefix ${prefix} > ${maxPrefix}`,
      }),
    );
  }
  return ok({ address: addr.value, prefixLength: prefix });
}

/**
 * Narrow a parsed CIDR to IPv4 for the M1 calculators, with a message that
 * tells the user what to do rather than just "invalid".
 */
export function asV4Cidr(cidr: IpCidr): Result<Ipv4Cidr> {
  if (cidr.address.family !== 4) {
    return err(
      toolError(
        'INVALID_INPUT',
        'IPv6 arrives with the IPv6 calculator (M2). This tool handles IPv4, e.g. 192.168.1.10/24.',
        { technical: `asV4Cidr: family ${cidr.address.family} unsupported in M1 calculators` },
      ),
    );
  }
  assertV4Prefix(cidr.prefixLength);
  return ok({ address: cidr.address, prefixLength: cidr.prefixLength });
}
