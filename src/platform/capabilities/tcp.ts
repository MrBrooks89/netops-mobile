/**
 * TCP capability contracts (plan §6.2, M4) — the seam between the tool screens
 * and `react-native-tcp-socket` (ADR-006).
 *
 * The interfaces mirror the operation flow: every method takes a job
 * description and options, returns a typed report, and honours the abort
 * signal from `useOperation` so cancel works everywhere. The port scanner
 * streams throttled progress (plan §0.6 batching rule: the UI sees a summary,
 * not a socket-by-socket firehose).
 *
 * All results are `Result<Report, ToolError>`: transport failures map onto
 * the taxonomy in `platform/http.ts` (REFUSED → `NETWORK_UNREACHABLE`-style
 * friendly copy is decided by the adapter, not the screens).
 */

import type { Result } from '../../core/result/result';
import type { PortScanReport, TcpConnectReport, TcpPingReport } from '../../core/model/tcp';

/** Shared options for every TCP capability call. */
export interface TcpOptions {
  /** Abort signal from the operation layer (cancel is a first-class action). */
  readonly signal?: AbortSignal;
  /** Per-connection timeout in ms. Defaults to DEFAULT_TCP_TIMEOUT_MS. */
  readonly timeoutMs?: number;
}

export interface TcpConnectCapability {
  /** Open one connection, measure how long the handshake took, close. */
  connect(host: string, port: number, options: TcpOptions): Promise<Result<TcpConnectReport>>;
}

export interface TcpPingCapability {
  /** N sequential connects; the report carries the per-probe latencies. */
  ping(
    host: string,
    port: number,
    count: number,
    options: TcpPingOptions,
  ): Promise<Result<TcpPingReport>>;
}

export interface TcpScanCapability {
  /**
   * Scan `ports` on one host with bounded concurrency. `onProgress` fires at
   * most a few times per second with a snapshot — never per port.
   */
  scan(
    host: string,
    ports: readonly number[],
    options: TcpScanOptions,
    onProgress?: (progress: TcpScanProgress) => void,
  ): Promise<Result<PortScanReport>>;
}

export interface TcpPingOptions extends TcpOptions {
  /** Delay between probes; defaults to DEFAULT_TCP_PING_INTERVAL_MS. */
  readonly intervalMs?: number;
}

export interface TcpScanOptions extends TcpOptions {
  /**
   * Upper bound on concurrent connect attempts. The adapter may clamp this
   * (MAX_SCAN_CONCURRENCY); the default is DEFAULT_SCAN_CONCURRENCY.
   */
  readonly concurrency?: number;
}

/** Throttled scan snapshot — the count of ports settled so far, by verdict. */
export interface TcpScanProgress {
  readonly scanned: number;
  readonly total: number;
  readonly open: number;
  /** Ratio in [0,1]; drives the progress bar. */
  readonly fraction: number;
}

export const DEFAULT_TCP_TIMEOUT_MS = 3_000;
export const DEFAULT_TCP_PING_INTERVAL_MS = 1_000;
export const DEFAULT_SCAN_CONCURRENCY = 20;
/** Hard cap: the adapter never opens more than this many sockets at once. */
export const MAX_SCAN_CONCURRENCY = 50;
