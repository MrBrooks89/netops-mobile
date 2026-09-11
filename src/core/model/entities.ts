/**
 * Persisted entity models (plan §11) — pure interfaces, no behaviour.
 *
 * These mirror the database rows 1:1 (row↔model mapping lives in the
 * repositories). Timestamps are UTC ISO-8601 strings; `tags` is a string array
 * here and JSON text in the database.
 */

import type { ToolId } from '../registry/types';
import type { ToolErrorCode } from '../result/toolError';

export interface SavedEntityBase {
  readonly id: string;
  readonly label: string;
  /** Free-form labels for grouping and filtering. */
  readonly tags: readonly string[];
  readonly notes: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A hostname or IP the user wants to keep for later tools. */
export interface SavedHost extends SavedEntityBase {
  /** Canonical hostname (lower-case) or canonical IP address. */
  readonly host: string;
}

/** A network in CIDR notation. */
export interface SavedNetwork extends SavedEntityBase {
  readonly cidr: string;
}

export type SavedEntity = SavedHost | SavedNetwork;
export type SavedEntityKind = 'host' | 'network';

export interface SavedHostInput {
  readonly label: string;
  readonly host: string;
  readonly tags?: readonly string[];
  readonly notes?: string;
}

export interface SavedNetworkInput {
  readonly label: string;
  readonly cidr: string;
  readonly tags?: readonly string[];
  readonly notes?: string;
}

// ---------------------------------------------------------------------------
// Runs (history)
// ---------------------------------------------------------------------------

export type RunStatus = 'running' | 'success' | 'partial' | 'error' | 'cancelled';

/**
 * One tool execution. Generic envelope: `input`/`detail` are JSON validated by
 * per-tool codecs, so history stays tool-agnostic while remaining type-safe.
 */
export interface RunRecord {
  readonly id: string;
  readonly toolId: ToolId;
  readonly status: RunStatus;
  readonly input: unknown;
  /** One-line human summary for history lists. */
  readonly summary: string;
  readonly detail: unknown | null;
  readonly errorCode?: ToolErrorCode;
  readonly errorMessage?: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly durationMs: number | null;
}

export type RunRecordInput = Omit<RunRecord, 'id'>;
