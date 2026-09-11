/**
 * Shared input parsing for the IPv4 calculator screens.
 *
 * Turns raw field text into one of three screen states — empty, invalid
 * (with a user-facing message), or a validated IPv4 CIDR — so every
 * calculator reports bad input the same way instead of each screen
 * re-implementing the parse chain.
 */

import { asV4Cidr, parseCidr, type Ipv4Cidr } from '../../core/ip/cidr';

export type CidrInput =
  | { readonly state: 'empty' }
  | { readonly state: 'error'; readonly message: string }
  | { readonly state: 'valid'; readonly cidr: Ipv4Cidr };

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
