/**
 * Input parsing for the wildcard mask calculator (pure, React-free).
 *
 * Three notations are accepted because that is how people actually work:
 * "/24" or "24" (prefix), "255.255.255.0" (netmask), "192.168.1.0/24" or
 * "192.168.1.0 255.255.255.0" (CIDR).
 */

import { parseV4 } from '../../core/ip/ip';
import { isV4HostMask, maskToPrefix } from '../../core/ip/cidr';
import { parseV4CidrInput } from '../_shared/input';

export type WildcardInput =
  | { readonly state: 'empty' }
  | { readonly state: 'error'; readonly message: string }
  | { readonly state: 'valid'; readonly prefix: number };

/**
 * A bare number is a prefix; "255.255.255.0" is a netmask (it cannot be a
 * prefix, so there is no ambiguity); anything with "/" or a space is a CIDR.
 */
export function parseWildcardInput(text: string): WildcardInput {
  const trimmed = text.trim();
  if (trimmed === '') return { state: 'empty' };

  const bare = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
  if (/^\d{1,3}$/.test(bare)) {
    const prefix = Number(bare);
    if (prefix > 32) {
      return { state: 'error', message: `Prefix /${prefix} is invalid for IPv4 (maximum /32).` };
    }
    return { state: 'valid', prefix };
  }

  if (!trimmed.includes('/') && !trimmed.includes(' ') && trimmed.includes('.')) {
    const mask = parseV4(trimmed);
    if (!mask.ok) return { state: 'error', message: mask.error.message };
    if (isV4HostMask(mask.value.int)) {
      return {
        state: 'error',
        message: `Invalid netmask "${trimmed}": bits must be contiguous (1s then 0s).`,
      };
    }
    return { state: 'valid', prefix: maskToPrefix(mask.value.int) };
  }

  const cidr = parseV4CidrInput(trimmed);
  if (cidr.state === 'valid') return { state: 'valid', prefix: cidr.cidr.prefixLength };
  if (cidr.state === 'error') return { state: 'error', message: cidr.message };
  return { state: 'empty' };
}

/** Cisco ACL shorthand: /32 is "host", /0 is "any". */
export function aclForm(prefix: number, wildcard: string): string {
  if (prefix === 32) return 'host (single address)';
  if (prefix === 0) return 'any (all addresses)';
  return `ip wildcard ${wildcard}`;
}
