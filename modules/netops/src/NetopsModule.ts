/**
 * Typed surface of the netops Expo module (module name "Netops").
 *
 * This file is imported ONLY by src/platform/android/netops.ts (the M4
 * capability-seam pattern: features never see the native import), so Jest
 * never loads it — the requireNativeModule call at the bottom would throw
 * outside a build that contains the module.
 *
 * Every function returns optionals/flags — never throws for an unavailable
 * platform: the caller renders degraded states (plan §6.4). Native halves:
 *   - Android: modules/netops/android/.../NetopsModule.kt
 *   - iOS:     modules/netops/ios/NetopsModule.swift
 */
import { requireNativeModule } from 'expo';

export interface WifiPermissionsResult {
  readonly granted: boolean;
  readonly canAskAgain: boolean;
  readonly status: 'granted' | 'denied' | 'undetermined' | 'unavailable';
}

export interface WifiInfoResult {
  readonly ssid: string | null;
  readonly bssid: string | null;
  /** Band channel frequency in MHz, null when gated or unknown. */
  readonly frequencyMHz: number | null;
  /** Signal in dBm, null when gated or unknown. */
  readonly rssi: number | null;
  readonly linkSpeedMbps: number | null;
  /** Default gateway of the active link (Android LinkProperties). */
  readonly gateway: string | null;
  /** DNS servers of the active link, in platform order. */
  readonly dnsServers: readonly string[];
  readonly transportWifi: boolean;
  readonly transportCellular: boolean;
  readonly transportVpn: boolean;
  readonly transportEthernet: boolean;
}

export interface IsReachableResult {
  readonly reachable: boolean;
  readonly error?: string;
}

/** One certificate in the presented chain (native-mapped, display-only). */
export interface TlsCertificateResult {
  readonly subject: string;
  readonly issuer: string;
  readonly sans: readonly string[];
  readonly notBefore: string;
  readonly notAfter: string;
  readonly serialNumber: string;
  readonly signatureAlgorithm: string;
  readonly keyInfo: string;
  readonly selfSigned: boolean;
}

export interface TlsInfoResult {
  readonly host: string;
  readonly port: number;
  readonly chain: readonly TlsCertificateResult[];
  readonly tlsVersion: string | null;
  readonly cipherSuite: string | null;
  readonly handshakeMs?: number;
  readonly error?: string;
}

/** The device's own IPv4 subnet, for a one-tap "scan my network" (M7). */
export interface LocalSubnetResult {
  readonly address: string;
  readonly prefixLength: number;
}

/** One service instance the mDNS browse heard from (M7). */
export interface MdnsServiceResult {
  readonly name: string;
  readonly host: string | null;
  readonly addresses: readonly string[];
  readonly port: number | null;
  readonly serviceType: string;
}

/**
 * Outcome of one mDNS browse. `available: false` means the browse could not
 * run at all (no NSD service, or the multicast lock was denied) — the LAN
 * screen then says "TCP sweep only" instead of pretending nothing is out
 * there. A browse that ran and heard nothing is `available: true`.
 */
export interface MdnsBrowseResult {
  readonly services: readonly MdnsServiceResult[];
  readonly available: boolean;
  readonly reason?: string;
}

interface NativeNetops {
  getWifiPermissions(): Promise<WifiPermissionsResult>;
  requestWifiPermissions(): Promise<WifiPermissionsResult>;
  getWifiInfo(): Promise<WifiInfoResult | null>;
  isReachable(host: string, timeoutMs: number): Promise<IsReachableResult>;
  getTlsInfo(host: string, port: number, timeoutMs: number): Promise<TlsInfoResult>;
  localSubnet(): Promise<LocalSubnetResult | null>;
  discoverMdns(windowMs: number): Promise<MdnsBrowseResult>;
}

/** The module handle's type — what requireNativeModule<NativeNetops> returns. */
export type NetopsModule = NativeNetops;

// Module-level require is safe: this file is only reachable from the
// Android adapter (see header). requireNativeModule throws when the module
// is absent — the adapter's try/catch maps that to CAPABILITY_UNAVAILABLE.
const Netops: NativeNetops = requireNativeModule<NativeNetops>('Netops');

export default Netops;
