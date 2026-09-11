/**
 * SQL driver port.
 *
 * **Synchronous by design.** expo-sqlite exposes a synchronous API and the data
 * volumes here are tiny (hundreds of rows), so the whole data layer can run
 * without promises. That matters beyond style: the app must have its
 * repositories during the *first* render, because expo-router needs its
 * navigator mounted then to build the route tree. An asynchronous bootstrap
 * forces a loading gate in the root layout, and gating the navigator leaves the
 * router with no routes (see docs/M2_VERIFICATION.md).
 *
 * Repositories may still be `async` if convenient — `await` on a plain value is
 * a no-op.
 *
 * Other design points:
 *  - Positional `?` parameters only, so both drivers bind identically.
 *  - No `boolean` params: SQLite has no boolean type, so flags are 0/1 INTEGERs.
 *  - `transaction()` is scoped; no repository writes BEGIN/COMMIT by hand.
 *    Transactions do not nest — nothing in the data layer nests them.
 */

import type { SQLiteBindValue, SQLiteDatabase } from 'expo-sqlite';

export type SqlParam = string | number | null;
export type SqlParams = readonly SqlParam[];

export interface SqlRunResult {
  readonly changes: number;
  readonly lastInsertRowId: number;
}

export interface SqlDriver {
  /** Run one or more statements with no parameters (DDL, PRAGMAs). */
  exec(sql: string): void;
  run(sql: string, params?: SqlParams): SqlRunResult;
  all<T>(sql: string, params?: SqlParams): T[];
  first<T>(sql: string, params?: SqlParams): T | null;
  /** Run `fn` inside a transaction; rolls back if it throws. */
  transaction<T>(fn: (tx: SqlDriver) => T): T;
}

const bind = (params: SqlParams): SQLiteBindValue[] => [...params];

/** Wrap an open expo-sqlite database as a SqlDriver. */
export function expoDriver(db: SQLiteDatabase): SqlDriver {
  const driver: SqlDriver = {
    exec: (sql) => db.execSync(sql),

    run: (sql, params = []) => {
      const result = db.runSync(sql, bind(params));
      return { changes: result.changes, lastInsertRowId: result.lastInsertRowId };
    },

    all: <T>(sql: string, params: SqlParams = []) => db.getAllSync<T>(sql, bind(params)),

    first: <T>(sql: string, params: SqlParams = []) => db.getFirstSync<T>(sql, bind(params)),

    transaction: <T>(fn: (tx: SqlDriver) => T): T => {
      let value: T | undefined;
      db.withTransactionSync(() => {
        value = fn(driver);
      });
      return value as T;
    },
  };
  return driver;
}

/** Database file name — one place, so tests and tools agree. */
export const DATABASE_NAME = 'netops.db';

/**
 * Open (and configure) the app database.
 *
 * WAL is recommended by the Expo docs; foreign keys are enabled explicitly
 * because SQLite defaults them off. The opener is injected so tests can supply
 * an in-memory database without touching the native module.
 */
export function openAppDatabase(
  open: (name: string) => SQLiteDatabase,
  name = DATABASE_NAME,
): SqlDriver {
  const db = open(name);
  db.execSync('PRAGMA journal_mode = WAL');
  db.execSync('PRAGMA foreign_keys = ON');
  return expoDriver(db);
}
