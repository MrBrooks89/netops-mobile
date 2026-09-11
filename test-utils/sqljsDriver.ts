/**
 * A real-SQLite SqlDriver for tests, backed by sql.js (SQLite compiled to
 * WebAssembly).
 *
 * Why: `expo-sqlite` is a native module and does not run under Jest, but the
 * data layer's risk lives in its SQL (schema, constraints, migrations,
 * pruning). Running the *same* statements through a real SQLite engine in CI
 * catches those bugs without a device.
 *
 * Test-only. Never import this from app code.
 */

import initSqlJs, { type Database } from 'sql.js';
import type { SqlDriver, SqlParams, SqlRunResult } from '../src/data/db/driver';

export interface TestDatabase extends SqlDriver {
  /** Escape hatch for assertions that are easier in raw SQL. */
  readonly raw: Database;
  close(): void;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  // No locateFile: sql.js's Node build resolves its own wasm relative to the
  // module directory, which keeps this file free of Node path APIs (the
  // project's tsconfig deliberately excludes Node types).
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');

  let depth = 0;

  const all = <T>(sql: string, params: SqlParams = []): T[] => {
    const stmt = db.prepare(sql);
    try {
      if (params.length > 0) stmt.bind([...params]);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  };

  const driver: TestDatabase = {
    raw: db,

    exec: (sql) => {
      db.run(sql);
    },

    run: (sql, params = []): SqlRunResult => {
      const stmt = db.prepare(sql);
      try {
        if (params.length > 0) stmt.bind([...params]);
        stmt.step();
      } finally {
        stmt.free();
      }
      const lastInsertRowId = all<{ id: number }>('SELECT last_insert_rowid() AS id')[0]?.id ?? 0;
      return { changes: db.getRowsModified(), lastInsertRowId };
    },

    all: <T>(sql: string, params: SqlParams = []) => all<T>(sql, params),

    first: <T>(sql: string, params: SqlParams = []) => all<T>(sql, params)[0] ?? null,

    transaction: <T>(fn: (tx: SqlDriver) => T): T => {
      // Savepoints make nesting safe (a repository may be called inside the
      // migration runner's transaction).
      const savepoint = `sp_${depth}`;
      depth += 1;
      db.run(depth === 1 ? 'BEGIN' : `SAVEPOINT ${savepoint}`);
      try {
        const value = fn(driver);
        db.run(depth === 1 ? 'COMMIT' : `RELEASE ${savepoint}`);
        return value;
      } catch (cause) {
        db.run(depth === 1 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}`);
        throw cause;
      } finally {
        depth -= 1;
      }
    },

    close: () => db.close(),
  };

  return driver;
}
