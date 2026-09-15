import { unwrap } from '../result/result';
import { parseV4 } from '../ip/ip';
import { v4CidrOf, type Ipv4Cidr } from '../ip/cidr';
import {
  DEFAULT_MAX_HOSTS,
  compareIpStrings,
  mergeLanHits,
  planSweep,
  summarizeSweep,
  type LanHit,
} from './lan';
import { runSweep } from './sweep';

const cidr = (int: bigint, prefix: number): Ipv4Cidr => v4CidrOf(int, prefix);

/** 10.0.0.0 as an integer, for readable fixtures. */
const base = (dotted: string): bigint => unwrap(parseV4(dotted)).int;

const hit = (ip: string, overrides: Partial<LanHit> = {}): LanHit => ({
  ip,
  sources: ['tcp'],
  hostname: null,
  openPorts: [],
  latencyMs: null,
  ...overrides,
});

describe('planSweep', () => {
  it('enumerates a /24 without network or broadcast', () => {
    const plan = unwrap(planSweep(cidr(base('192.168.1.0'), 24)));
    expect(plan.total).toBe(254);
    expect(plan.truncated).toBe(false);
    expect(plan.hosts).toHaveLength(254);
    expect(plan.hosts[0]).toBe('192.168.1.1');
    expect(plan.hosts[253]).toBe('192.168.1.254');
    expect(plan.cidr).toBe('192.168.1.0/24');
  });

  it('treats /31 and /32 as fully usable (RFC 3021)', () => {
    const thirtyOne = unwrap(planSweep(cidr(base('10.0.0.0'), 31)));
    expect(thirtyOne.hosts).toEqual(['10.0.0.0', '10.0.0.1']);

    const thirtyTwo = unwrap(planSweep(cidr(base('10.0.0.7'), 32)));
    expect(thirtyTwo.hosts).toEqual(['10.0.0.7']);
    expect(thirtyTwo.total).toBe(1);
  });

  it('caps a huge block and says so rather than sweeping it', () => {
    const plan = unwrap(planSweep(cidr(base('10.0.0.0'), 8)));
    expect(plan.total).toBe(16777214);
    expect(plan.truncated).toBe(true);
    expect(plan.hosts).toHaveLength(DEFAULT_MAX_HOSTS);
    expect(plan.hosts[0]).toBe('10.0.0.1');
    expect(plan.hosts[plan.hosts.length - 1]).toBe('10.0.4.0');
  });

  it('honours an explicit cap and rejects a nonsense one', () => {
    const plan = unwrap(planSweep(cidr(base('192.168.1.0'), 24), { maxHosts: 10 }));
    expect(plan.hosts).toHaveLength(10);
    expect(plan.truncated).toBe(true);

    expect(planSweep(cidr(base('192.168.1.0'), 24), { maxHosts: 0 }).ok).toBe(false);
    expect(planSweep(cidr(base('192.168.1.0'), 24), { maxHosts: 2.5 }).ok).toBe(false);
  });
});

describe('compareIpStrings', () => {
  it('orders numerically, not lexically', () => {
    const sorted = ['10.0.0.10', '10.0.0.9', '10.0.0.100'].sort(compareIpStrings);
    expect(sorted).toEqual(['10.0.0.9', '10.0.0.10', '10.0.0.100']);
  });
});

describe('mergeLanHits', () => {
  it('merges sources for the same address and keeps the useful parts', () => {
    const merged = mergeLanHits(
      [hit('192.168.1.5', { openPorts: [80], latencyMs: 12 })],
      [hit('192.168.1.5', { sources: ['mdns'], hostname: 'printer.lan', latencyMs: 4 })],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      ip: '192.168.1.5',
      sources: ['tcp', 'mdns'],
      hostname: 'printer.lan',
      openPorts: [80],
      latencyMs: 4, // the lowest latency wins
    });
  });

  it('unions a port found by two sources and de-duplicates', () => {
    const merged = mergeLanHits(
      [hit('10.0.0.2', { openPorts: [22, 443] })],
      [hit('10.0.0.2', { sources: ['mdns'], openPorts: [443, 8080] })],
    );
    expect(merged[0].openPorts).toEqual([22, 443, 8080]);
  });

  it('sorts by address and keeps distinct addresses apart', () => {
    const merged = mergeLanHits([hit('10.0.0.10')], [hit('10.0.0.9')], [hit('10.0.0.100')]);
    expect(merged.map((h) => h.ip)).toEqual(['10.0.0.9', '10.0.0.10', '10.0.0.100']);
  });

  it('normalizes source and port order on the first sighting too', () => {
    const merged = mergeLanHits([
      hit('10.0.0.5', { sources: ['mdns', 'tcp'], openPorts: [443, 22] }),
    ]);
    expect(merged[0].sources).toEqual(['tcp', 'mdns']);
    expect(merged[0].openPorts).toEqual([22, 443]);
  });

  it('handles empty input', () => {
    expect(mergeLanHits([], [])).toEqual([]);
  });
});

describe('summarizeSweep', () => {
  it('describes counts per source', () => {
    expect(summarizeSweep([])).toBe('no hosts found');
    expect(summarizeSweep([hit('10.0.0.1')])).toBe('1 host (tcp 1)');
    expect(
      summarizeSweep([
        hit('10.0.0.1'),
        hit('10.0.0.2', { sources: ['tcp', 'mdns'] }),
        hit('10.0.0.3', { sources: ['mdns'] }),
      ]),
    ).toBe('3 hosts (tcp 2, mdns 2)');
  });
});

describe('runSweep', () => {
  const hosts = ['10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4'];

  it('returns only the addresses that answered', async () => {
    const probe = async (ip: string) => (ip.endsWith('.2') ? hit(ip) : null);
    const result = await runSweep(hosts, probe);

    expect(result.hits.map((h) => h.ip)).toEqual(['10.0.0.2']);
    expect(result.probed).toBe(4);
    expect(result.stopped).toBe('complete');
  });

  it('treats a failing probe as "not a host" instead of throwing', async () => {
    const probe = async (ip: string) => {
      if (ip.endsWith('.1')) throw new Error('socket exploded');
      return ip.endsWith('.3') ? hit(ip) : null;
    };
    const result = await runSweep(hosts, probe);
    expect(result.hits.map((h) => h.ip)).toEqual(['10.0.0.3']);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const probe = async (ip: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return ip.endsWith('.1') ? hit(ip) : null;
    };

    await runSweep(
      Array.from({ length: 40 }, (_, i) => `10.0.0.${i + 1}`),
      probe,
      {
        concurrency: 4,
      },
    );
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('stops mid-sweep when aborted, keeping what it found', async () => {
    const controller = new AbortController();
    let seen = 0;
    const probe = async (ip: string) => {
      seen += 1;
      if (seen === 2) controller.abort();
      return hit(ip);
    };

    const result = await runSweep(
      Array.from({ length: 50 }, (_, i) => `10.0.0.${i + 1}`),
      probe,
      { concurrency: 1, signal: controller.signal },
    );

    expect(result.stopped).toBe('cancelled');
    expect(result.probed).toBeLessThan(50);
    expect(result.hits.length).toBe(result.probed);
  });

  it('throttles progress but always reports a final state', async () => {
    const progress: number[] = [];
    await runSweep(
      Array.from({ length: 20 }, (_, i) => `10.0.0.${i + 1}`),
      async () => null,
      {
        concurrency: 4,
        progressIntervalMs: 60_000, // force throttling
        onProgress: (p) => progress.push(p.done),
      },
    );

    // First (forced) report, then the final one — nothing in between.
    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(20);
    expect(progress.length).toBeLessThanOrEqual(3);
  });

  it('stops when the time budget runs out and says so', async () => {
    const probe = async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return null;
    };
    const result = await runSweep(
      Array.from({ length: 200 }, (_, i) => `10.0.0.${i + 1}`),
      probe,
      { concurrency: 1, budgetMs: 20 },
    );

    expect(result.stopped).toBe('budget');
    expect(result.probed).toBeLessThan(200);
    expect(result.probed).toBeGreaterThan(0);
  });

  it('reports completion when the budget is not reached', async () => {
    const result = await runSweep(hosts, async () => null, { budgetMs: 60_000 });
    expect(result.stopped).toBe('complete');
    expect(result.probed).toBe(4);
  });

  it('prefers "cancelled" over "budget" when both apply', async () => {
    const controller = new AbortController();
    const result = await runSweep(
      hosts,
      async (ip) => {
        controller.abort();
        return hit(ip);
      },
      { concurrency: 1, budgetMs: 1, signal: controller.signal },
    );
    expect(result.stopped).toBe('cancelled');
  });

  it('handles an empty host list', async () => {
    const result = await runSweep([], async () => null);
    expect(result).toEqual({ hits: [], stopped: 'complete', probed: 0 });
  });
});
