/**
 * Schema migrations.
 *
 * Append-only: never edit a released migration — add a new one. The runner
 * (./migrate.ts) applies pending versions in ascending order, each inside its
 * own transaction, and records them in `schema_migrations`.
 *
 * Timestamps are UTC ISO-8601 strings; tags/notes/payloads are stored as JSON
 * text and validated at the repository boundary.
 */

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    statements: [
      `CREATE TABLE hosts (
         id         TEXT PRIMARY KEY NOT NULL,
         label      TEXT NOT NULL,
         host       TEXT NOT NULL,
         tags       TEXT NOT NULL DEFAULT '[]',
         notes      TEXT NOT NULL DEFAULT '',
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL
       )`,
      `CREATE TABLE networks (
         id         TEXT PRIMARY KEY NOT NULL,
         label      TEXT NOT NULL,
         cidr       TEXT NOT NULL,
         tags       TEXT NOT NULL DEFAULT '[]',
         notes      TEXT NOT NULL DEFAULT '',
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL
       )`,
      `CREATE TABLE runs (
         id            TEXT PRIMARY KEY NOT NULL,
         tool_id       TEXT NOT NULL,
         status        TEXT NOT NULL,
         input         TEXT NOT NULL,
         summary       TEXT NOT NULL,
         detail        TEXT,
         error_code    TEXT,
         error_message TEXT,
         started_at    TEXT NOT NULL,
         finished_at   TEXT,
         duration_ms   INTEGER
       )`,
      `CREATE INDEX idx_runs_tool_started ON runs(tool_id, started_at DESC)`,
      `CREATE TABLE ports (
         port        INTEGER NOT NULL,
         proto       TEXT NOT NULL,
         service     TEXT NOT NULL,
         description TEXT NOT NULL,
         PRIMARY KEY (port, proto)
       )`,
    ],
  },
  {
    // List screens sort by label (Saved tab) and by recency (History tab);
    // these indexes keep those queries off a full table scan as history grows
    // toward the retention cap.
    version: 2,
    name: 'list indexes',
    statements: [
      `CREATE INDEX idx_hosts_label ON hosts(label COLLATE NOCASE)`,
      `CREATE INDEX idx_networks_label ON networks(label COLLATE NOCASE)`,
      `CREATE INDEX idx_runs_started ON runs(started_at DESC)`,
    ],
  },
];

/** Newest schema version described by MIGRATIONS. */
export const LATEST_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);
