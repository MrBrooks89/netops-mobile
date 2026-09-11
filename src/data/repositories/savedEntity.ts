/**
 * Shared implementation for the "saved entity" tables (hosts, networks).
 *
 * Both tables have the same shape and the same behaviour — label, tags, notes,
 * timestamps, plus one table-specific value column. Keeping one owner for the
 * CRUD logic means the two repositories cannot drift, and the only thing a
 * concrete repository supplies is its table name, value column and validator.
 *
 * Table and column names are literal unions rather than free strings, so the
 * SQL interpolation below is type-checked and cannot be fed user input.
 */

import type { SavedEntityBase } from '../../core/model/entities';
import { err, ok, type Result } from '../../core/result/result';
import { toolError, type ToolError } from '../../core/result/toolError';
import type { SqlDriver } from '../db/driver';
import { normalizeTags, parseTags, serializeTags } from './tags';

export interface SavedRepository<TModel extends SavedEntityBase, TInput> {
  /** All rows, ordered by label (case-insensitive) then creation time. */
  list(): Result<TModel[]>;
  get(id: string): Result<TModel | null>;
  create(input: TInput): Result<TModel>;
  update(id: string, patch: Partial<TInput>): Result<TModel>;
  /** `true` when a row was deleted, `false` when it was already gone. */
  remove(id: string): Result<boolean>;
  count(): Result<number>;
}

/** Row shape shared by both tables (`value` is read by the config). */
export type SavedRow = Record<string, unknown>;

export interface SavedFields {
  readonly id: string;
  readonly label: string;
  /** Canonical value: the host or the CIDR. */
  readonly value: string;
  readonly tags: readonly string[];
  readonly notes: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SavedTableConfig<TModel extends SavedEntityBase, TInput> {
  readonly table: 'hosts' | 'networks';
  readonly valueColumn: 'host' | 'cidr';
  /** Pull the raw value out of a create/update input. */
  readonly readInputValue: (input: TInput) => string;
  /** Validate and canonicalise it (core/validation/host, core/ip/cidr). */
  readonly parseValue: (raw: string) => Result<string>;
  /** Read the value column out of a database row. */
  readonly readRowValue: (row: SavedRow) => string;
  /** Assemble the model — explicit, so no dynamic property keys are needed. */
  readonly toModel: (fields: SavedFields) => TModel;
  readonly newId: () => string;
  /** Injectable clock, for deterministic tests. */
  readonly now?: () => string;
}

interface InputShape {
  readonly label: string;
  readonly tags?: readonly string[];
  readonly notes?: string;
}

const storageError = (cause: unknown, action: string): ToolError => {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return toolError('STORAGE_ERROR', `Could not ${action} on this device.`, {
    technical: `${action} failed: ${detail}`,
    cause,
  });
};

export function createSavedRepository<TModel extends SavedEntityBase, TInput extends InputShape>(
  db: SqlDriver,
  config: SavedTableConfig<TModel, TInput>,
): SavedRepository<TModel, TInput> {
  const now = config.now ?? (() => new Date().toISOString());
  const { table, valueColumn } = config;

  const toFields = (row: SavedRow): SavedFields => ({
    id: String(row['id']),
    label: String(row['label']),
    value: config.readRowValue(row),
    tags: parseTags(row['tags'] as string | null),
    notes: String(row['notes'] ?? ''),
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at']),
  });

  const selectById = (id: string) =>
    db.first<SavedRow>(`SELECT * FROM ${table} WHERE id = ?`, [id]);

  return {
    list() {
      try {
        const rows = db.all<SavedRow>(
          `SELECT * FROM ${table} ORDER BY label COLLATE NOCASE ASC, created_at ASC`,
        );
        return ok(rows.map((row) => config.toModel(toFields(row))));
      } catch (cause) {
        return err(storageError(cause, 'read saved items'));
      }
    },

    get(id) {
      try {
        const row = selectById(id);
        return ok(row ? config.toModel(toFields(row)) : null);
      } catch (cause) {
        return err(storageError(cause, 'read the saved item'));
      }
    },

    create(input) {
      const value = config.parseValue(config.readInputValue(input));
      if (!value.ok) return value;

      const timestamp = now();
      // A blank label falls back to the value: saving should never fail on
      // naming, and the item stays recognisable in the list.
      const label = input.label.trim() === '' ? value.value : input.label.trim();
      const id = config.newId();
      const tags = normalizeTags(input.tags);
      const notes = (input.notes ?? '').trim();

      try {
        db.run(
          `INSERT INTO ${table} (id, label, ${valueColumn}, tags, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, label, value.value, serializeTags(tags), notes, timestamp, timestamp],
        );
      } catch (cause) {
        return err(storageError(cause, 'save the item'));
      }

      return ok(
        config.toModel({
          id,
          label,
          value: value.value,
          tags,
          notes,
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      );
    },

    update(id, patch) {
      try {
        const row = selectById(id);
        if (!row) {
          return err(
            toolError('NOT_FOUND', 'That item no longer exists.', {
              technical: `update ${table} ${id}: no such row`,
            }),
          );
        }

        const existing = toFields(row);

        let value = existing.value;
        if (patch[config.valueColumn as keyof TInput] !== undefined) {
          const parsed = config.parseValue(config.readInputValue(patch as TInput));
          if (!parsed.ok) return parsed;
          value = parsed.value;
        }

        const label =
          patch.label === undefined
            ? existing.label
            : patch.label.trim() === ''
              ? value
              : patch.label.trim();
        const tags = patch.tags === undefined ? [...existing.tags] : normalizeTags(patch.tags);
        const notes = patch.notes === undefined ? existing.notes : patch.notes.trim();
        const updatedAt = now();

        db.run(
          `UPDATE ${table} SET label = ?, ${valueColumn} = ?, tags = ?, notes = ?, updated_at = ?
           WHERE id = ?`,
          [label, value, serializeTags(tags), notes, updatedAt, id],
        );

        return ok(config.toModel({ ...existing, label, value, tags, notes, updatedAt }));
      } catch (cause) {
        return err(storageError(cause, 'update the item'));
      }
    },

    remove(id) {
      try {
        const result = db.run(`DELETE FROM ${table} WHERE id = ?`, [id]);
        return ok(result.changes > 0);
      } catch (cause) {
        return err(storageError(cause, 'delete the item'));
      }
    },

    count() {
      try {
        const row = db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
        return ok(row?.n ?? 0);
      } catch (cause) {
        return err(storageError(cause, 'count saved items'));
      }
    },
  };
}
