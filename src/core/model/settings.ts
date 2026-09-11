/**
 * User-facing settings vocabulary (pure types).
 *
 * Lives in core so both the data layer (persistence/parsing) and the UI
 * (theme resolution) share one definition and cannot drift.
 */

export type ThemePreference = 'system' | 'light' | 'dark';

export interface AppSettings {
  readonly theme: ThemePreference;
  readonly historyEnabled: boolean;
  readonly historyRetentionLimit: number;
}
