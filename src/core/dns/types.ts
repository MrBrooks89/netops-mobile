/**
 * DNS value objects and provider configuration (pure types).
 *
 * The wire format is shared by every DoH JSON provider we support, so the model
 * lives here rather than in the capability implementation.
 */

export const DNS_RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'PTR'] as const;
export type DnsRecordType = (typeof DNS_RECORD_TYPES)[number];

export interface DnsAnswer {
  /** Owner name, trailing dot removed. */
  readonly name: string;
  readonly type: DnsRecordType;
  /** Canonical text: MX as "preference exchange", TXT unquoted. */
  readonly value: string;
  readonly ttl: number | null;
  /** MX preference, when the record is an MX. */
  readonly priority?: number;
}

/** DNS TYPE codes → our record names (RFC 1035 and friends). */
export const DNS_TYPE_BY_CODE: Readonly<Record<number, DnsRecordType>> = {
  1: 'A',
  2: 'NS',
  5: 'CNAME',
  12: 'PTR',
  15: 'MX',
  16: 'TXT',
  28: 'AAAA',
};

/** DNS RCODE values we give specific meaning to. */
export const DNS_RCODE = {
  NOERROR: 0,
  FORMERR: 1,
  SERVFAIL: 2,
  NXDOMAIN: 3,
  REFUSED: 5,
} as const;

export type DohProviderId = 'cloudflare' | 'google' | 'custom';

export interface DohProvider {
  readonly id: DohProviderId;
  readonly label: string;
  /** Base endpoint without query parameters. */
  readonly endpoint: string;
}

export const DOH_PROVIDERS: Readonly<Record<Exclude<DohProviderId, 'custom'>, DohProvider>> = {
  cloudflare: {
    id: 'cloudflare',
    label: 'Cloudflare',
    endpoint: 'https://cloudflare-dns.com/dns-query',
  },
  google: { id: 'google', label: 'Google', endpoint: 'https://dns.google/resolve' },
};

export const CUSTOM_PROVIDER_LABEL = 'Custom';
