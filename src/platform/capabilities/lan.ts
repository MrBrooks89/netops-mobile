/**
 * LAN discovery capability contract (plan #44/#45, M7).
 *
 * TCP sweep first (D5): the sweep is the engine that always works wherever
 * TCP sockets do, and mDNS is an optional second source that adds hostnames
 * and devices that block the probed ports. ARP was dropped: `/proc/net/arp`
 * is unreadable for apps on Android 10+ (SELinux), so it could never work on
 * a supported device — an always-empty source is complexity without value.
 *
 * The capability returns `Result<LanDiscoveryReport>`: a sweep that finds
 * nothing is a *success* with zero hosts, not an error.
 */

import type { LanHit, LanSource } from '../../core/lan/lan';
import type { SweepStop } from '../../core/lan/sweep';
import type { Ipv4Cidr } from '../../core/ip/cidr';
import type { Result } from '../../core/result/result';

/** Ports probed on every address by default: a small, high-signal set. */
export const DEFAULT_LAN_PORTS: readonly number[] = [80, 443, 22, 8080];
/**
 * Per-connect timeout. A LAN host that is up answers in single-digit
 * milliseconds (accept or RST); anything slower is silence, and silence is
 * what a sweep mostly meets.
 */
export const DEFAULT_LAN_TIMEOUT_MS = 500;
/**
 * Hosts probed in parallel, one port at a time each.
 *
 * Deliberately small, and coupled to the socket layer: Android's TCP library
 * runs connects on a **fixed 2-thread pool** (ADR-006), so probes beyond that
 * queue up, and a socket that waits in the queue is indistinguishable from a
 * slow one — it eventually trips the adapter's watchdog and is reported as
 * timed out. Four in flight keeps both threads fed while the worst-case queue
 * wait stays under the watchdog's slack. Raising this does **not** speed up a
 * silent network: the native pool is the ceiling.
 */
export const DEFAULT_LAN_CONCURRENCY = 4;
/**
 * Default time budget. On a network that refuses connections, a /24 finishes
 * in seconds; on one that drops them, the same sweep is minutes of timeouts.
 * Twenty seconds bounds the wait and the screen reports the partial coverage.
 */
export const DEFAULT_LAN_BUDGET_MS = 20_000;
/** Hard cap on the probe list; the sweep never opens more than this. */
export const MAX_LAN_PROBE_PORTS = 32;
/** How long the optional mDNS browse listens before it gives up. */
export const DEFAULT_MDNS_WINDOW_MS = 2_500;

/** One service instance found by the mDNS browse. */
export interface MdnsService {
  /** Instance name ("Living Room TV") or the host name when that is all we have. */
  readonly name: string;
  /** `.local` host name, when the platform reported one. */
  readonly host: string | null;
  /** IPv4 addresses the platform already resolved for this instance. */
  readonly addresses: readonly string[];
  readonly port: number | null;
  readonly serviceType: string;
}

/**
 * The outcome of one mDNS browse. `available: false` means the browse could
 * not run — the UI says so and shows TCP-sweep-only results (M7 acceptance).
 */
export interface MdnsBrowse {
  readonly services: readonly MdnsService[];
  readonly available: boolean;
  readonly reason?: string;
}

/** How the run discovered what it found; the screen renders this verbatim. */
export type LanMdnsState = 'ok' | 'unavailable' | 'off';

export interface LanDiscoveryReport {
  /** The swept block, canonicalized. */
  readonly cidr: string;
  readonly hosts: readonly LanHit[];
  /** Addresses actually probed. */
  readonly probed: number;
  /** Usable addresses in the block before the cap. */
  readonly total: number;
  /** True when the block was larger than the cap, so coverage is partial. */
  readonly truncated: boolean;
  /** Why the sweep stopped: fully probed, cancelled, or out of time. */
  readonly stopped: SweepStop;
  readonly mdns: LanMdnsState;
  /** Why mDNS was unavailable, when it was. */
  readonly mdnsReason?: string;
  /** The ports probed on every address (history detail). */
  readonly ports: readonly number[];
  readonly durationMs: number;
  /** One-line summary for the UI and history. */
  readonly summary: string;
}

export interface LanDiscoveryOptions {
  /** Abort signal from the operation layer; stops the sweep mid-run. */
  readonly signal?: AbortSignal;
  /** Ports probed per address; defaults to DEFAULT_LAN_PORTS. */
  readonly ports?: readonly number[];
  /** Addresses swept in parallel; defaults to DEFAULT_LAN_CONCURRENCY. */
  readonly concurrency?: number;
  /** Per-connect timeout; defaults to DEFAULT_LAN_TIMEOUT_MS. */
  readonly timeoutMs?: number;
  /** Stop scheduling probes after this long; defaults to DEFAULT_LAN_BUDGET_MS. */
  readonly budgetMs?: number;
  /** Cap on probed addresses (defaults to DEFAULT_MAX_HOSTS). */
  readonly maxHosts?: number;
  /** Browse mDNS as a second source. Defaults to on when available. */
  readonly mdns?: boolean;
  /** How long the mDNS browse listens; defaults to DEFAULT_MDNS_WINDOW_MS. */
  readonly mdnsWindowMs?: number;
  /** Minimum gap between progress callbacks (default 250ms, plan §0.6). */
  readonly progressIntervalMs?: number;
  /** Throttled sweep progress — a few snapshots per second, never per host. */
  readonly onProgress?: (progress: LanProgress) => void;
}

export interface LanProgress {
  readonly done: number;
  readonly total: number;
  readonly found: number;
  /** Ratio in [0,1]; drives the progress bar. */
  readonly fraction: number;
}

export interface LanDiscoveryCapability {
  /**
   * The device's own IPv4 subnet, so the screen can offer "scan my network"
   * without the user typing a CIDR. `NOT_FOUND` when there is no usable
   * interface (e.g. no Wi-Fi association).
   */
  localSubnet(options: { signal?: AbortSignal }): Promise<Result<Ipv4Cidr>>;
  /** Sweep `cidr` for live hosts, optionally merging an mDNS browse. */
  discover(cidr: Ipv4Cidr, options: LanDiscoveryOptions): Promise<Result<LanDiscoveryReport>>;
}

export type { LanHit, LanSource };
