/**
 * Central tool registry — the single place tools are declared (D15 contract).
 *
 * M0: placeholder screens for the M1 tool set, so the dashboard, routing,
 * and capability gating are all exercised from day one. Each feature module
 * in M1 will import its real Component here and delete its placeholder.
 */

import type { ToolModule } from './types';
import { PlaceholderTool } from '../../features/_placeholder/PlaceholderTool';
import { DnsLookupScreen } from '../../features/dns-lookup';
import { ReverseDnsScreen } from '../../features/reverse-dns';
import { SubnetCalculatorScreen } from '../../features/subnet-calculator';
import { CidrCalculatorScreen } from '../../features/cidr-calculator';
import { WildcardMaskScreen } from '../../features/wildcard-mask-calculator';
import { VlsmCalculatorScreen } from '../../features/vlsm-calculator';
import { PortsReferenceScreen } from '../../features/ports-reference';
import { TcpConnectScreen } from '../../features/tcp-connect';
import { TcpPingScreen } from '../../features/tcp-ping';
import { PortScannerScreen } from '../../features/port-scanner';

export const TOOL_REGISTRY: readonly ToolModule[] = [
  {
    id: 'subnet-calculator',
    title: 'Subnet Calculator',
    description: 'IPv4 address + CIDR → mask, wildcard, ranges, host count',
    category: 'ipv4',
    icon: 'calculator',
    requiredCapabilities: [],
    Component: SubnetCalculatorScreen,
  },
  {
    id: 'cidr-calculator',
    title: 'CIDR Calculator',
    description: 'Mask ↔ prefix conversion and subnet splitting',
    category: 'ipv4',
    icon: 'git-network',
    requiredCapabilities: [],
    Component: CidrCalculatorScreen,
  },
  {
    id: 'wildcard-mask-calculator',
    title: 'Wildcard Mask',
    description: 'Cisco-style wildcard masks from netmasks and CIDR',
    category: 'ipv4',
    icon: 'swap-horizontal',
    requiredCapabilities: [],
    Component: WildcardMaskScreen,
  },
  {
    id: 'vlsm-calculator',
    title: 'VLSM Calculator',
    description: 'Allocate subnets from a base network to fit host needs',
    category: 'ipv4',
    icon: 'layers',
    requiredCapabilities: [],
    Component: VlsmCalculatorScreen,
  },
  {
    id: 'ports-reference',
    title: 'Ports Reference',
    description: 'Common TCP/UDP ports and their services',
    category: 'reference',
    icon: 'list',
    requiredCapabilities: [],
    Component: PortsReferenceScreen,
  },
  // --- future milestones (registry-driven degraded states are an M3+ concern) ---
  {
    id: 'dns-lookup',
    title: 'DNS Lookup',
    description: 'Resolve A, AAAA, CNAME, MX, TXT records via DoH',
    category: 'dns',
    icon: 'search',
    requiredCapabilities: ['dnsResolve'],
    Component: DnsLookupScreen,
  },
  {
    id: 'reverse-dns',
    title: 'Reverse DNS',
    description: 'PTR record lookup for an IP address',
    category: 'dns',
    icon: 'arrow-undo',
    requiredCapabilities: ['dnsReverse'],
    Component: ReverseDnsScreen,
  },
  {
    id: 'tcp-connect',
    title: 'TCP Connect Test',
    description: 'Test connectivity to host:port with timing',
    category: 'connectivity',
    icon: 'plug',
    requiredCapabilities: ['tcpConnect'],
    Component: TcpConnectScreen,
  },
  {
    id: 'tcp-ping',
    title: 'TCP Ping',
    description: 'Reachability stats via repeated TCP connections',
    category: 'connectivity',
    icon: 'pulse',
    requiredCapabilities: ['tcpPing'],
    Component: TcpPingScreen,
  },
  {
    id: 'icmp-ping',
    title: 'Ping (ICMP)',
    description: 'ICMP echo — best effort on mobile platforms',
    category: 'connectivity',
    icon: 'pulse',
    requiredCapabilities: ['icmpPing'],
    Component: PlaceholderTool,
  },
  {
    id: 'port-scanner',
    title: 'Port Scanner',
    description: 'Scan common port ranges on a host',
    category: 'connectivity',
    icon: 'grid',
    requiredCapabilities: ['tcpScan'],
    Component: PortScannerScreen,
  },
  {
    id: 'http-diagnostics',
    title: 'HTTP Diagnostics',
    description: 'Status, headers, redirects, phase timings',
    category: 'connectivity',
    icon: 'globe',
    requiredCapabilities: ['httpProbe'],
    Component: PlaceholderTool,
  },
  {
    id: 'tls-inspector',
    title: 'TLS Inspector',
    description: 'Certificate chain, validity, SANs, expiry',
    category: 'connectivity',
    icon: 'shield',
    requiredCapabilities: ['tlsInspect'],
    Component: PlaceholderTool,
  },
  {
    id: 'lan-discovery',
    title: 'LAN Discovery',
    description: 'Find live hosts on the local network',
    category: 'discovery',
    icon: 'radar',
    requiredCapabilities: ['lanDiscovery'],
    Component: PlaceholderTool,
  },
  {
    id: 'wifi-info',
    title: 'Wi-Fi Info',
    description: 'Current network: SSID, channel, gateway, DNS',
    category: 'discovery',
    icon: 'wifi',
    requiredCapabilities: ['wifiInfo'],
    Component: PlaceholderTool,
  },
];

export const getTool = (id: string): ToolModule | undefined =>
  TOOL_REGISTRY.find((t) => t.id === id);

export const toolsByCategory = (): Map<string, ToolModule[]> => {
  const m = new Map<string, ToolModule[]>();
  for (const tool of TOOL_REGISTRY) {
    const list = m.get(tool.category) ?? [];
    list.push(tool);
    m.set(tool.category, list);
  }
  return m;
};
