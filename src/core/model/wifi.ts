/**
 * Wi-Fi info model — pure data, no React Native imports (plan §3.1).
 *
 * Every field is nullable by design (plan §6.4): Android gates SSID/BSSID
 * behind location permission + Location Services, iOS behind an
 * entitlement. The screen renders each null as an explicit "unavailable"
 * row with a reason, never a blank.
 */

/**
 * Raw Wi-Fi/network read from a native source (the netops module). The
 * adapter maps this to WifiInfo; core never imports the module itself.
 */
export interface RawWifiInfo {
  readonly ssid: string | null;
  readonly bssid: string | null;
  readonly frequencyMHz: number | null;
  readonly rssi: number | null;
  readonly linkSpeedMbps: number | null;
  /** Default gateway of the active link, when the platform exposes it. */
  readonly gateway: string | null;
  /** DNS servers of the active link, in platform order. */
  readonly dnsServers: readonly string[];
  readonly transportWifi: boolean;
  readonly transportCellular: boolean;
  readonly transportVpn: boolean;
  readonly transportEthernet: boolean;
}

/**
 * Frequency (MHz) → channel number for the 2.4/5/6 GHz bands (IEEE 802.11
 * channel plans). 2.4 GHz: ch = (freq − 2407) / 5; 5 GHz: (freq − 5000) / 5
 * up to ch 185 (5925 MHz); 6 GHz: (freq − 5950) / 5 from ch 1 (5955 MHz).
 * Returns null for unknown bands.
 */
export function channelForFrequencyMHz(freqMHz: number): number | null {
  if (freqMHz >= 2401 && freqMHz <= 2495) return Math.round((freqMHz - 2407) / 5);
  if (freqMHz >= 5000 && freqMHz <= 5925) return Math.round((freqMHz - 5000) / 5);
  if (freqMHz >= 5955 && freqMHz <= 7115) return Math.round((freqMHz - 5950) / 5);
  return null;
}

/** Frequency → friendly band label. */
export function bandForFrequencyMHz(freqMHz: number): '2.4 GHz' | '5 GHz' | '6 GHz' | null {
  if (freqMHz >= 2401 && freqMHz <= 2495) return '2.4 GHz';
  if (freqMHz >= 5000 && freqMHz <= 5925) return '5 GHz';
  if (freqMHz >= 5955 && freqMHz <= 7115) return '6 GHz';
  return null;
}

/** The Wi-Fi/network snapshot the screen renders. */
export interface WifiInfo {
  readonly ssid: string | null;
  readonly bssid: string | null;
  readonly frequencyMHz: number | null;
  readonly channel: number | null;
  readonly band: '2.4 GHz' | '5 GHz' | '6 GHz' | null;
  /** Signal strength in dBm, negative; null when gated. */
  readonly rssi: number | null;
  readonly linkSpeedMbps: number | null;
  /** Default gateway of the active link; null when the platform has none. */
  readonly gateway: string | null;
  /** Resolvers from the active link; empty when the platform has none. */
  readonly dnsServers: readonly string[];
  readonly transportWifi: boolean;
  readonly transportCellular: boolean;
  readonly transportVpn: boolean;
  readonly transportEthernet: boolean;
  readonly readAt: string;
}

/**
 * Map a raw read to the app model: adds channel/band derived from
 * frequency and stamps the read time. Accepts null (module absent or no
 * data) — every field stays null and the UI explains why.
 */
export function toWifiInfo(raw: RawWifiInfo | null): WifiInfo {
  const frequencyMHz = raw?.frequencyMHz ?? null;
  return {
    ssid: raw?.ssid ?? null,
    bssid: raw?.bssid ?? null,
    frequencyMHz,
    channel: frequencyMHz !== null ? channelForFrequencyMHz(frequencyMHz) : null,
    band: frequencyMHz !== null ? bandForFrequencyMHz(frequencyMHz) : null,
    rssi: raw?.rssi ?? null,
    linkSpeedMbps: raw?.linkSpeedMbps ?? null,
    gateway: raw?.gateway ?? null,
    dnsServers: raw?.dnsServers ?? [],
    transportWifi: raw?.transportWifi ?? false,
    transportCellular: raw?.transportCellular ?? false,
    transportVpn: raw?.transportVpn ?? false,
    transportEthernet: raw?.transportEthernet ?? false,
    readAt: new Date().toISOString(),
  };
}
