/**
 * Parsing and shaping of DNS-over-HTTPS JSON responses.
 *
 * Cloudflare (`/dns-query?name=&type=`) and Google (`/resolve?name=&type=`)
 * return the same JSON schema, so one parser serves both — and any custom
 * endpoint the user configures, as long as it follows the convention.
 *
 * Pure TS — no React Native imports, no I/O.
 */

import { err, ok, type Result } from '../result/result';
import { toolError } from '../result/toolError';
import { DNS_RCODE, DNS_TYPE_BY_CODE, type DnsAnswer, type DnsRecordType } from './types';

interface RawAnswer {
  readonly name?: unknown;
  readonly type?: unknown;
  readonly TTL?: unknown;
  readonly data?: unknown;
}

interface RawResponse {
  readonly Status?: unknown;
  readonly Answer?: unknown;
  readonly Authority?: unknown;
}

/** Trim a single trailing dot (DNS presentation form) for display. */
const stripDot = (value: string): string => (value.endsWith('.') ? value.slice(0, -1) : value);

/**
 * TXT records arrive as one or more quoted chunks which must be concatenated
 * (RFC 1035 3.3.14); the quotes are presentation syntax, not data.
 */
export function unquoteTxt(data: string): string {
  const chunks = data.match(/"((?:[^"\\]|\\.)*)"/g);
  if (!chunks || chunks.length === 0) return data;
  return chunks.map((chunk) => chunk.slice(1, -1).replace(/\\"/g, '"')).join('');
}

/** MX data is "<preference> <exchange>". */
function parseMx(data: string): { priority: number | null; value: string } {
  const match = /^(\d+)\s+(.+)$/.exec(data.trim());
  if (!match) return { priority: null, value: stripDot(data.trim()) };
  return { priority: Number(match[1]), value: stripDot(match[2].trim()) };
}

function toAnswer(raw: RawAnswer): DnsAnswer | null {
  const code = typeof raw.type === 'number' ? raw.type : Number(raw.type);
  const type: DnsRecordType | undefined = DNS_TYPE_BY_CODE[code];
  if (!type || typeof raw.data !== 'string') return null;

  const name = stripDot(String(raw.name ?? ''));
  const ttl = typeof raw.TTL === 'number' ? raw.TTL : null;

  if (type === 'MX') {
    const { priority, value } = parseMx(raw.data);
    return priority === null
      ? { name, type, value, ttl }
      : { name, type, value, ttl, priority };
  }
  if (type === 'TXT') return { name, type, value: unquoteTxt(raw.data), ttl };
  // A/AAAA/CNAME/NS/PTR are already canonical text; strip the presentation dot.
  return { name, type, value: stripDot(raw.data), ttl };
}

/**
 * Turn a DoH JSON body into answers.
 *
 * An empty answer list is a valid outcome (`ok([])`) — NXDOMAIN is the only
 * "no such name" case and it is an error, so callers can distinguish "the name
 * exists but has no records of this type" from "the name does not exist".
 */
export function parseDohResponse(json: unknown): Result<DnsAnswer[]> {
  if (typeof json !== 'object' || json === null) {
    return err(
      toolError('DNS_FAILURE', 'The DNS server returned an unexpected response.', {
        technical: `parseDohResponse: not an object (${typeof json})`,
      }),
    );
  }
  const response = json as RawResponse;
  const status = typeof response.Status === 'number' ? response.Status : null;

  if (status !== null && status !== DNS_RCODE.NOERROR) {
    if (status === DNS_RCODE.NXDOMAIN) {
      return err(
        toolError('NOT_FOUND', 'That name does not exist.', {
          technical: 'parseDohResponse: NXDOMAIN (rcode 3)',
        }),
      );
    }
    return err(
      toolError('DNS_FAILURE', 'The DNS server could not answer that query.', {
        technical: `parseDohResponse: rcode ${status}`,
      }),
    );
  }

  const rawAnswers = Array.isArray(response.Answer) ? (response.Answer as RawAnswer[]) : [];
  const answers: DnsAnswer[] = [];
  for (const raw of rawAnswers) {
    const answer = toAnswer(raw);
    // Unsupported record types (SOA, CAA, DNSSEC material) are dropped rather
    // than surfaced with a wrong type.
    if (answer) answers.push(answer);
  }
  return ok(answers);
}

/** One-line description for history summaries. */
export function summarizeAnswers(answers: readonly DnsAnswer[], max = 2): string {
  if (answers.length === 0) return 'no records';
  const shown = answers
    .slice(0, max)
    .map((answer) => answer.value)
    .join(', ');
  const rest = answers.length - max;
  return rest > 0 ? `${shown} +${rest} more` : shown;
}

/** "A, AAAA" → "A/AAAA" for compact display. */
export function describeTypes(types: readonly DnsRecordType[]): string {
  return types.join('/');
}
