/**
 * Tool registry contract — the module-system seam (D15).
 *
 * Each tool is a self-contained directory under src/features/<toolId>/ that
 * registers a ToolModule here. The dashboard renders purely from this
 * registry; adding a tool never touches existing tools.
 *
 * Freeze rule (plan D15): this shape is the contract — change it only via
 * an ADR, because churn here touches every tool.
 *
 * CIDR value objects and prefix↔mask math live in src/core/ip/cidr.ts
 * (shared by every calculator); they are re-exported below so registry
 * consumers keep a single import site.
 */

import type { ComponentType } from 'react';

export const TOOL_CATEGORIES = [
  'ipv4',
  'ipv6',
  'dns',
  'connectivity',
  'discovery',
  'reference',
  'utilities',
] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

export const TOOL_CATEGORY_LABELS: Record<ToolCategory, string> = {
  ipv4: 'IPv4',
  ipv6: 'IPv6',
  dns: 'DNS',
  connectivity: 'Connectivity',
  discovery: 'Discovery',
  reference: 'Reference',
  utilities: 'Utilities',
};

/** Stable string ids — one per tool, forever. */
export type ToolId =
  | 'subnet-calculator'
  | 'cidr-calculator'
  | 'wildcard-mask-calculator'
  | 'vlsm-calculator'
  | 'ports-reference'
  | 'dns-lookup'
  | 'reverse-dns'
  | 'tcp-connect'
  | 'tcp-ping'
  | 'port-scanner'
  | 'http-diagnostics'
  | 'tls-inspector'
  | 'lan-discovery'
  | 'wifi-info';

/** Capability ids mirror src/platform/capabilities (M3+). Pure tools need none. */
export type CapabilityId =
  | 'dnsResolve'
  | 'dnsReverse'
  | 'tcpConnect'
  | 'tcpScan'
  | 'tcpPing'
  | 'icmpPing'
  | 'wifiInfo'
  | 'lanDiscovery'
  | 'tlsInspect'
  | 'httpProbe';

export interface ToolScreenProps {
  /** The tool's own registry entry — screens never look up the registry. */
  tool: ToolModule;
}

export interface ToolModule {
  readonly id: ToolId;
  readonly title: string;
  readonly description: string;
  readonly category: ToolCategory;
  /** Icon name from @expo/vector-icons (Ionicons). */
  readonly icon: string;
  /** Capabilities that must be present for this tool to function. */
  readonly requiredCapabilities: readonly CapabilityId[];
  /** Screen component rendered by the generic tool route. */
  readonly Component: ComponentType<ToolScreenProps>;
}

// ---------------------------------------------------------------------------
// Convenience re-exports for registry consumers
// ---------------------------------------------------------------------------

export { parseIp, parseV4, parseV6 } from '../ip/ip';
export type { IpAddress, IpV4Address, IpV6Address, IpFamily } from '../ip/ip';
export { asV4Cidr, cidrToString, parseCidr, prefixToMaskV4, wildcardMaskV4 } from '../ip/cidr';
export type { IpCidr, Ipv4Cidr } from '../ip/cidr';
export { ok, err, type Result } from '../result/result';
export { toolError, type ToolError, type ToolErrorCode } from '../result/toolError';
