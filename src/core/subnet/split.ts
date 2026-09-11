/**
 * CIDR splitting and aggregation.
 *
 * Powers the CIDR calculator's two questions — "split this network into N
 * equal subnets" and "how many subnets of at least N hosts fit?" — and the
 * VLSM allocator's supernet checks.
 *
 * Host-count semantics follow core/subnet: RFC 3021 for /31 (2 usable) and
 * /32 (1 usable), so a request for exactly 2 hosts yields a /31 (the smallest
 * block that fits) rather than wasting a /30. The UI labels /31 allocations
 * as point-to-point links.
 *
 * Pure TS — no React Native imports.
 */

import { assertV4Prefix, v4CidrOf, V4_MAX, type Ipv4Cidr } from '../ip/cidr';
import { err, ok, type Result } from '../result/result';
import { toolError } from '../result/toolError';
import { broadcastIntV4, networkIntV4, usableHostCount } from './subnet';

/** Largest usable-host count in a single IPv4 subnet (/0). */
export const MAX_HOSTS = 2 ** 32 - 2;

const invalid = (message: string, technical: string) =>
  err(toolError('INVALID_INPUT', message, { technical }));

/**
 * Smallest prefix whose usable host count is at least `hosts`.
 * 1 → /32, 2 → /31 (RFC 3021), 3 → /29, … , MAX_HOSTS → /0.
 */
export function prefixForHosts(hosts: number): Result<number> {
  if (!Number.isInteger(hosts) || hosts < 1) {
    return invalid(
      'Host count must be a whole number of at least 1.',
      `prefixForHosts(${hosts}): not a positive integer`,
    );
  }
  if (hosts > MAX_HOSTS) {
    return invalid(
      `A single IPv4 subnet can hold at most ${MAX_HOSTS} hosts.`,
      `prefixForHosts(${hosts}): exceeds /0 capacity`,
    );
  }
  for (let prefix = 32; prefix >= 0; prefix--) {
    if (usableHostCount(prefix) >= hosts) return ok(prefix);
  }
  /* istanbul ignore next — unreachable: /0 always fits MAX_HOSTS */
  return invalid('Host count too large.', `prefixForHosts(${hosts}): no prefix fits`);
}

/** Number of /childPrefix blocks that fit in `parent`. */
export function subnetCount(parent: Ipv4Cidr, childPrefix: number): number {
  assertV4Prefix(childPrefix);
  if (childPrefix < parent.prefixLength) {
    throw new RangeError(
      `child prefix /${childPrefix} is larger than parent /${parent.prefixLength}`,
    );
  }
  return 2 ** (childPrefix - parent.prefixLength);
}

/**
 * Split a network into `count` equal subnets (count must be a power of two).
 * Returns them in ascending address order, based on the network address.
 */
export function splitInto(cidr: Ipv4Cidr, count: number): Result<Ipv4Cidr[]> {
  const { prefixLength } = cidr;
  assertV4Prefix(prefixLength);

  if (!Number.isInteger(count) || count < 1) {
    return invalid(
      'Number of subnets must be a whole number of at least 1.',
      `splitInto(count=${count})`,
    );
  }
  if ((count & (count - 1)) !== 0) {
    const lower = 2 ** Math.floor(Math.log2(count));
    const upper = lower * 2;
    return invalid(
      `Number of subnets must be a power of two — try ${lower} or ${upper}.`,
      `splitInto(count=${count}): not a power of two`,
    );
  }

  const extraBits = Math.log2(count);
  const newPrefix = prefixLength + extraBits;
  if (newPrefix > 32) {
    return invalid(
      `/${prefixLength} cannot be split into ${count} subnets — a /32 is the smallest possible network.`,
      `splitInto: prefix ${prefixLength} + ${extraBits} bits > 32`,
    );
  }

  const base = networkIntV4(cidr.address.int, prefixLength);
  const blockSize = 1n << BigInt(32 - newPrefix);
  const out: Ipv4Cidr[] = [];
  for (let i = 0; i < count; i++) {
    out.push(v4CidrOf(base + BigInt(i) * blockSize, newPrefix));
  }
  return ok(out);
}

/**
 * All subnets of the smallest size that provides at least `hostsPerSubnet`
 * usable hosts, covering the whole base network.
 */
export function subnetsForHosts(cidr: Ipv4Cidr, hostsPerSubnet: number): Result<Ipv4Cidr[]> {
  const prefix = prefixForHosts(hostsPerSubnet);
  if (!prefix.ok) return prefix;
  const { prefixLength } = cidr;
  assertV4Prefix(prefixLength);

  if (prefix.value < prefixLength) {
    return invalid(
      `A subnet with ${hostsPerSubnet} hosts needs a /${prefix.value}, which is larger than the base /${prefixLength}.`,
      `subnetsForHosts: required /${prefix.value} > base /${prefixLength}`,
    );
  }
  return splitInto(cidr, 2 ** (prefix.value - prefixLength));
}

/** True when `child` lies entirely inside `parent`. */
export function cidrContains(parent: Ipv4Cidr, child: Ipv4Cidr): boolean {
  const pNet = networkIntV4(parent.address.int, parent.prefixLength);
  const pBcast = broadcastIntV4(parent.address.int, parent.prefixLength);
  const cNet = networkIntV4(child.address.int, child.prefixLength);
  const cBcast = broadcastIntV4(child.address.int, child.prefixLength);
  return cNet >= pNet && cBcast <= pBcast;
}

/**
 * Tightest common supernet (CIDR summarisation) of one or more networks.
 * Returns the shortest prefix that covers every input.
 */
export function supernetOf(cidrs: readonly Ipv4Cidr[]): Result<Ipv4Cidr> {
  if (cidrs.length === 0) {
    return invalid('Provide at least one network to summarise.', 'supernetOf: empty input');
  }
  let min = V4_MAX;
  let max = 0n;
  for (const c of cidrs) {
    const net = networkIntV4(c.address.int, c.prefixLength);
    const bcast = broadcastIntV4(c.address.int, c.prefixLength);
    if (net < min) min = net;
    if (bcast > max) max = bcast;
  }
  // Longest prefix at which the lowest and highest addresses share a block.
  for (let prefix = 32; prefix >= 0; prefix--) {
    if (networkIntV4(min, prefix) === networkIntV4(max, prefix)) {
      return ok(v4CidrOf(min, prefix));
    }
  }
  /* istanbul ignore next — unreachable: /0 always contains both */
  return invalid('Could not summarise these networks.', 'supernetOf: no common prefix');
}
