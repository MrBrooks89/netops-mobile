/**
 * DNS name validation.
 *
 * Deliberately more permissive than host validation: DNS labels may contain
 * underscores (SRV, DKIM, `_dmarc`), and users paste names with a trailing dot.
 * What is *not* allowed is anything that would change the meaning of a query —
 * spaces, empty labels, over-long labels, or a URL.
 *
 * Pure TS — no React Native imports.
 */

import { err, ok, type Result } from '../result/result';
import { toolError } from '../result/toolError';

const MAX_NAME_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;
/** Underscores are legal in DNS even though they are not valid hostnames. */
const LABEL = /^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?$/;

export function isValidDnsName(input: string): boolean {
  if (input.length === 0 || input.length > MAX_NAME_LENGTH) return false;
  return input.split('.').every((label) => {
    if (label.length < 1 || label.length > MAX_LABEL_LENGTH) return false;
    return LABEL.test(label);
  });
}

/**
 * Normalise a name for querying: trimmed, lower-cased (DNS is
 * case-insensitive) and without a trailing dot.
 */
export function parseDnsName(input: string): Result<string> {
  const trimmed = input.trim();
  if (trimmed === '') {
    return err(
      toolError('INVALID_INPUT', 'Enter a name to look up.', {
        technical: 'parseDnsName: empty input',
      }),
    );
  }

  const name = trimmed.replace(/\.$/, '').toLowerCase();
  if (!isValidDnsName(name)) {
    return err(
      toolError('INVALID_INPUT', `"${trimmed}" is not a valid DNS name.`, {
        technical: `parseDnsName("${trimmed}"): failed label validation`,
      }),
    );
  }
  return ok(name);
}
