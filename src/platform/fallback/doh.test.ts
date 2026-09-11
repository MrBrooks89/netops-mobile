import { DOH_PROVIDERS } from '../../core/dns/types';
import { createDohCapability, dnsQueryUrl } from './doh';

const CLOUDFLARE = DOH_PROVIDERS.cloudflare.endpoint;

/** Minimal fetch double; records the calls it received. */
function stubFetch(response: {
  ok?: boolean;
  status?: number;
  json?: () => Promise<unknown>;
  reject?: unknown;
}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (response.reject !== undefined) throw response.reject;
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: response.json ?? (async () => ({ Status: 0, Answer: [] })),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/**
 * A fetch double that never settles on its own and rejects when its signal
 * aborts — the behaviour real fetch has, which the timeout path depends on.
 */
function stubFetchHonouringAbort() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Promise((_resolve, reject) => {
      const abort = () => {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        reject(error);
      };
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener('abort', abort);
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const withFetch = async <T>(fetchImpl: typeof fetch, run: () => Promise<T>): Promise<T> => {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
};

const A_RESPONSE = {
  Status: 0,
  Answer: [{ name: 'example.com.', type: 1, TTL: 300, data: '93.184.216.34' }],
};

describe('dnsQueryUrl', () => {
  it('encodes the name and type, and keeps an existing query string', () => {
    const url = dnsQueryUrl(CLOUDFLARE, 'example.com', 'A');
    expect(url.startsWith(`${CLOUDFLARE}?`)).toBe(true);
    expect(url).toContain('name=example.com');
    expect(url).toContain('type=A');

    const custom = dnsQueryUrl('https://doh.example/dns-query?token=abc', 'a b.example', 'TXT');
    expect(custom).toContain('token=abc');
    expect(custom).toContain('name=a+b.example');
  });
});

describe('createDohCapability — resolve', () => {
  it('returns parsed answers and sends an Accept header', async () => {
    const { impl, calls } = stubFetch({ json: async () => A_RESPONSE });
    const result = await withFetch(impl, () =>
      createDohCapability().resolve('example.com', 'A', { endpoint: CLOUDFLARE }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]).toMatchObject({ type: 'A', value: '93.184.216.34' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('type=A');
    expect((calls[0].init?.headers as Record<string, string>).accept).toBe('application/json');
  });

  it('maps NXDOMAIN to NOT_FOUND', async () => {
    const { impl } = stubFetch({ json: async () => ({ Status: 3 }) });
    const result = await withFetch(impl, () =>
      createDohCapability().resolve('nope.example', 'A', { endpoint: CLOUDFLARE }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('maps a transport failure to NETWORK_UNREACHABLE (the offline case)', async () => {
    const { impl } = stubFetch({ reject: new TypeError('Network request failed') });
    const result = await withFetch(impl, () =>
      createDohCapability().resolve('example.com', 'A', { endpoint: CLOUDFLARE }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NETWORK_UNREACHABLE');
      expect(result.error.retryable).toBe(true);
      expect(result.error.technical).toContain('TypeError');
    }
  });

  it('maps an abort to CANCELLED and a timeout to TIMEOUT', async () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    const aborted = await withFetch(stubFetch({ reject: abortError }).impl, () =>
      createDohCapability().resolve('example.com', 'A', { endpoint: CLOUDFLARE }),
    );
    expect(aborted.ok).toBe(false);
    if (!aborted.ok) expect(aborted.error.code).toBe('CANCELLED');

    // A fetch that never settles must hit the per-request timeout.
    const timedOut = await withFetch(stubFetchHonouringAbort().impl, () =>
      createDohCapability().resolve('example.com', 'A', { endpoint: CLOUDFLARE, timeoutMs: 20 }),
    );
    expect(timedOut.ok).toBe(false);
    if (!timedOut.ok) expect(timedOut.error.code).toBe('TIMEOUT');
  });

  it('maps a non-2xx response and a malformed body', async () => {
    const http = await withFetch(stubFetch({ ok: false, status: 503 }).impl, () =>
      createDohCapability().resolve('example.com', 'A', { endpoint: CLOUDFLARE }),
    );
    expect(http.ok).toBe(false);
    if (!http.ok) {
      expect(http.error.code).toBe('DNS_FAILURE');
      expect(http.error.technical).toContain('503');
    }

    const badJson = await withFetch(
      stubFetch({
        json: async () => {
          throw new Error('unexpected token');
        },
      }).impl,
      () => createDohCapability().resolve('example.com', 'A', { endpoint: CLOUDFLARE }),
    );
    expect(badJson.ok).toBe(false);
    if (!badJson.ok) expect(badJson.error.code).toBe('DNS_FAILURE');
  });

  it('rejects an empty name without calling the network', async () => {
    const { impl, calls } = stubFetch({});
    const result = await withFetch(impl, () =>
      createDohCapability().resolve('   ', 'A', { endpoint: CLOUDFLARE }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT');
    expect(calls).toHaveLength(0);
  });

  it('forwards the caller signal and reports a pre-aborted request as CANCELLED', async () => {
    const { impl, calls } = stubFetchHonouringAbort();
    const controller = new AbortController();
    controller.abort();

    const result = await withFetch(impl, () =>
      createDohCapability().resolve('example.com', 'A', {
        endpoint: CLOUDFLARE,
        signal: controller.signal,
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CANCELLED');
    // fetch receives the *combined* signal (caller + timeout), already aborted.
    expect(calls).toHaveLength(1);
    expect((calls[0].init?.signal as AbortSignal).aborted).toBe(true);
  });
});

describe('createDohCapability — reverse', () => {
  it('queries the in-addr.arpa name with type PTR', async () => {
    const { impl, calls } = stubFetch({
      json: async () => ({
        Status: 0,
        Answer: [{ name: '8.8.8.8.in-addr.arpa.', type: 12, TTL: 60, data: 'dns.google.' }],
      }),
    });
    const result = await withFetch(impl, () =>
      createDohCapability().reverse('8.8.8.8', { endpoint: DOH_PROVIDERS.google.endpoint }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]).toMatchObject({ type: 'PTR', value: 'dns.google' });
    }
    expect(calls[0].url).toContain('name=8.8.8.8.in-addr.arpa');
    expect(calls[0].url).toContain('type=PTR');
  });

  it('rejects an invalid address without calling the network', async () => {
    const { impl, calls } = stubFetch({});
    const result = await withFetch(impl, () =>
      createDohCapability().reverse('not-an-ip', { endpoint: CLOUDFLARE }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT');
    expect(calls).toHaveLength(0);
  });
});
