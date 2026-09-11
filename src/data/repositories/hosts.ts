/**
 * Saved hosts repository.
 */

import type { SavedHost, SavedHostInput } from '../../core/model/entities';
import { newHostId } from '../../core/util/id';
import { parseHostInput } from '../../core/validation/host';
import type { SqlDriver } from '../db/driver';
import { createSavedRepository, type SavedRepository, type SavedRow } from './savedEntity';

export type HostRepository = SavedRepository<SavedHost, SavedHostInput>;

export function createHostRepository(
  db: SqlDriver,
  options: { now?: () => string } = {},
): HostRepository {
  return createSavedRepository<SavedHost, SavedHostInput>(db, {
    table: 'hosts',
    valueColumn: 'host',
    readInputValue: (input) => input.host,
    parseValue: parseHostInput,
    readRowValue: (row: SavedRow) => String(row['host'] ?? ''),
    newId: newHostId,
    now: options.now,
    toModel: (fields) => ({
      id: fields.id,
      label: fields.label,
      host: fields.value,
      tags: fields.tags,
      notes: fields.notes,
      createdAt: fields.createdAt,
      updatedAt: fields.updatedAt,
    }),
  });
}
