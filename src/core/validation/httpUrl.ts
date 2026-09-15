/**
 * URL parsing for the HTTP diagnostics tool (M6) — pure, no RN imports.
 *
 * The tool needs an absolute http(s) URL plus its parts (host, optional
 * port, path-and-query) to build the raw HTTP/1.1 request line and Host
 * header by hand. Standard `URL` is available in RN's Hermes runtime, but
 * validation rules (what this tool accepts) belong in core where they
 * are testable and shared with the future iOS build (plan §6.3.5).
 */

import { err, ok, type Result } from '../result/result';
import { toolError } from '../result/toolError';

export interface ParsedHttpUrl {
  /** 'http' | 'https' — the only schemes a diagnostics tool speaks. */
  readonly scheme: 'http' | 'https';
  readonly host: string;
  /** Explicit port from the input, or the scheme default. */
  readonly port: number;
  /** Port as it should appear in the Host header (omitted when default). */
  readonly hostHeader: string;
  /** Path + query, always starting with '/'. */
  readonly pathAndQuery: string;
  /** Absolute URL, normalized (scheme://host[:port]/path). */
  readonly url: string;
}

export function parseHttpUrl(input: string): Result<ParsedHttpUrl> {
  const trimmed = input.trim();
  if (trimmed === '') {
    return err(toolError('INVALID_INPUT', 'Enter a URL to probe.'));
  }
  if (trimmed.length > 2_048) {
    return err(
      toolError('INVALID_INPUT', 'That URL is too long to probe.', {
        technical: `length=${trimmed.length}`,
      }),
    );
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    // Bare host without scheme: a diagnostics tool's most common input.
    // Assume https (the safe default for anything with TLS). Only apply
    // when there is no scheme — otherwise a malformed scheme-ful URL
    // would be silently re-interpreted (e.g. "http://h:99999" → host
    // "http"), which is a lie, not a repair.
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
      return err(
        toolError('INVALID_INPUT', 'Not a valid URL.', {
          technical: `unparseable: ${trimmed.slice(0, 80)}`,
        }),
      );
    }
    try {
      url = new URL(`https://${trimmed}`);
    } catch {
      return err(
        toolError('INVALID_INPUT', 'Not a valid URL.', {
          technical: `unparseable: ${trimmed.slice(0, 80)}`,
        }),
      );
    }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return err(
      toolError('INVALID_INPUT', 'Only http:// and https:// URLs can be probed.', {
        technical: `scheme=${url.protocol}`,
      }),
    );
  }
  if (url.username !== '' || url.password !== '') {
    return err(toolError('INVALID_INPUT', 'URLs with embedded credentials are not supported.'));
  }

  const scheme = url.protocol === 'http:' ? 'http' : 'https';
  const defaultPort = scheme === 'http' ? 80 : 443;
  const host = url.hostname.toLowerCase();
  if (host === '') {
    return err(toolError('INVALID_INPUT', 'The URL has no host.'));
  }
  const explicitPort = url.port === '' ? null : Number(url.port);
  if (
    explicitPort !== null &&
    (!Number.isInteger(explicitPort) || explicitPort < 1 || explicitPort > 65535)
  ) {
    return err(toolError('INVALID_INPUT', 'The port in that URL is not valid.'));
  }
  const port = explicitPort ?? defaultPort;
  const pathAndQuery = url.pathname === '' ? '/' : `${url.pathname}${url.search}`;

  return ok({
    scheme,
    host,
    port,
    hostHeader: explicitPort === null ? host : `${host}:${port}`,
    pathAndQuery,
    url: `${scheme}://${host}${explicitPort === null ? '' : `:${port}`}${pathAndQuery}`,
  });
}

/**
 * Resolve a Location header against the hop that produced it (redirect
 * targets may be relative). Pure — the adapter follows, core decides where.
 */
export function resolveLocation(currentUrl: string, location: string): string {
  try {
    return new URL(location, currentUrl).toString();
  } catch {
    return location;
  }
}
