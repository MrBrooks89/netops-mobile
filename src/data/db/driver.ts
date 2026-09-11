/**
 * SQL driver port.
 *
 * Repositories speak to this narrow interface rather than to `expo-sqlite`
 * directly, which keeps the data layer testable against real SQLite in Jest
 * (see test-utils/sqljsDriver.ts) and leaves room for a different backend
 * later without touching a single repository.
 *
 * Deliberate design points:
 *  - Positional `?` parameters only. Named parameters are convenient but the
 *    two drivers bind them differently; positional binding is unambiguous.
 *  - No `boolean` params: SQLite has no boolean type, so ports and flags are
 *    stored as 0/1 INTEGERs and must be converted at the repository boundary.
 *  - `transaction()` is scoped and rolls back on throw, so no repository ever
 *    writes BEGIN/COMMIT by hand.
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
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlParams): Promise<SqlRunResult>;
  all<T>(sql: string, params?: SqlParams): Promise<T[]>;
  first<T>(sql: string, params?: SqlParams): Promise<T | null>;
  /** Run `fn` inside a transaction; roll back if it throws. */
  transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T>;
}

const bind = (params: SqlParams): SQLiteBindValue[] => [...params];

/** Wrap an open expo-sqlite database as a SqlDriver. */
export function expoDriver(db: SQLiteDatabase): SqlDriver {
  const driver: SqlDriver = {
    exec: (sql) => db.execAsync(sql),

    run: async (sql, params = []) => {
      const result = await db.runAsync(sql, bind(params));
      return { changes: result.changes, lastInsertRowId: result.lastInsertRowId };
    },

    all: <T>(sql: string, params: SqlParams = []) => db.getAllAsync<T>(sql, bind(params)),

    first: <T>(sql: string, params: SqlParams = []) => db.getFirstAsync<T>(sql, bind(params)),

    transaction: async <T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T> => {
      // withExclusiveTransactionAsync gives us a txn-scoped handle and rolls
      // back automatically when the callback throws.
      let value: T | undefined;
      await db.withExclusiveTransactionAsync(async (txn) => {
        value = await fn(expoDriver(txn));
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
 * WAL is recommended by the Expo docs for general performance; foreign keys
 * are enabled explicitly because SQLite defaults them off.
 */
export async function openAppDatabase(
  open: (name: string) => Promise<SQLiteDatabase>,
  name = DATABASE_NAME,
): Promise<SqlDriver> {
  const db = await open(name);
  await db.execAsync('PRAGMA journal_mode = WAL');
  await db.execAsync('PRAGMA foreign_keys = ON');
  return expoDriver(db);
}
