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
import type { IcmpPingCapability } from './capabilities/icmp';
import type { WifiInfoCapability } from './capabilities/wifi';
import type { PermissionsCapability } from './permissions';
import type { HttpProbeCapability } from './capabilities/http';
import type { TlsInspectCapability } from './capabilities/tls';
import type { LanDiscoveryCapability } from './capabilities/lan';

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
  /** Best-effort ICMP reachability (D4); null when the platform has none. */
  readonly icmpPing: IcmpPingCapability | null;
  /** Current Wi-Fi/network snapshot; null when unavailable. */
  readonly wifiInfo: WifiInfoCapability | null;
  /** Typed permission flows (plan §6.3.4); null without the native module. */
  readonly permissions: PermissionsCapability | null;
  /** Raw-socket HTTP/1.1 diagnostics (M6); null without TCP sockets. */
  readonly httpProbe: HttpProbeCapability | null;
  /** TLS chain capture for display (M6, §16.7); null without the module. */
  readonly tlsInspect: TlsInspectCapability | null;
  /** LAN sweep + optional mDNS (M7); null without TCP sockets. */
  readonly lanDiscovery: LanDiscoveryCapability | null;
}

export const DEFAULT_DNS_TIMEOUT_MS = 10_000;
export type {
  TcpConnectCapability,
  TcpPingCapability,
  TcpScanCapability,
} from './capabilities/tcp';
export type { IcmpPingCapability, IcmpPingOptions } from './capabilities/icmp';
export type { WifiInfoCapability } from './capabilities/wifi';
export type { PermissionScope, PermissionState, PermissionsCapability } from './permissions';
export type { HttpProbeCapability, HttpProbeOptions } from './capabilities/http';
export type { TlsInspectCapability, TlsInspectOptions } from './capabilities/tls';
export type {
  LanDiscoveryCapability,
  LanDiscoveryOptions,
  LanDiscoveryReport,
  LanMdnsState,
  LanProgress,
  MdnsBrowse,
  MdnsService,
} from './capabilities/lan';
