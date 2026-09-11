import { createTestDatabase } from '../../../test-utils/sqljsDriver';
import { MIGRATIONS, type Migration } from './migrations';
import { migrate, validateMigrations } from './migrate';

const V1_ONLY = MIGRATIONS.filter((m) => m.version === 1);

describe('validateMigrations', () => {
  it('accepts the real migration list', () => {
    expect(validateMigrations(MIGRATIONS).ok).toBe(true);
  });

  it('rejects duplicate, unordered, empty and malformed migrations', () => {
    const ok1: Migration = { version: 1, name: 'a', statements: ['SELECT 1'] };
    const ok2: Migration = { version: 2, name: 'b', statements: ['SELECT 1'] };

    expect(validateMigrations([ok1, ok1]).ok).toBe(false); // duplicate
    expect(validateMigrations([ok2, ok1]).ok).toBe(false); // descending
    expect(validateMigrations([{ version: 1, name: 'a', statements: [] }]).ok).toBe(false);
    expect(validateMigrations([{ version: 0, name: 'a', statements: ['SELECT 1'] }]).ok).toBe(
      false,
    );
    expect(validateMigrations([{ version: -3, name: 'a', statements: ['SELECT 1'] }]).ok).toBe(
      false,
    );
    expect(validateMigrations([{ version: 1.5, name: 'a', statements: ['SELECT 1'] }]).ok).toBe(
      false,
    );
    expect(validateMigrations([ok1, ok2]).ok).toBe(true);
  });
});

describe('migrate — fresh database', () => {
  it('applies every migration and creates the schema', async () => {
    const db = await createTestDatabase();
    try {
      const result = await migrate(db);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toEqual({ from: 0, to: 2, applied: [1, 2] });

      const tables = await db.all<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
      );
      expect(tables.map((t) => t.name)).toEqual(
        expect.arrayContaining(['hosts', 'networks', 'runs', 'ports', 'schema_migrations']),
      );
    } finally {
      db.close();
    }
  });

  it('records the migration name and a UTC timestamp', async () => {
    const db = await createTestDatabase();
    try {
      await migrate(db);
      const row = await db.first<{ name: string; applied_at: string }>(
        'SELECT name, applied_at FROM schema_migrations WHERE version = 1',
      );
      expect(row?.name).toBe('initial schema');
      expect(row?.applied_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    } finally {
      db.close();
    }
  });

  it('is idempotent', async () => {
    const db = await createTestDatabase();
    try {
      await migrate(db);
      const second = await migrate(db);
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.value).toEqual({ from: 2, to: 2, applied: [] });
    } finally {
      db.close();
    }
  });
});

describe('migrate — version bump keeps data intact (M2 acceptance)', () => {
  it('adds v2 without disturbing v1 rows', async () => {
    const db = await createTestDatabase();
    try {
      // 1. A v1 database with real data in it.
      const first = await migrate(db, V1_ONLY);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.value.to).toBe(1);

      const now = '2026-09-12T10:00:00.000Z';
      await db.run(
        `INSERT INTO hosts (id, label, host, tags, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ['h1', 'Primary router', '192.168.1.1', '["core","edge"]', 'cabinet 3', now, now],
      );
      await db.run(
        `INSERT INTO networks (id, label, cidr, tags, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ['n1', 'Office LAN', '192.168.1.0/24', '["office"]', '', now, now],
      );
      await db.run(
        `INSERT INTO runs (id, tool_id, status, input, summary, started_at, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          'r1',
          'subnet-calculator',
          'success',
          '{"input":"192.168.1.10/24"}',
          '192.168.1.0/24',
          now,
          3,
        ],
      );

      // v2's indexes do not exist yet.
      const before = await db.all<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_hosts_label'`,
      );
      expect(before).toHaveLength(0);

      // 2. Apply the new migration.
      const bump = await migrate(db);
      expect(bump.ok).toBe(true);
      if (!bump.ok) return;
      expect(bump.value).toEqual({ from: 1, to: 2, applied: [2] });

      // 3. Every row survived, values unchanged.
      const host = await db.first<{ label: string; host: string; tags: string; notes: string }>(
        'SELECT label, host, tags, notes FROM hosts WHERE id = ?',
        ['h1'],
      );
      expect(host).toEqual({
        label: 'Primary router',
        host: '192.168.1.1',
        tags: '["core","edge"]',
        notes: 'cabinet 3',
      });

      const network = await db.first<{ cidr: string; tags: string }>(
        'SELECT cidr, tags FROM networks WHERE id = ?',
        ['n1'],
      );
      expect(network).toEqual({ cidr: '192.168.1.0/24', tags: '["office"]' });

      const run = await db.first<{ tool_id: string; duration_ms: number }>(
        'SELECT tool_id, duration_ms FROM runs WHERE id = ?',
        ['r1'],
      );
      expect(run).toEqual({ tool_id: 'subnet-calculator', duration_ms: 3 });

      // 4. The new indexes exist alongside the ones from v1.
      const indexes = await db.all<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'`,
      );
      expect(indexes.map((i) => i.name).sort()).toEqual([
        'idx_hosts_label',
        'idx_networks_label',
        'idx_runs_started',
        'idx_runs_tool_started',
      ]);
    } finally {
      db.close();
    }
  });
});

describe('migrate — failure handling', () => {
  it('rolls the whole failing migration back and reports STORAGE_ERROR', async () => {
    const db = await createTestDatabase();
    try {
      const migrations: Migration[] = [
        {
          version: 1,
          name: 'good',
          statements: ['CREATE TABLE good (id TEXT PRIMARY KEY NOT NULL)'],
        },
        {
          version: 2,
          name: 'broken',
          statements: [
            'CREATE TABLE half_applied (id TEXT PRIMARY KEY NOT NULL)',
            'INSERT INTO table_that_does_not_exist (id) VALUES (1)',
          ],
        },
      ];

      const result = await migrate(db, migrations);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('STORAGE_ERROR');

      // v1 committed; v2 rolled back entirely (table and version row).
      const versions = await db.all<{ version: number }>(
        'SELECT version FROM schema_migrations ORDER BY version',
      );
      expect(versions.map((v) => v.version)).toEqual([1]);

      const tables = await db.all<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table'`,
      );
      const names = tables.map((t) => t.name);
      expect(names).toContain('good');
      expect(names).not.toContain('half_applied');
    } finally {
      db.close();
    }
  });

  it('refuses an invalid migration list before touching the database', async () => {
    const db = await createTestDatabase();
    try {
      const result = await migrate(db, [
        { version: 2, name: 'later', statements: ['SELECT 1'] },
        { version: 1, name: 'earlier', statements: ['SELECT 1'] },
      ]);
      expect(result.ok).toBe(false);
      const tables = await db.all<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table'`,
      );
      expect(tables).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});
