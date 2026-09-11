/**
 * Saved networks repository.
 *
 * The CIDR is validated with the same parser the calculators use, so a network
 * can never be saved in a form the tools would reject. The address is kept as
 * entered (canonical formatting applied) rather than silently rewritten to the
 * network address — that choice belongs to the user's tools, not to storage.
 */

import { cidrToString, parseCidr } from '../../core/ip/cidr';
import type { SavedNetwork, SavedNetworkInput } from '../../core/model/entities';
import { ok } from '../../core/result/result';
import { newNetworkId } from '../../core/util/id';
import type { SqlDriver } from '../db/driver';
import { createSavedRepository, type SavedRepository, type SavedRow } from './savedEntity';

export type NetworkRepository = SavedRepository<SavedNetwork, SavedNetworkInput>;

export function createNetworkRepository(
  db: SqlDriver,
  options: { now?: () => string } = {},
): NetworkRepository {
  return createSavedRepository<SavedNetwork, SavedNetworkInput>(db, {
    table: 'networks',
    valueColumn: 'cidr',
    readInputValue: (input) => input.cidr,
    parseValue: (raw) => {
      const parsed = parseCidr(raw);
      return parsed.ok ? ok(cidrToString(parsed.value)) : parsed;
    },
    readRowValue: (row: SavedRow) => String(row['cidr'] ?? ''),
    newId: newNetworkId,
    now: options.now,
    toModel: (fields) => ({
      id: fields.id,
      label: fields.label,
      cidr: fields.value,
      tags: fields.tags,
      notes: fields.notes,
      createdAt: fields.createdAt,
      updatedAt: fields.updatedAt,
    }),
  });
}
