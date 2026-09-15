/**
 * HTTP diagnostics models (M6, plan #41) — pure data, no RN imports (§3.1).
 *
 * A probe is one raw-socket HTTP/1.1 exchange: the tool writes a request
 * by hand over TCP (or TLS) so every phase is visible — DNS, connect, TLS
 * handshake, time to first byte — and so redirects are followed one at a
 * time, recording each hop (fetch would hide all of this; plan §8).
 *
 * Honesty rules (plan D4-style):
 *  - A phase that did not run (e.g. no TLS on http://) is null, never 0.
 *  - The redirect chain records exactly what was observed, capped at a
 *    sane limit; hitting the cap is reported as an error, not silent
 *    truncation.
 *  - Headers render as parsed text; the app never renders HTML (§16.10).
 */

/** One hop in the redirect chain, in visit order. */
export interface HttpRedirectHop {
  /** Absolute URL requested at this hop (after Location resolution). */
  readonly url: string;
  readonly status: number;
  /** Location header as the server sent it (may be relative). */
  readonly location: string | null;
}

/** Per-phase wall-clock timings, ms. Null when the phase never ran. */
export interface HttpPhaseTimings {
  /** Host resolution. Null when the input was already an IP literal. */
  readonly dnsMs: number | null;
  /** TCP connect (handshake). */
  readonly connectMs: number | null;
  /** TLS handshake. Null on cleartext http:// exchanges. */
  readonly tlsMs: number | null;
  /** Request written → first response byte. */
  readonly ttfbMs: number | null;
  /** Whole exchange, request start → response fully read. */
  readonly totalMs: number | null;
}

/** A response header as received (name case preserved, list not joined). */
export interface HttpHeaderLine {
  readonly name: string;
  readonly value: string;
}

/** One full HTTP exchange (the final hop's response, plus its timings). */
export interface HttpExchange {
  /** True when this hop was served over TLS. */
  readonly secure: boolean;
  readonly status: number;
  readonly reasonPhrase: string;
  readonly httpVersion: string;
  readonly headers: readonly HttpHeaderLine[];
  /** Body bytes read; the tool never renders it as HTML. */
  readonly bodyByteLength: number;
  /** Body preview (plain text, truncated). */
  readonly bodyPreview: string | null;
  readonly timings: HttpPhaseTimings;
}

/** Report of one HTTP diagnostics run (tool id `http-diagnostics`). */
export interface HttpProbeReport {
  readonly method: 'http';
  /** The URL as entered (normalized: scheme + host + optional port + path). */
  readonly requestedUrl: string;
  /** Hops before the final exchange, in visit order (empty when no redirects). */
  readonly redirects: readonly HttpRedirectHop[];
  /** Total exchanges made = redirects.length + 1 (capped at MAX_REDIRECT_HOPS). */
  readonly exchanges: readonly HttpExchange[];
  /** Timings of the final exchange (the one the user cares about). */
  readonly finalTimings: HttpPhaseTimings;
  /** Sum across all hops — the honest end-to-end number. */
  readonly totalMs: number;
  readonly finishedAt: number;
}

export const MAX_REDIRECT_HOPS = 10;
export const DEFAULT_HTTP_TIMEOUT_MS = 10_000;
export const BODY_PREVIEW_MAX_BYTES = 2_048;

/** Sum the per-hop totals for the honest end-to-end number. */
export function httpTotalMs(exchanges: readonly HttpExchange[]): number {
  return exchanges.reduce((sum, exchange) => sum + (exchange.timings.totalMs ?? 0), 0);
}

/** Short human label for an exchange: "301 → /login (3 ms)". */
export function summarizeHop(hop: HttpRedirectHop): string {
  return `${hop.status} → ${hop.location ?? '(no location)'}`;
}
