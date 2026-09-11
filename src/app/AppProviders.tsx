/**
 * App-level composition root.
 *
 * Responsibilities, in order:
 *   1. create the synchronous settings store (theme is correct on frame one)
 *   2. open the database and wire repositories (async, once)
 *   3. expose settings + data to the tree, and drive the theme from the stored
 *      preference
 *
 * Children only render once storage is ready, so screens never handle a
 * "database not open yet" state; a failure shows a recovery screen instead.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import type { AppSettings } from '../core/model/settings';
import type { ToolError } from '../core/result/toolError';
import { openAppData, type AppData } from '../data/bootstrap';
import { createKvSettingsStore } from '../data/settings/kvStore';
import { readSettings, writeSettings } from '../data/settings/appSettings';
import type { SettingsStore } from '../data/settings/store';
import { Card, Screen, StyledText, ThemeProvider, useTheme } from '../ui/components';

export interface AppContextValue {
  readonly settings: SettingsStore;
  readonly appSettings: AppSettings;
  readonly updateSettings: (patch: Partial<AppSettings>) => void;
  /** Re-read appSettings from storage (used after a write from another path). */
  readonly refreshSettings: () => void;
  readonly data: AppData;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp() must be used inside <AppProviders>');
  return value;
}

/** Repositories + settings, guaranteed ready. */
export function useAppData(): AppData {
  return useApp().data;
}

export function useAppSettings(): {
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
} {
  const { appSettings, updateSettings } = useApp();
  return { settings: appSettings, updateSettings };
}

/**
 * Raw provider, exported so tests can supply in-memory repositories instead of
 * opening the real database. Production code always goes through
 * <AppProviders>, which is the only thing that opens storage.
 */
export function AppContextProvider({
  value,
  children,
}: {
  value: AppContextValue;
  children: React.ReactNode;
}) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

type BootState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: ToolError }
  | { readonly status: 'ready'; readonly data: AppData };

export function AppProviders({ children }: { children: React.ReactNode }) {
  const settings = useMemo(() => createKvSettingsStore(), []);
  const [appSettings, setAppSettings] = useState<AppSettings>(() => readSettings(settings));
  const [boot, setBoot] = useState<BootState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    openAppData(settings).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setAppSettings(result.value.appSettings);
        setBoot({ status: 'ready', data: result.value });
      } else {
        setBoot({ status: 'error', error: result.error });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [settings]);

  const updateSettings = useCallback(
    (patch: Partial<AppSettings>) => setAppSettings(writeSettings(settings, patch)),
    [settings],
  );

  const refreshSettings = useCallback(() => setAppSettings(readSettings(settings)), [settings]);

  const value = useMemo<AppContextValue | null>(
    () =>
      boot.status === 'ready'
        ? {
            settings,
            appSettings,
            updateSettings,
            refreshSettings,
            data: boot.data,
          }
        : null,
    [boot, settings, appSettings, updateSettings, refreshSettings],
  );

  return (
    <ThemeProvider preference={appSettings.theme}>
      {boot.status === 'loading' && <LoadingView />}
      {boot.status === 'error' && <BootErrorView error={boot.error} />}
      {value && <AppContext.Provider value={value}>{children}</AppContext.Provider>}
    </ThemeProvider>
  );
}

function LoadingView() {
  const { theme } = useTheme();
  return (
    <Screen style={{ justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator color={theme.colors.primary} />
      <StyledText dim style={{ marginTop: 12 }}>
        Preparing local storage…
      </StyledText>
    </Screen>
  );
}

function BootErrorView({ error }: { error: ToolError }) {
  return (
    <Screen style={{ justifyContent: 'center' }}>
      <Card>
        <StyledText style={{ fontWeight: '700', marginBottom: 6 }}>
          Local storage could not be opened
        </StyledText>
        <StyledText dim>{error.message}</StyledText>
        {error.technical ? (
          <View style={{ marginTop: 10 }}>
            <StyledText dim style={{ fontSize: 12 }}>
              {error.technical}
            </StyledText>
          </View>
        ) : null}
      </Card>
    </Screen>
  );
}
