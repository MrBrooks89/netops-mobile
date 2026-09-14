/**
 * Typed permission flows (plan §6.3.4) — permissions are capability UX, not
 * OS branches.
 *
 * Features call `requestFor('wifiInfo')` and get back a value describing the
 * outcome; each platform adapter supplies the native call and rationale copy
 * behind the same interface. The screen never learns which OS it is on.
 */

import type { Result } from '../core/result/result';

/** The permission scopes the app knows about. One per capability that gates. */
export type PermissionScope = 'wifiInfo';

export interface PermissionState {
  /** True when the capability may be used right now. */
  readonly granted: boolean;
  /**
   * False when the OS will not show the dialog again (permanently denied);
   * the UI then deep-links to settings instead of re-asking.
   */
  readonly canAskAgain: boolean;
  /**
   * 'granted' | 'denied' | 'undetermined' (never asked) | 'unavailable'
   * (no permission system — e.g. a build without the native module).
   */
  readonly status: 'granted' | 'denied' | 'undetermined' | 'unavailable';
}

export interface PermissionsCapability {
  /** Current state without prompting. */
  get(scope: PermissionScope): Promise<Result<PermissionState>>;
  /** Ask (OS dialog, with our rationale shown before it). */
  request(scope: PermissionScope): Promise<Result<PermissionState>>;
}
