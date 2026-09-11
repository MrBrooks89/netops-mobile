/**
 * DNS-over-HTTPS capability (the plan's `fallback` layer: no native code).
 *
 * Works with any endpoint that speaks the Cloudflare/Google JSON convention,
 * which is what makes the Settings provider switch a one-line change.
 */

import { parseDohResponse } from '../../core/dns/parse';
import { reverseNameFor } from '../../core/dns/reverse';
import type { DnsAnswer, DnsRecordType } from '../../core/dns/types';
import { err, type Result } from '../../core/result/result';
import { toolError } from '../../core/result/toolError';
import { DEFAULT_DNS_TIMEOUT_MS, type DnsCapability, type DnsQueryOptions } from '../capabilities';
import { fetchJson } from '../http';

/**
 * Build the query URL. `cd=0` asks the resolver not to disable DNSSEC checking;
 * `ct=application/dns-json` is understood by both built-in providers and is a
 * no-op where it is ignored.
 */
export function dnsQueryUrl(endpoint: string, name: string, type: DnsRecordType): string {
  const url = new URL(endpoint);
  url.searchParams.set('name', name);
  url.searchParams.set('type', type);
  url.searchParams.set('cd', '0');
  // Preserve any query string the user already put in a custom endpoint.
  return url.toString();
}

async function query(
  name: string,
  type: DnsRecordType,
  options: DnsQueryOptions,
): Promise<Result<DnsAnswer[]>> {
  if (name.trim() === '') {
    return err(
      toolError('INVALID_INPUT', 'Enter a name to look up.', {
        technical: `doh.query: empty name for ${type}`,
      }),
    );
  }

  const response = await fetchJson(dnsQueryUrl(options.endpoint, name.trim(), type), {
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? DEFAULT_DNS_TIMEOUT_MS,
  });
  if (!response.ok) return response;

  return parseDohResponse(response.value);
}

export function createDohCapability(): DnsCapability {
  return {
    resolve: (name, type, options) => query(name, type, options),

    async reverse(ip, options) {
      const name = reverseNameFor(ip);
      if (!name.ok) return name;
      return query(name.value, 'PTR', options);
    },
  };
}

/** The built-in resolver instance (stateless, so one is enough). */
export const dohCapability = createDohCapability();
