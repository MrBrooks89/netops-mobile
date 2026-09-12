/**
 * Reverse-DNS (PTR) name construction.
 *
 * A PTR lookup asks for `<reversed-address>.in-addr.arpa` (IPv4) or
 * `<reversed-nibbles>.ip6.arpa` (IPv6). Building this from the core IP model
 * rather than string manipulation keeps IPv6 correct for compressed input.
 *
 * Pure TS — no React Native imports.
 */

import { parseIp } from '../ip/ip';
import { err, ok, type Result } from '../result/result';
import { toolError } from '../result/toolError';

const invalid = (input: string, why: string): Result<never> =>
  err(
    toolError('INVALID_INPUT', `"${input}" is not a valid IP address.`, {
      technical: `reverseNameFor("${input}"): ${why}`,
    }),
  );

/**
 * `192.0.2.5` → `5.2.0.192.in-addr.arpa`
 * `2001:db8::1` → `1.0.0.0.…​.ip6.arpa` (32 reversed nibbles)
 */
export function reverseNameFor(input: string): Result<string> {
  const parsed = parseIp(input);
  if (!parsed.ok) return invalid(input.trim(), 'IP parse failed');

  if (parsed.value.family === 4) {
    const octets = [24n, 16n, 8n, 0n].map((shift) => Number((parsed.value.int >> shift) & 0xffn));
    return ok(`${octets.reverse().join('.')}.in-addr.arpa`);
  }

  // IPv6: 32 nibbles, least significant first.
  const hex = parsed.value.int.toString(16).padStart(32, '0');
  return ok(`${hex.split('').reverse().join('.')}.ip6.arpa`);
}
