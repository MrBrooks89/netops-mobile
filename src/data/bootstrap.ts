/**
 * Application bootstrap: open the database, bring the schema up to date, seed
 * the port reference and enforce history retention — in one place, so the
 * startup order is explicit and every screen can assume ready repositories.
 *
 * Returns a `Result` rather than throwing: "local storage could not be opened"
 * is a screen the user can be shown, not a crash.
 */

import { openDatabaseAsync } from 'expo-sqlite';
import type { AppSettings } from '../core/model/settings';
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
  readonly appSettings: AppSettings;
}

export async function openAppData(settings: SettingsStore): Promise<Result<AppData>> {
  try {
    const db = await openAppDatabase(openDatabaseAsync);

    const migrated = await migrate(db);
    if (!migrated.ok) return migrated;

    const ports = createPortRepository(db, settings);
    const seeded = await ports.ensureSeeded();
    if (!seeded.ok) return seeded;

    const runs = createRunRepository(db);
    const appSettings = readSettings(settings);

    // Retention is enforced at startup as well as after each write, so a long
    // gap between sessions cannot leave an oversized history behind.
    await runs.prune(appSettings.historyRetentionLimit);

    return ok({
      db,
      hosts: createHostRepository(db),
      networks: createNetworkRepository(db),
      runs,
      ports,
      settings,
      appSettings,
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
