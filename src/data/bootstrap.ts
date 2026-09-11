/**
 * Application bootstrap: open the database, bring the schema up to date, seed
 * the port reference and enforce history retention — in one place, so the
 * startup order is explicit.
 *
 * **Synchronous on purpose.** The root layout must render its expo-router
 * navigator during the very first render; an asynchronous bootstrap would force
 * a loading gate there and leave the router with no routes. See driver.ts.
 *
 * Returns a `Result` rather than throwing: "local storage could not be opened"
 * is a screen the user can be shown, not a crash.
 */

import { openDatabaseSync } from 'expo-sqlite';
import { err, ok, type Result } from '../core/result/result';
import { toolError } from '../core/result/toolError';
import { openAppDatabase, type SqlDriver } from './db/driver';
import { migrate } from './db/migrate';
import { createHostRepository, type HostRepository } from './repositories/hosts';
import { createNetworkRepository, type NetworkRepository } from './repositories/networks';
import { createPortRepository, type PortRepository } from './repositories/ports';
import { createRunRepository, type RunRepository } from './repositories/runs';
import { readSettings } from './settings/appSettings';
import type { SettingsStore } from './settings/store';

export interface AppData {
  readonly db: SqlDriver;
  readonly hosts: HostRepository;
  readonly networks: NetworkRepository;
  readonly runs: RunRepository;
  readonly ports: PortRepository;
  readonly settings: SettingsStore;
}

export function openAppData(settings: SettingsStore): Result<AppData> {
  try {
    const db = openAppDatabase(openDatabaseSync);

    const migrated = migrate(db);
    if (!migrated.ok) return migrated;

    const ports = createPortRepository(db, settings);
    const seeded = ports.ensureSeeded();
    if (!seeded.ok) return seeded;

    const runs = createRunRepository(db);

    // Retention is enforced at startup as well as after each write, so a long
    // gap between sessions cannot leave an oversized history behind.
    runs.prune(readSettings(settings).historyRetentionLimit);

    return ok({
      db,
      hosts: createHostRepository(db),
      networks: createNetworkRepository(db),
      runs,
      ports,
      settings,
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err(
      toolError('STORAGE_ERROR', 'Could not open local storage on this device.', {
        technical: `openAppData failed: ${detail}`,
        cause,
      }),
    );
  }
}
