/**
 * TCP tool screens — the operation flow over mocked capabilities:
 * capability data reaches the cards, missing capabilities degrade to
 * CAPABILITY_UNAVAILABLE, and runs land in history with the tool's summary.
 *
 * The Android adapter itself is covered by platform/android/tcp.test.ts; here
 * we verify the screens speak the capability + operation contracts.
 */

import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithApp } from '../../../test-utils/appTestKit';
import type { ToolModule, ToolId } from '../../core/registry/types';
import { ok } from '../../core/result/result';
import type { TcpConnectReport, TcpPingReport } from '../../core/model/tcp';
import { TcpConnectScreen } from '../tcp-connect';
import { TcpPingScreen } from '../tcp-ping';
import { PortScannerScreen } from '../port-scanner';
import { getCapabilities } from '../../platform/registry';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  router: { push: jest.fn() },
}));

// Screens must never import the native lib; the capability seam is what they
// see. Mock the registry so each test can shape availability.
jest.mock('../../platform/registry', () => ({
  getCapabilities: jest.fn(),
}));

const mockedCapabilities = getCapabilities as jest.MockedFunction<typeof getCapabilities>;

const tool = (id: ToolId, title: string): ToolModule => ({
  id,
  title,
  description: 'test tool',
  category: 'connectivity',
  icon: 'plug',
  requiredCapabilities: [],
  Component: () => null,
});

const connectReport: TcpConnectReport = {
  host: 'example.com',
  port: 443,
  ok: true,
  latencyMs: 42,
  finishedAt: '2026-09-13T10:00:00.000Z',
};

const pingReport: TcpPingReport = {
  host: 'example.com',
  port: 443,
  probes: [
    { seq: 1, ok: true, latencyMs: 20 },
    { seq: 2, ok: false, latencyMs: null, errorCode: 'REFUSED' },
  ],
  sent: 2,
  received: 1,
  lossPercent: 50,
  minMs: 20,
  avgMs: 20,
  maxMs: 20,
};

function mockConnect() {
  mockedCapabilities.mockReturnValue({
    dnsResolve: null,
    dnsReverse: null,
    tcpConnect: {
      connect: jest.fn().mockResolvedValue(ok(connectReport)),
    },
    tcpPing: {
      ping: jest.fn().mockResolvedValue(ok(pingReport)),
    },
    tcpScan: {
      scan: jest
        .fn()
        .mockImplementation(
          (_host: string, _ports: readonly number[], _options: object, onProgress?: Function) => {
            onProgress?.({ scanned: 5, total: 10, open: 2, fraction: 0.5 });
            return Promise.resolve(
              ok({
                host: 'example.com',
                ports: [
                  { port: 80, verdict: 'open', service: 'http', latencyMs: 12 },
                  { port: 443, verdict: 'open', service: 'https', latencyMs: 15 },
                  { port: 8080, verdict: 'closed', errorCode: 'REFUSED' },
                ],
                scanned: 3,
                openCount: 2,
                startedAt: '2026-09-13T10:00:00.000Z',
                durationMs: 540,
              }),
            );
          },
        ),
    },
  });
}

beforeEach(() => {
  mockedCapabilities.mockReset();
});

describe('TcpConnectScreen', () => {
  it('runs a connect through the capability and shows the latency', async () => {
    mockConnect();
    const { getByTestId, getByText, data } = await renderWithApp(
      <TcpConnectScreen tool={tool('tcp-connect', 'TCP Connect Test')} />,
    );

    await fireEvent.press(getByTestId('tcp-connect-submit'));
    await waitFor(() => expect(getByTestId('tcp-connect-result')).toBeTruthy(), { timeout: 3000 });

    expect(getByText(/TCP handshake/)).toBeTruthy();
    expect(getByText('42 ms')).toBeTruthy();

    const runs = data.runs.list();
    expect(runs.ok).toBe(true);
    if (runs.ok) {
      expect(runs.value[0]).toMatchObject({
        toolId: 'tcp-connect',
        status: 'success',
        summary: 'example.com:443 open in 42 ms',
      });
    }
  });

  it('degrades to CAPABILITY_UNAVAILABLE when the build lacks the capability', async () => {
    mockedCapabilities.mockReturnValue({
      dnsResolve: null,
      dnsReverse: null,
      tcpConnect: null,
      tcpPing: null,
      tcpScan: null,
    });
    const { getByTestId, getByText } = await renderWithApp(
      <TcpConnectScreen tool={tool('tcp-connect', 'TCP Connect Test')} />,
    );

    await fireEvent.press(getByTestId('tcp-connect-submit'));
    await waitFor(() => expect(getByText(/not available in this build/i)).toBeTruthy(), {
      timeout: 3000,
    });
  });
});

describe('TcpPingScreen', () => {
  it('shows probe lines and loss stats from the report', async () => {
    mockConnect();
    const { getByTestId, getByText } = await renderWithApp(
      <TcpPingScreen tool={tool('tcp-ping', 'TCP Ping')} />,
    );

    await fireEvent.press(getByTestId('tcp-ping-submit'));
    await waitFor(() => expect(getByTestId('tcp-ping-result')).toBeTruthy(), { timeout: 3000 });

    expect(getByText(/1\/2 received/)).toBeTruthy();
    expect(getByText(/loss 50%/)).toBeTruthy();
    expect(getByTestId('tcp-ping-probe-1').props.children.join(' ')).toContain('ok 20 ms');
  });
});

describe('PortScannerScreen', () => {
  it('scans a preset and lists open ports with service names', async () => {
    mockConnect();
    const { getByTestId, getByText } = await renderWithApp(
      <PortScannerScreen tool={tool('port-scanner', 'Port Scanner')} />,
    );

    await fireEvent.press(getByTestId('port-scanner-submit'));
    await waitFor(() => expect(getByTestId('port-scanner-result')).toBeTruthy(), { timeout: 3000 });

    expect(getByText(/2 open, 3 scanned/)).toBeTruthy();
    expect(getByTestId('port-scanner-open-443').props.children.join(' ')).toContain('https');
    expect(getByTestId('port-scanner-open-80').props.children.join(' ')).toContain('http');
  });

  it('accepts a custom port list overriding the preset', async () => {
    mockConnect();
    const { getByTestId } = await renderWithApp(
      <PortScannerScreen tool={tool('port-scanner', 'Port Scanner')} />,
    );

    await fireEvent.changeText(getByTestId('port-scanner-custom'), '22 80 443');
    await fireEvent.press(getByTestId('port-scanner-submit'));
    await waitFor(() => expect(getByTestId('port-scanner-result')).toBeTruthy(), { timeout: 3000 });

    // The scan capability received exactly the parsed custom list.
    const caps = mockedCapabilities.mock.results[0].value;
    expect(caps.tcpScan.scan).toHaveBeenCalledWith(
      'example.com',
      [22, 80, 443],
      expect.anything(),
      expect.anything(),
    );
  });
});
