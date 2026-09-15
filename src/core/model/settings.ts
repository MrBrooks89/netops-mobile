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
  /**
   * Tool ids pinned to the top of the dashboard, in pin order.
   *
   * Deliberately `string[]` rather than `ToolId[]`: this is a persistence
   * boundary, so the value must survive a read even when another build wrote an
   * id this one does not ship. The dashboard resolves ids against the registry
   * and drops the ones it cannot find.
   */
  readonly favoriteToolIds: readonly string[];
  /** True once the first-run onboarding card has been dismissed. */
  readonly onboardingDismissed: boolean;
}
