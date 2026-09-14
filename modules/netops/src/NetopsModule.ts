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
  readonly transportWifi: boolean;
  readonly transportCellular: boolean;
  readonly transportVpn: boolean;
  readonly transportEthernet: boolean;
}

export interface IsReachableResult {
  readonly reachable: boolean;
  readonly error?: string;
}

interface NativeNetops {
  getWifiPermissions(): Promise<WifiPermissionsResult>;
  requestWifiPermissions(): Promise<WifiPermissionsResult>;
  getWifiInfo(): Promise<WifiInfoResult | null>;
  isReachable(host: string, timeoutMs: number): Promise<IsReachableResult>;
}

/** The module handle's type — what requireNativeModule<NativeNetops> returns. */
export type NetopsModule = NativeNetops;

// Module-level require is safe: this file is only reachable from the
// Android adapter (see header). requireNativeModule throws when the module
// is absent — the adapter's try/catch maps that to CAPABILITY_UNAVAILABLE.
const Netops: NativeNetops = requireNativeModule<NativeNetops>('Netops');

export default Netops;
