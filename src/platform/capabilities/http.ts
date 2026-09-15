/**
 * HTTP diagnostics capability (M6, plan #41) — raw-socket HTTP/1.1.
 *
 * The tool writes requests by hand over TCP (tcp-socket) or TLS
 * (tcp-socket connectTLS) so every phase is timed and every redirect is
 * visible. fetch is not used for the probe exchange: it follows redirects
 * silently and hides DNS/connect/TLS timings (plan §8).
 */

import type { Result } from '../../core/result/result';
import type { HttpProbeReport } from '../../core/model/http';
import { DEFAULT_HTTP_TIMEOUT_MS } from '../../core/model/http';

export interface HttpProbeOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /** Max redirects per run; defaults to MAX_REDIRECT_HOPS from the model. */
  readonly maxRedirects?: number;
}

export interface HttpProbeCapability {
  probe(url: string, options?: HttpProbeOptions): Promise<Result<HttpProbeReport>>;
}

export { DEFAULT_HTTP_TIMEOUT_MS };
