import { parseV4 } from '../ip/ip';
import { unwrap } from '../result/result';
import { cidrToString, v4CidrOf, type Ipv4Cidr } from '../ip/cidr';
import { broadcastIntV4, networkIntV4, usableHostCount } from '../subnet/subnet';
import { MAX_VLSM_REQUESTS, allocateVlsm, type VlsmRequest } from './vlsm';

const cidr = (addr: string, prefix: number): Ipv4Cidr => ({
  address: unwrap(parseV4(addr)),
  prefixLength: prefix,
});

const req = (requiredHosts: number, name?: string): VlsmRequest => ({ requiredHosts, name });

describe('allocateVlsm — textbook /24 example', () => {
  const base = cidr('192.168.1.0', 24);
  const requests = [req(100, 'Sales'), req(50, 'Engineering'), req(20, 'VoIP'), req(10, 'Mgmt')];

  it('allocates largest-first with correct ranges and prefixes', () => {
    const r = unwrap(allocateVlsm(base, requests));
    expect(r.fits).toBe(true);
    expect(r.failures).toEqual([]);
    expect(r.allocations.map((a) => cidrToString(a.cidr))).toEqual([
      '192.168.1.0/25',
      '192.168.1.128/26',
      '192.168.1.192/27',
      '192.168.1.224/28',
    ]);
    expect(r.allocations.map((a) => a.name)).toEqual(['Sales', 'Engineering', 'VoIP', 'Mgmt']);
    expect(r.allocations.map((a) => a.usable)).toEqual([126, 62, 30, 14]);
    expect(r.allocations.map((a) => a.waste)).toEqual([26, 12, 10, 4]);
    expect(r.allocations[0].hostRange).toBe('192.168.1.1 - 192.168.1.126');
    expect(r.allocations[0].network).toBe('192.168.1.0');
    expect(r.allocations[0].firstHost).toBe('192.168.1.1');
    expect(r.allocations[0].lastHost).toBe('192.168.1.126');
  });

  it('reports leftover space coalesced into one block', () => {
    const r = unwrap(allocateVlsm(base, requests));
    expect(r.unallocatedSpace.map(cidrToString)).toEqual(['192.168.1.240/28']);
    expect(r.unallocatedAddresses).toBe(16);
  });

  it('totals requested hosts, usable addresses and waste', () => {
    const r = unwrap(allocateVlsm(base, requests));
    expect(r.totalRequestedHosts).toBe(180);
    expect(r.totalAllocatedUsable).toBe(232);
    expect(r.totalWaste).toBe(52);
  });

  it('sorts largest-first regardless of input order', () => {
    const shuffled = [req(10, 'Mgmt'), req(100, 'Sales'), req(20, 'VoIP'), req(50, 'Eng')];
    const r = unwrap(allocateVlsm(base, shuffled));
    expect(r.allocations.map((a) => a.requiredHosts)).toEqual([100, 50, 20, 10]);
    expect(r.allocations.map((a) => cidrToString(a.cidr))).toEqual([
      '192.168.1.0/25',
      '192.168.1.128/26',
      '192.168.1.192/27',
      '192.168.1.224/28',
    ]);
  });

  it('is stable for equal-size requests', () => {
    const r = unwrap(allocateVlsm(base, [req(40, 'first'), req(40, 'second')]));
    expect(r.allocations.map((a) => a.name)).toEqual(['first', 'second']);
    expect(r.allocations.map((a) => cidrToString(a.cidr))).toEqual([
      '192.168.1.0/26',
      '192.168.1.64/26',
    ]);
  });
});

describe('allocateVlsm — leftover space coalescing', () => {
  it('reports the untouched half as a single block', () => {
    const r = unwrap(allocateVlsm(cidr('10.0.0.0', 24), [req(64)]));
    expect(r.unallocatedSpace.map(cidrToString)).toEqual(['10.0.0.128/25']);
    expect(r.unallocatedAddresses).toBe(128);
  });

  it('reports multiple free blocks in ascending order', () => {
    const r = unwrap(allocateVlsm(cidr('10.0.0.0', 24), [req(60), req(3)]));
    expect(r.allocations.map((a) => cidrToString(a.cidr))).toEqual(['10.0.0.0/26', '10.0.0.64/29']);
    // free: 10.0.0.72/29, 10.0.0.80/28, 10.0.0.96/27, 10.0.0.128/25
    expect(r.unallocatedSpace.map(cidrToString)).toEqual([
      '10.0.0.72/29',
      '10.0.0.80/28',
      '10.0.0.96/27',
      '10.0.0.128/25',
    ]);
    expect(r.unallocatedAddresses).toBe(184);
    expect(r.totalWaste).toBe(5);
  });

  it('leaves the last block when the base is not exactly consumed', () => {
    const r = unwrap(allocateVlsm(cidr('10.0.0.0', 24), [req(120), req(60), req(30), req(10)]));
    expect(r.fits).toBe(true);
    // 128 + 64 + 32 + 16 = 240 addresses placed → 10.0.0.240/28 remains
    expect(r.unallocatedSpace.map(cidrToString)).toEqual(['10.0.0.240/28']);
    expect(r.unallocatedAddresses).toBe(16);
  });

  it('leaves nothing unallocated when the base is exactly consumed', () => {
    // /25 + /26 + /27 + /27 = 128 + 64 + 32 + 32 = 256 exactly
    const r = unwrap(allocateVlsm(cidr('10.0.0.0', 24), [req(120), req(60), req(30), req(30)]));
    expect(r.fits).toBe(true);
    expect(r.allocations.map((a) => cidrToString(a.cidr))).toEqual([
      '10.0.0.0/25',
      '10.0.0.128/26',
      '10.0.0.192/27',
      '10.0.0.224/27',
    ]);
    expect(r.unallocatedSpace).toEqual([]);
    expect(r.unallocatedAddresses).toBe(0);
  });
});

describe('allocateVlsm — RFC 3021 point-to-point packing', () => {
  it('packs two 2-host links into a /30 as two /31s', () => {
    const r = unwrap(allocateVlsm(cidr('192.168.1.0', 30), [req(2, 'link-a'), req(2, 'link-b')]));
    expect(r.fits).toBe(true);
    expect(r.allocations.map((a) => cidrToString(a.cidr))).toEqual([
      '192.168.1.0/31',
      '192.168.1.2/31',
    ]);
    expect(r.allocations.every((a) => a.pointToPoint)).toBe(true);
    expect(r.allocations.every((a) => a.waste === 0)).toBe(true);
    expect(r.unallocatedSpace).toEqual([]);
  });

  it('uses a /32 for a single-host request', () => {
    const r = unwrap(allocateVlsm(cidr('10.0.0.0', 29), [req(1, 'loopback-like')]));
    expect(r.allocations[0].cidr.prefixLength).toBe(32);
    expect(r.allocations[0].hostRange).toBe('10.0.0.0');
    expect(r.allocations[0].usable).toBe(1);
    expect(r.allocations[0].waste).toBe(0);
  });
});

describe('allocateVlsm — does not fit', () => {
  it('reports fits:false with a reason when the base is too small', () => {
    const r = unwrap(allocateVlsm(cidr('192.168.1.0', 24), [req(200, 'big'), req(100, 'small')]));
    expect(r.fits).toBe(false);
    expect(r.allocations.map((a) => cidrToString(a.cidr))).toEqual(['192.168.1.0/24']);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].name).toBe('small');
    expect(r.failures[0].requiredHosts).toBe(100);
    expect(r.failures[0].reason).toContain('/25');
    // Nothing is left over once the whole base is consumed
    expect(r.unallocatedSpace).toEqual([]);
    expect(r.unallocatedAddresses).toBe(0);
  });

  it('still reports the allocations that did fit', () => {
    // /26 holds 62 usable: the first 60-host request consumes it entirely.
    const r = unwrap(allocateVlsm(cidr('10.0.0.0', 26), [req(60, 'a'), req(30, 'b')]));
    expect(r.fits).toBe(false);
    expect(r.allocations.map((a) => cidrToString(a.cidr))).toEqual(['10.0.0.0/26']);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].name).toBe('b');
    expect(r.totalRequestedHosts).toBe(90);
    expect(r.totalAllocatedUsable).toBe(62);
  });
});

describe('allocateVlsm — validation', () => {
  const base = cidr('192.168.1.0', 24);

  it('rejects an empty request list', () => {
    const r = allocateVlsm(base, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_INPUT');
  });

  it('rejects non-positive and fractional host counts', () => {
    expect(allocateVlsm(base, [req(0)]).ok).toBe(false);
    expect(allocateVlsm(base, [req(-5)]).ok).toBe(false);
    expect(allocateVlsm(base, [req(10.5)]).ok).toBe(false);
  });

  it('rejects a requirement larger than the base capacity', () => {
    const r = allocateVlsm(base, [req(300, 'too-big')]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('INVALID_INPUT');
      expect(r.error.message).toContain('254');
    }
  });

  it('rejects more requests than the guardrail allows', () => {
    const many = Array.from({ length: MAX_VLSM_REQUESTS + 1 }, () => req(1));
    const r = allocateVlsm(cidr('10.0.0.0', 16), many);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain(String(MAX_VLSM_REQUESTS));
  });

  it('handles a /0 base', () => {
    const r = unwrap(allocateVlsm(cidr('0.0.0.0', 0), [req(1000)]));
    expect(r.fits).toBe(true);
    expect(cidrToString(r.allocations[0].cidr)).toBe('0.0.0.0/22');
  });
});

describe('allocateVlsm — allocation invariants (property test)', () => {
  /** Deterministic PRNG so a failure is reproducible. */
  const rng = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  const overlap = (a: { start: bigint; end: bigint }, b: { start: bigint; end: bigint }) =>
    a.start <= b.end && b.start <= a.end;

  it('holds for 400 randomised base/request combinations', () => {
    const rand = rng(20260911);
    const V4 = 4294967295n;

    for (let iter = 0; iter < 400; iter++) {
      const prefix = 16 + Math.floor(rand() * 13); // /16 … /28
      const raw = BigInt(Math.floor(rand() * 0xffffffff));
      const mask = (V4 << BigInt(32 - prefix)) & V4;
      const base = v4CidrOf(raw & mask, prefix);

      const requestCount = 1 + Math.floor(rand() * 8);
      const requests: VlsmRequest[] = [];
      for (let i = 0; i < requestCount; i++) {
        const capacity = usableHostCount(prefix);
        requests.push({ name: `s${i}`, requiredHosts: 1 + Math.floor(rand() * capacity) });
      }

      const report = allocateVlsm(base, requests);
      if (!report.ok) continue; // oversized requests are rejected, not reported

      const r = report.value;
      expect(r.allocations.length + r.failures.length).toBe(requestCount);

      const spans = r.allocations.map((a) => ({
        start: networkIntV4(a.cidr.address.int, a.cidr.prefixLength),
        end: broadcastIntV4(a.cidr.address.int, a.cidr.prefixLength),
      }));

      // 1. allocations never overlap
      for (let i = 0; i < spans.length; i++) {
        for (let j = i + 1; j < spans.length; j++) {
          expect(overlap(spans[i], spans[j])).toBe(false);
        }
      }

      // 2. everything stays inside the base, and each allocation fits its request
      const baseSpan = {
        start: networkIntV4(base.address.int, base.prefixLength),
        end: broadcastIntV4(base.address.int, base.prefixLength),
      };
      for (const a of r.allocations) {
        const span = {
          start: networkIntV4(a.cidr.address.int, a.cidr.prefixLength),
          end: broadcastIntV4(a.cidr.address.int, a.cidr.prefixLength),
        };
        expect(span.start >= baseSpan.start).toBe(true);
        expect(span.end <= baseSpan.end).toBe(true);
        expect(a.usable).toBeGreaterThanOrEqual(a.requiredHosts);
        expect(a.waste).toBe(a.usable - a.requiredHosts);
      }

      // 3. allocated + unallocated accounts for the whole base
      const allocatedAddresses = r.allocations.reduce(
        (sum, a) => sum + 2 ** (32 - a.cidr.prefixLength),
        0,
      );
      expect(allocatedAddresses + r.unallocatedAddresses).toBe(2 ** (32 - prefix));

      // 4. unallocated space is merge-minimal: no two same-size buddies remain
      for (let i = 0; i < r.unallocatedSpace.length; i++) {
        for (let j = i + 1; j < r.unallocatedSpace.length; j++) {
          const a = r.unallocatedSpace[i];
          const b = r.unallocatedSpace[j];
          if (a.prefixLength !== b.prefixLength) continue;
          const size = 1n << BigInt(32 - a.prefixLength);
          const aNet = networkIntV4(a.address.int, a.prefixLength);
          const bNet = networkIntV4(b.address.int, b.prefixLength);
          const lo = aNet < bNet ? aNet : bNet;
          const hi = aNet < bNet ? bNet : aNet;
          const mergeable = hi === lo + size && lo % (size * 2n) === 0n;
          expect(mergeable).toBe(false);
        }
      }

      // 5. allocations are in descending requirement order (greedy)
      for (let i = 1; i < r.allocations.length; i++) {
        expect(r.allocations[i - 1].requiredHosts).toBeGreaterThanOrEqual(
          r.allocations[i].requiredHosts,
        );
      }
    }
  });
});
