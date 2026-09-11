/**
 * Capability registry — the single place that answers "what can this build do?"
 *
 * Everything in M3 is fetch-based, so both DNS capabilities are present on every
 * platform. M4+ registers native-backed capabilities here, and returning null is
 * how a feature learns to render its degraded state instead of crashing.
 */

import type { CapabilityMap } from './capabilities';
import { dohCapability } from './fallback/doh';

export function getCapabilities(): CapabilityMap {
  return {
    dnsResolve: dohCapability,
    dnsReverse: dohCapability,
  };
}

/** True when every listed capability is available in this build. */
export function hasCapabilities(ids: readonly (keyof CapabilityMap)[]): boolean {
  const available = getCapabilities();
  return ids.every((id) => available[id] !== null);
}
