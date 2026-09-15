/**
 * M5 screen tests over mocked capabilities: the unified Ping (method
 * toggle, TCP + ICMP paths, honest ICMP labeling) and Wi-Fi info
 * (permission rationale, unavailable rows, "why location?" explainer).
 */

import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithApp } from '../../../test-utils/appTestKit';
import { PingScreen } from '../tcp-ping';
import { WifiInfoScreen } from '../wifi-info';
import { getCapabilities } from '../../platform/registry';
import type { CapabilityMap } from '../../platform/capabilities';
import { ok } from '../../core/result/result';
import type { TcpPingReport } from '../../core/model/tcp';
import type { IcmpPingReport } from '../../core/model/ping';
import type { PermissionState } from '../../platform/permissions';
import { toWifiInfo, type RawWifiInfo, type WifiInfo } from '../../core/model/wifi';

jest.mock('../../platform/registry', () => ({
  getCapabilities: jest.fn(),
}));

const mockedCapabilities = getCapabilities as jest.MockedFunction<typeof getCapabilities>;

const tool = (id: 'tcp-ping' | 'wifi-info', title: string) => ({
  id,
  title,
  description: 'test',
  category: 'connectivity' as const,
  icon: 'pulse' as const,
  requiredCapabilities: [],
  Component: () => null,
});

const tcpReport: TcpPingReport = {
  method: 'tcp',
  host: 'example.com',
  port: 443,
  probes: [
    { seq: 1, ok: true, latencyMs: 30 },
    { seq: 2, ok: false, latencyMs: null, errorCode: 'TIMEOUT' },
  ],
  sent: 2,
  received: 1,
  lossPercent: 50,
  minMs: 30,
  avgMs: 30,
  maxMs: 30,
};

const icmpReport: IcmpPingReport = {
  host: 'example.com',
  method: 'icmp',
  probes: [
    { seq: 1, ok: true, latencyMs: null },
    { seq: 2, ok: false, latencyMs: null, errorCode: 'UNREACHABLE' },
  ],
  sent: 2,
  received: 1,
  lossPercent: 50,
  minMs: null,
  avgMs: null,
  maxMs: null,
};

const granted: PermissionState = { granted: true, canAskAgain: false, status: 'granted' };

function withPingCapabilities(icmp = true) {
  mockedCapabilities.mockReturnValue({
    dnsResolve: null,
    dnsReverse: null,
    tcpConnect: null,
    tcpScan: null,
    tcpPing: {
      ping: jest.fn().mockResolvedValue(ok(tcpReport)),
    },
    icmpPing: icmp ? { ping: jest.fn().mockResolvedValue(ok(icmpReport)) } : null,
    wifiInfo: null,
    permissions: null,
  } as unknown as CapabilityMap);
}

beforeEach(() => {
  mockedCapabilities.mockReset();
});

describe('PingScreen (unified)', () => {
  it('defaults to TCP and renders TCP stats on run', async () => {
    withPingCapabilities();
    const { getByTestId, getByText } = await renderWithApp(
      <PingScreen tool={tool('tcp-ping', 'Ping')} />,
    );

    await fireEvent.press(getByTestId('ping-submit'));
    await waitFor(() => expect(getByTestId('ping-result')).toBeTruthy(), { timeout: 3000 });

    expect(getByText(/example.com:443 \(TCP\)/)).toBeTruthy();
    expect(getByText(/1\/2 received/)).toBeTruthy();
    expect(getByTestId('ping-probe-1').props.children.join(' ')).toContain('ok 30 ms');
  });

  it('switches to ICMP best-effort, labels the run, and shows honest no-timing copy', async () => {
    withPingCapabilities();
    const { getByTestId, getByText } = await renderWithApp(
      <PingScreen tool={tool('tcp-ping', 'Ping')} />,
    );

    fireEvent.press(getByTestId('ping-method-icmp'));
    await waitFor(() => expect(getByTestId('ping-method-note')).toBeTruthy());
    expect(getByText(/no timing data/)).toBeTruthy();

    await fireEvent.press(getByTestId('ping-submit'));
    await waitFor(() => expect(getByTestId('ping-result')).toBeTruthy(), { timeout: 3000 });

    expect(getByText(/example.com \(ICMP, best-effort\)/)).toBeTruthy();
    expect(getByTestId('ping-probe-1').props.children.join(' ')).toContain('reachable');
    // min/avg/max render as — for ICMP: honest, not invented.
    expect(getByText(/min — ms/)).toBeTruthy();
  });

  it('hides the port field in ICMP mode (no port to ping)', async () => {
    withPingCapabilities();
    const { getByTestId, queryByTestId } = await renderWithApp(
      <PingScreen tool={tool('tcp-ping', 'Ping')} />,
    );
    // TCP mode shows the port field.
    expect(queryByTestId('ping-port')).toBeTruthy();
    fireEvent.press(getByTestId('ping-method-icmp'));
    // React 19 state updates flush async in this environment — wait for it.
    await waitFor(() => expect(queryByTestId('ping-port')).toBeNull());
  });

  it('degrades to CAPABILITY_UNAVAILABLE when ICMP is chosen but absent', async () => {
    withPingCapabilities(false);
    const { getByTestId, getByText } = await renderWithApp(
      <PingScreen tool={tool('tcp-ping', 'Ping')} />,
    );

    fireEvent.press(getByTestId('ping-method-icmp'));
    await waitFor(() => expect(getByTestId('ping-method-note')).toBeTruthy());
    await fireEvent.press(getByTestId('ping-submit'));
    await waitFor(() => expect(getByText(/ICMP ping is not available/)).toBeTruthy(), {
      timeout: 3000,
    });
  });
});

describe('WifiInfoScreen', () => {
  function withWifi(options: {
    info?: WifiInfo | null;
    permission?: PermissionState;
    askResult?: PermissionState;
  }) {
    const getInfo = jest.fn().mockResolvedValue(options.info ?? null);
    const get = jest.fn().mockResolvedValue(ok(options.permission ?? granted));
    const request = jest
      .fn()
      .mockResolvedValue(
        ok(options.askResult ?? { granted: false, canAskAgain: true, status: 'denied' }),
      );
    mockedCapabilities.mockReturnValue({
      dnsResolve: null,
      dnsReverse: null,
      tcpConnect: null,
      tcpScan: null,
      tcpPing: null,
      icmpPing: null,
      wifiInfo: { getInfo },
      permissions: { get, request },
    } as unknown as CapabilityMap);
    return { getInfo, get, request };
  }
  /**
   * Built through `toWifiInfo` on purpose: the capability returns the mapped
   * model, so a hand-written literal here silently drifts (and did — the
   * gateway/DNS rows arrived later and the fixture did not).
   */
  function wifiInfoFixture(overrides: Partial<RawWifiInfo> = {}): WifiInfo {
    return toWifiInfo({
      ssid: null,
      bssid: null,
      frequencyMHz: null,
      rssi: null,
      linkSpeedMbps: null,
      gateway: null,
      dnsServers: [],
      transportWifi: true,
      transportCellular: false,
      transportVpn: false,
      transportEthernet: false,
      ...overrides,
    });
  }

  it('renders unavailable rows (never blanks) when info fields are gated', async () => {
    withWifi({ info: wifiInfoFixture(), permission: granted });
    const { findByTestId, getAllByText } = await renderWithApp(
      <WifiInfoScreen tool={tool('wifi-info', 'Wi-Fi Info')} />,
    );
    await findByTestId('wifi-ssid');
    // Rows say "unavailable — <reason>", never a blank. Several rows share
    // the location-permission reason; all of them must render it.
    expect(getAllByText(/unavailable — needs location permission/).length).toBeGreaterThan(0);
  });

  it('shows the gateway and every DNS server the link reports', async () => {
    withWifi({
      info: wifiInfoFixture({
        gateway: '192.168.1.1',
        dnsServers: ['192.168.1.1', '2606:4700:4700::1111'],
      }),
      permission: granted,
    });
    const { findByTestId, getByText } = await renderWithApp(
      <WifiInfoScreen tool={tool('wifi-info', 'Wi-Fi Info')} />,
    );

    await findByTestId('wifi-gateway');
    expect(getByText('192.168.1.1')).toBeTruthy();
    // IPv6 resolvers are carried through unchanged, and both are listed.
    expect(getByText('192.168.1.1, 2606:4700:4700::1111')).toBeTruthy();
  });

  it('says the gateway and DNS are unavailable rather than blank when absent', async () => {
    withWifi({ info: wifiInfoFixture(), permission: granted });
    const { findByTestId, getAllByText } = await renderWithApp(
      <WifiInfoScreen tool={tool('wifi-info', 'Wi-Fi Info')} />,
    );

    await findByTestId('wifi-gateway');
    expect(getAllByText(/unavailable — not exposed on this platform/)).toHaveLength(2);
  });

  it('shows the permission rationale card with Allow when not granted and askable', async () => {
    const mocks = withWifi({
      info: wifiInfoFixture(),
      permission: { granted: false, canAskAgain: true, status: 'undetermined' },
    });
    const { getByTestId, getByText } = await renderWithApp(
      <WifiInfoScreen tool={tool('wifi-info', 'Wi-Fi Info')} />,
    );
    await waitFor(() => expect(getByTestId('wifi-permission-card')).toBeTruthy());
    expect(getByText(/Location permission needed/)).toBeTruthy();

    await fireEvent.press(getByTestId('wifi-ask'));
    expect(mocks.request).toHaveBeenCalledWith('wifiInfo');
  });

  it('deep-links to settings when the permission was permanently denied', async () => {
    withWifi({
      info: wifiInfoFixture(),
      permission: { granted: false, canAskAgain: false, status: 'denied' },
    });
    const { getByTestId } = await renderWithApp(
      <WifiInfoScreen tool={tool('wifi-info', 'Wi-Fi Info')} />,
    );
    await waitFor(() => expect(getByTestId('wifi-open-settings')).toBeTruthy());
  });

  it('degrades to module-unavailable when the build lacks the native module', async () => {
    mockedCapabilities.mockReturnValue({
      dnsResolve: null,
      dnsReverse: null,
      tcpConnect: null,
      tcpScan: null,
      tcpPing: null,
      icmpPing: null,
      wifiInfo: null,
      permissions: null,
    } as unknown as CapabilityMap);
    const { getByTestId } = await renderWithApp(
      <WifiInfoScreen tool={tool('wifi-info', 'Wi-Fi Info')} />,
    );
    expect(getByTestId('wifi-module-unavailable')).toBeTruthy();
  });

  it('explains why a network tool asks for location', async () => {
    withWifi({ info: wifiInfoFixture(), permission: granted });
    const { getByText } = await renderWithApp(
      <WifiInfoScreen tool={tool('wifi-info', 'Wi-Fi Info')} />,
    );
    await waitFor(() =>
      expect(getByText(/Why does a network tool ask for location\?/)).toBeTruthy(),
    );
  });
});
