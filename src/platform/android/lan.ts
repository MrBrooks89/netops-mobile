/**
 * Android LAN-discovery adapter (M7, plan #44/#45).
 *
 * The sweep engine is pure TS (`src/core/lan/`), the per-host probe is the M4
 * TCP scan capability, and mDNS rides the local `netops` module. This file is
 * the composition root for all three — and the only place that decides how
 * they fit together.
 *
 * Design notes:
 *  - **Dependencies are injected**, so the orchestration (plan → sweep →
 *    merge → report) is unit-testable in Jest without sockets or a native
 *    module. Only `lanNativeSurface()` touches the native handle.
 *  - **mDNS never blocks the sweep.** The browse starts alongside the sweep,
 *    is bounded by its own window, and a browse that fails yields
 *    `available: false` rather than an error (M7 acceptance: mDNS denied ⇒
 *    TCP-sweep-only still works).
 *  - **A host is "found" when a probed port accepts a connection.** A host
 *    with none of the probed ports open is invisible to the sweep; the port
 *    list is the tuning knob, and the screen says so.
 */

import type { Ipv4Cidr } from '../../core/ip/cidr';
import { v4CidrOf } from '../../core/ip/cidr';
import { parseV4 } from '../../core/ip/ip';
import type { LanHit } from '../../core/lan/lan';
import { mergeLanHits, planSweep, summarizeSweep } from '../../core/lan/lan';
import { runSweep } from '../../core/lan/sweep';
import { err, ok, type Result } from '../../core/result/result';
import { toolError } from '../../core/result/toolError';
import type {
  LanDiscoveryCapability,
  LanDiscoveryReport,
  MdnsBrowse,
  MdnsService,
  LanMdnsState,
} from '../capabilities/lan';
import {
  DEFAULT_LAN_CONCURRENCY,
  DEFAULT_LAN_PORTS,
  DEFAULT_LAN_TIMEOUT_MS,
  DEFAULT_MDNS_WINDOW_MS,
  MAX_LAN_PROBE_PORTS,
} from '../capabilities/lan';
import { MAX_SCAN_CONCURRENCY, type TcpScanCapability } from '../capabilities/tcp';
import { netopsModule } from './netops';

/** The native calls this adapter needs — the seam the tests fake. */
export interface LanNativeSurface {
  localSubnet(): Promise<{ address: string; prefixLength: number } | null>;
  discoverMdns(windowMs: number): Promise<MdnsBrowse>;
}

/**
 * The native surface, or null when this build has no `netops` module. The
 * module handle is required on first use, so evaluating this file never
 * throws (same rule as `android/netops.ts`).
 */
export function lanNativeSurface(): LanNativeSurface | null {
  try {
    const module = netopsModule();
    return {
      localSubnet: () => module.localSubnet(),
      discoverMdns: (windowMs) => module.discoverMdns(windowMs),
    };
  } catch {
    return null;
  }
}

export interface LanDiscoveryDeps {
  /** The M4 per-host probe primitive. */
  readonly tcpScan: TcpScanCapability;
  /** mDNS + local-subnet bridge; null when the native module is absent. */
  readonly native: LanNativeSurface | null;
}

export function makeLanDiscoveryCapability(deps: LanDiscoveryDeps): LanDiscoveryCapability {
  return {
    async localSubnet(options): Promise<Result<Ipv4Cidr>> {
      if (options.signal?.aborted) {
        return err(toolError('CANCELLED', 'The request was cancelled.'));
      }
      const native = deps.native;
      if (!native) {
        return err(
          toolError('CAPABILITY_UNAVAILABLE', 'Local network information is unavailable.', {
            technical: 'lanNativeSurface() === null',
          }),
        );
      }

      let subnet: { address: string; prefixLength: number } | null;
      try {
        subnet = await native.localSubnet();
      } catch (e) {
        return err(
          toolError('CAPABILITY_UNAVAILABLE', 'Could not read the local network.', {
            technical: e instanceof Error ? e.message : String(e),
          }),
        );
      }
      if (subnet === null) {
        return err(
          toolError('NOT_FOUND', 'No local IPv4 network found — connect to Wi-Fi and try again.', {
            technical: 'native localSubnet() resolved null',
          }),
        );
      }

      const address = parseV4(subnet.address);
      const prefix = subnet.prefixLength;
      if (!address.ok || !Number.isInteger(prefix) || prefix < 1 || prefix > 32) {
        return err(
          toolError('UNKNOWN', 'The device reported an unusable local address.', {
            technical: `localSubnet() = ${subnet.address}/${prefix}`,
          }),
        );
      }
      return ok(v4CidrOf(address.value.int, prefix));
    },

    async discover(cidr, options): Promise<Result<LanDiscoveryReport>> {
      const plan = planSweep(cidr, { maxHosts: options.maxHosts });
      if (!plan.ok) return err(plan.error);

      const ports = normalizeProbePorts(options.ports);
      if (!ports.ok) return err(ports.error);

      const sweepConcurrency = Math.max(1, options.concurrency ?? DEFAULT_LAN_CONCURRENCY);
      const timeoutMs = options.timeoutMs ?? DEFAULT_LAN_TIMEOUT_MS;
      // Each in-flight host scans its ports in parallel, so the socket
      // ceiling is concurrency × ports (see DEFAULT_LAN_CONCURRENCY).
      const hostConcurrency = Math.min(ports.value.length, MAX_SCAN_CONCURRENCY);
      const total = plan.value.hosts.length;
      const startedAt = Date.now();

      const emit = (done: number, found: number) =>
        options.onProgress?.({
          done,
          total,
          found,
          fraction: total === 0 ? 1 : done / total,
        });

      const wantMdns = options.mdns !== false && deps.native !== null;
      const browsePromise = wantMdns
        ? browseMdns(deps.native, options.mdnsWindowMs ?? DEFAULT_MDNS_WINDOW_MS)
        : Promise.resolve({ services: [], available: false } as MdnsBrowse);

      const sweep = await runSweep(
        plan.value.hosts,
        async (ip, signal) => {
          const scanned = await deps.tcpScan.scan(ip, ports.value, {
            signal,
            timeoutMs,
            concurrency: hostConcurrency,
          });
          if (!scanned.ok) return null;
          const open = scanned.value.ports.filter((result) => result.verdict === 'open');
          if (open.length === 0) return null;
          const latencies = open
            .map((result) => result.latencyMs)
            .filter((value): value is number => typeof value === 'number');
          return {
            ip,
            sources: ['tcp'],
            hostname: null,
            openPorts: open.map((result) => result.port).sort((a, b) => a - b),
            latencyMs: latencies.length === 0 ? null : Math.min(...latencies),
          } satisfies LanHit;
        },
        {
          concurrency: sweepConcurrency,
          signal: options.signal,
          progressIntervalMs: options.progressIntervalMs,
          onProgress: (progress) => emit(progress.done, progress.found),
        },
      );

      const browse = await browsePromise;
      const hosts = mergeLanHits(sweep.hits, mdnsHits(browse.services));
      emit(sweep.probed, hosts.length);

      const mdns: LanMdnsState = !wantMdns ? 'off' : browse.available ? 'ok' : 'unavailable';
      return ok({
        cidr: plan.value.cidr,
        hosts,
        probed: sweep.probed,
        total: plan.value.total,
        truncated: plan.value.truncated,
        cancelled: sweep.cancelled,
        mdns,
        mdnsReason: mdns === 'unavailable' ? browse.reason : undefined,
        ports: ports.value,
        durationMs: Date.now() - startedAt,
        summary: summarizeSweep(hosts),
      });
    },
  };
}

/**
 * One best-effort browse. A thrown native call or a rejected promise is the
 * same as "unavailable": the sweep result stands on its own.
 */
async function browseMdns(
  native: LanNativeSurface,
  windowMs: number,
): Promise<MdnsBrowse> {
  try {
    return await native.discoverMdns(windowMs);
  } catch (e) {
    return {
      services: [],
      available: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

/** mDNS services → hits. Addresses outside IPv4 are ignored (the model is v4). */
function mdnsHits(services: readonly MdnsService[]): LanHit[] {
  const hits: LanHit[] = [];
  for (const service of services) {
    for (const address of service.addresses) {
      if (!parseV4(address).ok) continue;
      hits.push({
        ip: address,
        sources: ['mdns'],
        hostname: service.name,
        openPorts:
          service.port !== null && service.port > 0 && service.port <= 65535
            ? [service.port]
            : [],
        latencyMs: null,
      });
    }
  }
  return hits;
}

/** Validate and de-duplicate the probe list; the sweep's cost is ports × hosts. */
function normalizeProbePorts(input?: readonly number[]): Result<number[]> {
  const unique = [...new Set(input ?? DEFAULT_LAN_PORTS)];
  if (unique.length === 0) {
    return err(toolError('INVALID_INPUT', 'Pick at least one port to probe.'));
  }
  if (unique.length > MAX_LAN_PROBE_PORTS) {
    return err(
      toolError('INVALID_INPUT', `Probe at most ${MAX_LAN_PROBE_PORTS} ports in one sweep.`, {
        technical: `probe ports = ${unique.length}`,
      }),
    );
  }
  for (const port of unique) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return err(
        toolError('INVALID_INPUT', `"${port}" is not a valid port number.`, {
          technical: `probe port = ${port}`,
        }),
      );
    }
  }
  return ok(unique.sort((a, b) => a - b));
}
