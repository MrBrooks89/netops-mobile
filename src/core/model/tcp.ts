/**
 * TCP reports — pure data, no React Native imports (plan §3.1).
 *
 * These are the typed outputs of the TCP capabilities (M4) and the payload
 * history persists for every run. Latencies are integer milliseconds because
 * sub-millisecond precision is noise over mobile radio.
 */

/** What one TCP connect attempt concluded. */
export type TcpPortVerdict =
  | 'open'
  | 'closed'
  /** No answer within the timeout — filtered or firewalled. */
  | 'filtered'
  | 'error';

/** A single completed connect attempt, as a value. */
export interface TcpProbe {
  /** 1-based probe number, for TCP ping ordering. */
  readonly seq: number;
  readonly ok: boolean;
  /** Milliseconds from connect start to established, when ok. */
  readonly latencyMs: number | null;
  /** Taxonomy code of the failure, when not ok. */
  readonly errorCode?: string;
}

/** Report of one connect test (tcp-connect tool). */
export interface TcpConnectReport {
  readonly host: string;
  readonly port: number;
  readonly ok: boolean;
  readonly latencyMs: number | null;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  /** Raw native message (exception text) — history detail, not UI copy. */
  readonly technicalMessage?: string;
  readonly finishedAt: string;
}

/** Report of a TCP ping series (tcp-ping tool). */
export interface TcpPingReport {
  /** Method tag — distinguishes TCP from ICMP ping reports (plan D4). */
  readonly method: 'tcp';
  readonly host: string;
  readonly port: number;
  readonly probes: readonly TcpProbe[];
  readonly sent: number;
  readonly received: number;
  /** Percentage [0,100] with one decimal. */
  readonly lossPercent: number;
  readonly minMs: number | null;
  readonly avgMs: number | null;
  readonly maxMs: number | null;
}

/** One port's verdict inside a scan. */
export interface PortScanResult {
  readonly port: number;
  readonly verdict: TcpPortVerdict;
  /** Service name from the ports database, when known. */
  readonly service?: string;
  /** Milliseconds for the connect, when the verdict is open. */
  readonly latencyMs?: number;
  readonly errorCode?: string;
}

/** Report of a port scan run (port-scanner tool) — what history persists. */
export interface PortScanReport {
  readonly host: string;
  readonly ports: readonly PortScanResult[];
  readonly scanned: number;
  readonly openCount: number;
  readonly startedAt: string;
  readonly durationMs: number;
}

/** Reduce probes to the min/avg/max/loss summary the ping UI shows. */
export function pingStats(probes: readonly TcpProbe[]): {
  sent: number;
  received: number;
  lossPercent: number;
  minMs: number | null;
  avgMs: number | null;
  maxMs: number | null;
} {
  const latencies = probes
    .filter((p) => p.ok && p.latencyMs !== null)
    .map((p) => p.latencyMs as number);
  const received = latencies.length;
  const lossPercent = probes.length === 0 ? 0 : ((probes.length - received) / probes.length) * 100;
  if (received === 0) {
    return {
      sent: probes.length,
      received,
      lossPercent: round1(lossPercent),
      minMs: null,
      avgMs: null,
      maxMs: null,
    };
  }
  const min = Math.min(...latencies);
  const max = Math.max(...latencies);
  const avg = latencies.reduce((sum, value) => sum + value, 0) / received;
  return {
    sent: probes.length,
    received,
    lossPercent: round1(lossPercent),
    minMs: min,
    avgMs: Math.round(avg),
    maxMs: max,
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
