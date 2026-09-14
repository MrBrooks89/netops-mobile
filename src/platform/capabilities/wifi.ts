/**
 * Wi-Fi info capability contract (M5, plan §6.2).
 *
 * Every field is nullable on BOTH platforms: Android gates SSID/BSSID
 * behind location permission + enabled Location Services, iOS needs the
 * wifi-info entitlement. The UI renders explicit "unavailable" rows rather
 * than blanks (plan §6.4) — get() never throws for missing data.
 */

import type { WifiInfo } from '../../core/model/wifi';

export interface WifiInfoCapability {
  /** Current connection snapshot; individual fields may be null. */
  getInfo(): Promise<WifiInfo>;
}
