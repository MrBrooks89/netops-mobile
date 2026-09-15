/**
 * LAN discovery screen tests (M7 acceptance): the device's own subnet is the
 * default target, results carry source badges, cancel is visible, the mDNS
 * degradation is stated, and every discovered row feeds another tool in one
 * tap.
 */

import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithApp } from '../../../test-utils/appTestKit';
import { LanDiscoveryScreen } from '../lan-discovery';
import { getCapabilities } from '../../platform/registry';
import type { CapabilityMap } from '../../platform/capabilities';
import type { LanDiscoveryReport } from '../../platform/capabilities/lan';
import { ok, unwrap } from '../../core/result/result';
import { parseV4 } from '../../core/ip/ip';
import { v4CidrOf } from '../../core/ip/cidr';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => ({}),
}));

jest.mock('../../platform/registry', () => ({
  getCapabilities: jest.fn(),
}));

const mockedCapabilities = getCapabilities as jest.MockedFunction<typeof getCapabilities>;

const tool = {
  id: 'lan-discovery' as const,
  title: 'LAN Discovery',
  description: 'Find live hosts on the local network',
  category: 'discovery' as const,
  icon: 'radar',
  requiredCapabilities: ['lanDiscovery' as const],
  Component: () => null,
};

const subnet = v4CidrOf(unwrap(parseV4('10.0.2.15')).int, 24);

const report: LanDiscoveryReport = {
  cidr: '10.0.2.0/24',
  hosts: [
    { ip: '10.0.2.2', sources: ['tcp'], hostname: null, openPorts: [80], latencyMs: 12 },
    {
      ip: '10.0.2.5',
      sources: ['tcp', 'mdns'],
      hostname: 'printer.lan',
      openPorts: [631],
      latencyMs: null,
    },
  ],
  probed: 254,
  total: 254,
  truncated: false,
  stopped: 'complete',
  mdns: 'ok',
  ports: [80, 443, 22, 8080],
  durationMs: 3200,
  summary: '2 hosts (tcp 2, mdns 1)',
};

function withLanCapabilities(overrides: Partial<NonNullable<CapabilityMap['lanDiscovery']>> = {}) {
  const discover = jest.fn().mockResolvedValue(ok(report));
  mockedCapabilities.mockReturnValue({
    dnsResolve: null,
    dnsReverse: null,
    tcpConnect: null,
    tcpScan: null,
    tcpPing: null,
    icmpPing: null,
    wifiInfo: null,
    permissions: null,
    httpProbe: null,
    tlsInspect: null,
    lanDiscovery: {
      localSubnet: jest.fn().mockResolvedValue(ok(subnet)),
      discover,
      ...overrides,
    },
  } as unknown as CapabilityMap);
  return discover;
}

beforeEach(() => {
  mockedCapabilities.mockReset();
  mockPush.mockReset();
});

describe('LanDiscoveryScreen', () => {
  it('detects the local subnet as the default target', async () => {
    withLanCapabilities();
    const { getByTestId } = await renderWithApp(<LanDiscoveryScreen tool={tool} />);

    await waitFor(() => expect(getByTestId('lan-discovery-cidr').props.value).toBe('10.0.2.0/24'));
    expect(getByTestId('lan-discovery-ports').props.value).toBe('80, 443, 22, 8080');
  });

  it('sweeps, badges each host with its sources, and labels the run', async () => {
    const discover = withLanCapabilities();
    const { getByTestId, getAllByTestId, getByText } = await renderWithApp(
      <LanDiscoveryScreen tool={tool} />,
    );
    await waitFor(() => expect(getByTestId('lan-discovery-cidr').props.value).toBe('10.0.2.0/24'));

    await fireEvent.press(getByTestId('lan-discovery-submit'));
    await waitFor(() => expect(getByTestId('lan-discovery-result')).toBeTruthy(), {
      timeout: 3000,
    });

    expect(discover).toHaveBeenCalledWith(
      subnet,
      expect.objectContaining({ ports: [22, 80, 443, 8080], mdns: true }),
    );
    expect(getByTestId('lan-host-10.0.2.2')).toBeTruthy();
    expect(getByText('printer.lan')).toBeTruthy();
    expect(getAllByTestId('lan-source-tcp')).toHaveLength(2);
    expect(getAllByTestId('lan-source-mdns')).toHaveLength(1);
    expect(getByText(/2 hosts \(tcp 2, mdns 1\) in 3.2s/)).toBeTruthy();
  });

  it('feeds a discovered host to the scanner and the ping tool in one tap', async () => {
    withLanCapabilities();
    const { getByTestId } = await renderWithApp(<LanDiscoveryScreen tool={tool} />);
    await waitFor(() => expect(getByTestId('lan-discovery-cidr').props.value).toBe('10.0.2.0/24'));
    await fireEvent.press(getByTestId('lan-discovery-submit'));
    await waitFor(() => expect(getByTestId('lan-host-10.0.2.2')).toBeTruthy(), { timeout: 3000 });

    await fireEvent.press(getByTestId('lan-scan-10.0.2.2'));
    expect(mockPush).toHaveBeenCalledWith('/tool/port-scanner?host=10.0.2.2');

    await fireEvent.press(getByTestId('lan-ping-10.0.2.2'));
    expect(mockPush).toHaveBeenCalledWith('/tool/tcp-ping?host=10.0.2.2');
  });

  it('saves a discovered host with the discovered tag and then disables the action', async () => {
    withLanCapabilities();
    const { getByTestId, data } = await renderWithApp(<LanDiscoveryScreen tool={tool} />);
    await waitFor(() => expect(getByTestId('lan-discovery-cidr').props.value).toBe('10.0.2.0/24'));
    await fireEvent.press(getByTestId('lan-discovery-submit'));
    await waitFor(() => expect(getByTestId('lan-host-10.0.2.5')).toBeTruthy(), { timeout: 3000 });

    await fireEvent.press(getByTestId('lan-save-10.0.2.5'));
    await waitFor(() =>
      expect(getByTestId('lan-save-10.0.2.5').props.accessibilityState.disabled).toBe(true),
    );

    const saved = unwrap(data.hosts.list());
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ host: '10.0.2.5', label: 'printer.lan' });
    expect(saved[0].tags).toContain('discovered');
  });

  it('says when mDNS was unavailable instead of silently returning fewer hosts', async () => {
    withLanCapabilities({
      discover: jest.fn().mockResolvedValue(
        ok({
          ...report,
          hosts: [report.hosts[0]],
          mdns: 'unavailable',
          mdnsReason: 'multicast lock not permitted',
          summary: '1 host (tcp 1)',
        }),
      ),
    });
    const { getByTestId, getByText } = await renderWithApp(<LanDiscoveryScreen tool={tool} />);
    await waitFor(() => expect(getByTestId('lan-discovery-cidr').props.value).toBe('10.0.2.0/24'));

    await fireEvent.press(getByTestId('lan-discovery-submit'));
    await waitFor(() => expect(getByTestId('lan-discovery-mdns-unavailable')).toBeTruthy(), {
      timeout: 3000,
    });
    expect(getByText(/multicast lock not permitted/)).toBeTruthy();
  });

  it('warns that a capped sweep did not cover the whole block', async () => {
    withLanCapabilities({
      discover: jest
        .fn()
        .mockResolvedValue(
          ok({ ...report, cidr: '10.0.0.0/8', total: 16_777_214, probed: 1024, truncated: true }),
        ),
    });
    const { getByTestId } = await renderWithApp(<LanDiscoveryScreen tool={tool} />);
    await waitFor(() => expect(getByTestId('lan-discovery-cidr').props.value).toBe('10.0.2.0/24'));

    await fireEvent.press(getByTestId('lan-discovery-submit'));
    await waitFor(() => expect(getByTestId('lan-discovery-truncated')).toBeTruthy(), {
      timeout: 3000,
    });
  });

  it('says a budget stop left the sweep incomplete, not that the network is empty', async () => {
    withLanCapabilities({
      discover: jest
        .fn()
        .mockResolvedValue(ok({ ...report, hosts: [], probed: 96, stopped: 'budget' })),
    });
    const { getByTestId, getByText } = await renderWithApp(<LanDiscoveryScreen tool={tool} />);
    await waitFor(() => expect(getByTestId('lan-discovery-cidr').props.value).toBe('10.0.2.0/24'));

    await fireEvent.press(getByTestId('lan-discovery-submit'));
    await waitFor(() => expect(getByTestId('lan-discovery-budget')).toBeTruthy(), {
      timeout: 3000,
    });
    expect(getByText(/probing 96 of 254 addresses/)).toBeTruthy();
  });

  it('shows the cancelled run as cancelled, keeping the hosts it did find', async () => {
    withLanCapabilities({
      discover: jest.fn().mockImplementation(
        (_cidr: unknown, options: { signal: AbortSignal; onProgress?: Function }) =>
          new Promise((resolve) => {
            options.onProgress?.({ done: 12, total: 254, found: 1, fraction: 0.05 });
            options.signal.addEventListener('abort', () =>
              resolve(
                ok({ ...report, hosts: [report.hosts[0]], probed: 12, stopped: 'cancelled' }),
              ),
            );
          }),
      ),
    });
    const { getByTestId, getByText } = await renderWithApp(<LanDiscoveryScreen tool={tool} />);
    await waitFor(() => expect(getByTestId('lan-discovery-cidr').props.value).toBe('10.0.2.0/24'));

    await fireEvent.press(getByTestId('lan-discovery-submit'));
    await waitFor(() => expect(getByTestId('lan-discovery-progress')).toBeTruthy(), {
      timeout: 3000,
    });

    await fireEvent.press(getByText('Cancel'));
    await waitFor(() => expect(getByText(/\(cancelled\)/)).toBeTruthy(), { timeout: 3000 });
    expect(getByTestId('lan-host-10.0.2.2')).toBeTruthy();
  });

  it('explains itself when the build has no LAN capability', async () => {
    mockedCapabilities.mockReturnValue({
      dnsResolve: null,
      dnsReverse: null,
      tcpConnect: null,
      tcpScan: null,
      tcpPing: null,
      icmpPing: null,
      wifiInfo: null,
      permissions: null,
      httpProbe: null,
      tlsInspect: null,
      lanDiscovery: null,
    } as unknown as CapabilityMap);
    const { getByTestId, getByText } = await renderWithApp(<LanDiscoveryScreen tool={tool} />);

    await waitFor(() => expect(getByTestId('lan-discovery-detect-message')).toBeTruthy());
    expect(getByText(/not available in this build/)).toBeTruthy();
  });
});
