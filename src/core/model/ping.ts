/**
 * ICMP ping reports — pure data, no React Native imports (plan §3.1).
 *
 * Mirrors the TCP ping model (core/model/tcp.ts) so the unified Ping tool
 * can render both methods with the same stats shape. `method` records
 * which path produced the report — the UI labels ICMP runs as best-effort.
 */

export interface IcmpProbe {
  readonly seq: number;
  readonly ok: boolean;
  /** Round-trip in ms when ok — isReachable() gives no timing, so null. */
  readonly latencyMs: number | null;
  readonly errorCode?: string;
}

/**
 * Report of an ICMP (best-effort) ping series. `latencyMs` is always null
 * per probe (InetAddress.isReachable reports no timing) — the stats carry
 * min/avg/max as null and the UI says so honestly instead of inventing
 * numbers.
 */
export interface IcmpPingReport {
  readonly host: string;
  readonly method: 'icmp';
  readonly probes: readonly IcmpProbe[];
  readonly sent: number;
  readonly received: number;
  readonly lossPercent: number;
  /** Always null for ICMP probes (see IcmpProbe.latencyMs). */
  readonly minMs: number | null;
  readonly avgMs: number | null;
  readonly maxMs: number | null;
}

/** Reduce ICMP probes to the summary the ping UI shows. */
export function icmpStats(probes: readonly IcmpProbe[]): {
  sent: number;
  received: number;
  lossPercent: number;
  minMs: number | null;
  avgMs: number | null;
  maxMs: number | null;
} {
  const received = probes.filter((p) => p.ok).length;
  const lossPercent = probes.length === 0 ? 0 : ((probes.length - received) / probes.length) * 100;
  // isReachable reports no timing — min/avg/max stay honestly null.
  return {
    sent: probes.length,
    received,
    lossPercent: round1(lossPercent),
    minMs: null,
    avgMs: null,
    maxMs: null,
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
