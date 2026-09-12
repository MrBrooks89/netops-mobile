/**
 * Typed application settings on top of the synchronous key-value store.
 *
 * Every read is validated and clamped: settings live in storage that an older
 * or newer build may have written, so a bad value must degrade to a sane
 * default rather than propagate into the UI.
 */

import { DOH_PROVIDERS, type DohProviderId } from '../../core/dns/types';
import type { AppSettings, ThemePreference } from '../../core/model/settings';
import type { SettingsStore } from './store';

export type { AppSettings, ThemePreference };

export const SETTINGS_KEYS = {
  theme: 'settings.theme',
  historyEnabled: 'settings.historyEnabled',
  historyRetentionLimit: 'settings.historyRetentionLimit',
  dohProvider: 'settings.dohProvider',
  customDohUrl: 'settings.customDohUrl',
} as const;

export const RETENTION_MIN = 10;
export const RETENTION_MAX = 5000;

/** How many runs history keeps by default; the history path reuses this cap. */
export const DEFAULT_HISTORY_RETENTION = 500;

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  historyEnabled: true,
  historyRetentionLimit: DEFAULT_HISTORY_RETENTION,
  dohProvider: 'cloudflare',
  customDohUrl: '',
};

export function parseTheme(raw: string | null): ThemePreference {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : DEFAULT_SETTINGS.theme;
}

export function parseBooleanSetting(raw: string | null, fallback: boolean): boolean {
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return fallback;
}

/** Integers only, clamped to [RETENTION_MIN, RETENTION_MAX]. */
export function parseRetention(raw: string | null): number {
  if (raw === null) return DEFAULT_SETTINGS.historyRetentionLimit;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return DEFAULT_SETTINGS.historyRetentionLimit;
  }
  return Math.min(RETENTION_MAX, Math.max(RETENTION_MIN, value));
}

/** Only the providers we ship, or a custom endpoint, are valid values. */
export function parseDohProvider(raw: string | null): DohProviderId {
  if (raw === 'custom') return 'custom';
  if (raw !== null && raw in DOH_PROVIDERS) return raw as DohProviderId;
  return DEFAULT_SETTINGS.dohProvider;
}

export function readSettings(store: SettingsStore): AppSettings {
  return {
    theme: parseTheme(store.get(SETTINGS_KEYS.theme)),
    historyEnabled: parseBooleanSetting(
      store.get(SETTINGS_KEYS.historyEnabled),
      DEFAULT_SETTINGS.historyEnabled,
    ),
    historyRetentionLimit: parseRetention(store.get(SETTINGS_KEYS.historyRetentionLimit)),
    dohProvider: parseDohProvider(store.get(SETTINGS_KEYS.dohProvider)),
    customDohUrl: store.get(SETTINGS_KEYS.customDohUrl) ?? DEFAULT_SETTINGS.customDohUrl,
  };
}

/** Persist a partial update; returns the full, normalised settings. */
export function writeSettings(store: SettingsStore, patch: Partial<AppSettings>): AppSettings {
  const current = readSettings(store);
  const next: AppSettings = {
    theme: patch.theme === undefined ? current.theme : parseTheme(patch.theme),
    historyEnabled:
      patch.historyEnabled === undefined
        ? current.historyEnabled
        : parseBooleanSetting(String(patch.historyEnabled), current.historyEnabled),
    historyRetentionLimit:
      patch.historyRetentionLimit === undefined
        ? current.historyRetentionLimit
        : parseRetention(String(patch.historyRetentionLimit)),
    dohProvider:
      patch.dohProvider === undefined ? current.dohProvider : parseDohProvider(patch.dohProvider),
    customDohUrl:
      patch.customDohUrl === undefined ? current.customDohUrl : patch.customDohUrl.trim(),
  };

  store.set(SETTINGS_KEYS.theme, next.theme);
  store.set(SETTINGS_KEYS.historyEnabled, String(next.historyEnabled));
  store.set(SETTINGS_KEYS.historyRetentionLimit, String(next.historyRetentionLimit));
  store.set(SETTINGS_KEYS.dohProvider, next.dohProvider);
  store.set(SETTINGS_KEYS.customDohUrl, next.customDohUrl);
  return next;
}
