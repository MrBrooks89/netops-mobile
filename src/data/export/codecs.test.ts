import type { RunRecord, SavedHost, SavedNetwork } from '../../core/model/entities';
import {
  EXPORT_SCHEMA_VERSION,
  escapeCsvField,
  exportRunHistory,
  exportSavedHosts,
  exportSavedNetworks,
  filenameStamp,
  toCsv,
} from './codecs';

const AT = '2026-09-12T10:05:30.000Z';

const run: RunRecord = {
  id: 'r_001',
  toolId: 'subnet-calculator',
  status: 'success',
  input: { cidr: '192.168.1.10/24' },
  summary: '192.168.1.0/24',
  detail: { networkAddress: '192.168.1.0' },
  startedAt: '2026-09-12T10:00:00.000Z',
  finishedAt: '2026-09-12T10:00:00.003Z',
  durationMs: 3,
};

const host: SavedHost = {
  id: 'h_001',
  label: 'Router, primary',
  host: '192.168.1.1',
  tags: ['core', 'edge'],
  notes: 'cabinet 3\nrack B',
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-09-01T09:00:00.000Z',
};

const network: SavedNetwork = {
  id: 'n_001',
  label: 'Office LAN',
  cidr: '192.168.1.0/24',
  tags: ['office'],
  notes: '',
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-09-01T09:00:00.000Z',
};

describe('CSV primitives', () => {
  it('quotes only when needed and escapes embedded quotes', () => {
    expect(escapeCsvField('plain')).toBe('plain');
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField('line\nbreak')).toBe('"line\nbreak"');
    expect(escapeCsvField('carriage\rreturn')).toBe('"carriage\rreturn"');
  });

  it('writes a header row and CRLF line endings', () => {
    expect(
      toCsv(
        ['a', 'b'],
        [
          ['1', '2'],
          ['x,y', 'z'],
        ],
      ),
    ).toBe('a,b\r\n1,2\r\n"x,y",z\r\n');
  });

  it('handles no rows', () => {
    expect(toCsv(['a'], [])).toBe('a\r\n');
  });
});

describe('filenameStamp', () => {
  it('produces a filename-safe stamp', () => {
    expect(filenameStamp(AT)).toBe('20260912-100530');
  });

  it('falls back when the timestamp is unusable', () => {
    expect(filenameStamp('nonsense')).toBe('export');
  });
});

describe('run history export', () => {
  it('exports JSON with the envelope and raw models', () => {
    const file = exportRunHistory([run], 'json', { exportedAt: AT });
    expect(file.filename).toBe('netops-history-20260912-100530.json');
    expect(file.mimeType).toBe('application/json');

    const parsed = JSON.parse(file.contents);
    expect(parsed).toMatchObject({
      kind: 'run-history',
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: AT,
      count: 1,
    });
    expect(parsed.items[0]).toEqual(run);
  });

  it('exports CSV with a stable column order', () => {
    const file = exportRunHistory([run], 'csv', { exportedAt: AT });
    expect(file.filename).toBe('netops-history-20260912-100530.csv');
    const [header, row] = file.contents.trim().split('\r\n');
    expect(header.split(',')[0]).toBe('id');
    expect(header).toContain('duration_ms');
    expect(row).toContain('r_001,subnet-calculator,success');
    // JSON payloads are quoted because they contain commas and quotes
    expect(row).toContain('"{""cidr"":""192.168.1.10/24""}"');
  });

  it('exports plain text, one run per line', () => {
    const file = exportRunHistory([run], 'text', { exportedAt: AT });
    expect(file.filename).toBe('netops-history-20260912-100530.txt');
    expect(file.mimeType).toBe('text/plain');
    expect(file.contents).toContain('NetOps Mobile history — 1 entry');
    expect(file.contents).toContain('Exported 2026-09-12T10:05:30.000Z');
    expect(file.contents).toContain('2026-09-12T10:00:00.000Z  success');
  });

  it('pluralises and handles an empty history', () => {
    const empty = exportRunHistory([], 'text', { exportedAt: AT });
    expect(empty.contents).toContain('0 entries');
    expect(exportRunHistory([], 'json', { exportedAt: AT }).contents).toContain('"count": 0');
    expect(
      exportRunHistory([], 'csv', { exportedAt: AT }).contents.trim().split('\r\n'),
    ).toHaveLength(1);
  });

  it('includes error fields for failed runs', () => {
    const failed: RunRecord = {
      ...run,
      status: 'error',
      detail: null,
      durationMs: null,
      finishedAt: null,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Invalid CIDR "x"',
    };
    const csv = exportRunHistory([failed], 'csv', { exportedAt: AT }).contents;
    expect(csv).toContain('INVALID_INPUT');
    expect(csv).toContain('"Invalid CIDR ""x"""');
  });

  it('defaults exportedAt to now when omitted', () => {
    const file = exportRunHistory([run], 'json');
    expect(file.filename).toMatch(/^netops-history-\d{8}-\d{6}\.json$/);
    expect(JSON.parse(file.contents).exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('saved entity exports', () => {
  it('exports hosts with escaped label, notes and tags', () => {
    const json = exportSavedHosts([host], 'json', { exportedAt: AT });
    expect(json.filename).toBe('netops-hosts-20260912-100530.json');
    expect(JSON.parse(json.contents).items[0]).toEqual(host);

    const csv = exportSavedHosts([host], 'csv', { exportedAt: AT }).contents;
    expect(csv).toContain('"Router, primary"');
    expect(csv).toContain('core;edge');
    expect(csv).toContain('"cabinet 3\nrack B"');

    const text = exportSavedHosts([host], 'text', { exportedAt: AT }).contents;
    expect(text).toContain('NetOps Mobile saved hosts — 1 entry');
    expect(text).toContain('Router, primary\t192.168.1.1\tcore edge');
  });

  it('exports networks', () => {
    const csv = exportSavedNetworks([network], 'csv', { exportedAt: AT }).contents;
    expect(csv).toContain('cidr');
    expect(csv).toContain('192.168.1.0/24');
    expect(exportSavedNetworks([network], 'text', { exportedAt: AT }).contents).toContain(
      'Office LAN\t192.168.1.0/24\toffice',
    );
  });
});
