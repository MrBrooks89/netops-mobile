/**
 * Android TCP adapter tests — everything the capability promises, against a
 * mock of `react-native-tcp-socket`:
 *
 *   - connect: latency on success, REFUSED/TIMEOUT verdicts from message text
 *   - ping: probe aggregation, loss stats, cancel between probes
 *   - scan: bounded concurrency, throttled progress, cancel, service names
 *
 * The mock reproduces the library's real shape: `createConnection(options,
 * callback)` returns an event-emitting socket whose 'connect' or 'error' fires
 * asynchronously — exactly the seams the adapter owns.
 */

import TcpSockets from 'react-native-tcp-socket';
import { toolError } from '../../core/result/toolError';
import { pingStats } from '../../core/model/tcp';
import { lookupTcpService } from '../../core/ports/ports';
import { tcpConnectCapability, tcpPingCapability, tcpScanCapability } from './tcp';

/** Minimal event-emitter stand-in with exactly the API the adapter touches. */
type Listener = (...args: unknown[]) => void;
class FakeSocket {
  private readonly listeners = new Map<string, Set<Listener>>();
  destroy = jest.fn();

  on(event: string, listener: Listener): this {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(event, set);
    return this;
  }

  emit(event: string, ...args: unknown[]): boolean {
    const set = this.listeners.get(event);
    if (!set) return false;
    for (const listener of set) listener(...args);
    return true;
  }
}

/** A fake library socket, stored so tests can assert destroy was called. */
type MockSocket = FakeSocket;

jest.mock('react-native-tcp-socket', () => {
  const mockModule = {
    __sockets: [] as MockSocket[],
    createConnection: jest.fn(),
  };
  return { __esModule: true, default: mockModule, ...mockModule };
});

type CreateConnection = jest.MockedFunction<typeof TcpSockets.createConnection>;

const mockedCreate = TcpSockets.createConnection as unknown as CreateConnection;
const module_ = TcpSockets as unknown as { __sockets: MockSocket[] };

/** Build a socket whose connect outcome is decided by `behave`. */
function fakeSocket(
  behave: (socket: MockSocket) => void,
): MockSocket {
  const socket = new FakeSocket();
  module_.__sockets.push(socket);
  behave(socket);
  return socket;
}

beforeEach(() => {
  module_.__sockets.length = 0;
  mockedCreate.mockReset();
});

describe('mapConnectError via connectOnce (connect capability)', () => {
  it('reports latency and a friendly report on success', async () => {
    mockedCreate.mockImplementation(
      ((_options: object, callback: () => void) =>
        fakeSocket((socket) => {
          setTimeout(() => {
            callback();
          }, 10);
        })) as unknown as typeof mockedCreate,
    );
    const result = await tcpConnectCapability.connect('example.com', 443, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ok).toBe(true);
      expect(result.value.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.value.host).toBe('example.com');
      expect(result.value.port).toBe(443);
    }
    // The socket must be destroyed so the native map does not leak.
    expect(module_.__sockets[0].destroy).toHaveBeenCalled();
  });

  it('maps "Connection refused" to REFUSED', async () => {
    mockedCreate.mockImplementation(
      ((_options: object, _callback: () => void) =>
        fakeSocket((socket) => {
          setTimeout(() => socket.emit('error', new Error('Connection refused')), 5);
        })) as unknown as typeof mockedCreate,
    );
    const result = await tcpConnectCapability.connect('10.0.0.1', 81, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ok).toBe(false);
      expect(result.value.errorCode).toBe('REFUSED');
      expect(result.value.latencyMs).toBeNull();
    }
  });

  it('maps Android\'s real SocketTimeoutException message ("failed to connect … after 3000ms") to TIMEOUT', async () => {
    // Device-verified (M4): Android's SocketTimeoutException message never
    // contains the word "timeout" — it reads
    // "failed to connect to /host (port N) from /local (port N) after 3000ms".
    mockedCreate.mockImplementation(
      ((_options: object, _callback: () => void) =>
        fakeSocket((socket) => {
          setTimeout(
            () =>
              socket.emit(
                'error',
                new Error(
                  'failed to connect to /10.255.255.1 (port 81) from /10.0.2.16 (port 37479) after 3000ms',
                ),
              ),
            5,
          );
        })) as unknown as typeof mockedCreate,
    );
    const result = await tcpConnectCapability.connect('10.255.255.1', 81, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ok).toBe(false);
      expect(result.value.errorCode).toBe('TIMEOUT');
      expect(result.value.technicalMessage).toContain('after 3000ms');
    }
  });

  it('maps timeout messages to TIMEOUT', async () => {
    mockedCreate.mockImplementation(
      ((_options: object, _callback: () => void) =>
        fakeSocket((socket) => {
          setTimeout(
            () => socket.emit('error', new Error('connect timed out')),
            5,
          );
        })) as unknown as typeof mockedCreate,
    );
    const result = await tcpConnectCapability.connect('10.255.255.1', 81, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ok).toBe(false);
      expect(result.value.errorCode).toBe('TIMEOUT');
    }
  });

  it('surfaces a synchronous throw (e.g. resolve failure) as an error report', async () => {
    mockedCreate.mockImplementation(() => {
      throw new Error('Unable to resolve host "nope.invalid"');
    });
    const result = await tcpConnectCapability.connect('nope.invalid', 80, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ok).toBe(false);
      expect(result.value.errorCode).toBe('NETWORK_UNREACHABLE');
    }
  });

  it('resolves an aborted signal as CANCELLED without touching the network', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await tcpConnectCapability.connect('example.com', 443, {
      signal: controller.signal,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.errorCode).toBe('CANCELLED');
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});

describe('tcpPingCapability', () => {
  it('aggregates probes into stats with loss and latency spread', async () => {
    const latencies = [30, 10, 50, 10];
    mockedCreate.mockImplementation((() => {
      let call = 0;
      return ((_options: object, callback: () => void) =>
        fakeSocket((socket) => {
          const latency = latencies[call++] ?? 10;
          setTimeout(callback, latency);
        })) as unknown as typeof mockedCreate;
    })());

    const result = await tcpPingCapability.ping('example.com', 443, 4, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.probes).toHaveLength(4);
      expect(result.value.received).toBe(4);
      expect(result.value.lossPercent).toBe(0);
      // Node truncates timer delays, so a 10ms timeout can fire at 9ms; the
      // bounds below carry that 1ms tolerance. The spread is what matters.
      expect(result.value.minMs).toBeGreaterThanOrEqual(9);
      expect(result.value.minMs).toBeLessThanOrEqual(50);
      expect(result.value.maxMs).toBeGreaterThanOrEqual(49);
      expect(result.value.avgMs).toBeGreaterThanOrEqual(24);
    }
  });

  it('stops at cancel and reports the probes that completed', async () => {
    const controller = new AbortController();
    let calls = 0;
    mockedCreate.mockImplementation(
      ((_options: object, callback: () => void) =>
        fakeSocket((socket) => {
          calls++;
          setTimeout(() => {
            if (calls === 2) controller.abort();
            callback();
          }, 5);
        })) as unknown as typeof mockedCreate,
    );
    const result = await tcpPingCapability.ping('example.com', 443, 5, {
      signal: controller.signal,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.probes.length).toBeGreaterThanOrEqual(2);
      expect(result.value.probes.length).toBeLessThan(5);
      expect(mockedCreate.mock.calls.length).toBeLessThan(5);
    }
  });
});

describe('tcpScanCapability', () => {
  /** Make every port open with a deterministic latency. */
  function allOpen() {
    mockedCreate.mockImplementation(
      ((_options: object, callback: () => void) =>
        fakeSocket((_socket) => {
          setTimeout(callback, 5);
        })) as unknown as typeof mockedCreate,
    );
  }

  it('scans ports, annotates open ones with service names and latency', async () => {
    allOpen();
    const result = await tcpScanCapability.scan('example.com', [80, 443, 8080], {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.scanned).toBe(3);
      expect(result.value.openCount).toBe(3);
      expect(result.value.ports.map((p) => p.port)).toEqual([80, 443, 8080]);
      // Service names come from the curated ports dataset.
      const https = result.value.ports.find((p) => p.port === 443);
      expect(https?.verdict).toBe('open');
      expect(https?.service).toBe('https');
    }
  });

  it('never runs more connects concurrently than the requested cap', async () => {
    let inFlight = 0;
    let peak = 0;
    mockedCreate.mockImplementation(
      ((_options: object, callback: () => void) =>
        fakeSocket((_socket) => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          setTimeout(() => {
            inFlight--;
            callback();
          }, 10);
        })) as unknown as typeof mockedCreate,
    );
    const ports = Array.from({ length: 30 }, (_, i) => 100 + i);
    await tcpScanCapability.scan('example.com', ports, { concurrency: 5 });
    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThan(1);
  });

  it('reports progress snapshots that end at the full total', async () => {
    allOpen();
    const events: { scanned: number; total: number }[] = [];
    const ports = Array.from({ length: 12 }, (_, i) => 2000 + i);
    await tcpScanCapability.scan('example.com', ports, { concurrency: 4 }, (progress) => {
      events.push({ scanned: progress.scanned, total: progress.total });
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1].scanned).toBe(12);
    expect(events[events.length - 1].total).toBe(12);
    // Snapshots are monotone: the adapter never reports a lower scanned count.
    for (let i = 1; i < events.length; i++) {
      expect(events[i].scanned).toBeGreaterThanOrEqual(events[i - 1].scanned);
    }
  });

  it('returns CANCELLED (not a partial report) when the signal aborts', async () => {
    const controller = new AbortController();
    let calls = 0;
    mockedCreate.mockImplementation(
      ((_options: object, callback: () => void) =>
        fakeSocket((_socket) => {
          calls++;
          if (calls === 3) controller.abort();
          setTimeout(callback, 5);
        })) as unknown as typeof mockedCreate,
    );
    const result = await tcpScanCapability.scan(
      'example.com',
      [1, 2, 3, 4, 5, 6],
      { concurrency: 1, signal: controller.signal },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CANCELLED');
  });

  it('classifies refused as closed and timeouts as filtered', async () => {
    let call = 0;
    const behaviors = ['refused', 'timeout', 'open'] as const;
    mockedCreate.mockImplementation(
      ((_options: object, callback: () => void) =>
        fakeSocket((socket) => {
          const mode = behaviors[call++ % behaviors.length];
          if (mode === 'open') setTimeout(callback, 2);
          else if (mode === 'refused')
            setTimeout(() => socket.emit('error', new Error('Connection refused')), 2);
          else setTimeout(() => socket.emit('error', new Error('connect timed out')), 2);
        })) as unknown as typeof mockedCreate,
    );
    const result = await tcpScanCapability.scan('example.com', [1, 2, 3], { concurrency: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const byPort = new Map(result.value.ports.map((p) => [p.port, p.verdict]));
      expect(byPort.get(1)).toBe('closed');
      expect(byPort.get(2)).toBe('filtered');
      expect(byPort.get(3)).toBe('open');
    }
  });
});

describe('pingStats (pure model)', () => {
  it('computes min/avg/max and one-decimal loss over a mixed set', () => {
    const stats = pingStats([
      { seq: 1, ok: true, latencyMs: 20 },
      { seq: 2, ok: false, latencyMs: null, errorCode: 'REFUSED' },
      { seq: 3, ok: true, latencyMs: 30 },
      { seq: 4, ok: true, latencyMs: 40 },
    ]);
    expect(stats).toMatchObject({
      sent: 4,
      received: 3,
      lossPercent: 25,
      minMs: 20,
      maxMs: 40,
      avgMs: 30,
    });
  });

  it('returns null latencies for a fully failed series', () => {
    const stats = pingStats([{ seq: 1, ok: false, latencyMs: null, errorCode: 'TIMEOUT' }]);
    expect(stats).toMatchObject({
      sent: 1,
      received: 0,
      lossPercent: 100,
      minMs: null,
      avgMs: null,
      maxMs: null,
    });
  });
});

describe('lookupTcpService (ports DB join)', () => {
  it('finds a known TCP port and ignores UDP-only assignments', () => {
    expect(lookupTcpService(443)?.service).toBe('https');
    expect(lookupTcpService(9999)).toBeNull();
  });
});

describe('taxonomy guard for the adapter error surface', () => {
  it('uses ToolError codes from the shared taxonomy', () => {
    const codes = ['REFUSED', 'TIMEOUT', 'CANCELLED', 'NETWORK_UNREACHABLE'] as const;
    for (const code of codes) {
      expect(toolError(code, 'x').code).toBe(code);
    }
  });
});
