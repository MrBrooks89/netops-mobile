/**
 * Test-only app harness.
 *
 * Screens now depend on the app context (repositories + settings), so tests
 * supply real repositories over an in-memory SQLite database. That keeps the
 * production path (context → repository → SQL) under test instead of letting
 * screens silently no-op when no provider is present.
 */

import React from 'react';
import { render, renderHook } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { AppContextProvider, type AppContextValue } from '../src/providers/AppProviders';
import type { AppSettings } from '../src/core/model/settings';
import { migrate } from '../src/data/db/migrate';
import { createHostRepository } from '../src/data/repositories/hosts';
import { createNetworkRepository } from '../src/data/repositories/networks';
import { createPortRepository } from '../src/data/repositories/ports';
import { createRunRepository } from '../src/data/repositories/runs';
import type { AppData } from '../src/data/bootstrap';
import { DEFAULT_SETTINGS } from '../src/data/settings/appSettings';
import { createQueryClient } from '../src/providers/QueryProvider';
import { ThemeProvider } from '../src/ui/components';
import { createMemorySettingsStore } from './memorySettingsStore';
import { createTestDatabase, type TestDatabase } from './sqljsDriver';

export async function createTestAppData(
  overrides: Partial<AppSettings> = {},
  options: { seedPorts?: boolean } = {},
): Promise<{
  db: TestDatabase;
  data: AppData;
  appSettings: AppSettings;
}> {
  const db = await createTestDatabase();
  const migrated = await migrate(db);
  if (!migrated.ok) throw new Error('migration failed in test setup');

  const settings = createMemorySettingsStore();
  const ports = createPortRepository(db, settings);
  // Seeding the full dataset is only needed by tests that read it; leaving it
  // out keeps the calculator screen tests fast.
  if (options.seedPorts) await ports.ensureSeeded();

  const appSettings: AppSettings = { ...DEFAULT_SETTINGS, ...overrides };
  const data: AppData = {
    db,
    hosts: createHostRepository(db),
    networks: createNetworkRepository(db),
    runs: createRunRepository(db),
    ports,
    settings,
  };
  return { db, data, appSettings };
}

/** Render a screen inside a working app context backed by in-memory SQLite. */
export async function renderWithApp(
  ui: React.ReactElement,
  options: { appSettings?: Partial<AppSettings>; seedPorts?: boolean } = {},
) {
  const { db, data, appSettings } = await createTestAppData(options.appSettings, {
    seedPorts: options.seedPorts,
  });
  const value: AppContextValue = {
    settings: data.settings,
    appSettings,
    updateSettings: () => {},
    refreshSettings: () => {},
    data,
  };

  const result = await render(
    <AppContextProvider value={value}>
      <ThemeProvider preference="dark">{ui}</ThemeProvider>
    </AppContextProvider>,
  );

  return { ...result, data, db, appSettings };
}

/** Render a hook inside the app context plus React Query. */
export async function renderHookWithApp<Result, Props>(
  hook: (props: Props) => Result,
  options: { appSettings?: Partial<AppSettings> } = {},
) {
  const { db, data, appSettings } = await createTestAppData(options.appSettings);
  const value: AppContextValue = {
    settings: data.settings,
    appSettings,
    updateSettings: () => {},
    refreshSettings: () => {},
    data,
  };

  // gcTime 0 / retryDelay 0: no lingering cache timers (Jest would not exit) and
  // no backoff to wait through.
  const client = createQueryClient({ gcTime: 0, retryDelay: 0 });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AppContextProvider value={value}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </AppContextProvider>
  );

  const rendered = await renderHook(hook, { wrapper });
  return { ...rendered, data, db, appSettings };
}
