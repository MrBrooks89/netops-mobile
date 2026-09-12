import { describeTypes, parseDohResponse, summarizeAnswers, unquoteTxt } from './parse';
import { DNS_RCODE, DOH_PROVIDERS } from './types';
import { reverseNameFor } from './reverse';

describe('parseDohResponse', () => {
  it('parses a Cloudflare/Google A response', () => {
    const result = parseDohResponse({
      Status: DNS_RCODE.NOERROR,
      Answer: [{ name: 'example.com.', type: 1, TTL: 300, data: '93.184.216.34' }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([
        { name: 'example.com', type: 'A', value: '93.184.216.34', ttl: 300 },
      ]);
    }
  });

  it('parses AAAA, CNAME, NS and PTR records', () => {
    const result = parseDohResponse({
      Status: 0,
      Answer: [
        { name: 'example.com.', type: 28, TTL: 60, data: '2606:2800:220:1:248:1893:25c8:1946' },
        { name: 'www.example.com.', type: 5, TTL: 60, data: 'example.com.' },
        { name: 'example.com.', type: 2, TTL: 172800, data: 'a.iana-servers.net.' },
        { name: '8.8.8.8.in-addr.arpa.', type: 12, TTL: 60, data: 'dns.google.' },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((a) => a.type)).toEqual(['AAAA', 'CNAME', 'NS', 'PTR']);
      expect(result.value[1].value).toBe('example.com');
      expect(result.value[3].value).toBe('dns.google');
    }
  });

  it('splits MX into preference and exchange', () => {
    const result = parseDohResponse({
      Status: 0,
      Answer: [{ name: 'example.com.', type: 15, TTL: 300, data: '10 mail.example.com.' }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]).toEqual({
        name: 'example.com',
        type: 'MX',
        value: 'mail.example.com',
        ttl: 300,
        priority: 10,
      });
    }
  });

  it('unquotes and concatenates TXT chunks', () => {
    expect(unquoteTxt('"v=spf1 include:_spf.example.com ~all"')).toBe(
      'v=spf1 include:_spf.example.com ~all',
    );
    expect(unquoteTxt('"part one " "part two"')).toBe('part one part two');
    expect(unquoteTxt('"say \\"hi\\""')).toBe('say "hi"');

    const result = parseDohResponse({
      Status: 0,
      Answer: [{ name: 'example.com.', type: 16, TTL: 300, data: '"v=spf1 -all"' }],
    });
    if (result.ok) expect(result.value[0].value).toBe('v=spf1 -all');
  });

  it('maps NXDOMAIN to NOT_FOUND and other rcodes to DNS_FAILURE', () => {
    const nx = parseDohResponse({ Status: DNS_RCODE.NXDOMAIN });
    expect(nx.ok).toBe(false);
    if (!nx.ok) expect(nx.error.code).toBe('NOT_FOUND');

    for (const rcode of [DNS_RCODE.SERVFAIL, DNS_RCODE.REFUSED, DNS_RCODE.FORMERR]) {
      const failed = parseDohResponse({ Status: rcode });
      expect(failed.ok).toBe(false);
      if (!failed.ok) expect(failed.error.code).toBe('DNS_FAILURE');
    }
  });

  it('treats a name with no records of the requested type as an empty success', () => {
    const result = parseDohResponse({ Status: 0, Answer: [] });
    expect(result).toEqual({ ok: true, value: [] });
    const missing = parseDohResponse({ Status: 0 });
    expect(missing).toEqual({ ok: true, value: [] });
  });

  it('drops unsupported record types instead of mislabelling them', () => {
    const result = parseDohResponse({
      Status: 0,
      Answer: [
        {
          name: 'example.com.',
          type: 6,
          TTL: 300,
          data: 'ns.icann.org. noc.dns.icann.org. 1 2 3 4 5',
        },
        { name: 'example.com.', type: 257, TTL: 300, data: '0 issue "ca.example.net"' },
        { name: 'example.com.', type: 1, TTL: 300, data: '93.184.216.34' },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('rejects malformed payloads', () => {
    for (const bad of [null, undefined, 'nope', 42]) {
      const result = parseDohResponse(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('DNS_FAILURE');
    }
  });
});

describe('summarizeAnswers', () => {
  const answer = (value: string) => ({ name: 'x', type: 'A' as const, value, ttl: null });

  it('summarises values and elides the tail', () => {
    expect(summarizeAnswers([])).toBe('no records');
    expect(summarizeAnswers([answer('1.1.1.1')])).toBe('1.1.1.1');
    expect(summarizeAnswers([answer('1.1.1.1'), answer('2.2.2.2')])).toBe('1.1.1.1, 2.2.2.2');
    expect(
      summarizeAnswers([
        answer('1.1.1.1'),
        answer('2.2.2.2'),
        answer('3.3.3.3'),
        answer('4.4.4.4'),
      ]),
    ).toBe('1.1.1.1, 2.2.2.2 +2 more');
  });
});

describe('describeTypes', () => {
  it('joins type names', () => {
    expect(describeTypes(['A', 'AAAA'])).toBe('A/AAAA');
  });
});

describe('DOH_PROVIDERS', () => {
  it('exposes the two built-in endpoints', () => {
    expect(DOH_PROVIDERS.cloudflare.endpoint).toContain('cloudflare-dns.com');
    expect(DOH_PROVIDERS.google.endpoint).toContain('dns.google');
  });
});

describe('reverseNameFor', () => {
  it('builds IPv4 in-addr.arpa names', () => {
    const result = reverseNameFor('192.0.2.5');
    expect(result).toEqual({ ok: true, value: '5.2.0.192.in-addr.arpa' });
  });

  it('builds IPv6 ip6.arpa names from compressed input', () => {
    const result = reverseNameFor('2001:db8::1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const labels = result.value.split('.');
      expect(labels).toHaveLength(34); // 32 nibbles + "ip6" + "arpa"
      expect(labels[0]).toBe('1'); // least significant nibble first
      expect(labels[32]).toBe('ip6');
      expect(labels[33]).toBe('arpa');
      expect(labels.slice(1, 5).join('')).toBe('0000');
    }
  });

  it('agrees between compressed and expanded IPv6 forms', () => {
    const compressed = reverseNameFor('2001:db8::1');
    const expanded = reverseNameFor('2001:0db8:0000:0000:0000:0000:0000:0001');
    expect(compressed).toEqual(expanded);
  });

  it('rejects non-addresses', () => {
    for (const bad of ['example.com', '', '999.1.1.1', '2001:db8::zz']) {
      const result = reverseNameFor(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT');
    }
  });
});
