/**
 * User-facing settings vocabulary (pure types).
 *
 * Lives in core so both the data layer (persistence/parsing) and the UI
 * (theme resolution) share one definition and cannot drift.
 */

import type { DohProviderId } from '../dns/types';

export type ThemePreference = 'system' | 'light' | 'dark';

export interface AppSettings {
  readonly theme: ThemePreference;
  readonly historyEnabled: boolean;
  readonly historyRetentionLimit: number;
  /** Which DoH resolver queries go to — a privacy-visible choice. */
  readonly dohProvider: DohProviderId;
  /** Endpoint used when `dohProvider` is 'custom'. */
  readonly customDohUrl: string;
}
