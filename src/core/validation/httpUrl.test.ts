import { parseHttpUrl, resolveLocation } from './httpUrl';

describe('parseHttpUrl', () => {
  it('parses a full https URL with default port', () => {
    const result = parseHttpUrl('https://example.com/some/path?q=1');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.scheme).toBe('https');
    expect(result.value.host).toBe('example.com');
    expect(result.value.port).toBe(443);
    expect(result.value.hostHeader).toBe('example.com');
    expect(result.value.pathAndQuery).toBe('/some/path?q=1');
    expect(result.value.url).toBe('https://example.com/some/path?q=1');
  });

  it('parses http URLs with explicit ports, keeping the port in the Host header', () => {
    const result = parseHttpUrl('http://10.0.2.2:9701/');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.scheme).toBe('http');
    expect(result.value.port).toBe(9701);
    expect(result.value.hostHeader).toBe('10.0.2.2:9701');
    expect(result.value.pathAndQuery).toBe('/');
  });

  it('assumes https for bare host input (safe default)', () => {
    const result = parseHttpUrl('example.com');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.scheme).toBe('https');
    expect(result.value.pathAndQuery).toBe('/');
  });

  it('normalizes an empty path to /', () => {
    const result = parseHttpUrl('https://example.com');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.pathAndQuery).toBe('/');
  });

  it('rejects non-http schemes', () => {
    for (const url of ['ftp://example.com', 'file:///etc/passwd', 'ws://example.com']) {
      const result = parseHttpUrl(url);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT');
    }
  });

  it('rejects embedded credentials', () => {
    const result = parseHttpUrl('https://user:pass@example.com/');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT');
  });

  it('rejects empty and overlong input', () => {
    expect(parseHttpUrl('').ok).toBe(false);
    expect(parseHttpUrl('   ').ok).toBe(false);
    const long = `https://example.com/${'a'.repeat(2100)}`;
    const result = parseHttpUrl(long);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT');
  });

  it('rejects invalid explicit ports', () => {
    for (const url of ['http://example.com:0/', 'http://example.com:99999/']) {
      const result = parseHttpUrl(url);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT');
    }
  });

  it('does not "repair" a malformed scheme-ful URL by re-reading it as a bare host', () => {
    // Regression: the bare-host fallback used to re-parse "http://h:99999"
    // as host "http" + path "//h:99999" — a lie, not a repair.
    for (const url of ['http://example.com:99999/', 'https://[bad', 'http://']) {
      const result = parseHttpUrl(url);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT');
    }
  });

  it('lowercases the host and keeps the URL canonical', () => {
    const result = parseHttpUrl('https://EXAMPLE.com:443/x');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.host).toBe('example.com');
    // Explicit 443 on https is the default → normalized away.
    expect(result.value.url).toBe('https://example.com/x');
  });
});

describe('resolveLocation', () => {
  it('resolves relative redirect targets against the current hop', () => {
    expect(resolveLocation('https://a.com/dir/page', '/login')).toBe('https://a.com/login');
    expect(resolveLocation('https://a.com/dir/page', 'other')).toBe('https://a.com/dir/other');
  });

  it('passes absolute targets through', () => {
    expect(resolveLocation('https://a.com/', 'https://b.com/x')).toBe('https://b.com/x');
  });

  it('keeps scheme upgrades (http→https) as-is', () => {
    expect(resolveLocation('http://a.com/', 'https://a.com/secure')).toBe('https://a.com/secure');
  });
});
