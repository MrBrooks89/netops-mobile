/**
 * HTTP helpers shared by the fetch-based capabilities.
 *
 * The mapping from transport failures onto the error taxonomy lives here and
 * nowhere else (plan §14.4): everything above this layer sees `ToolError`s with
 * codes it can act on.
 */

import { err, type Result } from '../core/result/result';
import { toolError, type ToolError } from '../core/result/toolError';

/** Raised when a fetch should be retried by the caller (kept out of the UI). */
export const isAbortError = (cause: unknown): boolean =>
  cause instanceof Error && (cause.name === 'AbortError' || cause.name === 'TimeoutError');

/**
 * Map a thrown fetch/network failure onto the taxonomy.
 *
 * `fetch` rejects with a TypeError for every transport-level problem (DNS
 * resolution of the endpoint itself, no route, TLS failure, connection reset),
 * which the platform does not distinguish — so they all become
 * NETWORK_UNREACHABLE, which is both honest and actionable ("check your
 * connection"). An abort becomes CANCELLED so the UI can stay silent.
 */
export function mapFetchFailure(cause: unknown): ToolError {
  if (isAbortError(cause)) {
    return toolError('CANCELLED', 'The request was cancelled.', {
      technical: 'mapFetchFailure: abort',
      cause,
    });
  }
  const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
  return toolError('NETWORK_UNREACHABLE', 'Could not reach the network.', {
    technical: `mapFetchFailure: ${detail}`,
    cause,
  });
}

/** Non-2xx responses from a DoH endpoint. */
export function mapHttpFailure(status: number, endpoint: string): ToolError {
  return toolError('DNS_FAILURE', 'The DNS service rejected the request.', {
    technical: `HTTP ${status} from ${endpoint}`,
  });
}

/**
 * `fetch` with a timeout that also honours the caller's abort signal.
 *
 * `AbortSignal.timeout` / `AbortSignal.any` are not available on every Hermes
 * build, so the two are combined manually with one controller.
 */
export async function fetchJson(
  url: string,
  options: {
    readonly signal?: AbortSignal;
    readonly timeoutMs: number;
    readonly headers?: Record<string, string>;
  },
): Promise<Result<unknown>> {
  const controller = new AbortController();
  let timedOut = false;

  const onAbort = () => controller.abort();
  // The caller may hand us a signal that is already aborted (cancelled before
  // the request started); an `abort` listener would never fire for it.
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json', ...options.headers },
      signal: controller.signal,
    });

    if (!response.ok) {
      return err(mapHttpFailure(response.status, url));
    }

    try {
      return { ok: true, value: await response.json() };
    } catch (cause) {
      return err(
        toolError('DNS_FAILURE', 'The DNS service returned a malformed response.', {
          technical: `fetchJson: response.json() failed for ${url}`,
          cause,
        }),
      );
    }
  } catch (cause) {
    if (timedOut) {
      return err(
        toolError('TIMEOUT', 'The request timed out.', {
          technical: `fetchJson: no response within ${options.timeoutMs}ms from ${url}`,
          cause,
        }),
      );
    }
    return err(mapFetchFailure(cause));
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
