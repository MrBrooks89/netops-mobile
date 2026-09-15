/**
 * Deep-link helpers shared by tool screens.
 *
 * Tools feed each other: LAN discovery hands an address to the port scanner or
 * ping, and reverse DNS hands a name to the DNS lookup. Rather than each
 * screen re-reading route params, the convention lives here — one param name
 * per kind of value, one fallback rule.
 */

import { useLocalSearchParams } from 'expo-router';

/**
 * The `host` query param, when a screen was opened from another tool
 * (`/tool/port-scanner?host=192.168.1.10`). Falls back to `fallback` for a
 * plain tab/registry launch.
 *
 * Read once on mount by the caller's `useState`: this is an initial value,
 * not a live binding, so editing the field afterwards is never overwritten.
 */
export function usePrefilledHost(fallback: string): string {
  const params = useLocalSearchParams<{ host?: string }>();
  const host = params.host;
  return typeof host === 'string' && host.trim() !== '' ? host : fallback;
}
