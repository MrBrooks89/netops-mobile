import { parseV4 } from '../ip/ip';
import { unwrap } from '../result/result';
import { cidrToString, type Ipv4Cidr } from '../ip/cidr';
import { broadcastIntV4, networkIntV4, usableHostCount } from './subnet';
import {
  cidrContains,
  MAX_HOSTS,
  prefixForHosts,
  splitInto,
  subnetCount,
  subnetsForHosts,
  supernetOf,
} from './split';

const cidr = (addr: string, prefix: number): Ipv4Cidr => ({
  address: unwrap(parseV4(addr)),
  prefixLength: prefix,
});

const netInt = (c: Ipv4Cidr) => networkIntV4(c.address.int, c.prefixLength);
const bcastInt = (c: Ipv4Cidr) => broadcastIntV4(c.address.int, c.prefixLength);

describe('prefixForHosts', () => {
  it.each([
    [1, 32],
    [2, 31], // RFC 3021: 2 usable hosts
    [3, 29],
    [6, 29],
    [7, 28],
    [14, 28],
    [15, 27],
    [30, 27],
    [62, 26],
    [126, 25],
    [254, 24],
    [510, 23],
    [65534, 16],
    [MAX_HOSTS, 0],
  ])('%i hosts → /%i', (hosts, prefix) => {
    expect(unwrap(prefixForHosts(hosts))).toBe(prefix);
  });

  it('is minimal and sufficient for every request up to 1024 hosts', () => {
    for (let hosts = 1; hosts <= 1024; hosts++) {
      const prefix = unwrap(prefixForHosts(hosts));
      expect(usableHostCount(prefix)).toBeGreaterThanOrEqual(hosts);
      for (let smaller = prefix + 1; smaller <= 32; smaller++) {
        expect(usableHostCount(smaller)).toBeLessThan(hosts);
      }
    }
  });

  it('rejects non-positive and over-capacity requests', () => {
    expect(prefixForHosts(0).ok).toBe(false);
    expect(prefixForHosts(-1).ok).toBe(false);
    expect(prefixForHosts(2.5).ok).toBe(false);
    expect(prefixForHosts(MAX_HOSTS + 1).ok).toBe(false);
  });
});

describe('splitInto', () => {
  it('splits a /24 into four /26s in ascending order', () => {
    const out = unwrap(splitInto(cidr('192.168.1.0', 24), 4));
    expect(out.map(cidrToString)).toEqual([
      '192.168.1.0/26',
      '192.168.1.64/26',
      '192.168.1.128/26',
      '192.168.1.192/26',
    ]);
  });

  it('splits the whole IPv4 space in two', () => {
    const out = unwrap(splitInto(cidr('0.0.0.0', 0), 2));
    expect(out.map(cidrToString)).toEqual(['0.0.0.0/1', '128.0.0.0/1']);
  });

  it('returns the canonical network for count=1', () => {
    const out = unwrap(splitInto(cidr('192.168.1.130', 24), 1));
    expect(out.map(cidrToString)).toEqual(['192.168.1.0/24']);
  });

  it('covers the base exactly with no gaps or overlaps', () => {
    const bases = [cidr('10.0.0.0', 8), cidr('192.168.1.0', 24), cidr('172.16.0.0', 12)];
    for (const base of bases) {
      for (const count of [1, 2, 4, 8, 16]) {
        const children = unwrap(splitInto(base, count));
        expect(children).toHaveLength(count);
        // contiguous, ascending, non-overlapping
        expect(netInt(children[0])).toBe(netInt(base));
        expect(bcastInt(children[children.length - 1])).toBe(bcastInt(base));
        for (let i = 1; i < children.length; i++) {
          expect(netInt(children[i])).toBe(bcastInt(children[i - 1]) + 1n);
        }
        for (const child of children) {
          expect(cidrContains(base, child)).toBe(true);
          expect(child.prefixLength).toBe(base.prefixLength + Math.log2(count));
        }
      }
    }
  });

  it('rejects non-power-of-two counts and names the neighbours', () => {
    const r = splitInto(cidr('10.0.0.0', 24), 6);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('INVALID_INPUT');
      expect(r.error.message).toContain('4');
      expect(r.error.message).toContain('8');
    }
    expect(splitInto(cidr('10.0.0.0', 24), 0).ok).toBe(false);
    expect(splitInto(cidr('10.0.0.0', 24), 3).ok).toBe(false);
  });

  it('rejects splitting a /32 further', () => {
    const r = splitInto(cidr('10.0.0.1', 32), 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('/32');
  });
});

describe('subnetsForHosts', () => {
  it('produces the right number of correctly sized subnets', () => {
    const out = unwrap(subnetsForHosts(cidr('192.168.1.0', 24), 50));
    expect(out).toHaveLength(4);
    expect(out.map(cidrToString)).toEqual([
      '192.168.1.0/26',
      '192.168.1.64/26',
      '192.168.1.128/26',
      '192.168.1.192/26',
    ]);
  });

  it('every subnet fits the requested host count, and density is maximal', () => {
    // /24 base keeps the generated subnet counts small enough to assert fully;
    // a /16 case below covers wide splits.
    for (const hosts of [1, 2, 5, 14, 30, 60, 100, 254]) {
      const base = cidr('10.0.1.0', 24);
      const out = unwrap(subnetsForHosts(base, hosts));
      expect(out.length).toBeGreaterThan(0);
      for (const child of out) {
        expect(usableHostCount(child.prefixLength)).toBeGreaterThanOrEqual(hosts);
        expect(cidrContains(base, child)).toBe(true);
      }
      // maximal density: the subnet count matches the prefix maths exactly
      const childPrefix = out[0].prefixLength;
      expect(out).toHaveLength(2 ** (childPrefix - base.prefixLength));
      expect(subnetCount(base, childPrefix)).toBe(out.length);
      // covers the base exactly
      expect(netInt(out[0])).toBe(netInt(base));
      expect(bcastInt(out[out.length - 1])).toBe(bcastInt(base));
    }
  });

  it('covers a larger base network exactly', () => {
    const base = cidr('10.0.0.0', 16);
    const out = unwrap(subnetsForHosts(base, 254));
    expect(out).toHaveLength(256);
    expect(netInt(out[0])).toBe(netInt(base));
    expect(bcastInt(out[out.length - 1])).toBe(bcastInt(base));
    expect(out.every((c) => c.prefixLength === 24)).toBe(true);
  });

  it('rejects a host requirement larger than the base network', () => {
    const r = subnetsForHosts(cidr('192.168.1.0', 24), 1000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_INPUT');
  });

  it('propagates invalid host counts', () => {
    expect(subnetsForHosts(cidr('192.168.1.0', 24), 0).ok).toBe(false);
  });
});

describe('cidrContains', () => {
  it('accepts strict children and the network itself', () => {
    expect(cidrContains(cidr('10.0.0.0', 8), cidr('10.1.2.0', 24))).toBe(true);
    expect(cidrContains(cidr('10.0.0.0', 8), cidr('10.0.0.0', 8))).toBe(true);
  });

  it('rejects larger blocks, siblings and unrelated networks', () => {
    expect(cidrContains(cidr('10.1.0.0', 16), cidr('10.0.0.0', 8))).toBe(false);
    expect(cidrContains(cidr('10.0.0.0', 25), cidr('10.0.0.128', 25))).toBe(false);
    expect(cidrContains(cidr('192.168.1.0', 24), cidr('10.0.0.0', 24))).toBe(false);
  });
});

describe('supernetOf', () => {
  it('summarises two adjacent /24s into a /23', () => {
    const r = unwrap(supernetOf([cidr('192.168.0.0', 24), cidr('192.168.1.0', 24)]));
    expect(cidrToString(r)).toBe('192.168.0.0/23');
  });

  it('summarises two halves into the parent', () => {
    const r = unwrap(supernetOf([cidr('10.0.0.0', 25), cidr('10.0.0.128', 25)]));
    expect(cidrToString(r)).toBe('10.0.0.0/24');
  });

  it('pads to the covering block when the inputs are not adjacent', () => {
    const r = unwrap(supernetOf([cidr('10.0.0.0', 24), cidr('10.0.2.0', 24)]));
    expect(cidrToString(r)).toBe('10.0.0.0/22');
  });

  it('returns the input unchanged for a single network', () => {
    expect(cidrToString(unwrap(supernetOf([cidr('172.16.5.0', 24)])))).toBe('172.16.5.0/24');
  });

  it('widens to /0 for disjoint ranges', () => {
    const r = unwrap(supernetOf([cidr('10.0.0.0', 8), cidr('192.168.0.0', 16)]));
    expect(cidrToString(r)).toBe('0.0.0.0/0');
  });

  it('rejects an empty list', () => {
    expect(supernetOf([]).ok).toBe(false);
  });
});
