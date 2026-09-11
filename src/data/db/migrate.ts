/**
 * Migration runner.
 *
 * Applies pending migrations in ascending version order, each inside its own
 * transaction, and records them in `schema_migrations`. Idempotent: running it
 * twice applies nothing the second time.
 *
 * Failures come back as `Result` with a `STORAGE_ERROR` code — a database that
 * cannot be prepared is a user-visible condition ("could not open local
 * storage"), not a crash. A failed migration rolls back, so the database is
 * never left half-migrated.
 */

import { err, ok, type Result } from '../../core/result/result';
import { toolError, type ToolError } from '../../core/result/toolError';
import type { SqlDriver } from './driver';
import { LATEST_VERSION, MIGRATIONS, type Migration } from './migrations';

export interface MigrateResult {
  /** Schema version before this run. */
  readonly from: number;
  /** Schema version after this run. */
  readonly to: number;
  /** Versions applied by this run, ascending (empty when already current). */
  readonly applied: readonly number[];
}

interface VersionRow {
  readonly version: number;
}

/** Migration versions must be positive, unique, and strictly increasing. */
export function validateMigrations(migrations: readonly Migration[]): Result<void> {
  let previous = 0;
  for (const migration of migrations) {
    if (!Number.isInteger(migration.version) || migration.version < 1) {
      return invalid(
        `Migration version must be a positive whole number (got ${migration.version}).`,
      );
    }
    if (migration.version === previous) {
      return invalid(`Duplicate migration version ${migration.version}.`);
    }
    if (migration.version < previous) {
      return invalid(
        `Migrations must be listed in ascending order (${migration.version} after ${previous}).`,
      );
    }
    if (migration.statements.length === 0) {
      return invalid(`Migration ${migration.version} has no statements.`);
    }
    previous = migration.version;
  }
  return ok(undefined);
}

function invalid(message: string): Result<never> {
  return err(
    toolError('STORAGE_ERROR', message, {
      technical: `validateMigrations: ${message}`,
    }),
  );
}

/**
 * Bring the database up to the latest schema version.
 *
 * `migrations` is injectable so tests can exercise the version-bump path with
 * a real database (see migrate.sqlite.test.ts).
 */
export async function migrate(
  db: SqlDriver,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<Result<MigrateResult>> {
  const valid = validateMigrations(migrations);
  if (!valid.ok) return valid;

  try {
    await db.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version    INTEGER PRIMARY KEY NOT NULL,
         name       TEXT NOT NULL,
         applied_at TEXT NOT NULL
       )`,
    );

    const rows = await db.all<VersionRow>('SELECT version FROM schema_migrations');
    const appliedVersions = new Set(rows.map((row) => row.version));
    const from = rows.reduce((max, row) => Math.max(max, row.version), 0);

    const pending = migrations
      .filter((migration) => !appliedVersions.has(migration.version))
      .sort((a, b) => a.version - b.version);

    for (const migration of pending) {
      await db.transaction(async (tx) => {
        for (const statement of migration.statements) {
          await tx.exec(statement);
        }
        await tx.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [
          migration.version,
          migration.name,
          new Date().toISOString(),
        ]);
      });
    }

    const to = pending.reduce((max, migration) => Math.max(max, migration.version), from);
    return ok({ from, to, applied: pending.map((migration) => migration.version) });
  } catch (cause) {
    return err(storageError(cause, 'prepare local storage'));
  }
}

function storageError(cause: unknown, action: string): ToolError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return toolError('STORAGE_ERROR', `Could not ${action} on this device.`, {
    technical: `migrate failed: ${detail}`,
    cause,
  });
}

export { LATEST_VERSION };
