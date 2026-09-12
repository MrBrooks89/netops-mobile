/**
 * DoH provider resolution: settings → a usable endpoint.
 *
 * Kept pure and separate from the capability so "which provider is active" is a
 * single decision the Settings screen, the tools and the tests all share.
 */

import { err, ok, type Result } from '../result/result';
import { toolError } from '../result/toolError';
import { DOH_PROVIDERS, type DohProviderId } from './types';

/** Validate a user-supplied endpoint. */
export function parseCustomDohUrl(input: string): Result<string> {
  const trimmed = input.trim();
  if (trimmed === '') {
    return err(
      toolError('INVALID_INPUT', 'Enter the custom DNS-over-HTTPS URL.', {
        technical: 'parseCustomDohUrl: empty',
      }),
    );
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return err(
      toolError('INVALID_INPUT', 'That does not look like a URL.', {
        technical: `parseCustomDohUrl("${trimmed}"): URL parse failed`,
      }),
    );
  }

  if (url.protocol !== 'https:') {
    return err(
      toolError('INVALID_INPUT', 'A DNS-over-HTTPS endpoint must use https://.', {
        technical: `parseCustomDohUrl: protocol ${url.protocol}`,
      }),
    );
  }

  // A query string is preserved (some endpoints need a token) but a fragment is
  // meaningless in a request and is dropped.
  url.hash = '';
  return ok(url.toString());
}

/**
 * The endpoint for the configured provider, or an error explaining what is
 * missing — never a silent fallback to a different resolver, because the whole
 * point of the setting is that the user chose where their queries go.
 */
export function resolveDohEndpoint(provider: DohProviderId, customUrl: string): Result<string> {
  if (provider === 'custom') return parseCustomDohUrl(customUrl);
  return ok(DOH_PROVIDERS[provider].endpoint);
}

/** Label for the Settings screen and history summaries. */
export function describeProvider(provider: DohProviderId, customUrl: string): string {
  if (provider !== 'custom') return DOH_PROVIDERS[provider].label;
  return customUrl.trim() === '' ? 'Custom (not set)' : 'Custom';
}
