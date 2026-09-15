/**
 * LAN discovery value objects, sweep planning and result merging (plan #44).
 *
 * Pure TS — no sockets, no React Native. The planner answers "which addresses
 * should we probe, and is the list complete?"; the runner (./sweep.ts) performs
 * the probes with bounded concurrency. Keeping both pure means the time budget,
 * the caps and the cancel semantics are testable without a network.
 */

import { formatV4 } from '../ip/ip';
import { V4_MAX, type Ipv4Cidr } from '../ip/cidr';
import { err, ok, type Result } from '../result/result';
import { toolError } from '../result/toolError';

/** How a host was found. Results carry every source that saw it. */
export type LanSource = 'tcp' | 'mdns' | 'arp';

export interface LanHit {
  readonly ip: string;
  readonly sources: readonly LanSource[];
  readonly hostname: string | null;
  readonly openPorts: readonly number[];
  readonly latencyMs: number | null;
}

/**
 * Default cap on probed addresses. A /24 (254 hosts) is the intended default
 * shape; a /16 or larger is capped and reported as truncated rather than
 * quietly sweeping 65k addresses (plan §16.9 resource caps).
 */
export const DEFAULT_MAX_HOSTS = 1024;

/** Default in-flight probe count. */
export const DEFAULT_SWEEP_CONCURRENCY = 32;

/** Progress callbacks are throttled to this rate (plan §0.6 batch rule). */
export const DEFAULT_PROGRESS_INTERVAL_MS = 250;

export interface SweepPlan {
  readonly hosts: readonly string[];
  /** Usable addresses in the block, before the cap. */
  readonly total: number;
  /** True when `maxHosts` cut the list short. */
  readonly truncated: boolean;
  readonly cidr: string;
}

/**
 * Enumerate the addresses to probe.
 *
 * Network and broadcast addresses are skipped for prefixes up to /30, while
 * /31 (RFC 3021) contributes both addresses and /32 the single one — the same
 * semantics the subnet calculator reports.
 */
export function planSweep(cidr: Ipv4Cidr, options: { maxHosts?: number } = {}): Result<SweepPlan> {
  const maxHosts = options.maxHosts ?? DEFAULT_MAX_HOSTS;
  if (!Number.isInteger(maxHosts) || maxHosts < 1) {
    return err(
      toolError('INVALID_INPUT', 'The host cap must be a positive whole number.', {
        technical: `planSweep: maxHosts=${maxHosts}`,
      }),
    );
  }

  const prefix = cidr.prefixLength;
  const maskBits = prefix === 0 ? 0n : (V4_MAX << BigInt(32 - prefix)) & V4_MAX;
  const network = cidr.address.int & maskBits;
  const broadcast = network | (V4_MAX ^ maskBits);

  const first = prefix >= 31 ? network : network + 1n;
  const last = prefix >= 31 ? broadcast : broadcast - 1n;
  const total = Number(last - first + 1n);

  const hosts: string[] = [];
  const limit = Math.min(total, maxHosts);
  for (let i = 0; i < limit; i++) {
    hosts.push(formatV4(first + BigInt(i)).value);
  }

  return ok({
    hosts,
    total,
    truncated: total > limit,
    cidr: `${formatV4(network).value}/${prefix}`,
  });
}

const SOURCE_ORDER: readonly LanSource[] = ['tcp', 'mdns', 'arp'];

/**
 * Merge probe results from different discovery sources into one hit per address.
 *
 * Sources are unioned, open ports gathered, the lowest latency kept, and the
 * first non-null hostname wins (mDNS is the only source that provides one, so
 * in practice it always wins). Output is sorted by address.
 */
export function mergeLanHits(...groups: readonly (readonly LanHit[])[]): LanHit[] {
  const byIp = new Map<string, LanHit>();

  for (const group of groups) {
    for (const hit of group) {
      const existing = byIp.get(hit.ip);
      if (!existing) {
        byIp.set(hit.ip, {
          ...hit,
          sources: [...new Set(hit.sources)].sort(
            (a, b) => SOURCE_ORDER.indexOf(a) - SOURCE_ORDER.indexOf(b),
          ),
          openPorts: [...new Set(hit.openPorts)].sort((a, b) => a - b),
        });
        continue;
      }
      byIp.set(hit.ip, {
        ip: hit.ip,
        sources: [...new Set([...existing.sources, ...hit.sources])].sort(
          (a, b) => SOURCE_ORDER.indexOf(a) - SOURCE_ORDER.indexOf(b),
        ),
        hostname: existing.hostname ?? hit.hostname,
        openPorts: [...new Set([...existing.openPorts, ...hit.openPorts])].sort((a, b) => a - b),
        latencyMs:
          existing.latencyMs === null
            ? hit.latencyMs
            : hit.latencyMs === null
              ? existing.latencyMs
              : Math.min(existing.latencyMs, hit.latencyMs),
      });
    }
  }

  return [...byIp.values()].sort((a, b) => compareIpStrings(a.ip, b.ip));
}

/** Numeric address comparison, so 10.0.0.9 sorts before 10.0.0.10. */
export function compareIpStrings(a: string, b: string): number {
  const toInt = (ip: string): number =>
    ip.split('.').reduce((acc, octet) => acc * 256 + Number(octet), 0);
  return toInt(a) - toInt(b);
}

/** One-line summary for the UI and history. */
export function summarizeSweep(hits: readonly LanHit[]): string {
  if (hits.length === 0) return 'no hosts found';
  const counts = SOURCE_ORDER.map((source) => ({
    source,
    count: hits.filter((hit) => hit.sources.includes(source)).length,
  })).filter((entry) => entry.count > 0);
  const breakdown = counts.map((entry) => `${entry.source} ${entry.count}`).join(', ');
  return `${hits.length} host${hits.length === 1 ? '' : 's'} (${breakdown})`;
}
