/**
 * M6 screen tests over mocked capabilities: HTTP diagnostics (status,
 * redirect chain, phase rows, header list) and TLS inspector (chain
 * cards, expiry states incl. the < 14-day warning + expired, self-signed
 * flag, export button).
 */

import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithApp } from '../../../test-utils/appTestKit';
import { HttpDiagnosticsScreen } from '../http-diagnostics';
import { TlsInspectorScreen } from '../tls-inspector';
import { getCapabilities } from '../../platform/registry';
import type { CapabilityMap } from '../../platform/capabilities';
import { ok } from '../../core/result/result';
import type { HttpProbeReport } from '../../core/model/http';
import type { TlsReport } from '../../core/model/tls';

jest.mock('../../platform/registry', () => ({
  getCapabilities: jest.fn(),
}));

const mockedCapabilities = getCapabilities as jest.MockedFunction<typeof getCapabilities>;

const tool = (id: 'http-diagnostics' | 'tls-inspector', title: string) => ({
  id,
  title,
  description: 'test',
  category: 'connectivity' as const,
  icon: 'globe' as const,
  requiredCapabilities: [],
  Component: () => null,
});

const now = Date.UTC(2026, 8, 14, 12);

const probeReport: HttpProbeReport = {
  method: 'http',
  requestedUrl: 'http://example.com/',
  redirects: [{ url: 'http://example.com/', status: 301, location: '/login' }],
  exchanges: [
    {
      secure: false,
      status: 301,
      reasonPhrase: 'Moved Permanently',
      httpVersion: '1.1',
      headers: [{ name: 'Location', value: '/login' }],
      bodyByteLength: 0,
      bodyPreview: null,
      timings: { dnsMs: null, connectMs: 5, tlsMs: null, ttfbMs: 10, totalMs: 50 },
    },
    {
      secure: false,
      status: 200,
      reasonPhrase: 'OK',
      httpVersion: '1.1',
      headers: [
        { name: 'Content-Type', value: 'text/plain' },
        { name: 'X-Custom', value: 'yes' },
      ],
      bodyByteLength: 5,
      bodyPreview: 'hello',
      timings: { dnsMs: null, connectMs: 4, tlsMs: null, ttfbMs: 9, totalMs: 60 },
    },
  ],
  finalTimings: { dnsMs: null, connectMs: 4, tlsMs: null, ttfbMs: 9, totalMs: 60 },
  totalMs: 110,
  finishedAt: now,
};

function tlsReport(overrides: Partial<TlsReport> = {}): TlsReport {
  const in90Days = new Date(now + 90 * 86_400_000).toISOString();
  return {
    method: 'tls',
    host: 'example.com',
    port: 443,
    chain: [
      {
        subject: 'CN=example.com',
        issuer: 'CN=Example CA',
        sans: ['example.com', 'www.example.com'],
        notBefore: '2026-01-01T00:00:00Z',
        notAfter: in90Days,
        serialNumber: 'abc123',
        signatureAlgorithm: 'SHA256withRSA',
        keyInfo: 'RSA 2048',
        selfSigned: false,
      },
    ],
    tlsVersion: 'TLSv1.3',
    cipherSuite: 'TLS_AES_256_GCM_SHA384',
    finishedAt: now,
    ...overrides,
  };
}

function withCapabilities(http: boolean, tls: boolean) {
  mockedCapabilities.mockReturnValue({
    dnsResolve: null,
    dnsReverse: null,
    tcpConnect: null,
    tcpScan: null,
    tcpPing: null,
    icmpPing: null,
    wifiInfo: null,
    permissions: null,
    httpProbe: http ? { probe: jest.fn().mockResolvedValue(ok(probeReport)) } : null,
    tlsInspect: tls ? { inspect: jest.fn().mockResolvedValue(ok(tlsReport())) } : null,
  } as unknown as CapabilityMap);
}

beforeEach(() => {
  mockedCapabilities.mockReset();
});

describe('HttpDiagnosticsScreen', () => {
  it('renders status, redirect chain, timings, and headers from the report', async () => {
    withCapabilities(true, false);
    const { getByTestId, getByText, getAllByText } = await renderWithApp(
      <HttpDiagnosticsScreen tool={tool('http-diagnostics', 'HTTP Diagnostics')} />,
    );

    await fireEvent.press(getByTestId('http-submit'));
    await waitFor(() => expect(getByTestId('http-result')).toBeTruthy(), { timeout: 3000 });

    // The final exchange (after following the redirect) is the headline.
    expect(getByText(/200 OK \(HTTP\/1\.1\)/)).toBeTruthy();
    expect(getByText(/1 redirect/)).toBeTruthy();
    expect(getByTestId('http-hop-0').props.children).toContain('/login');
    expect(getByText(/Connect/)).toBeTruthy();
    // DNS + TLS rows both show the honest dash (no invented numbers).
    expect(getAllByText(/—/).length).toBeGreaterThanOrEqual(2);
    expect(getAllByText(/Content-Type|X-Custom/).length).toBeGreaterThan(0);
    expect(getByTestId('http-body-preview').props.children).toContain('hello');
  });

  it('degrades to CAPABILITY_UNAVAILABLE when the build lacks the adapter', async () => {
    withCapabilities(false, false);
    const { getByTestId, getByText } = await renderWithApp(
      <HttpDiagnosticsScreen tool={tool('http-diagnostics', 'HTTP Diagnostics')} />,
    );

    await fireEvent.press(getByTestId('http-submit'));
    await waitFor(() => expect(getByText(/not available in this build/)).toBeTruthy(), {
      timeout: 3000,
    });
  });

  it('disables the submit button for an invalid URL', async () => {
    withCapabilities(true, false);
    const { getByTestId } = await renderWithApp(
      <HttpDiagnosticsScreen tool={tool('http-diagnostics', 'HTTP Diagnostics')} />,
    );
    await fireEvent.changeText(getByTestId('http-url'), 'ftp://example.com');
    // React 19 async flush: wait for the disabled state to land.
    await waitFor(() =>
      expect(getByTestId('http-submit').props.accessibilityState?.disabled).toBe(true),
    );
  });
});

describe('TlsInspectorScreen', () => {
  it('renders the chain card, version/cipher, and a healthy expiry', async () => {
    withCapabilities(false, true);
    const { getByTestId, getByText } = await renderWithApp(
      <TlsInspectorScreen tool={tool('tls-inspector', 'TLS Inspector')} />,
    );

    await fireEvent.press(getByTestId('tls-submit'));
    await waitFor(() => expect(getByTestId('tls-result')).toBeTruthy(), { timeout: 3000 });

    expect(getByText(/TLSv1\.3/)).toBeTruthy();
    expect(getByText(/TLS_AES_256_GCM_SHA384/)).toBeTruthy();
    expect(getByText(/1 certificate/)).toBeTruthy();
    expect(getByTestId('tls-cert-0')).toBeTruthy();
    expect(getByText(/www\.example\.com/)).toBeTruthy();
    expect(getByText(/in \d+ days?/)).toBeTruthy();
    expect(getByTestId('tls-export')).toBeTruthy();
  });

  it('fires the expiring-soon warning inside the 14-day window', async () => {
    const soon = tlsReport({
      chain: [
        {
          ...tlsReport().chain[0],
          notAfter: new Date(now + 5 * 86_400_000).toISOString(),
        },
      ],
    });
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
      tlsInspect: { inspect: jest.fn().mockResolvedValue(ok(soon)) },
    } as unknown as CapabilityMap);

    const { getByTestId } = await renderWithApp(
      <TlsInspectorScreen tool={tool('tls-inspector', 'TLS Inspector')} />,
    );
    await fireEvent.press(getByTestId('tls-submit'));
    await waitFor(() => expect(getByTestId('tls-expiring-soon-0')).toBeTruthy(), {
      timeout: 3000,
    });
  });

  it('shows the expired state, never "expiring soon"', async () => {
    const dead = tlsReport({
      chain: [
        {
          ...tlsReport().chain[0],
          notAfter: new Date(now - 2 * 86_400_000).toISOString(),
        },
      ],
    });
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
      tlsInspect: { inspect: jest.fn().mockResolvedValue(ok(dead)) },
    } as unknown as CapabilityMap);

    const { getByTestId, queryByTestId } = await renderWithApp(
      <TlsInspectorScreen tool={tool('tls-inspector', 'TLS Inspector')} />,
    );
    await fireEvent.press(getByTestId('tls-submit'));
    await waitFor(() => expect(getByTestId('tls-expired-0')).toBeTruthy(), { timeout: 3000 });
    expect(queryByTestId('tls-expiring-soon-0')).toBeNull();
  });

  it('flags a self-signed leaf with the warning note', async () => {
    const selfSigned = tlsReport({
      chain: [
        {
          ...tlsReport().chain[0],
          selfSigned: true,
          issuer: 'CN=example.com',
        },
      ],
    });
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
      tlsInspect: { inspect: jest.fn().mockResolvedValue(ok(selfSigned)) },
    } as unknown as CapabilityMap);

    const { getByTestId } = await renderWithApp(
      <TlsInspectorScreen tool={tool('tls-inspector', 'TLS Inspector')} />,
    );
    await fireEvent.press(getByTestId('tls-submit'));
    await waitFor(() => expect(getByTestId('tls-self-signed')).toBeTruthy(), { timeout: 3000 });
  });

  it('degrades to CAPABILITY_UNAVAILABLE when the build lacks the module', async () => {
    withCapabilities(false, false);
    const { getByTestId, getByText } = await renderWithApp(
      <TlsInspectorScreen tool={tool('tls-inspector', 'TLS Inspector')} />,
    );

    await fireEvent.press(getByTestId('tls-submit'));
    await waitFor(() => expect(getByText(/not available in this build/)).toBeTruthy(), {
      timeout: 3000,
    });
  });
});
