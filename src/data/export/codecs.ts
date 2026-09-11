/**
 * Export codecs — render entities to JSON, CSV, or plain text.
 *
 * Pure and synchronous: the codecs produce a filename + contents, and
 * ./share.ts is the only thing that touches the filesystem or the share sheet.
 * That split keeps the formatting (the part with real rules: CSV escaping,
 * column order, filename safety) fully unit-tested.
 *
 * JSON keeps the raw models so the file round-trips; CSV and text are for
 * humans and spreadsheets.
 */

import type { RunRecord, SavedHost, SavedNetwork } from '../../core/model/entities';

export type ExportFormat = 'json' | 'csv' | 'text';

export interface ExportFile {
  readonly filename: string;
  readonly mimeType: string;
  readonly contents: string;
}

export interface ExportOptions {
  /** ISO timestamp recorded in the file; injectable so tests are deterministic. */
  readonly exportedAt?: string;
}

const MIME_TYPES: Record<ExportFormat, string> = {
  json: 'application/json',
  csv: 'text/csv',
  text: 'text/plain',
};

const EXTENSIONS: Record<ExportFormat, string> = { json: 'json', csv: 'csv', text: 'txt' };

/** Bumped if the JSON envelope shape ever changes. */
export const EXPORT_SCHEMA_VERSION = 1;

/** Quote a CSV field when it contains a delimiter, a quote, or a line break. */
export function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** RFC 4180-style CSV with CRLF line endings and a trailing newline. */
export function toCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return [headers, ...rows].map((row) => row.map(escapeCsvField).join(',')).join('\r\n') + '\r\n';
}

/** `2026-09-12T10:00:00.000Z` → `20260912-100000` (filename-safe). */
export function filenameStamp(iso: string): string {
  const digits = iso.replace(/\D/g, '');
  return digits.length >= 14 ? `${digits.slice(0, 8)}-${digits.slice(8, 14)}` : 'export';
}

interface ExportColumn<T> {
  readonly header: string;
  readonly value: (item: T) => string;
}

interface ExportSpec<T> {
  readonly kind: string;
  readonly prefix: string;
  readonly title: string;
  readonly columns: readonly ExportColumn<T>[];
  readonly textLine: (item: T, index: number) => string;
}

function buildExport<T>(
  spec: ExportSpec<T>,
  items: readonly T[],
  format: ExportFormat,
  options: ExportOptions = {},
): ExportFile {
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  const filename = `netops-${spec.prefix}-${filenameStamp(exportedAt)}.${EXTENSIONS[format]}`;

  let contents: string;
  if (format === 'json') {
    contents =
      JSON.stringify(
        {
          kind: spec.kind,
          schemaVersion: EXPORT_SCHEMA_VERSION,
          exportedAt,
          count: items.length,
          items,
        },
        null,
        2,
      ) + '\n';
  } else if (format === 'csv') {
    contents = toCsv(
      spec.columns.map((column) => column.header),
      items.map((item) => spec.columns.map((column) => column.value(item))),
    );
  } else {
    const lines = items.map((item, index) => spec.textLine(item, index));
    contents = `${spec.title} — ${items.length} ${items.length === 1 ? 'entry' : 'entries'}\nExported ${exportedAt}\n\n${lines.join('\n')}\n`;
  }

  return { filename, mimeType: MIME_TYPES[format], contents };
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

const HISTORY_SPEC: ExportSpec<RunRecord> = {
  kind: 'run-history',
  prefix: 'history',
  title: 'NetOps Mobile history',
  columns: [
    { header: 'id', value: (r) => r.id },
    { header: 'tool_id', value: (r) => r.toolId },
    { header: 'status', value: (r) => r.status },
    { header: 'summary', value: (r) => r.summary },
    { header: 'started_at', value: (r) => r.startedAt },
    { header: 'finished_at', value: (r) => r.finishedAt ?? '' },
    { header: 'duration_ms', value: (r) => (r.durationMs === null ? '' : String(r.durationMs)) },
    { header: 'error_code', value: (r) => r.errorCode ?? '' },
    { header: 'error_message', value: (r) => r.errorMessage ?? '' },
    { header: 'input', value: (r) => (r.input === null ? '' : JSON.stringify(r.input)) },
    { header: 'detail', value: (r) => (r.detail === null ? '' : JSON.stringify(r.detail)) },
  ],
  textLine: (r) => `${r.startedAt}  ${r.status.padEnd(9)}  ${r.toolId.padEnd(20)}  ${r.summary}`,
};

const HOSTS_SPEC: ExportSpec<SavedHost> = {
  kind: 'saved-hosts',
  prefix: 'hosts',
  title: 'NetOps Mobile saved hosts',
  columns: [
    { header: 'id', value: (h) => h.id },
    { header: 'label', value: (h) => h.label },
    { header: 'host', value: (h) => h.host },
    { header: 'tags', value: (h) => h.tags.join(';') },
    { header: 'notes', value: (h) => h.notes },
    { header: 'created_at', value: (h) => h.createdAt },
    { header: 'updated_at', value: (h) => h.updatedAt },
  ],
  textLine: (h) => `${h.label}\t${h.host}\t${h.tags.join(' ')}`.trimEnd(),
};

const NETWORKS_SPEC: ExportSpec<SavedNetwork> = {
  kind: 'saved-networks',
  prefix: 'networks',
  title: 'NetOps Mobile saved networks',
  columns: [
    { header: 'id', value: (n) => n.id },
    { header: 'label', value: (n) => n.label },
    { header: 'cidr', value: (n) => n.cidr },
    { header: 'tags', value: (n) => n.tags.join(';') },
    { header: 'notes', value: (n) => n.notes },
    { header: 'created_at', value: (n) => n.createdAt },
    { header: 'updated_at', value: (n) => n.updatedAt },
  ],
  textLine: (n) => `${n.label}\t${n.cidr}\t${n.tags.join(' ')}`.trimEnd(),
};

export const exportRunHistory = (
  runs: readonly RunRecord[],
  format: ExportFormat,
  options?: ExportOptions,
): ExportFile => buildExport(HISTORY_SPEC, runs, format, options);

export const exportSavedHosts = (
  hosts: readonly SavedHost[],
  format: ExportFormat,
  options?: ExportOptions,
): ExportFile => buildExport(HOSTS_SPEC, hosts, format, options);

export const exportSavedNetworks = (
  networks: readonly SavedNetwork[],
  format: ExportFormat,
  options?: ExportOptions,
): ExportFile => buildExport(NETWORKS_SPEC, networks, format, options);
