/**
 * Degraded-state tests (plan §6.4, M8 acceptance).
 *
 * The M8 criterion is "an iOS dev build launches with … native-gated tools
 * showing degraded-state cards". A bare iOS build is, to the JS layer, simply a
 * build where every native-backed capability is `null` — so that is what these
 * tests simulate, over the **whole registry** rather than one screen.
 */

import React from 'react';
import { Text } from 'react-native';
import { renderWithApp } from '../../../test-utils/appTestKit';
import { CapabilityGate, isToolAvailable } from './CapabilityGate';
import { TOOL_REGISTRY } from '../../core/registry/registry';
import { getCapabilities } from '../../platform/registry';
import type { CapabilityMap } from '../../platform/capabilities';
import type { CapabilityId, ToolModule } from '../../core/registry/types';

jest.mock('../../platform/registry', () => ({
  ...jest.requireActual('../../platform/registry'),
  getCapabilities: jest.fn(),
}));

const mockedCapabilities = getCapabilities as jest.MockedFunction<typeof getCapabilities>;

/** An iOS-like build: DoH works (fetch-based); nothing native is present. */
const BARE_IOS: CapabilityMap = {
  dnsResolve: { resolve: jest.fn(), reverse: jest.fn() },
  dnsReverse: { resolve: jest.fn(), reverse: jest.fn() },
  tcpConnect: null,
  tcpScan: null,
  tcpPing: null,
  icmpPing: null,
  wifiInfo: null,
  permissions: null,
  httpProbe: null,
  tlsInspect: null,
  lanDiscovery: null,
};

const ANDROID: CapabilityMap = {
  ...BARE_IOS,
  tcpConnect: { connect: jest.fn() } as never,
  tcpScan: { scan: jest.fn() } as never,
  tcpPing: { ping: jest.fn() } as never,
  icmpPing: { ping: jest.fn(), probeOnce: jest.fn() } as never,
  wifiInfo: { getInfo: jest.fn() } as never,
  permissions: { get: jest.fn(), request: jest.fn() } as never,
  httpProbe: { request: jest.fn() } as never,
  tlsInspect: { inspect: jest.fn() } as never,
  lanDiscovery: { localSubnet: jest.fn(), discover: jest.fn() } as never,
};

/** Capabilities that only exist on a build with the native modules. */
const NATIVE_CAPABILITIES: readonly CapabilityId[] = [
  'tcpConnect',
  'tcpScan',
  'tcpPing',
  'icmpPing',
  'wifiInfo',
  'httpProbe',
  'tlsInspect',
  'lanDiscovery',
];

const needsNative = (tool: ToolModule) =>
  tool.requiredCapabilities.some((id) => NATIVE_CAPABILITIES.includes(id));

const nativeTools = TOOL_REGISTRY.filter(needsNative);
const pureTools = TOOL_REGISTRY.filter((tool) => tool.requiredCapabilities.length === 0);

beforeEach(() => {
  mockedCapabilities.mockReset();
});

describe('CapabilityGate', () => {
  it('renders the tool when every required capability is present', async () => {
    mockedCapabilities.mockReturnValue(ANDROID);
    const tool = TOOL_REGISTRY.find((entry) => entry.id === 'port-scanner')!;

    const { getByText, queryByTestId } = await renderWithApp(
      <CapabilityGate tool={tool}>
        <Text>the real screen</Text>
      </CapabilityGate>,
    );

    expect(getByText('the real screen')).toBeTruthy();
    expect(queryByTestId('tool-unavailable')).toBeNull();
  });

  it('renders the degraded card, naming what is missing, on a bare build', async () => {
    mockedCapabilities.mockReturnValue(BARE_IOS);
    const tool = TOOL_REGISTRY.find((entry) => entry.id === 'lan-discovery')!;

    const { getByTestId, getByText, queryByText } = await renderWithApp(
      <CapabilityGate tool={tool}>
        <Text>the real screen</Text>
      </CapabilityGate>,
    );

    expect(getByTestId('tool-unavailable')).toBeTruthy();
    expect(queryByText('the real screen')).toBeNull();
    expect(getByText('LAN Discovery is not available in this build')).toBeTruthy();
    // The socket module, not "your platform": the user can act on this.
    expect(getByText(/native TCP socket module/)).toBeTruthy();
    // …and the card says what still works, so it does not read as a broken app.
    expect(getByText(/IPv4\s+calculators/)).toBeTruthy();
  });

  it('gates every native-backed tool and no pure tool (registry-wide)', async () => {
    mockedCapabilities.mockReturnValue(BARE_IOS);

    expect(nativeTools.length).toBeGreaterThan(0);
    expect(pureTools.length).toBeGreaterThan(0);
    for (const tool of nativeTools) {
      expect([tool.id, isToolAvailable(tool, BARE_IOS)]).toEqual([tool.id, false]);
    }
    for (const tool of pureTools) {
      expect([tool.id, isToolAvailable(tool, BARE_IOS)]).toEqual([tool.id, true]);
    }

    // And the two fetch-based DNS tools are the native-free ones that still run.
    const available = TOOL_REGISTRY.filter((tool) => isToolAvailable(tool, BARE_IOS)).map(
      (tool) => tool.id,
    );
    expect(available).toEqual([
      'subnet-calculator',
      'cidr-calculator',
      'wildcard-mask-calculator',
      'vlsm-calculator',
      'ports-reference',
      'dns-lookup',
      'reverse-dns',
    ]);
  });

  it('lets every native tool through on a build that has the modules', async () => {
    mockedCapabilities.mockReturnValue(ANDROID);
    for (const tool of nativeTools) {
      expect([tool.id, isToolAvailable(tool, ANDROID)]).toEqual([tool.id, true]);
    }
  });
});
