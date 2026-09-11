/**
 * Host input validation, shared by saved entities and (from M3) network tools.
 *
 * Accepts either an IP address (canonicalised through core/ip) or a DNS
 * hostname (RFC 1123 labels, lower-cased because DNS is case-insensitive).
 *
 * Pure TS — no React Native imports.
 */

import { parseIp } from '../ip/ip';
import { err, ok, type Result } from '../result/result';
import { toolError } from '../result/toolError';

const MAX_HOSTNAME_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;
const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** True for a syntactically valid DNS hostname (no trailing-dot tolerance here). */
export function isValidHostname(input: string): boolean {
  if (input.length === 0 || input.length > MAX_HOSTNAME_LENGTH) return false;
  const labels = input.split('.');
  return labels.every(
    (label) => label.length >= 1 && label.length <= MAX_LABEL_LENGTH && LABEL.test(label),
  );
}

/**
 * Parse user input into a canonical host string.
 * IPs come back in canonical form (`::1`, `192.168.001.1` → `192.168.1.1` is
 * rejected as invalid anyway); hostnames come back lower-cased without a
 * trailing dot.
 */
export function parseHostInput(input: string): Result<string> {
  const trimmed = input.trim();
  if (trimmed === '') {
    return err(
      toolError('INVALID_INPUT', 'Enter a hostname or IP address.', {
        technical: 'parseHostInput: empty input',
      }),
    );
  }

  const ip = parseIp(trimmed);
  if (ip.ok) return ok(ip.value.value);

  const hostname = trimmed.replace(/\.$/, '').toLowerCase();
  if (!isValidHostname(hostname)) {
    return err(
      toolError('INVALID_INPUT', `"${input.trim()}" is not a valid hostname or IP address.`, {
        technical: `parseHostInput("${trimmed}"): failed IP parse and hostname validation`,
      }),
    );
  }
  return ok(hostname);
}

/** True when the input is acceptable as a host (used for live field feedback). */
export function isValidHostInput(input: string): boolean {
  return parseHostInput(input).ok;
}
