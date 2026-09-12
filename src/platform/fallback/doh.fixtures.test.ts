/**
 * Parsing of *real* resolver responses.
 *
 * The payloads in `__fixtures__/doh-responses.json` were captured from a public
 * DoH resolver with a plain Node fetch:
 *
 *   fetch('https://dns.adguard-dns.com/resolve?name=example.com&type=A',
 *         { headers: { accept: 'application/dns-json' } })
 *
 * They are checked in because a live request cannot be made from Jest here:
 * jest-expo installs a react-native `fetch` shim whose response is not a
 * spec-compliant Response, so `doh.test.ts` drives the logic with a stubbed
 * fetch and this file pins the wire format the parser has to survive — including
 * quirks like an MX with preference 0 and a root (".") exchange, and the
 * 8.8.8.8 PTR of the M3 acceptance criteria.
 */

import { parseDohResponse } from '../../core/dns/parse';
import fixtures from './__fixtures__/doh-responses.json';

const parse = (key: string) => {
  const payload = (fixtures as Record<string, unknown>)[key];
  expect(payload).toBeDefined();
  return parseDohResponse(payload);
};

describe('parsing captured resolver responses', () => {
  it('A records become dotted quads', () => {
    const result = parse('A example.com');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    for (const answer of result.value) {
      expect(answer.type).toBe('A');
      expect(answer.value).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
      expect(answer.ttl).toBeGreaterThan(0);
    }
  });

  it('AAAA records keep their canonical form', () => {
    const result = parse('AAAA example.com');
    if (!result.ok) throw new Error('expected success');
    expect(result.value[0].type).toBe('AAAA');
    expect(result.value[0].value).toMatch(/^[0-9a-f:]+$/);
  });

  it('NS records lose the presentation dot', () => {
    const result = parse('NS example.com');
    if (!result.ok) throw new Error('expected success');
    expect(result.value.map((a) => a.type)).toEqual(['NS', 'NS']);
    for (const answer of result.value) expect(answer.value.endsWith('.')).toBe(false);
  });

  it('a null MX (preference 0, root exchange) parses without inventing data', () => {
    const result = parse('MX example.com');
    if (!result.ok) throw new Error('expected success');
    expect(result.value[0]).toMatchObject({ type: 'MX', priority: 0, value: '' });
  });

  it('TXT arrives unquoted', () => {
    const result = parse('TXT example.com');
    if (!result.ok) throw new Error('expected success');
    expect(result.value[0].value).toBe('v=spf1 -all');
  });

  it('a name with no records of the requested type is an empty success', () => {
    const result = parse('CNAME www.example.com');
    expect(result).toEqual({ ok: true, value: [] });
  });

  it('reverse-resolves 8.8.8.8 to dns.google (M3 acceptance)', () => {
    const result = parse('PTR 8.8.8.8.in-addr.arpa');
    if (!result.ok) throw new Error('expected success');
    expect(result.value[0]).toMatchObject({ type: 'PTR', value: 'dns.google' });
  });
});
