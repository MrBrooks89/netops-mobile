/**
 * ICMP capability contracts (M5, plan §6.2/D4).
 *
 * ICMP is best-effort by design: raw ICMP needs privileges mobile apps
 * don't have, so the Android implementation is `InetAddress.isReachable()`
 * (which tries ICMP then a TCP echo on port 7) and reports honestly. The
 * ping tool defaults to TCP ping; this capability exists so the UI can
 * offer the labeled alternative when present.
 */

import type { Result } from '../../core/result/result';
import type { IcmpPingReport, IcmpProbe } from '../../core/model/ping';

export interface IcmpPingOptions {
  /** Abort signal from the operation layer. */
  readonly signal?: AbortSignal;
  /** Per-probe timeout in ms; default 3000. */
  readonly timeoutMs?: number;
  /** Gap between probes in ms; default 1000. */
  readonly intervalMs?: number;
}

export interface IcmpPingCapability {
  /**
   * Send `count` best-effort reachability probes to `host`, one every
   * intervalMs. Resolves with a report even when every probe fails —
   * loss is a value, not an error. Only abort (cancel) rejects the
   * CANCELLED path via the Result.
   */
  ping(host: string, count: number, options: IcmpPingOptions): Promise<Result<IcmpPingReport>>;
  /** Single-probe convenience for quick checks (used by tests/diagnostics). */
  probeOnce(host: string, options: IcmpPingOptions): Promise<Result<IcmpProbe>>;
}

export const DEFAULT_ICMP_TIMEOUT_MS = 3_000;
export const DEFAULT_ICMP_INTERVAL_MS = 1_000;
export const MAX_ICMP_PROBE_COUNT = 50;
