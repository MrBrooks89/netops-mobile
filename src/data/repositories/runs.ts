/**
 * Run history repository.
 *
 * One generic envelope for every tool execution: `input` and `detail` are JSON
 * text validated by per-tool codecs at the app boundary, so history needs no
 * polymorphic table and adding a tool never touches this file.
 *
 * Retention is enforced by `prune(keep)`, which keeps the newest N runs and
 * deletes the rest — the plan's `historyRetentionLimit` setting.
 */

import type { RunRecord, RunRecordInput, RunStatus } from '../../core/model/entities';
import type { ToolId } from '../../core/registry/types';
import { err, ok, type Result } from '../../core/result/result';
import { toolError, type ToolError, type ToolErrorCode } from '../../core/result/toolError';
import { newRunId } from '../../core/util/id';
import type { SqlDriver } from '../db/driver';

export interface RunQuery {
  readonly toolId?: ToolId;
  readonly limit?: number;
}

export interface RunRepository {
  record(input: RunRecordInput): Result<RunRecord>;
  /** Newest first. */
  list(query?: RunQuery): Result<RunRecord[]>;
  get(id: string): Result<RunRecord | null>;
  remove(id: string): Result<boolean>;
  /** Delete everything; returns how many runs were removed. */
  clear(): Result<number>;
  count(): Result<number>;
  /** Keep the newest `keep` runs, delete the rest; returns how many were pruned. */
  prune(keep: number): Result<number>;
}

interface RunRow {
  readonly id: string;
  readonly tool_id: string;
  readonly status: string;
  readonly input: string;
  readonly summary: string;
  readonly detail: string | null;
  readonly error_code: string | null;
  readonly error_message: string | null;
  readonly started_at: string;
  readonly finished_at: string | null;
  readonly duration_ms: number | null;
}

const RUN_STATUSES: readonly RunStatus[] = ['running', 'success', 'partial', 'error', 'cancelled'];

/** Unknown statuses only appear if a row was hand-edited; 'error' is the safest read. */
const parseStatus = (raw: string): RunStatus =>
  (RUN_STATUSES as readonly string[]).includes(raw) ? (raw as RunStatus) : 'error';

/**
 * Serialise a tool payload for storage.
 *
 * Core reports carry `bigint` values (IP integers), and `JSON.stringify` throws
 * on those — which would silently drop the history entry. Addresses are stored
 * as their decimal string instead, which is what a reader wants anyway.
 */
const toJson = (value: unknown): string =>
  JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item));

/** Corrupt JSON degrades to null rather than breaking the history list. */
const parseJson = (text: string | null): unknown | null => {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const storageError = (cause: unknown, action: string): ToolError => {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return toolError('STORAGE_ERROR', `Could not ${action} on this device.`, {
    technical: `runs ${action} failed: ${detail}`,
    cause,
  });
};

export function createRunRepository(
  db: SqlDriver,
  options: { newId?: () => string } = {},
): RunRepository {
  const newId = options.newId ?? newRunId;

  const toModel = (row: RunRow): RunRecord => ({
    id: row.id,
    toolId: row.tool_id as ToolId,
    status: parseStatus(row.status),
    input: parseJson(row.input),
    summary: row.summary,
    detail: parseJson(row.detail),
    ...(row.error_code ? { errorCode: row.error_code as ToolErrorCode } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
  });

  return {
    record(input) {
      const id = newId();
      try {
        db.run(
          `INSERT INTO runs
             (id, tool_id, status, input, summary, detail, error_code, error_message,
              started_at, finished_at, duration_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            input.toolId,
            input.status,
            toJson(input.input ?? null),
            input.summary,
            input.detail === null || input.detail === undefined ? null : toJson(input.detail),
            input.errorCode ?? null,
            input.errorMessage ?? null,
            input.startedAt,
            input.finishedAt,
            input.durationMs,
          ],
        );
      } catch (cause) {
        return err(storageError(cause, 'save the history entry'));
      }
      return ok({ ...input, id });
    },

    list(query = {}) {
      try {
        const limit = query.limit !== undefined && query.limit > 0 ? query.limit : -1;
        const rows = query.toolId
          ? db.all<RunRow>(
              `SELECT * FROM runs WHERE tool_id = ? ORDER BY started_at DESC, id DESC LIMIT ?`,
              [query.toolId, limit],
            )
          : db.all<RunRow>(`SELECT * FROM runs ORDER BY started_at DESC, id DESC LIMIT ?`, [limit]);
        return ok(rows.map(toModel));
      } catch (cause) {
        return err(storageError(cause, 'read history'));
      }
    },

    get(id) {
      try {
        const row = db.first<RunRow>('SELECT * FROM runs WHERE id = ?', [id]);
        return ok(row ? toModel(row) : null);
      } catch (cause) {
        return err(storageError(cause, 'read the history entry'));
      }
    },

    remove(id) {
      try {
        const result = db.run('DELETE FROM runs WHERE id = ?', [id]);
        return ok(result.changes > 0);
      } catch (cause) {
        return err(storageError(cause, 'delete the history entry'));
      }
    },

    clear() {
      try {
        const result = db.run('DELETE FROM runs');
        return ok(result.changes);
      } catch (cause) {
        return err(storageError(cause, 'clear history'));
      }
    },

    count() {
      try {
        const row = db.first<{ n: number }>('SELECT COUNT(*) AS n FROM runs');
        return ok(row?.n ?? 0);
      } catch (cause) {
        return err(storageError(cause, 'count history'));
      }
    },

    prune(keep) {
      if (!Number.isInteger(keep) || keep < 0) {
        return err(
          toolError('INVALID_INPUT', 'History retention must be zero or more runs.', {
            technical: `runs.prune(${keep}): not a non-negative integer`,
          }),
        );
      }
      try {
        const result = db.run(
          `DELETE FROM runs
            WHERE id NOT IN (
              SELECT id FROM runs ORDER BY started_at DESC, id DESC LIMIT ?
            )`,
          [keep],
        );
        return ok(result.changes);
      } catch (cause) {
        return err(storageError(cause, 'prune history'));
      }
    },
  };
}
