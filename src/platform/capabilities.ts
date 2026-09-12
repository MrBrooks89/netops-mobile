/**
 * Capability contract (plan §3.3, §6.1).
 *
 * Features depend on *interfaces*, never on `Platform.OS` or a specific native
 * module. Everything M3 needs is fetch-based, so it is available on every
 * platform — but the shape is the one the native capabilities (TCP, ICMP, Wi-Fi,
 * TLS) will implement in M4+.
 *
 * Availability is data, not a platform check: `getCapabilities()` returns null
 * for anything this build cannot do, and the UI degrades instead of branching on
 * the operating system.
 */

import type { DnsAnswer, DnsRecordType } from '../core/dns/types';
import type { Result } from '../core/result/result';
import type {
  TcpConnectCapability,
  TcpPingCapability,
  TcpScanCapability,
} from './capabilities/tcp';

export interface DnsQueryOptions {
  /** Base endpoint, no query string, e.g. https://cloudflare-dns.com/dns-query */
  readonly endpoint: string;
  /** Abort signal from the operation layer (cancel is a first-class action). */
  readonly signal?: AbortSignal;
  /** Per-request timeout; defaults to DEFAULT_DNS_TIMEOUT_MS. */
  readonly timeoutMs?: number;
}

export interface DnsCapability {
  resolve(
    name: string,
    type: DnsRecordType,
    options: DnsQueryOptions,
  ): Promise<Result<DnsAnswer[]>>;
  /** PTR lookup for an IP address. */
  reverse(ip: string, options: DnsQueryOptions): Promise<Result<DnsAnswer[]>>;
}

export interface CapabilityMap {
  readonly dnsResolve: DnsCapability | null;
  readonly dnsReverse: DnsCapability | null;
  readonly tcpConnect: TcpConnectCapability | null;
  readonly tcpScan: TcpScanCapability | null;
  readonly tcpPing: TcpPingCapability | null;
}

export const DEFAULT_DNS_TIMEOUT_MS = 10_000;
export type {
  TcpConnectCapability,
  TcpPingCapability,
  TcpScanCapability,
} from './capabilities/tcp';
