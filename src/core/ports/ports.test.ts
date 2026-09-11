import { PORTS } from './dataset';
import { portStats, searchPorts } from './ports';

describe('port dataset integrity', () => {
  it('has a useful number of entries', () => {
    expect(PORTS.length).toBeGreaterThanOrEqual(250);
  });

  it('has no duplicate (port, protocol) pairs', () => {
    const seen = new Set<string>();
    for (const e of PORTS) {
      const key = `${e.port}/${e.proto}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('uses valid port numbers and non-empty text', () => {
    for (const e of PORTS) {
      expect(Number.isInteger(e.port)).toBe(true);
      expect(e.port).toBeGreaterThanOrEqual(1);
      expect(e.port).toBeLessThanOrEqual(65535);
      expect(['tcp', 'udp', 'sctp']).toContain(e.proto);
      expect(e.service.trim().length).toBeGreaterThan(0);
      expect(e.description.trim().length).toBeGreaterThan(0);
    }
  });

  it('is sorted by port then protocol', () => {
    for (let i = 1; i < PORTS.length; i++) {
      const prev = PORTS[i - 1];
      const cur = PORTS[i];
      expect(prev.port < cur.port || (prev.port === cur.port && prev.proto <= cur.proto)).toBe(
        true,
      );
    }
  });

  it('covers the most commonly needed service ports', () => {
    const ports = new Set(PORTS.map((e) => e.port));
    for (const p of [
      20, 21, 22, 23, 25, 53, 67, 80, 110, 123, 143, 161, 389, 443, 445, 514, 587, 636, 993, 995,
      1433, 1521, 3306, 3389, 5432, 5900, 6379, 8080, 27017,
    ]) {
      expect(ports.has(p)).toBe(true);
    }
  });
});

describe('searchPorts — by port number', () => {
  it('ranks an exact port match first', () => {
    const results = searchPorts('443');
    expect(results[0].port).toBe(443);
    expect(results[0].service).toBe('https');
  });

  it('finds both protocols for a port registered on TCP and UDP', () => {
    const results = searchPorts('53');
    const protos = results.filter((r) => r.port === 53).map((r) => r.proto);
    expect(protos).toEqual(expect.arrayContaining(['tcp', 'udp']));
  });

  it('treats a numeric prefix as a port-range search', () => {
    const results = searchPorts('80');
    const ports = results.map((r) => r.port);
    expect(ports).toContain(80);
    expect(ports).toContain(8000);
    expect(ports).toContain(8080);
    // exact match still outranks prefix matches
    expect(results[0].port).toBe(80);
  });

  it('returns nothing for an unknown port', () => {
    expect(searchPorts('64999')).toEqual([]);
  });
});

describe('searchPorts — by service name', () => {
  it('finds ssh', () => {
    expect(searchPorts('ssh')[0]).toMatchObject({ port: 22, proto: 'tcp', service: 'ssh' });
  });

  it('finds a service by prefix', () => {
    const results = searchPorts('ms-sql');
    expect(results.map((r) => r.port)).toEqual(expect.arrayContaining([1433, 1434]));
  });

  it('finds services by description text (DNS)', () => {
    const results = searchPorts('dns');
    const ports = results.map((r) => r.port);
    expect(ports).toContain(53);
    expect(ports).toContain(5353);
  });

  it('is case-insensitive', () => {
    expect(searchPorts('MYSQL')[0].port).toBe(3306);
    expect(searchPorts('Https')[0].port).toBe(443);
  });

  it('prefers service matches over description matches', () => {
    // "http" is a service name on 80/8000/8080 and appears in many descriptions
    const results = searchPorts('http');
    expect(results[0].service).toContain('http');
    expect(results[0].port).toBe(80);
  });
});

describe('searchPorts — by protocol', () => {
  it('filters by an explicit protocol option', () => {
    const udp = searchPorts('', { proto: 'udp' });
    expect(udp.length).toBeGreaterThan(0);
    expect(udp.every((e) => e.proto === 'udp')).toBe(true);
  });

  it('accepts a protocol token in the query', () => {
    const results = searchPorts('tcp ssh');
    expect(results[0]).toMatchObject({ port: 22, proto: 'tcp' });
  });

  it('returns nothing when the protocol token excludes the service', () => {
    // ssh is TCP-only in the dataset
    expect(searchPorts('udp ssh')).toEqual([]);
  });

  it('combines a protocol token with a numeric term', () => {
    const results = searchPorts('udp 53');
    expect(results[0]).toMatchObject({ port: 53, proto: 'udp' });
    // prefix matches (5351, 5353, 5355) are allowed after the exact hit
    expect(results.every((r) => r.proto === 'udp')).toBe(true);
  });

  it('supports the "all" pseudo-filter', () => {
    expect(searchPorts('', { proto: 'all' }).length).toBe(PORTS.length);
  });
});

describe('searchPorts — query handling', () => {
  it('returns the full list for an empty or whitespace query', () => {
    expect(searchPorts('')).toHaveLength(PORTS.length);
    expect(searchPorts('   ')).toHaveLength(PORTS.length);
  });

  it('requires every term to match (AND semantics)', () => {
    expect(searchPorts('radius 1812')).toHaveLength(2); // tcp + udp
    expect(searchPorts('radius 3306')).toEqual([]);
  });

  it('returns an empty list for gibberish', () => {
    expect(searchPorts('zzzznotaservice')).toEqual([]);
  });

  it('can search an injected dataset', () => {
    const entries = [
      { port: 1234, proto: 'tcp' as const, service: 'custom', description: 'test entry' },
    ];
    expect(searchPorts('custom', { entries })).toHaveLength(1);
    expect(searchPorts('', { entries })).toEqual(entries);
  });
});

describe('portStats', () => {
  it('counts totals per protocol', () => {
    const stats = portStats();
    expect(stats.total).toBe(PORTS.length);
    expect(stats.tcp + stats.udp).toBeLessThanOrEqual(stats.total);
    expect(stats.tcp).toBeGreaterThan(100);
    expect(stats.udp).toBeGreaterThan(20);
  });
});
