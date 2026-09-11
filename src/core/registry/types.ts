/**
 * Tool registry contract — the module-system seam (D15).
 *
 * Each tool is a self-contained directory under src/features/<toolId>/ that
 * registers a ToolModule here. The dashboard renders purely from this
 * registry; adding a tool never touches existing tools.
 *
 * Freeze rule (plan D15): this shape is the contract — change it only via
 * an ADR, because churn here touches every tool.
 */

import type { ComponentType } from 'react';
import { parseIp, parseV4, type IpAddress } from '../ip/ip';
import { err, ok, type Result } from '../result/result';
import { toolError } from '../result/toolError';

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
  | 'icmp-ping'
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
// Shared value objects used across tools (pure data, no behaviour)
// ---------------------------------------------------------------------------

/** A network in CIDR notation, family-aware. */
export interface IpCidr {
  readonly address: IpAddress;
  readonly prefixLength: number;
}

export const cidrToString = (c: IpCidr): string => `${c.address.value}/${c.prefixLength}`;

/** Parse "a.b.c.d/n" or "a.b.c.d m.m.m.m" — mask form parsed to a prefix. */
export function parseCidr(input: string): Result<IpCidr> {
  const s = input.trim();
  const sep = s.includes('/') ? '/' : ' ';
  const i = s.indexOf(sep);
  if (i === -1) {
    return err(
      toolError('INVALID_INPUT', `Invalid CIDR "${input}": expected "address/prefix".`, {
        technical: `parseCidr("${input}"): no separator`,
      }),
    );
  }
  const addr = parseIp(s.slice(0, i));
  if (!addr.ok) return addr;
  const rest = s.slice(i + 1).trim();

  let prefix: number;
  if (rest.includes('.')) {
    // dotted netmask form — count bits
    const mask = parseV4(rest);
    if (!mask.ok || isV4HostMask(mask.value.int)) {
      return err(
        toolError('INVALID_INPUT', `Invalid netmask "${rest}".`, {
          technical: `parseCidr: netmask "${rest}" is not a contiguous mask`,
        }),
      );
    }
    prefix = maskToPrefix(mask.value.int);
  } else {
    if (!/^\d{1,3}$/.test(rest)) {
      return err(
        toolError('INVALID_INPUT', `Invalid prefix length "${rest}".`, {
          technical: `parseCidr: bad prefix "${rest}"`,
        }),
      );
    }
    prefix = Number(rest);
  }

  const maxPrefix = addr.value.family === 4 ? 32 : 128;
  if (prefix > maxPrefix) {
    return err(
      toolError('INVALID_INPUT', `Prefix /${prefix} is invalid for IPv${addr.value.family}.`, {
        technical: `parseCidr: prefix ${prefix} > ${maxPrefix}`,
      }),
    );
  }
  return ok({ address: addr.value, prefixLength: prefix });
}

function isV4HostMask(int: bigint): boolean {
  // A valid netmask is 1s followed by 0s. Detect non-contiguous bits.
  let seenZero = false;
  for (let bit = 31; bit >= 0; bit--) {
    const b = (int >> BigInt(bit)) & 1n;
    if (b === 0n) seenZero = true;
    else if (seenZero) return true; // 1 after 0 → non-contiguous
  }
  return false;
}

function maskToPrefix(int: bigint): number {
  let p = 0;
  for (let bit = 31; bit >= 0; bit--) {
    if (((int >> BigInt(bit)) & 1n) === 1n) p++;
  }
  return p;
}

/** Re-export IP parsing for registry consumers' convenience. */
export { parseIp, parseV4, parseV6 } from '../ip/ip';
export type { IpAddress, IpV4Address, IpV6Address, IpFamily } from '../ip/ip';
export { ok, err, type Result } from '../result/result';
export { toolError, type ToolError, type ToolErrorCode } from '../result/toolError';
