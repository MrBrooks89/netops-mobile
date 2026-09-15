/**
 * Android HTTP/TLS adapter (M6, plan #41/#42).
 *
 * Same seam rules as tcp.ts/netops.ts: this is the only file that touches
 * `react-native-tcp-socket` TLS sockets or the netops TLS capture.
 *
 * HTTP/1.1 by hand (plan §8 "full control"):
 *  - open TCP (or TLS via connectTLS) with connectTimeout
 *  - write `GET <path> HTTP/1.1` + Host + minimal fixed headers
 *  - read until headers end + body per Content-Length (or close)
 *  - time every phase: connect, TLS, TTFB, total
 *  - on 3xx + Location: record the hop, re-resolve, repeat (≤ max hops)
 *
 * DNS phase: the tcp-socket lib resolves inside its native connect, so
 * DNS is not separately observable from JS on Android; dnsMs stays null
 * (honest) — no invented numbers (plan D4).
 *
 * TLS phase: `secureConnect` on the TLS socket marks handshake completion.
 * For the *inspector* the full chain comes from the netops module's
 * capture-only trust manager (§16.7) — display-only, never a bypass.
 *
 * Bytes: socket data arrives as the lib's Buffer (or string); this file
 * works in plain Uint8Array/byte math so the two buffer majors never
 * meet in the type system.
 */

import TcpSockets from 'react-native-tcp-socket';
import { err, ok, type Result } from '../../core/result/result';
import { toolError, type ToolError } from '../../core/result/toolError';
import type { NetopsModule } from '../../../modules/netops';
import type {
  HttpExchange,
  HttpHeaderLine,
  HttpPhaseTimings,
  HttpProbeReport,
  HttpRedirectHop,
} from '../../core/model/http';
import { BODY_PREVIEW_MAX_BYTES, MAX_REDIRECT_HOPS } from '../../core/model/http';
import type { HttpProbeCapability, HttpProbeOptions } from '../capabilities/http';
import { DEFAULT_HTTP_TIMEOUT_MS } from '../capabilities/http';
import type { TlsInspectCapability, TlsInspectOptions } from '../capabilities/tls';
import { DEFAULT_TLS_TIMEOUT_MS } from '../capabilities/tls';
import type { TlsCertificate, TlsReport } from '../../core/model/tls';
import { parseHttpUrl, resolveLocation } from '../../core/validation/httpUrl';

type Socket = TcpSockets.Socket;
type TlsSocket = TcpSockets.TLSSocket;

/** Cap on total buffered response bytes — the preview needs far less. */
const MAX_RESPONSE_BYTES = BODY_PREVIEW_MAX_BYTES * 8;

function toBytes(data: unknown): Uint8Array {
  if (typeof data === 'string') {
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = data.charCodeAt(i) & 0xff;
    return out;
  }
  if (data instanceof Uint8Array) return data;
  if (Array.isArray(data)) return new Uint8Array(data);
  if (data !== null && typeof data === 'object' && 'data' in data) {
    // The lib's Buffer quacks like { data: number[] } in some bridges.
    const inner = (data as { data: number[] }).data;
    if (Array.isArray(inner)) return new Uint8Array(inner);
  }
  return new Uint8Array(0);
}

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function utf8Slice(bytes: Uint8Array, start: number, end: number): string {
  // TextDecoder exists in Hermes; fall back to per-byte for safety.
  try {
    return new TextDecoder('utf-8').decode(bytes.subarray(start, end));
  } catch {
    let out = '';
    for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i]);
    return out;
  }
}

/** Find a needle's bytes inside a byte array (indexOf for Uint8Array). */
function bytesIndexOf(haystack: Uint8Array, needle: string, from = 0): number {
  const needleBytes = asciiBytes(needle);
  outer: for (let i = from; i <= haystack.length - needleBytes.length; i++) {
    for (let j = 0; j < needleBytes.length; j++) {
      if (haystack[i + j] !== needleBytes[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** Parse a header block (everything before \r\n\r\n) into lines. */
function parseHeaderBlock(block: string): HttpHeaderLine[] {
  const lines = block.split('\r\n');
  return lines.slice(1).flatMap((line) => {
    const at = line.indexOf(':');
    if (at <= 0) return [];
    return [{ name: line.slice(0, at).trim(), value: line.slice(at + 1).trim() }];
  });
}

/** Map a socket/HTTP failure onto the taxonomy by message text. */
function mapHttpError(error: Error | unknown): ToolError {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes('cancel')) {
    return toolError('CANCELLED', 'The request was cancelled.', { technical: `http: ${message}` });
  }
  if (lower.includes('refused')) {
    return toolError('REFUSED', 'The connection was refused — nothing is listening there.', {
      technical: `http: ${message}`,
    });
  }
  if (
    lower.includes('timed out') ||
    lower.includes('timeout') ||
    /after \d+ms/.test(lower) ||
    lower.includes('failed to connect')
  ) {
    return toolError('TIMEOUT', 'No answer within the timeout.', {
      technical: `http: ${message}`,
    });
  }
  if (lower.includes('resolve') || lower.includes('unreachable') || lower.includes('network')) {
    return toolError('NETWORK_UNREACHABLE', 'Could not reach the host.', {
      technical: `http: ${message}`,
    });
  }
  return toolError('NETWORK_UNREACHABLE', 'The request failed.', {
    technical: `http: ${message}`,
  });
}

interface RawExchange {
  bytes: Uint8Array;
  ttfbMs: number;
}

/** Attach listeners once; resolve on complete response, close, or error. */
function readExchange(
  socket: Socket | TlsSocket,
  request: string,
  timeoutMs: number,
): Promise<RawExchange> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Uint8Array[] = [];
    const startedAt = Date.now();
    let ttfbMs: number | null = null;
    let ended = false;
    let response: RawExchange | null = null;
    let failure: ToolError | null = null;

    const settle = () => {
      if (ended) return;
      ended = true;
      clearTimeout(watchdog);
      try {
        socket.destroy();
      } catch {
        // best-effort
      }
      if (failure !== null) reject(failure);
      else if (response !== null) resolve(response);
      else
        reject(
          toolError('NETWORK_UNREACHABLE', 'The connection closed before a response arrived.', {
            technical: 'http: socket closed with no data',
          }),
        );
    };

    const finishWith = (bytes: Uint8Array) => {
      response = { bytes, ttfbMs: ttfbMs ?? Date.now() - startedAt };
      settle();
    };

    const onData = (data: unknown) => {
      if (ended) return;
      if (ttfbMs === null) ttfbMs = Date.now() - startedAt;
      const chunk = toBytes(data);
      chunks.push(chunk);
      total += chunk.length;

      const raw = concatBytes(chunks);
      const headerEnd = bytesIndexOf(raw, '\r\n\r\n');
      if (headerEnd >= 0) {
        const headerText = utf8Slice(raw, 0, headerEnd);
        const headers = parseHeaderBlock(headerText);
        const lengthHeader = headers.find((h) => h.name.toLowerCase() === 'content-length');
        if (lengthHeader !== undefined) {
          const expected = headerEnd + 4 + Number(lengthHeader.value);
          if (raw.length >= expected) {
            finishWith(raw.subarray(0, Math.min(raw.length, expected)));
            return;
          }
        }
        // Without Content-Length (chunked or close-delimited): the header
        // set + preview is the tool's purpose; stop at the byte cap.
        if (raw.length >= MAX_RESPONSE_BYTES) {
          finishWith(raw.subarray(0, MAX_RESPONSE_BYTES));
          return;
        }
      }
      if (total >= MAX_RESPONSE_BYTES) {
        finishWith(raw.subarray(0, MAX_RESPONSE_BYTES));
      }
    };

    const onError = (error: Error) => {
      if (ended) return;
      if (response !== null) {
        settle(); // we already have a complete response; the close was noisy
        return;
      }
      failure = mapHttpError(error);
      settle();
    };

    const onClose = () => {
      if (ended) return;
      if (chunks.length > 0 && response === null) {
        // Close-delimited body: whatever arrived is the response.
        finishWith(concatBytes(chunks));
        return;
      }
      settle();
    };

    const watchdog = setTimeout(() => {
      failure = toolError('TIMEOUT', 'No answer within the timeout.', {
        technical: `http read timeout after ${timeoutMs}ms`,
      });
      settle();
    }, timeoutMs + 1_000);

    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);
    socket.write(request, 'utf8');
  });
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A failed exchange still carries its timings + a ToolError. */
type ExchangeOutcome = HttpExchange & { error?: ToolError };

/** Open TCP (+ TLS) and run one request/response exchange. */
function exchangeOnce(
  target: {
    host: string;
    port: number;
    secure: boolean;
    pathAndQuery: string;
    hostHeader: string;
  },
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<ExchangeOutcome> {
  const request =
    `GET ${target.pathAndQuery} HTTP/1.1\r\n` +
    `Host: ${target.hostHeader}\r\n` +
    'User-Agent: netops-mobile/0.1 (diagnostics)\r\n' +
    'Accept: */*\r\n' +
    'Connection: close\r\n' +
    '\r\n';

  return new Promise<ExchangeOutcome>((resolve) => {
    let connectMs: number | null = null;
    let tlsMs: number | null = null;
    const requestStart = Date.now();
    let settled = false;
    let watchdog: ReturnType<typeof setTimeout> | null = null;

    const abortExchange = (): HttpExchange => ({
      secure: target.secure,
      status: 0,
      reasonPhrase: '',
      httpVersion: '',
      headers: [],
      bodyByteLength: 0,
      bodyPreview: null,
      timings: { dnsMs: null, connectMs, tlsMs, ttfbMs: null, totalMs: null },
    });

    const finish = (outcome: ExchangeOutcome) => {
      if (settled) return;
      settled = true;
      if (watchdog !== null) clearTimeout(watchdog);
      signal?.removeEventListener('abort', onAbort);
      resolve(outcome);
    };

    function onAbort() {
      finish({ ...abortExchange(), error: toolError('CANCELLED', 'The request was cancelled.') });
    }

    signal?.addEventListener('abort', onAbort);
    if (signal?.aborted) {
      onAbort();
      return;
    }

    watchdog = setTimeout(() => {
      finish({
        ...abortExchange(),
        error: toolError('TIMEOUT', 'No answer within the timeout.', {
          technical: `http connect timeout after ${timeoutMs}ms`,
        }),
      });
    }, timeoutMs + 2_000);

    const connectStart = Date.now();
    const onConnectError = (error: Error) => {
      finish({ ...abortExchange(), error: mapHttpError(error) });
    };

    const runExchange = async (active: Socket | TlsSocket) => {
      try {
        const { bytes, ttfbMs } = await readExchange(active, request, timeoutMs);
        const headerEnd = bytesIndexOf(bytes, '\r\n\r\n');
        if (headerEnd < 0) {
          finish({
            ...abortExchange(),
            timings: {
              dnsMs: null,
              connectMs,
              tlsMs,
              ttfbMs,
              totalMs: Date.now() - requestStart,
            },
            error: toolError('INVALID_INPUT', 'The server response could not be parsed.', {
              technical: 'no header terminator in response',
            }),
          });
          return;
        }
        const headerText = utf8Slice(bytes, 0, headerEnd);
        const statusLine = headerText.split('\r\n')[0];
        const match = /^HTTP\/(\S+)\s+(\d{3})\s*(.*)$/.exec(statusLine);
        if (match === null) {
          finish({
            ...abortExchange(),
            timings: {
              dnsMs: null,
              connectMs,
              tlsMs,
              ttfbMs,
              totalMs: Date.now() - requestStart,
            },
            error: toolError('INVALID_INPUT', 'The status line was malformed.', {
              technical: statusLine.slice(0, 120),
            }),
          });
          return;
        }
        const headers = parseHeaderBlock(headerText);
        const bodyStart = headerEnd + 4;
        const bodyByteLength = Math.max(0, bytes.length - bodyStart);
        const previewEnd = Math.min(bodyStart + BODY_PREVIEW_MAX_BYTES, bytes.length);
        const preview =
          previewEnd > bodyStart ? utf8Slice(bytes, bodyStart, previewEnd) : null;
        finish({
          secure: target.secure,
          status: Number(match[2]),
          reasonPhrase: match[3] ?? '',
          httpVersion: match[1],
          headers,
          bodyByteLength,
          bodyPreview: preview !== null && preview !== '' ? preview : null,
          timings: {
            dnsMs: null,
            connectMs,
            tlsMs,
            ttfbMs,
            totalMs: Date.now() - requestStart,
          },
        });
      } catch (cause) {
        finish({
          ...abortExchange(),
          error:
            cause instanceof Error && 'code' in cause
              ? (cause as unknown as ToolError)
              : mapHttpError(cause),
        });
      }
    };

    try {
      if (target.secure) {
        // Track the moment the TLS layer reports completion. On Android the
        // connect callback and secureConnect can arrive in either order, so
        // the phase is derived from timestamps, not assumed event ordering.
        let secureConnectAt: number | null = null;
        const tlsSocket = TcpSockets.connectTLS(
          { host: target.host, port: target.port, connectTimeout: timeoutMs },
          () => {
            const now = Date.now();
            if (secureConnectAt === null) secureConnectAt = now;
            connectMs = connectMs ?? now - connectStart;
            // TLS phase = time from the TCP connect completing to the TLS
            // handshake completing (0 when they arrive indistinguishably).
            tlsMs = Math.max(0, secureConnectAt - (connectStart + (connectMs ?? 0)));
            void runExchange(tlsSocket);
          },
        );
        tlsSocket.on('secureConnect', () => {
          secureConnectAt = Date.now();
          if (connectMs !== null) {
            tlsMs = Math.max(0, secureConnectAt - (connectStart + connectMs));
          }
        });
        tlsSocket.on('error', onConnectError);
      } else {
        const socket = TcpSockets.createConnection(
          { host: target.host, port: target.port, connectTimeout: timeoutMs },
          () => {
            connectMs = Date.now() - connectStart;
            void runExchange(socket);
          },
        );
        socket.on('error', onConnectError);
      }
    } catch (cause) {
      finish({ ...abortExchange(), error: mapHttpError(cause) });
    }
  });
}

export function makeHttpProbeCapability(): HttpProbeCapability {
  return {
    async probe(url: string, options: HttpProbeOptions = {}): Promise<Result<HttpProbeReport>> {
      const parsedUrl = parseHttpUrl(url);
      if (!parsedUrl.ok) return err(parsedUrl.error);
      const timeoutMs = options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
      const maxRedirects = options.maxRedirects ?? MAX_REDIRECT_HOPS;

      const redirects: HttpRedirectHop[] = [];
      const exchanges: HttpExchange[] = [];
      let currentUrl = parsedUrl.value.url;

      for (let hop = 0; hop <= maxRedirects; hop++) {
        const parsed = parseHttpUrl(currentUrl);
        if (!parsed.ok) return err(parsed.error);

        const exchange = await exchangeOnce(
          {
            host: parsed.value.host,
            port: parsed.value.port,
            secure: parsed.value.scheme === 'https',
            pathAndQuery: parsed.value.pathAndQuery,
            hostHeader: parsed.value.hostHeader,
          },
          timeoutMs,
          options.signal,
        );
        if (exchange.error !== undefined) return err(exchange.error);
        exchanges.push(exchange);

        const location = exchange.headers.find((h) => h.name.toLowerCase() === 'location');
        if (exchange.status >= 300 && exchange.status < 400 && location !== undefined) {
          if (hop === maxRedirects) {
            return err(
              toolError('INVALID_INPUT', `Too many redirects (more than ${maxRedirects}).`, {
                technical: `stopped at ${currentUrl}`,
              }),
            );
          }
          redirects.push({ url: currentUrl, status: exchange.status, location: location.value });
          currentUrl = resolveLocation(currentUrl, location.value);
          continue;
        }

        const finalTimings: HttpPhaseTimings = exchange.timings;
        return ok({
          method: 'http',
          requestedUrl: parsedUrl.value.url,
          redirects,
          exchanges,
          finalTimings,
          totalMs: exchanges.reduce((sum, e) => sum + (e.timings.totalMs ?? 0), 0),
          finishedAt: Date.now(),
        });
      }

      return err(toolError('INVALID_INPUT', 'The redirect chain did not resolve.'));
    },
  };
}

export function makeTlsInspectCapability(module: NetopsModule): TlsInspectCapability {
  return {
    async inspect(
      host: string,
      port: number,
      options: TlsInspectOptions = {},
    ): Promise<Result<TlsReport>> {
      try {
        const result = await module.getTlsInfo(
          host,
          port,
          options.timeoutMs ?? DEFAULT_TLS_TIMEOUT_MS,
        );
        if (result.error !== undefined) {
          return err(
            toolError('NETWORK_UNREACHABLE', 'The TLS handshake could not be completed.', {
              technical: result.error,
            }),
          );
        }
        const chain: TlsCertificate[] = result.chain.map((cert) => ({
          subject: cert.subject,
          issuer: cert.issuer,
          sans: cert.sans,
          notBefore: cert.notBefore,
          notAfter: cert.notAfter,
          serialNumber: cert.serialNumber,
          signatureAlgorithm: cert.signatureAlgorithm,
          keyInfo: cert.keyInfo,
          selfSigned: cert.selfSigned,
        }));
        return ok({
          method: 'tls',
          host,
          port,
          chain,
          tlsVersion: result.tlsVersion ?? null,
          cipherSuite: result.cipherSuite ?? null,
          finishedAt: Date.now(),
        });
      } catch (cause) {
        return err(
          toolError('NETWORK_UNREACHABLE', 'The TLS inspection failed.', {
            technical: cause instanceof Error ? cause.message : String(cause),
          }),
        );
      }
    },
  };
}
