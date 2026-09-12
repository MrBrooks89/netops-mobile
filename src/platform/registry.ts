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

export function getCapabilities(): CapabilityMap {
  const tcp =
    Platform.OS === 'android' ? androidTcp() : { tcpConnect: null, tcpPing: null, tcpScan: null };
  return {
    dnsResolve: dohCapability,
    dnsReverse: dohCapability,
    tcpConnect: tcp.tcpConnect,
    tcpPing: tcp.tcpPing,
    tcpScan: tcp.tcpScan,
  };
}

/** True when every listed capability is available in this build. */
export function hasCapabilities(ids: readonly (keyof CapabilityMap)[]): boolean {
  const available = getCapabilities();
  return ids.every((id) => available[id] !== null);
}
