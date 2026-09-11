/**
 * Port reference search.
 *
 * One ranked search over the curated dataset: match by port number, service
 * name, description text, or protocol token — in any combination
 * ("udp 53", "ms-sql", "https").
 *
 * Pure TS — no React Native imports.
 */

import { PORTS, type PortEntry, type PortProto } from './dataset';

export { PORTS };
export type { PortEntry, PortProto };

export interface PortSearchOptions {
  /** Restrict results to one protocol (default: all). */
  readonly proto?: PortProto | 'all';
  /** Override the dataset (tests, and M2's DB-backed source). */
  readonly entries?: readonly PortEntry[];
}

const PROTO_TOKENS: readonly PortProto[] = ['tcp', 'udp', 'sctp'];

const isProtoToken = (t: string): t is PortProto => (PROTO_TOKENS as readonly string[]).includes(t);

/**
 * Score one search term against one entry; 0 means "no match".
 * Numeric terms target the port; text terms prefer the service name and
 * fall back to the description.
 */
function scoreTerm(entry: PortEntry, term: string): number {
  if (/^\d+$/.test(term)) {
    const port = String(entry.port);
    if (port === term) return 100;
    if (port.startsWith(term)) return 50;
    return 0;
  }
  const service = entry.service.toLowerCase();
  if (service === term) return 80;
  if (service.startsWith(term)) return 60;
  if (service.includes(term)) return 40;
  if (entry.description.toLowerCase().includes(term)) return 20;
  return 0;
}

/**
 * Ranked search across the port dataset. An empty query returns the whole
 * (protocol-filtered) list in canonical port order.
 */
export function searchPorts(query: string, options: PortSearchOptions = {}): PortEntry[] {
  const source = options.entries ?? PORTS;
  let list: PortEntry[] =
    options.proto && options.proto !== 'all'
      ? source.filter((e) => e.proto === options.proto)
      : [...source];

  const normalized = query.trim().toLowerCase();
  if (!normalized) return list;

  const protoTokens: PortProto[] = [];
  const terms: string[] = [];
  for (const token of normalized.split(/\s+/)) {
    if (isProtoToken(token)) protoTokens.push(token);
    else terms.push(token);
  }

  if (protoTokens.length > 0) {
    list = list.filter((e) => protoTokens.includes(e.proto));
  }
  if (terms.length === 0) return list;

  const scored: { entry: PortEntry; score: number }[] = [];
  for (const entry of list) {
    let score = 0;
    let matchesAll = true;
    for (const term of terms) {
      const s = scoreTerm(entry, term);
      if (s === 0) {
        matchesAll = false;
        break;
      }
      score += s;
    }
    if (matchesAll) scored.push({ entry, score });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.entry.port - b.entry.port ||
      a.entry.proto.localeCompare(b.entry.proto),
  );
  return scored.map((s) => s.entry);
}

/** Total entries and per-protocol breakdown, for screen headers. */
export function portStats(entries: readonly PortEntry[] = PORTS): {
  total: number;
  tcp: number;
  udp: number;
} {
  let tcp = 0;
  let udp = 0;
  for (const e of entries) {
    if (e.proto === 'tcp') tcp++;
    else if (e.proto === 'udp') udp++;
  }
  return { total: entries.length, tcp, udp };
}

/**
 * Content fingerprint of a dataset (FNV-1a, 32-bit, hex).
 *
 * The database seeds its `ports` table from this dataset; the seeder stores the
 * fingerprint so an app update that changes the list re-seeds exactly once,
 * instead of diffing hundreds of rows on every launch. Order-sensitive, which
 * is fine: PORTS has a fixed canonical sort.
 */
export function datasetFingerprint(entries: readonly PortEntry[] = PORTS): string {
  let hash = 0x811c9dc5;
  for (const entry of entries) {
    const line = `${entry.port}|${entry.proto}|${entry.service}|${entry.description}\n`;
    for (let i = 0; i < line.length; i++) {
      hash ^= line.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, '0');
}
