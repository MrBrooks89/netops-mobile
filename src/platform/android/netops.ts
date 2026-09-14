/**
 * Android adapter over the netops Expo module (M5).
 *
 * Same seam rules as tcp.ts (M4): this is the ONLY file that may import
 * the native module. It is loaded lazily by the registry only on Android,
 * so Jest/web/iOS never evaluate the requireNativeModule call.
 *
 * Honesty rules (plan D4, §6.4):
 *  - ICMP is best-effort: InetAddress.isReachable() under the hood, no
 *    timing data. The adapter reports exactly what the module gives it —
 *    reachable or not — and never fabricates latencies.
 *  - Wi-Fi info fields are individually gated: nulls flow through and the
 *    screen renders "unavailable" rows.
 *  - Permissions come from the module's typed flow (Expo Modules calls —
 *    the M5 decision), not a permission library.
 */

import type { IcmpProbe, IcmpPingReport } from '../../core/model/ping';
import { icmpStats } from '../../core/model/ping';
import type { RawWifiInfo, WifiInfo } from '../../core/model/wifi';
import { toWifiInfo } from '../../core/model/wifi';
import type { Result } from '../../core/result/result';
import { err, ok } from '../../core/result/result';
import { toolError, type ToolError } from '../../core/result/toolError';
import type { IcmpPingCapability } from '../capabilities/icmp';
import {
  DEFAULT_ICMP_INTERVAL_MS,
  DEFAULT_ICMP_TIMEOUT_MS,
  MAX_ICMP_PROBE_COUNT,
} from '../capabilities/icmp';
import type { PermissionScope, PermissionState, PermissionsCapability } from '../permissions';
import type { WifiInfoCapability } from '../capabilities/wifi';
import type { NetopsModule } from '../../../modules/netops';

/**
 * The netops module handle, loaded on first use. The require is inside a
 * function (not module scope) so evaluating this file never throws — the
 * registry can still return nulls for absent capabilities.
 */
let moduleHandle: NetopsModule | null = null;
export function netopsModule(): NetopsModule {
  if (moduleHandle === null) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    moduleHandle = require('../../../modules/netops').default as NetopsModule;
  }
  return moduleHandle;
}

/** Delay helper that wakes early when the abort signal fires. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(toolError('CANCELLED', 'Ping cancelled.'));
    }
    if (signal?.aborted) {
      clearTimeout(timer);
      reject(toolError('CANCELLED', 'Ping cancelled.'));
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function isAbortError(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === 'CANCELLED'
  );
}

async function probeOnce(
  module: NetopsModule,
  host: string,
  timeoutMs: number,
): Promise<IcmpProbe> {
  const result = await module.isReachable(host, timeoutMs);
  return {
    seq: 0,
    ok: result.reachable,
    // isReachable carries no timing — honest null, never an invention.
    latencyMs: null,
    errorCode: result.reachable ? undefined : (result.error ?? 'UNREACHABLE'),
  };
}

export function makeIcmpPingCapability(module: NetopsModule): IcmpPingCapability {
  return {
    async ping(host, count, options) {
      if (count < 1 || count > MAX_ICMP_PROBE_COUNT) {
        return Promise.resolve(
          err(
            toolError('INVALID_INPUT', 'Probe count must be between 1 and 50.', {
              technical: `icmp ping count=${count}`,
            }),
          ),
        );
      }
      const timeoutMs = options.timeoutMs ?? DEFAULT_ICMP_TIMEOUT_MS;
      const intervalMs = options.intervalMs ?? DEFAULT_ICMP_INTERVAL_MS;
      const probes: IcmpProbe[] = [];
      try {
        for (let i = 0; i < count; i++) {
          // Abort check before every probe, including the first: a cancelled
          // series must never spend a network round-trip (and a pre-aborted
          // signal cancels before any probe at all).
          if (options.signal?.aborted) throw toolError('CANCELLED', 'Ping cancelled.');
          probes.push({ ...(await probeOnce(module, host, timeoutMs)), seq: i + 1 });
          if (i < count - 1) await delay(intervalMs, options.signal);
        }
      } catch (e) {
        if (isAbortError(e)) {
          return err(e as ToolError);
        }
        return err(
          toolError('NETWORK_UNREACHABLE', 'The reachability probe failed.', {
            technical: e instanceof Error ? e.message : String(e),
          }),
        );
      }
      const stats = icmpStats(probes);
      const report: IcmpPingReport = {
        host,
        method: 'icmp',
        probes,
        ...stats,
      };
      return ok(report);
    },

    async probeOnce(host, options) {
      const timeoutMs = options.timeoutMs ?? DEFAULT_ICMP_TIMEOUT_MS;
      return ok(await probeOnce(module, host, timeoutMs));
    },
  };
}

export function makeWifiInfoCapability(module: NetopsModule): WifiInfoCapability {
  return {
    async getInfo(): Promise<WifiInfo> {
      const raw = await module.getWifiInfo();
      return toWifiInfo(raw as RawWifiInfo | null);
    },
  };
}

export function makePermissionsCapability(module: NetopsModule): PermissionsCapability {
  const toState = (result: {
    granted: boolean;
    canAskAgain: boolean;
    status: 'granted' | 'denied' | 'undetermined' | 'unavailable';
  }): Result<PermissionState> => ok({ ...result });

  return {
    async get(scope: PermissionScope) {
      if (scope !== 'wifiInfo') {
        return err(
          toolError('CAPABILITY_UNAVAILABLE', `No permission flow for "${scope}".`, {
            technical: `permissions.get("${scope}")`,
          }),
        );
      }
      try {
        return toState(await module.getWifiPermissions());
      } catch (e) {
        return err(
          toolError('CAPABILITY_UNAVAILABLE', 'Could not read the permission state.', {
            technical: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    },

    async request(scope: PermissionScope) {
      if (scope !== 'wifiInfo') {
        return err(
          toolError('CAPABILITY_UNAVAILABLE', `No permission flow for "${scope}".`, {
            technical: `permissions.request("${scope}")`,
          }),
        );
      }
      try {
        return toState(await module.requestWifiPermissions());
      } catch (e) {
        return err(
          toolError('CAPABILITY_UNAVAILABLE', 'The permission request failed.', {
            technical: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    },
  };
}
