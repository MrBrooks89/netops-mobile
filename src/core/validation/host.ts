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

const MAX_PORT = 65_535;

/**
 * Parse user input into a TCP/UDP port number (1–65535, no leading zeros
 * beyond one digit). Used by every connectivity tool's port field.
 */
export function parsePortInput(input: string): Result<number> {
  const trimmed = input.trim();
  if (!/^\d{1,5}$/.test(trimmed) || Number(trimmed) < 1 || Number(trimmed) > MAX_PORT) {
    return err(
      toolError('INVALID_INPUT', 'Enter a port between 1 and 65535.', {
        technical: `parsePortInput("${trimmed}"): out of range`,
      }),
    );
  }
  return ok(Number(trimmed));
}

/** Cap a parsed custom list: garbage input beyond this is a typo, not a scan. */
const MAX_CUSTOM_PORTS = 1024;

/**
 * Parse a custom port list for the scanner: numbers, ranges (9800-9899),
 * or both, separated by commas or whitespace ("80 443", "9800-9899,443").
 *
 * Returns ascending unique ports, or null when any token is invalid.
 * Pure: the screen, the smoke harness, and tests all share this grammar.
 */
export function parsePortList(input: string): number[] | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const ports: number[] = [];
  for (const token of trimmed.split(/[,\s]+/)) {
    const range = /^(\d{1,5})-(\d{1,5})$/.exec(token);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from < 1 || to > MAX_PORT || from > to) return null;
      for (let p = from; p <= to; p++) ports.push(p);
      continue;
    }
    const single = parsePortInput(token);
    if (!single.ok) return null;
    ports.push(single.value);
  }
  const unique = Array.from(new Set(ports)).sort((a, b) => a - b);
  if (unique.length === 0 || unique.length > MAX_CUSTOM_PORTS) return null;
  return unique;
}
