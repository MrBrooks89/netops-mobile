/**
 * Shared input parsing for the IPv4 calculator screens.
 *
 * Turns raw field text into one of three screen states — empty, invalid
 * (with a user-facing message), or a validated IPv4 CIDR — so every
 * calculator reports bad input the same way instead of each screen
 * re-implementing the parse chain.
 */

import { asV4Cidr, asV6Cidr, parseCidr, type Ipv4Cidr, type Ipv6Cidr } from '../../core/ip/cidr';

export type CidrInput =
  | { readonly state: 'empty' }
  | { readonly state: 'error'; readonly message: string }
  | { readonly state: 'valid'; readonly cidr: Ipv4Cidr };

/** The same three states for the IPv6 calculator. */
export type V6CidrInput =
  | { readonly state: 'empty' }
  | { readonly state: 'error'; readonly message: string }
  | { readonly state: 'valid'; readonly cidr: Ipv6Cidr };

/** Parse "address/prefix" or "address netmask" (IPv4 only) for a screen. */
export function parseV4CidrInput(text: string): CidrInput {
  const trimmed = text.trim();
  if (trimmed === '') return { state: 'empty' };

  const parsed = parseCidr(trimmed);
  if (!parsed.ok) return { state: 'error', message: parsed.error.message };

  const v4 = asV4Cidr(parsed.value);
  if (!v4.ok) return { state: 'error', message: v4.error.message };

  return { state: 'valid', cidr: v4.value };
}

/**
 * Parse "address/prefix" for the IPv6 calculator (IPv6 only).
 *
 * The counterpart of `parseV4CidrInput`. Two deliberate differences:
 *  - a dotted netmask is meaningless here, so `address/prefix` is the only
 *    accepted form;
 *  - a **bare IPv6 address defaults to /64**, because pasting an address out of
 *    a device config is common and /64 is the conventional subnet size (the
 *    screen says so, and the prefix chips change it in one tap). A bare IPv4
 *    address is parsed as /32 only so that the family check can answer with its
 *    "this tool handles IPv6" message.
 */
export function parseV6CidrInput(text: string): V6CidrInput {
  const trimmed = text.trim();
  if (trimmed === '') return { state: 'empty' };

  const candidate = trimmed.includes('/')
    ? trimmed
    : trimmed.includes(':')
      ? `${trimmed}/64`
      : `${trimmed}/32`;

  const parsed = parseCidr(candidate);
  if (!parsed.ok) return { state: 'error', message: parsed.error.message };

  const v6 = asV6Cidr(parsed.value);
  if (!v6.ok) return { state: 'error', message: v6.error.message };

  return { state: 'valid', cidr: v6.value };
}
