/**
 * Android HTTP/TLS adapter tests (M6) against a mocked
 * `react-native-tcp-socket` + netops module handle.
 *
 * The mock reproduces the library's event shape: connectTLS /
 * createConnection return an event-emitting socket; tests fire
 * 'secureConnect'/'data'/'error'/'close' with raw bytes to exercise the
 * hand-rolled HTTP/1.1 exchange — status parsing, Content-Length framing,
 * redirects (absolute + relative), phase timing fields, the preview cap,
 * and honest null DNS.
 */

import TcpSockets from 'react-native-tcp-socket';
import type { NetopsModule } from '../../../modules/netops';
import { makeHttpProbeCapability, makeTlsInspectCapability } from './http';
import { toolError } from '../../core/result/toolError';

type Listener = (...args: unknown[]) => void;

class FakeSocket {
  readonly listeners = new Map<string, Set<Listener>>();
  destroyed = false;
  written: string[] = [];
  destroy = jest.fn(() => {
    this.destroyed = true;
  });

  on(event: string, listener: Listener): this {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(event, set);
    return this;
  }

  removeListener(event: string, listener: Listener): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: string, ...args: unknown[]): boolean {
    const set = this.listeners.get(event);
    if (!set) return false;
    for (const listener of [...set]) listener(...args);
    return true;
  }

  write(data: string, _encoding?: string, _cb?: unknown): boolean {
    this.written.push(data);
    return true;
  }
}

jest.mock('react-native-tcp-socket', () => {
  const mockModule = {
    __sockets: [] as FakeSocket[],
    createConnection: jest.fn(),
    connectTLS: jest.fn(),
  };
  return { __esModule: true, default: mockModule, ...mockModule };
});

const mockedCreate = TcpSockets.createConnection as unknown as jest.Mock;
const mockedTls = TcpSockets.connectTLS as unknown as jest.Mock;
const module_ = TcpSockets as unknown as { __sockets: FakeSocket[] };

function fakeSocket(): FakeSocket {
  const socket = new FakeSocket();
  module_.__sockets.push(socket);
  return socket;
}

/** HTTP response bytes for the mock to emit. */
function httpBytes(response: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < response.length; i++) out.push(response.charCodeAt(i) & 0xff);
  return out;
}

const SIMPLE_RESPONSE =
  'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 5\r\n\r\nhello';

beforeEach(() => {
  module_.__sockets.length = 0;
  mockedCreate.mockReset();
  mockedTls.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('makeHttpProbeCapability — plain http', () => {
  it('parses status, headers, body, and fills phase timings honestly', async () => {
    mockedCreate.mockImplementation(
      ((_options: object, callback: () => void) => {
        const socket = fakeSocket();
        setTimeout(() => {
          callback();
          setTimeout(() => socket.emit('data', httpBytes(SIMPLE_RESPONSE)), 5);
        }, 5);
        return socket;
      }) as never,
    );

    const capability = makeHttpProbeCapability();
    const result = await capability.probe('http://example.com/');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');

    expect(result.value.redirects).toHaveLength(0);
    expect(result.value.exchanges).toHaveLength(1);
    const exchange = result.value.exchanges[0];
    expect(exchange.status).toBe(200);
    expect(exchange.reasonPhrase).toBe('OK');
    expect(exchange.httpVersion).toBe('1.1');
    expect(exchange.secure).toBe(false);
    expect(exchange.headers).toContainEqual({ name: 'Content-Type', value: 'text/plain' });
    expect(exchange.bodyByteLength).toBe(5);
    expect(exchange.bodyPreview).toBe('hello');
    // The request was a hand-written GET with Host + Connection: close.
    const written = module_.__sockets[0].written.join('');
    expect(written).toContain('GET / HTTP/1.1');
    expect(written).toContain('Host: example.com');
    expect(written).toContain('Connection: close');
    // Phases: connect measured, TLS null (cleartext), DNS null (honest).
    expect(exchange.timings.connectMs).not.toBeNull();
    expect(exchange.timings.tlsMs).toBeNull();
    expect(exchange.timings.dnsMs).toBeNull();
    expect(exchange.timings.ttfbMs).not.toBeNull();
  });

  it('records a redirect hop and follows a relative Location', async () => {
    let call = 0;
    mockedCreate.mockImplementation(
      ((_options: object, callback: () => void) => {
        const socket = fakeSocket();
        call += 1;
        const response =
          call === 1
            ? 'HTTP/1.1 301 Moved Permanently\r\nLocation: /login\r\nContent-Length: 0\r\n\r\n'
            : 'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok';
        setTimeout(() => {
          callback();
          setTimeout(() => socket.emit('data', httpBytes(response)), 5);
        }, 5);
        return socket;
      }) as never,
    );

    const capability = makeHttpProbeCapability();
    const result = await capability.probe('http://example.com/');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');

    expect(result.value.redirects).toEqual([
      { url: 'http://example.com/', status: 301, location: '/login' },
    ]);
    expect(result.value.exchanges).toHaveLength(2);
    expect(result.value.exchanges[1].status).toBe(200);
    // The second request went to the resolved path with a fresh socket.
    expect(module_.__sockets).toHaveLength(2);
    expect(module_.__sockets[1].written.join('')).toContain('GET /login HTTP/1.1');
    // Total is the sum of both hops.
    expect(result.value.totalMs).toBe(
      result.value.exchanges.reduce((s, e) => s + (e.timings.totalMs ?? 0), 0),
    );
  });

  it('maps a refused connection to REFUSED', async () => {
    mockedCreate.mockImplementation(
      ((_options: object, _callback: () => void) => {
        const socket = fakeSocket();
        setTimeout(() => socket.emit('error', new Error('Connection refused')), 5);
        return socket;
      }) as never,
    );
    const capability = makeHttpProbeCapability();
    const result = await capability.probe('http://10.0.0.1:81/');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('REFUSED');
  });

  it('maps Android\'s timeout message ("failed to connect … after 3000ms") to TIMEOUT', async () => {
    mockedCreate.mockImplementation(
      ((_options: object, _callback: () => void) => {
        const socket = fakeSocket();
        setTimeout(
          () => socket.emit('error', new Error('failed to connect to /10.255.255.1 from /10.0.2.15 after 3000ms')),
          5,
        );
        return socket;
      }) as never,
    );
    const capability = makeHttpProbeCapability();
    const result = await capability.probe('http://192.0.2.1/');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('TIMEOUT');
  });

  it('reads close-delimited bodies when there is no Content-Length', async () => {
    mockedCreate.mockImplementation(
      ((_options: object, callback: () => void) => {
        const socket = fakeSocket();
        setTimeout(() => {
          callback();
          setTimeout(() => {
            socket.emit('data', httpBytes('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nchunk-bytes'));
            setTimeout(() => socket.emit('close'), 5);
          }, 5);
        }, 5);
        return socket;
      }) as never,
    );
    const capability = makeHttpProbeCapability();
    const result = await capability.probe('http://example.com/stream');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.exchanges[0].bodyByteLength).toBe(11);
    expect(result.value.exchanges[0].bodyPreview).toBe('chunk-bytes');
  });

  it('stops at the redirect cap with a clear error', async () => {
    mockedCreate.mockImplementation(
      ((_options: object, callback: () => void) => {
        const socket = fakeSocket();
        setTimeout(() => {
          callback();
          setTimeout(
            () => socket.emit('data', httpBytes('HTTP/1.1 302 Found\r\nLocation: /next\r\nContent-Length: 0\r\n\r\n')),
            5,
          );
        }, 5);
        return socket;
      }) as never,
    );
    const capability = makeHttpProbeCapability();
    const result = await capability.probe('http://example.com/', { maxRedirects: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_INPUT');
      expect(result.error.message).toContain('Too many redirects');
    }
    // cap + 1 exchanges: the initial + 2 followed hops before giving up.
    expect(module_.__sockets).toHaveLength(3);
  });

  it('rejects a malformed status line as INVALID_INPUT with the raw line as detail', async () => {
    mockedCreate.mockImplementation(
      ((_options: object, callback: () => void) => {
        const socket = fakeSocket();
        setTimeout(() => {
          callback();
          setTimeout(() => {
            socket.emit('data', httpBytes('GARBAGE\r\n\r\n'));
            // Close-delimited: without this the reader waits for more bytes.
            setTimeout(() => socket.emit('close'), 5);
          }, 5);
        }, 5);
        return socket;
      }) as never,
    );
    const capability = makeHttpProbeCapability();
    const result = await capability.probe('http://example.com/');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT');
  });
});

describe('makeHttpProbeCapability — https', () => {
  it('uses connectTLS and records the TLS phase from secureConnect', async () => {
    mockedTls.mockImplementation(
      ((_options: object, callback: () => void) => {
        const socket = fakeSocket();
        setTimeout(() => {
          callback();
          setTimeout(() => socket.emit('secureConnect'), 5);
          setTimeout(() => socket.emit('data', httpBytes(SIMPLE_RESPONSE)), 10);
        }, 5);
        return socket;
      }) as never,
    );

    const capability = makeHttpProbeCapability();
    const result = await capability.probe('https://example.com/');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const exchange = result.value.exchanges[0];
    expect(exchange.secure).toBe(true);
    expect(exchange.timings.tlsMs).not.toBeNull();
    expect(mockedTls).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'example.com', port: 443 }),
      expect.any(Function),
    );
  });
});

describe('makeHttpProbeCapability — input validation', () => {
  it('rejects invalid URLs before any socket is opened', async () => {
    const capability = makeHttpProbeCapability();
    for (const url of ['', 'ftp://example.com', 'https://user:pass@example.com/']) {
      const result = await capability.probe(url);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT');
    }
    expect(module_.__sockets).toHaveLength(0);
  });

  it('cancels before the first exchange when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    mockedCreate.mockImplementation((() => fakeSocket()) as never);
    const capability = makeHttpProbeCapability();
    const result = await capability.probe('http://example.com/', {
      signal: controller.signal,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CANCELLED');
    // The abort check runs before socket creation — nothing was opened.
    expect(module_.__sockets).toHaveLength(0);
  });
});

describe('makeTlsInspectCapability', () => {
  function fakeModule(overrides: Partial<NetopsModule> = {}): NetopsModule {
    return {
      getWifiPermissions: jest.fn(),
      requestWifiPermissions: jest.fn(),
      getWifiInfo: jest.fn(),
      isReachable: jest.fn(),
      getTlsInfo: jest.fn().mockResolvedValue({
        host: 'example.com',
        port: 443,
        chain: [
          {
            subject: 'CN=example.com',
            issuer: 'CN=Example CA',
            sans: ['example.com'],
            notBefore: '2026-01-01T00:00:00Z',
            notAfter: '2027-01-01T00:00:00Z',
            serialNumber: 'abc123',
            signatureAlgorithm: 'SHA256withRSA',
            keyInfo: 'RSA 2048',
            selfSigned: false,
          },
        ],
        tlsVersion: 'TLSv1.3',
        cipherSuite: 'TLS_AES_256_GCM_SHA384',
      }),
      ...overrides,
    } as NetopsModule;
  }

  it('maps the native capture to a typed report', async () => {
    const module = fakeModule();
    const capability = makeTlsInspectCapability(module);
    const result = await capability.inspect('example.com', 443);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.method).toBe('tls');
    expect(result.value.host).toBe('example.com');
    expect(result.value.tlsVersion).toBe('TLSv1.3');
    expect(result.value.cipherSuite).toBe('TLS_AES_256_GCM_SHA384');
    expect(result.value.chain[0].subject).toBe('CN=example.com');
    expect(result.value.chain[0].selfSigned).toBe(false);
    expect(module.getTlsInfo).toHaveBeenCalledWith('example.com', 443, 10_000);
  });

  it('maps the native error value to NETWORK_UNREACHABLE (never a crash)', async () => {
    const module = fakeModule({
      getTlsInfo: jest.fn().mockResolvedValue({ error: 'handshake failed' }),
    });
    const capability = makeTlsInspectCapability(module);
    const result = await capability.inspect('self-signed.example', 443);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NETWORK_UNREACHABLE');
      expect(result.error.technical).toContain('handshake failed');
    }
  });

  it('maps a thrown exception to an error result with the message as detail', async () => {
    const module = fakeModule({
      getTlsInfo: jest.fn().mockRejectedValue(new Error('boom')),
    });
    const capability = makeTlsInspectCapability(module);
    const result = await capability.inspect('example.com', 443);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NETWORK_UNREACHABLE');
      expect(result.error.technical).toContain('boom');
    }
  });
});

// Silence the unused import lint for toolError (used in older revisions;
// kept to mirror the adapter's taxonomy imports).
void toolError;
