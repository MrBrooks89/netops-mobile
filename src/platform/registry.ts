/**
 * Capability registry — the single place that answers "what can this build do?"
 *
 * M3's DNS capabilities are fetch-based, so both are present on every platform.
 * M4 registers the first native-backed capabilities here; availability is
 * feature detection (null when this build lacks the native module), never a
 * `Platform.OS` check inside a feature (plan §3.3).
 */

import { Platform } from 'react-native';
import type { CapabilityMap } from './capabilities';
import { dohCapability } from './fallback/doh';
import type {
  TcpConnectCapability,
  TcpPingCapability,
  TcpScanCapability,
} from './capabilities/tcp';

/**
 * Android TCP adapters, loaded lazily: `react-native-tcp-socket` runs
 * `new NativeEventEmitter(NativeModules.TcpSockets)` at module scope, which
 * throws when the native module is absent (jest, web). Importing inside the
 * guard keeps "unavailable" a data value, not a crash (plan §3.3).
 */
function androidTcp(): Pick<CapabilityMap, 'tcpConnect' | 'tcpPing' | 'tcpScan'> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const tcp = require('./android/tcp') as {
    tcpConnectCapability: TcpConnectCapability;
    tcpPingCapability: TcpPingCapability;
    tcpScanCapability: TcpScanCapability;
  };
  return {
    tcpConnect: tcp.tcpConnectCapability,
    tcpPing: tcp.tcpPingCapability,
    tcpScan: tcp.tcpScanCapability,
  };
}

/**
 * Android netops-module adapters (M5: ICMP best-effort, Wi-Fi info,
 * permission flows). Lazy for the same reason as androidTcp: the module
 * file calls requireNativeModule at module scope, which throws when the
 * native module is absent.
 */
function androidNetops(): Pick<CapabilityMap, 'icmpPing' | 'wifiInfo' | 'permissions'> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const netops = require('./android/netops') as {
    makeIcmpPingCapability: (
      module: import('./capabilities/icmp').IcmpPingCapability extends never ? never : never,
    ) => never;
  } & typeof import('./android/netops');
  // netopsModule() loads the native handle lazily (first call requires the
  // module package). Calling it here — passing the factory itself would hand
  // the adapters a function whose methods are all undefined.
  const module = netops.netopsModule();
  return {
    icmpPing: netops.makeIcmpPingCapability(module),
    wifiInfo: netops.makeWifiInfoCapability(module),
    permissions: netops.makePermissionsCapability(module),
  };
}

export function getCapabilities(): CapabilityMap {
  const tcp =
    Platform.OS === 'android' ? androidTcp() : { tcpConnect: null, tcpPing: null, tcpScan: null };
  const netops =
    Platform.OS === 'android'
      ? androidNetops()
      : { icmpPing: null, wifiInfo: null, permissions: null };
  return {
    dnsResolve: dohCapability,
    dnsReverse: dohCapability,
    tcpConnect: tcp.tcpConnect,
    tcpPing: tcp.tcpPing,
    tcpScan: tcp.tcpScan,
    icmpPing: netops.icmpPing,
    wifiInfo: netops.wifiInfo,
    permissions: netops.permissions,
  };
}

/** True when every listed capability is available in this build. */
export function hasCapabilities(ids: readonly (keyof CapabilityMap)[]): boolean {
  const available = getCapabilities();
  return ids.every((id) => available[id] !== null);
}
