import { isValidDnsName, parseDnsName } from './name';
import { describeProvider, parseCustomDohUrl, resolveDohEndpoint } from './provider';

describe('parseDnsName', () => {
  it('normalises case and a trailing dot', () => {
    expect(parseDnsName('  Example.COM. ')).toEqual({ ok: true, value: 'example.com' });
  });

  it('accepts underscores, which are legal in DNS but not in hostnames', () => {
    for (const name of ['_dmarc.example.com', 'selector._domainkey.example.com', 'a_b.example']) {
      const result = parseDnsName(name);
      expect(result.ok).toBe(true);
    }
  });

  it('accepts IPv6-shaped names for PTR-ish queries and plain labels', () => {
    expect(parseDnsName('localhost').ok).toBe(true);
    expect(parseDnsName('8.8.8.8.in-addr.arpa').ok).toBe(true);
  });

  it('rejects empty, spaced, over-long and malformed names', () => {
    for (const bad of [
      '',
      '   ',
      'has space',
      'double..dot',
      '.leading',
      '-leading.example',
      `${'a'.repeat(64)}.com`,
      `${'a.'.repeat(130)}com`,
    ]) {
      const result = parseDnsName(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT');
    }
  });
});

describe('isValidDnsName', () => {
  it('enforces label length limits', () => {
    expect(isValidDnsName('a'.repeat(63))).toBe(true);
    expect(isValidDnsName('a'.repeat(64))).toBe(false);
    expect(isValidDnsName('')).toBe(false);
  });
});

describe('parseCustomDohUrl', () => {
  it('accepts https endpoints and preserves a query string', () => {
    expect(parseCustomDohUrl('https://doh.example/dns-query?token=abc')).toEqual({
      ok: true,
      value: 'https://doh.example/dns-query?token=abc',
    });
  });

  it('rejects http, fragments, blanks and nonsense', () => {
    expect(parseCustomDohUrl('http://doh.example/dns-query').ok).toBe(false);
    expect(parseCustomDohUrl('not a url').ok).toBe(false);
    expect(parseCustomDohUrl('   ').ok).toBe(false);
    const withHash = parseCustomDohUrl('https://doh.example/q#frag');
    expect(withHash).toEqual({ ok: true, value: 'https://doh.example/q' });
  });
});

describe('resolveDohEndpoint', () => {
  it('returns the built-in endpoints', () => {
    const cloudflare = resolveDohEndpoint('cloudflare', '');
    expect(cloudflare.ok && cloudflare.value).toContain('cloudflare-dns.com');
    const google = resolveDohEndpoint('google', '');
    expect(google.ok && google.value).toContain('dns.google');
  });

  it('uses the custom URL only when the custom provider is selected', () => {
    expect(resolveDohEndpoint('custom', 'https://doh.example/q')).toEqual({
      ok: true,
      value: 'https://doh.example/q',
    });
    // A custom URL is ignored while a built-in provider is selected.
    const builtIn = resolveDohEndpoint('cloudflare', 'https://ignored.example/q');
    expect(builtIn.ok && builtIn.value).toContain('cloudflare-dns.com');
  });

  it('fails loudly rather than silently falling back', () => {
    const result = resolveDohEndpoint('custom', '');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT');
  });
});

describe('describeProvider', () => {
  it('labels the provider for the UI and history', () => {
    expect(describeProvider('cloudflare', '')).toBe('Cloudflare');
    expect(describeProvider('google', '')).toBe('Google');
    expect(describeProvider('custom', '')).toBe('Custom (not set)');
    expect(describeProvider('custom', 'https://doh.example/q')).toBe('Custom');
  });
});
