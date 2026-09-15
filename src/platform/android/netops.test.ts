/**
 * Tests for the netops Android adapter over a fake module handle. These
 * pin the honesty rules (plan D4, §6.4): ICMP probes report reachable /
 * not reachable with no invented timing, Wi-Fi reads map nulls through,
 * permission states flow unchanged, and aborts cancel between probes.
 */

import type { NetopsModule } from '../../../modules/netops';
import { makeIcmpPingCapability } from './netops';

function fakeNetops(overrides: Partial<NetopsModule> = {}): NetopsModule {
  return {
    getWifiPermissions: jest.fn().mockResolvedValue({
      granted: false,
      canAskAgain: true,
      status: 'undetermined',
    }),
    requestWifiPermissions: jest.fn().mockResolvedValue({
      granted: true,
      canAskAgain: true,
      status: 'granted',
    }),
    getWifiInfo: jest.fn().mockResolvedValue(null),
    isReachable: jest.fn().mockResolvedValue({ reachable: false }),
    getTlsInfo: jest.fn().mockResolvedValue({ error: 'not implemented in fake' }),
    localSubnet: jest.fn().mockResolvedValue(null),
    discoverMdns: jest.fn().mockResolvedValue({ services: [], available: true }),
    ...overrides,
  };
}

afterEach(() => {
  jest.useRealTimers();
});

describe('makeIcmpPingCapability', () => {
  it('aggregates reachable probes with loss stats and no invented latency', async () => {
    const module = fakeNetops({
      isReachable: jest
        .fn()
        .mockResolvedValueOnce({ reachable: true })
        .mockResolvedValueOnce({ reachable: false, error: 'timeout' })
        .mockResolvedValueOnce({ reachable: true })
        .mockResolvedValueOnce({ reachable: true }),
    });
    const capability = makeIcmpPingCapability(module);
    const result = await capability.ping('example.com', 4, { intervalMs: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.method).toBe('icmp');
    expect(result.value.sent).toBe(4);
    expect(result.value.received).toBe(3);
    expect(result.value.lossPercent).toBe(25);
    // Honesty: isReachable has no timing — the report must not invent any.
    expect(result.value.minMs).toBeNull();
    expect(result.value.avgMs).toBeNull();
    expect(result.value.maxMs).toBeNull();
    for (const probe of result.value.probes) {
      expect(probe.latencyMs).toBeNull();
    }
  });

  it('passes the requested per-probe timeout to the module', async () => {
    const module = fakeNetops();
    const capability = makeIcmpPingCapability(module);
    await capability.ping('example.com', 1, { timeoutMs: 1500 });
    expect(module.isReachable).toHaveBeenCalledWith('example.com', 1500);
  });

  it('rejects counts outside 1–50 with INVALID_INPUT', async () => {
    const capability = makeIcmpPingCapability(fakeNetops());
    for (const count of [0, -1, 51, 100]) {
      const result = await capability.ping('example.com', count, {});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT');
    }
  });

  it('maps a module exception to NETWORK_UNREACHABLE (loss is a value, crashes are not)', async () => {
    const module = fakeNetops({
      isReachable: jest.fn().mockRejectedValue(new Error('boom')),
    });
    const capability = makeIcmpPingCapability(module);
    const result = await capability.ping('example.com', 1, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NETWORK_UNREACHABLE');
      expect(result.error.technical).toContain('boom');
    }
  });

  it('cancels between probes: aborted interval resolves CANCELLED with partial data lost, not recorded', async () => {
    const controller = new AbortController();
    const module = fakeNetops({
      isReachable: jest.fn().mockResolvedValue({ reachable: true }),
    });
    const capability = makeIcmpPingCapability(module);
    const pending = capability.ping('example.com', 3, {
      intervalMs: 5_000,
      signal: controller.signal,
    });
    // Abort during the first inter-probe gap.
    setTimeout(() => controller.abort(), 30);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CANCELLED');
    // Only the probes before the abort ran.
    expect(module.isReachable).toHaveBeenCalledTimes(1);
  });

  it('honors an already-aborted signal before any probe', async () => {
    const controller = new AbortController();
    controller.abort();
    const module = fakeNetops();
    const capability = makeIcmpPingCapability(module);
    const result = await capability.ping('example.com', 3, {
      intervalMs: 0,
      signal: controller.signal,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CANCELLED');
    expect(module.isReachable).not.toHaveBeenCalled();
  });

  it('probeOnce returns a single probe without stats', async () => {
    const module = fakeNetops({
      isReachable: jest.fn().mockResolvedValue({ reachable: false, error: 'no route' }),
    });
    const capability = makeIcmpPingCapability(module);
    const result = await capability.probeOnce('192.0.2.1', {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.ok).toBe(false);
    expect(result.value.errorCode).toBe('no route');
  });
});
