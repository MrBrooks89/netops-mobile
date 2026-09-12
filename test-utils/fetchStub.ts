/**
 * fetch double for tests that drive a real capability (DNS over HTTPS, and
 * later HTTP/TLS). Returns the responder's value as the JSON body and records
 * the URLs it was asked for. Test-only.
 */

export async function withFetchStub<T>(
  responder: (url: string) => unknown,
  run: () => Promise<T>,
): Promise<{ result: T; calls: string[] }> {
  const original = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => responder(String(url)),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  try {
    return { result: await run(), calls };
  } finally {
    globalThis.fetch = original;
  }
}

/** Standard Cloudflare/Google-shaped success body. */
export const dohAnswer = (type: number, data: string, name = 'example.com.') => ({
  Status: 0,
  Answer: [{ name, type, TTL: 300, data }],
});
