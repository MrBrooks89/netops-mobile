import { httpTotalMs, summarizeHop, type HttpExchange } from './http';

function exchange(overrides: Partial<HttpExchange> = {}): HttpExchange {
  return {
    secure: false,
    status: 200,
    reasonPhrase: 'OK',
    httpVersion: '1.1',
    headers: [],
    bodyByteLength: 0,
    bodyPreview: null,
    timings: { dnsMs: null, connectMs: 5, tlsMs: null, ttfbMs: 10, totalMs: 100 },
    ...overrides,
  };
}

describe('httpTotalMs', () => {
  it('sums per-hop totals — the honest end-to-end number', () => {
    const hops = [
      exchange({ timings: { dnsMs: null, connectMs: 5, tlsMs: null, ttfbMs: 10, totalMs: 100 } }),
      exchange({
        secure: true,
        status: 200,
        timings: { dnsMs: null, connectMs: 3, tlsMs: 40, ttfbMs: 12, totalMs: 150 },
      }),
    ];
    expect(httpTotalMs(hops)).toBe(250);
  });

  it('treats a null total as 0, never NaN', () => {
    const hops = [
      exchange({
        timings: { dnsMs: null, connectMs: null, tlsMs: null, ttfbMs: null, totalMs: null },
      }),
    ];
    expect(httpTotalMs(hops)).toBe(0);
  });
});

describe('summarizeHop', () => {
  it('renders a redirect hop as "status → location"', () => {
    expect(summarizeHop({ url: 'https://a.com', status: 301, location: '/login' })).toBe(
      '301 → /login',
    );
  });

  it('notes a 3xx without a Location header explicitly', () => {
    expect(summarizeHop({ url: 'https://a.com', status: 302, location: null })).toBe(
      '302 → (no location)',
    );
  });
});
