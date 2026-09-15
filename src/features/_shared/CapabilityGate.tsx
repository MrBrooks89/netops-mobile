/**
 * Capability gate (plan §6.4, M8).
 *
 * A tool declares the capabilities it needs (`ToolModule.requiredCapabilities`)
 * and this decides what the user sees when the build cannot provide one — a
 * bare iOS build is the motivating case. Detection lives in the platform
 * registry; the copy lives here, next to the screens that need it.
 *
 * The gate is a component rather than a registry flag so that a build can also
 * gate *part* of a screen later without touching the frozen `ToolModule`
 * contract (D15).
 */

import React from 'react';
import { Screen, UnavailableState } from '../../ui/components';
import type { CapabilityId, ToolModule } from '../../core/registry/types';
import type { CapabilityMap } from '../../platform/capabilities';
import { getCapabilities, missingCapabilities } from '../../platform/registry';

/**
 * Why a capability is missing, in the user's terms. One line per capability, so
 * a tool that needs two modules says so instead of blaming "this platform".
 */
const CAPABILITY_REASONS: Record<CapabilityId, string> = {
  dnsResolve: 'DNS over HTTPS needs a working network connection',
  dnsReverse: 'Reverse DNS needs a working network connection',
  tcpConnect: 'needs the native TCP socket module (M4)',
  tcpScan: 'needs the native TCP socket module (M4)',
  tcpPing: 'needs the native TCP socket module (M4)',
  icmpPing: 'needs the native `netops` module (M5)',
  wifiInfo: 'needs the native `netops` module (M5) and a location permission',
  httpProbe: 'needs the native TCP socket module (M6)',
  tlsInspect: 'needs the native `netops` module (M6)',
  lanDiscovery: 'needs the native TCP socket module (M7); mDNS also needs `netops`',
};

export function CapabilityGate({
  tool,
  children,
}: {
  tool: ToolModule;
  children: React.ReactNode;
}) {
  const missing = missingCapabilities(getCapabilities(), tool.requiredCapabilities);
  if (missing.length === 0) return <>{children}</>;

  // The screen container lives here rather than in the route: tool screens
  // bring their own (ScrollScreen), so the route must not wrap them twice.
  return (
    <Screen>
      <UnavailableState
        kind="module"
        title={`${tool.title} is not available in this build`}
        message="This tool needs a native module that this build does not include. Nothing is broken — the rest of the app works normally."
        reasons={missing.map((id) => CAPABILITY_REASONS[id])}
        testID="tool-unavailable"
      />
    </Screen>
  );
}

/**
 * True when the tool can run in this build. Exported for the dashboard, which
 * marks unavailable tools without mounting them; it takes the capability map so
 * a list of 14 rows resolves it once, not 14 times.
 */
export function isToolAvailable(tool: ToolModule, available: CapabilityMap): boolean {
  return missingCapabilities(available, tool.requiredCapabilities).length === 0;
}
