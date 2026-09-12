/**
 * Android TCP capability — backed by `react-native-tcp-socket` (ADR-006).
 *
 * This is the only place in the app that touches the library; features reach
 * it through `getCapabilities()` and the contracts in `capabilities/tcp.ts`
 * (plan §6.4: native imports live only under src/platform/android/**).
 *
 * The library's socket is event-driven (`connect` / `error` / `close`), so
 * every capability call is a small promise machine around one socket:
 *   - `connect`/`ping`: open, measure, destroy.
 *   - `scan`: a bounded worker pool; each worker owns one socket at a time.
 *
 * Error mapping (plan §14 taxonomy): Android surfaces Java exception
 * *messages* only, so verdicts are decided by matching the message text —
 *   "connection refused" → REFUSED   (something answered: closed)
 *   "timed out"          → TIMEOUT   (no answer: filtered/firewalled)
 *   "resolve"            → DNS failure for the host itself
 * Anything else is a generic NETWORK_UNREACHABLE with the raw message as
 * technical detail.
 */

import TcpSockets from 'react-native-tcp-socket';
import { err, ok, type Result } from '../../core/result/result';
import { toolError, type ToolError } from '../../core/result/toolError';
import type {
  PortScanReport,
  PortScanResult,
  TcpConnectReport,
  TcpPingReport,
  TcpPortVerdict,
  TcpProbe,
} from '../../core/model/tcp';
import { pingStats } from '../../core/model/tcp';
import { lookupTcpService } from '../../core/ports/ports';
import type {
  TcpConnectCapability,
  TcpOptions,
  TcpPingCapability,
  TcpPingOptions,
  TcpScanCapability,
  TcpScanOptions,
  TcpScanProgress,
} from '../capabilities/tcp';
import {
  DEFAULT_SCAN_CONCURRENCY,
  DEFAULT_TCP_PING_INTERVAL_MS,
  DEFAULT_TCP_TIMEOUT_MS,
  MAX_SCAN_CONCURRENCY,
} from '../capabilities/tcp';

/** The library's socket class — used as a type only (the instance comes from createConnection). */
type Socket = TcpSockets.Socket;

/** Open one socket, wait for connect/error, destroy. Resolves with the verdict. */
function connectOnce(
  host: string,
  port: number,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<{ ok: true; latencyMs: number } | { ok: false; error: ToolError }> {
  return new Promise((resolve) => {
    let settled = false;
    const startedAt = Date.now();
    let socket: Socket | null = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;

    const finish = (result: { ok: true; latencyMs: number } | { ok: false; error: ToolError }) => {
      if (settled) return;
      settled = true;
      if (watchdog !== null) clearTimeout(watchdog);
      signal?.removeEventListener('abort', onAbort);
      try {
        socket?.destroy();
      } catch {
        // destroy on an already-dead socket is best-effort
      }
      resolve(result);
    };

    function onAbort() {
      finish({ ok: false, error: toolError('CANCELLED', 'The request was cancelled.') });
    }
    signal?.addEventListener('abort', onAbort);
    if (signal?.aborted) {
      onAbort();
      return;
    }

    try {
      socket = TcpSockets.createConnection({ host, port, connectTimeout: timeoutMs }, () => {
        // 'connect' callback: the handshake completed.
        finish({ ok: true, latencyMs: Date.now() - startedAt });
      });
      socket.on('error', (error: Error) => {
        finish({ ok: false, error: mapConnectError(error) });
      });
      // Safety net: if neither connect nor error fires within the timeout
      // (plus slack for the event hop), treat it as a timeout, not a hang.
      watchdog = setTimeout(() => {
        finish({ ok: false, error: toolError('TIMEOUT', 'The connection attempt timed out.') });
      }, timeoutMs + 1_500);
    } catch (cause) {
      finish({ ok: false, error: mapConnectError(cause as Error) });
    }
  });
}

/** Map a native connect failure onto the taxonomy by its message text. */
function mapConnectError(error: Error | unknown): ToolError {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes('cancel')) {
    return toolError('CANCELLED', 'The request was cancelled.', {
      technical: `tcp: ${message}`,
    });
  }
  if (lower.includes('refused')) {
    // Something answered RST — the port is closed, not filtered.
    return toolError('REFUSED', 'The connection was refused — the port is closed.', {
      technical: `tcp: ${message}`,
    });
  }
  // Android's SocketTimeoutException message is
  // "failed to connect to /host (port N) from /local (port N) after 3000ms" —
  // the word "timeout" never appears in it (device-verified, M4).
  if (
    lower.includes('timed out') ||
    lower.includes('timeout') ||
    /after \d+ms/.test(lower) ||
    lower.includes('failed to connect')
  ) {
    return toolError('TIMEOUT', 'No answer within the timeout — filtered or firewalled.', {
      technical: `tcp: ${message}`,
    });
  }
  if (lower.includes('resolve') || lower.includes('unreachable') || lower.includes('network')) {
    return toolError('NETWORK_UNREACHABLE', 'Could not reach the network or host.', {
      technical: `tcp: ${message}`,
    });
  }
  return toolError('NETWORK_UNREACHABLE', 'The connection attempt failed.', {
    technical: `tcp: ${message}`,
  });
}

export const tcpConnectCapability: TcpConnectCapability = {
  async connect(host, port, options: TcpOptions): Promise<Result<TcpConnectReport>> {
    const attempt = await connectOnce(
      host,
      port,
      options.timeoutMs ?? DEFAULT_TCP_TIMEOUT_MS,
      options.signal,
    );
    return ok({
      host,
      port,
      ok: attempt.ok,
      latencyMs: attempt.ok ? attempt.latencyMs : null,
      errorCode: attempt.ok ? undefined : attempt.error.code,
      errorMessage: attempt.ok ? undefined : attempt.error.message,
      technicalMessage: attempt.ok ? undefined : attempt.error.technical,
      finishedAt: new Date().toISOString(),
    });
  },
};

export const tcpPingCapability: TcpPingCapability = {
  async ping(host, port, count, options: TcpPingOptions): Promise<Result<TcpPingReport>> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TCP_TIMEOUT_MS;
    const intervalMs = options.intervalMs ?? DEFAULT_TCP_PING_INTERVAL_MS;
    const probes: TcpProbe[] = [];

    for (let seq = 1; seq <= count; seq++) {
      if (options.signal?.aborted) break;
      const attempt = await connectOnce(host, port, timeoutMs, options.signal);
      probes.push({
        seq,
        ok: attempt.ok,
        latencyMs: attempt.ok ? attempt.latencyMs : null,
        errorCode: attempt.ok ? undefined : attempt.error.code,
      });
      if (seq < count && !options.signal?.aborted) {
        await delay(intervalMs, options.signal);
      }
    }

    return ok({ host, port, probes, ...pingStats(probes) });
  },
};

export const tcpScanCapability: TcpScanCapability = {
  async scan(
    host,
    ports,
    options: TcpScanOptions,
    onProgress?: (progress: TcpScanProgress) => void,
  ): Promise<Result<PortScanReport>> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TCP_TIMEOUT_MS;
    const concurrency = Math.min(
      Math.max(1, options.concurrency ?? DEFAULT_SCAN_CONCURRENCY),
      MAX_SCAN_CONCURRENCY,
    );
    const startedAt = new Date();
    const startedAtMs = Date.now();
    const total = ports.length;
    let scanned = 0;
    let openCount = 0;
    const results: PortScanResult[] = [];

    // Throttled progress: at most ~5 snapshots per second, plus the last one.
    let lastProgressAt = 0;
    const report = (force = false) => {
      if (!onProgress) return;
      const now = Date.now();
      if (!force && now - lastProgressAt < 200) return;
      lastProgressAt = now;
      onProgress({ scanned, total, open: openCount, fraction: total === 0 ? 1 : scanned / total });
    };

    const queue = [...ports];
    const worker = async () => {
      for (;;) {
        if (options.signal?.aborted) return;
        const port = queue.shift();
        if (port === undefined) return;
        const isLastPort = queue.length === 0;
        const attempt = await connectOnce(host, port, timeoutMs, options.signal);
        scanned++;
        let verdict: TcpPortVerdict;
        let latencyMs: number | undefined;
        let errorCode: string | undefined;
        if (attempt.ok) {
          verdict = 'open';
          latencyMs = attempt.latencyMs;
          openCount++;
        } else if (attempt.error.code === 'REFUSED') {
          verdict = 'closed';
          errorCode = attempt.error.code;
        } else if (attempt.error.code === 'TIMEOUT' || attempt.error.code === 'CANCELLED') {
          verdict = 'filtered';
          errorCode = attempt.error.code;
        } else {
          verdict = 'error';
          errorCode = attempt.error.code;
        }
        const service = lookupTcpService(port)?.service;
        results.push({ port, verdict, latencyMs, errorCode, service });
        // The final port always forces a snapshot; earlier ones are throttled.
        report(isLastPort);
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, Math.max(1, total)) }, () => worker());
    await Promise.all(workers);

    if (options.signal?.aborted) {
      // The caller cancelled: surface it as a cancelled operation, not a
      // partial report. useOperation maps CANCELLED to silence.
      return err(toolError('CANCELLED', 'The scan was cancelled.'));
    }

    // Ascending port order, like every port scanner the user has seen.
    results.sort((a, b) => a.port - b.port);

    return ok({
      host,
      ports: results,
      scanned: results.length,
      openCount,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAtMs,
    });
  },
};

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}
