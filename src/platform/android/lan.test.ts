/**
 * Tests for the Android LAN-discovery adapter over fakes (M7).
 *
 * These pin the behaviours the milestone is accepted on: only hosts with an
 * open probed port are reported, mDNS merges hostnames into the same rows,
 * an unavailable mDNS browse degrades to "TCP sweep only" instead of failing,
 * and cancel mid-sweep keeps what was already found.
 */

import type { TcpScanCapability } from '../capabilities/tcp';
import type { PortScanReport } from '../../core/model/tcp';
import { err, ok, unwrap, type Result } from '../../core/result/result';
import { toolError } from '../../core/result/toolError';
import { v4CidrOf } from '../../core/ip/cidr';
import { parseV4 } from '../../core/ip/ip';
import { makeLanDiscoveryCapability, type LanNativeSurface } from './lan';

const cidr = (dotted: string, prefix: number) =>
  v4CidrOf(unwrap(parseV4(dotted)).int, prefix);

/** A /30 → two usable addresses (10.0.2.1, 10.0.2.2). */
const SMALL = cidr('10.0.2.0', 30);

function fakeScan(
  openByHost: Record<string, readonly number[]>,
  options: { failHosts?: readonly string[]; onScan?: () => void } = {},
): TcpScanCapability {
  return {
    scan: jest.fn(
      async (host: string, ports: readonly number[]): Promise<Result<PortScanReport>> => {
        options.onScan?.();
        if (options.failHosts?.includes(host)) {
          return err(toolError('TIMEOUT', 'No answer within the timeout.'));
        }
        const open = openByHost[host] ?? [];
        const report: PortScanReport = {
          host,
          ports: ports.map((port) =>
            open.includes(port)
              ? { port, verdict: 'open' as const, latencyMs: 5 }
              : { port, verdict: 'closed' as const, errorCode: 'REFUSED' },
          ),
          scanned: ports.length,
          openCount: open.length,
          startedAt: '2026-09-13T10:00:00.000Z',
          durationMs: 12,
        };
        return ok(report);
      },
    ),
  } as unknown as TcpScanCapability;
}

function fakeNative(overrides: Partial<LanNativeSurface> = {}): LanNativeSurface {
  return {
    localSubnet: jest.fn(async () => ({ address: '10.0.2.15', prefixLength: 24 })),
    discoverMdns: jest.fn(async () => ({ services: [], available: true })),
    ...overrides,
  };
}

const capability = (scan: TcpScanCapability, native: LanNativeSurface | null = fakeNative()) =>
  makeLanDiscoveryCapability({ tcpScan: scan, native });

describe('localSubnet', () => {
  it('reads the interface address as a canonical CIDR', async () => {
    const result = await capability(fakeScan({})).localSubnet({});
    expect(result.ok).toBe(true);
    expect(unwrap(result)).toEqual(cidr('10.0.2.0', 24));
  });

  it('reports NOT_FOUND when there is no usable interface', async () => {
    const result = await capability(
      fakeScan({}),
      fakeNative({ localSubnet: jest.fn(async () => null) }),
    ).localSubnet({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('refuses an address the planner could not use', async () => {
    const result = await capability(
      fakeScan({}),
      fakeNative({ localSubnet: jest.fn(async () => ({ address: 'not-an-ip', prefixLength: 24 })) }),
    ).localSubnet({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNKNOWN');
  });

  it('is unavailable without the native module', async () => {
    const result = await capability(fakeScan({}), null).localSubnet({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CAPABILITY_UNAVAILABLE');
  });

  it('honours an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await capability(fakeScan({})).localSubnet({ signal: controller.signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CANCELLED');
  });
});

describe('discover', () => {
  it('reports only addresses with an open probed port', async () => {
    const result = await capability(fakeScan({ '10.0.2.2': [22] })).discover(SMALL, {});
    const report = unwrap(result);

    expect(report.hosts).toHaveLength(1);
    expect(report.hosts[0]).toMatchObject({
      ip: '10.0.2.2',
      sources: ['tcp'],
      openPorts: [22],
      latencyMs: 5,
      hostname: null,
    });
    expect(report.probed).toBe(2);
    expect(report.mdns).toBe('ok');
    expect(report.summary).toBe('1 host (tcp 1)');
    expect(report.truncated).toBe(false);
  });

  it('keeps sweeping when one host probe fails outright', async () => {
    const result = await capability(
      fakeScan({ '10.0.2.1': [80] }, { failHosts: ['10.0.2.2'] }),
    ).discover(SMALL, {});
    expect(unwrap(result).hosts.map((h) => h.ip)).toEqual(['10.0.2.1']);
  });

  it('merges mDNS hostnames and addresses into the sweep rows', async () => {
    const native = fakeNative({
      discoverMdns: jest.fn(async () => ({
        services: [
          {
            name: 'printer.lan',
            host: 'printer.lan',
            addresses: ['10.0.2.2'],
            port: 631,
            serviceType: '_ipp._tcp',
          },
        ],
        available: true,
      })),
    });
    const report = unwrap(
      await capability(fakeScan({ '10.0.2.2': [80] }), native).discover(SMALL, {
        ports: [80],
      }),
    );

    expect(report.hosts).toHaveLength(1);
    expect(report.hosts[0]).toMatchObject({
      ip: '10.0.2.2',
      sources: ['tcp', 'mdns'],
      hostname: 'printer.lan',
      openPorts: [80, 631],
    });
  });

  it('includes an mDNS-only host the sweep could not see', async () => {
    const native = fakeNative({
      discoverMdns: jest.fn(async () => ({
        services: [
          {
            name: 'cast.lan',
            host: 'cast.lan',
            addresses: ['10.0.2.1'],
            port: 8009,
            serviceType: '_googlecast._tcp',
          },
        ],
        available: true,
      })),
    });
    const report = unwrap(await capability(fakeScan({}), native).discover(SMALL, {}));

    expect(report.hosts).toEqual([
      {
        ip: '10.0.2.1',
        sources: ['mdns'],
        hostname: 'cast.lan',
        openPorts: [8009],
        latencyMs: null,
      },
    ]);
    expect(report.summary).toBe('1 host (mdns 1)');
  });

  it('degrades to TCP-sweep-only when mDNS is unavailable', async () => {
    const native = fakeNative({
      discoverMdns: jest.fn(async () => ({
        services: [],
        available: false,
        reason: 'multicast lock not permitted',
      })),
    });
    const report = unwrap(
      await capability(fakeScan({ '10.0.2.1': [80] }), native).discover(SMALL, {}),
    );

    expect(report.mdns).toBe('unavailable');
    expect(report.mdnsReason).toBe('multicast lock not permitted');
    expect(report.hosts.map((h) => h.ip)).toEqual(['10.0.2.1']);
  });

  it('degrades the same way when the browse rejects', async () => {
    const native = fakeNative({
      discoverMdns: jest.fn(async () => {
        throw new Error('NSD exploded');
      }),
    });
    const report = unwrap(
      await capability(fakeScan({ '10.0.2.1': [80] }), native).discover(SMALL, {}),
    );

    expect(report.mdns).toBe('unavailable');
    expect(report.mdnsReason).toBe('NSD exploded');
    expect(report.hosts).toHaveLength(1);
  });

  it('skips the browse entirely when it is switched off', async () => {
    const native = fakeNative();
    const report = unwrap(await capability(fakeScan({}), native).discover(SMALL, { mdns: false }));

    expect(report.mdns).toBe('off');
    expect(report.mdnsReason).toBeUndefined();
    expect(native.discoverMdns).not.toHaveBeenCalled();
  });

  it('reports truncation instead of silently sweeping a huge block', async () => {
    const report = unwrap(
      await capability(fakeScan({})).discover(cidr('10.0.0.0', 8), { maxHosts: 4, ports: [80] }),
    );
    expect(report.truncated).toBe(true);
    expect(report.total).toBe(16777214);
    expect(report.cidr).toBe('10.0.0.0/8');
    expect(report.probed).toBe(4);
  });

  it('rejects an unusable port list before opening a socket', async () => {
    const scan = fakeScan({});
    for (const ports of [[], [0], [70_000], [1.5]]) {
      const result = await capability(scan).discover(SMALL, { ports });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT');
    }
    expect(scan.scan).not.toHaveBeenCalled();
  });

  it('stops mid-sweep on cancel and keeps what it found', async () => {
    const controller = new AbortController();
    const scan = fakeScan({ '10.0.2.2': [80] }, { onScan: () => controller.abort() });
    const report = unwrap(
      await capability(scan).discover(cidr('10.0.2.0', 24), {
        signal: controller.signal,
        ports: [80],
        concurrency: 1,
      }),
    );

    expect(report.stopped).toBe('cancelled');
    expect(report.probed).toBeLessThan(254);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('reports a time-budget stop as partial coverage, not as a failure', async () => {
    const scan = fakeScan({}, { onScan: () => undefined });
    const report = unwrap(
      await capability(scan).discover(cidr('10.0.2.0', 24), {
        ports: [80],
        concurrency: 1,
        budgetMs: 0,
      }),
    );

    expect(report.stopped).toBe('budget');
    expect(report.probed).toBe(0);
    expect(report.total).toBe(254);
    expect(report.hosts).toEqual([]);
  });

  it('probes one port per socket and reports every open port it finds', async () => {
    const scan = fakeScan({ '10.0.2.2': [80, 443] });
    const report = unwrap(
      await capability(scan).discover(SMALL, { ports: [22, 80, 443], concurrency: 1 }),
    );

    const calls = (scan.scan as jest.Mock).mock.calls as [string, readonly number[]][];
    const portsFor = (host: string) =>
      calls.filter(([called]) => called === host).map(([, ports]) => ports[0]);
    // Every socket probes exactly one port: the connect pool is the bottleneck.
    expect(calls.every(([, ports]) => ports.length === 1)).toBe(true);
    // A host's ports are all probed — a live host refuses its closed ports
    // instantly, and stopping at the first hit would understate what is open.
    expect(portsFor('10.0.2.2')).toEqual([22, 80, 443]);
    expect(portsFor('10.0.2.1')).toEqual([22, 80, 443]);
    expect(report.hosts[0].openPorts).toEqual([80, 443]);
  });

  it('streams throttled progress and always ends at the full count', async () => {
    const fractions: number[] = [];
    unwrap(
      await capability(fakeScan({ '10.0.2.2': [80] })).discover(SMALL, {
        ports: [80],
        progressIntervalMs: 60_000,
        onProgress: (progress) => fractions.push(progress.fraction),
      }),
    );

    expect(fractions[0]).toBe(0);
    expect(fractions[fractions.length - 1]).toBe(1);
  });
});
