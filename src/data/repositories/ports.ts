/**
 * Ports repository — the database is the source of truth for the reference
 * screen, seeded from the bundled dataset.
 *
 * Why a table at all: the port scanner (M4) and exports need to join service
 * names against ports, and the plan calls for the reference data to live in the
 * database by M2. Ranking/search stays in `core/ports` so there is still one
 * owner for "what a good match looks like".
 */

import {
  PORTS,
  datasetFingerprint,
  searchPorts,
  type PortEntry,
  type PortProto,
} from '../../core/ports/ports';
import { err, ok, type Result } from '../../core/result/result';
import { toolError, type ToolError } from '../../core/result/toolError';
import type { SqlDriver } from '../db/driver';
import { DATA_KEYS, type SettingsStore } from '../settings/store';

export interface SeedOutcome {
  /** True when the table was rewritten by this call. */
  readonly seeded: boolean;
  readonly count: number;
  readonly fingerprint: string;
}

export interface PortRepository {
  /** Seed (or re-seed) the table when the bundled dataset has changed. */
  ensureSeeded(entries?: readonly PortEntry[]): Result<SeedOutcome>;
  /** Ranked search; ranked by core/ports, stored by SQLite. */
  search(query: string, proto?: PortProto | 'all'): Result<PortEntry[]>;
  count(): Result<number>;
}

interface PortRow {
  readonly port: number;
  readonly proto: string;
  readonly service: string;
  readonly description: string;
}

const storageError = (cause: unknown, action: string): ToolError => {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return toolError('STORAGE_ERROR', `Could not ${action} on this device.`, {
    technical: `ports ${action} failed: ${detail}`,
    cause,
  });
};

/**
 * Rows per INSERT when seeding. 200 rows × 4 params = 800 bound variables,
 * comfortably under SQLite's classic 999-variable limit.
 */
export const INSERT_CHUNK_ROWS = 200;

const isProto = (value: string): value is PortProto =>
  value === 'tcp' || value === 'udp' || value === 'sctp';

export function createPortRepository(db: SqlDriver, meta?: SettingsStore): PortRepository {
  // The dataset is static for the lifetime of a session, so rows are cached
  // after the first read.
  let cache: PortEntry[] | null = null;

  const load = (): PortEntry[] => {
    if (cache) return cache;
    const rows = db.all<PortRow>('SELECT port, proto, service, description FROM ports');
    cache = rows.map((row) => ({
      port: row.port,
      proto: isProto(row.proto) ? row.proto : 'tcp',
      service: row.service,
      description: row.description,
    }));
    return cache;
  };

  return {
    ensureSeeded(entries = PORTS) {
      const fingerprint = datasetFingerprint(entries);
      try {
        const stored = meta?.get(DATA_KEYS.portsFingerprint) ?? null;
        const existing = db.first<{ n: number }>('SELECT COUNT(*) AS n FROM ports');
        const count = existing?.n ?? 0;

        // Fast path: the stored fingerprint matches, or (without a settings
        // store) the row count already matches the dataset.
        const upToDate = meta
          ? stored === fingerprint && count === entries.length
          : count === entries.length;
        if (upToDate) return ok({ seeded: false, count, fingerprint });

        db.transaction((tx) => {
          // Rewrite wholesale: the bundled dataset is the source of truth, so a
          // removed or renamed port must not survive an update.
          tx.exec('DELETE FROM ports');
          // Multi-row inserts. Chunked because each row binds four parameters
          // and older SQLite builds cap a statement at 999 variables.
          for (let offset = 0; offset < entries.length; offset += INSERT_CHUNK_ROWS) {
            const chunk = entries.slice(offset, offset + INSERT_CHUNK_ROWS);
            const placeholders = chunk.map(() => '(?, ?, ?, ?)').join(', ');
            const params = chunk.flatMap((entry) => [
              entry.port,
              entry.proto,
              entry.service,
              entry.description,
            ]);
            tx.run(
              `INSERT INTO ports (port, proto, service, description) VALUES ${placeholders}`,
              params,
            );
          }
        });

        meta?.set(DATA_KEYS.portsFingerprint, fingerprint);
        cache = null;
        return ok({ seeded: true, count: entries.length, fingerprint });
      } catch (cause) {
        return err(storageError(cause, 'prepare the port reference'));
      }
    },

    search(query, proto = 'all') {
      try {
        const entries = load();
        return ok(searchPorts(query, { proto, entries }));
      } catch (cause) {
        return err(storageError(cause, 'search ports'));
      }
    },

    count() {
      try {
        const row = db.first<{ n: number }>('SELECT COUNT(*) AS n FROM ports');
        return ok(row?.n ?? 0);
      } catch (cause) {
        return err(storageError(cause, 'count ports'));
      }
    },
  };
}
