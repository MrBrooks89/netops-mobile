/**
 * VLSM (Variable Length Subnet Mask) allocation.
 *
 * Given a base network and a list of host requirements, allocate the smallest
 * block that fits each requirement, largest first (classic greedy VLSM), and
 * report the resulting table plus whatever space is left over.
 *
 * Allocation is a buddy free-list: the base starts as one free block; a
 * request takes the *smallest* free block that fits (minimising fragmentation),
 * halving larger blocks as needed; the leftovers are coalesced back into the
 * largest possible CIDR blocks so "unallocated space" reads like a network
 * engineer would write it.
 *
 * Host-count semantics are RFC 3021 aware (see core/subnet), so two 2-host
 * links pack into a /30 as two /31s.
 *
 * Pure TS — no React Native imports.
 */

import { formatV4 } from '../ip/ip';
import { assertV4Prefix, v4CidrOf, type Ipv4Cidr } from '../ip/cidr';
import { err, ok, type Result } from '../result/result';
import { toolError } from '../result/toolError';
import { broadcastIntV4, networkIntV4, usableHostCount } from '../subnet/subnet';
import { prefixForHosts } from '../subnet/split';

/** One "I need room for N hosts" request. */
export interface VlsmRequest {
  readonly name?: string;
  readonly requiredHosts: number;
}

export interface VlsmAllocation {
  readonly name?: string;
  readonly requiredHosts: number;
  readonly cidr: Ipv4Cidr;
  readonly network: string;
  readonly firstHost: string;
  readonly lastHost: string;
  readonly hostRange: string;
  /** Usable host addresses in the allocated block (RFC 3021 aware). */
  readonly usable: number;
  /** usable − requiredHosts. */
  readonly waste: number;
  /** True when this is a /31 point-to-point link. */
  readonly pointToPoint: boolean;
}

export interface VlsmFailure {
  readonly name?: string;
  readonly requiredHosts: number;
  readonly reason: string;
}

export interface VlsmReport {
  readonly base: Ipv4Cidr;
  /** Allocations in greedy order (largest requirement first). */
  readonly allocations: VlsmAllocation[];
  /** Remaining free space, coalesced and sorted ascending. */
  readonly unallocatedSpace: Ipv4Cidr[];
  /** True only when every request was placed. */
  readonly fits: boolean;
  readonly failures: VlsmFailure[];
  /** Hosts requested across every request (placed or not). */
  readonly totalRequestedHosts: number;
  /** Usable addresses across placed allocations only. */
  readonly totalAllocatedUsable: number;
  /** Unused usable addresses across placed allocations (lower is tighter). */
  readonly totalWaste: number;
  /** Addresses still free in the base network. */
  readonly unallocatedAddresses: number;
}

/** Guardrail: keeps the table renderable and the algorithm bounded. */
export const MAX_VLSM_REQUESTS = 512;

const invalid = (message: string, technical: string) =>
  err(toolError('INVALID_INPUT', message, { technical }));

const netOf = (c: Ipv4Cidr): bigint => networkIntV4(c.address.int, c.prefixLength);

/**
 * Free blocks in ascending address order.
 *
 * Best-fit splitting keeps this list *merge-minimal*: each prefix length
 * appears at most once, so no two free blocks can be coalesced into a larger
 * CIDR. The "unallocated space stays minimal" property test guards that
 * invariant — if the allocation strategy ever changes, the test fails loudly
 * instead of the report silently becoming fragmented.
 */
function sortFree(blocks: readonly Ipv4Cidr[]): Ipv4Cidr[] {
  return [...blocks].sort((x, y) => (netOf(x) < netOf(y) ? -1 : netOf(x) > netOf(y) ? 1 : 0));
}

const blockAddresses = (c: Ipv4Cidr): number => 2 ** (32 - c.prefixLength);

function toAllocation(block: Ipv4Cidr, request: VlsmRequest): VlsmAllocation {
  const usable = usableHostCount(block.prefixLength);
  const net = netOf(block);
  const bcast = broadcastIntV4(block.address.int, block.prefixLength);
  const noReservation = block.prefixLength >= 31;
  const first = noReservation ? net : net + 1n;
  const last = noReservation ? bcast : bcast - 1n;
  const firstHost = formatInt(first);
  const lastHost = formatInt(last);

  return {
    name: request.name,
    requiredHosts: request.requiredHosts,
    cidr: block,
    network: formatInt(net),
    firstHost,
    lastHost,
    hostRange: block.prefixLength === 32 ? firstHost : `${firstHost} - ${lastHost}`,
    usable,
    waste: usable - request.requiredHosts,
    pointToPoint: block.prefixLength === 31,
  };
}

// Local formatter keeps the allocation builder terse.
const formatInt = (int: bigint): string => formatV4(int).value;

/**
 * Allocate `requests` inside `base` using greedy VLSM.
 *
 * Returns a failure report (not an error) when the requests do not all fit —
 * `fits: false` plus a reason per unplaced request — because "your network is
 * too small" is a normal answer, not an exception. Structural problems
 * (empty request list, non-positive host counts, oversized requests) come
 * back as `INVALID_INPUT` errors.
 */
export function allocateVlsm(base: Ipv4Cidr, requests: readonly VlsmRequest[]): Result<VlsmReport> {
  assertV4Prefix(base.prefixLength);

  if (requests.length === 0) {
    return invalid('Add at least one subnet requirement.', 'allocateVlsm: empty request list');
  }
  if (requests.length > MAX_VLSM_REQUESTS) {
    return invalid(
      `Too many requirements — ${MAX_VLSM_REQUESTS} subnets is the limit for one base network.`,
      `allocateVlsm: ${requests.length} > ${MAX_VLSM_REQUESTS}`,
    );
  }
  for (const r of requests) {
    if (!Number.isInteger(r.requiredHosts) || r.requiredHosts < 1) {
      return invalid(
        `Host requirement for "${r.name ?? 'subnet'}" must be a whole number of at least 1.`,
        `allocateVlsm: requiredHosts=${r.requiredHosts}`,
      );
    }
  }

  const baseCapacity = usableHostCount(base.prefixLength);
  for (const r of requests) {
    if (r.requiredHosts > baseCapacity) {
      return invalid(
        `"${r.name ?? 'subnet'}" needs ${r.requiredHosts} hosts, but the base network only has ${baseCapacity} usable addresses.`,
        `allocateVlsm: requiredHosts ${r.requiredHosts} > base capacity ${baseCapacity}`,
      );
    }
  }

  // Greedy VLSM: largest requirement first (stable for equal sizes).
  const ordered = requests
    .map((r, index) => ({ r, index }))
    .sort((a, b) => b.r.requiredHosts - a.r.requiredHosts || a.index - b.index)
    .map(({ r }) => r);

  const free: Ipv4Cidr[] = [v4CidrOf(netOf(base), base.prefixLength)];
  const allocations: VlsmAllocation[] = [];
  const failures: VlsmFailure[] = [];

  for (const request of ordered) {
    const neededPrefix = prefixForHosts(request.requiredHosts);
    /* istanbul ignore next — validated above, so this cannot fail */
    if (!neededPrefix.ok) return neededPrefix;

    // Best fit: the smallest free block that still fits the request.
    let chosenIndex = -1;
    for (let i = 0; i < free.length; i++) {
      if (free[i].prefixLength > neededPrefix.value) continue; // too small
      if (chosenIndex === -1 || free[i].prefixLength > free[chosenIndex].prefixLength) {
        chosenIndex = i;
      }
    }

    if (chosenIndex === -1) {
      const reason = `No ${formatInt(netOf(base))}/${neededPrefix.value} block is left in ${formatInt(netOf(base))}/${base.prefixLength}.`;
      failures.push({
        name: request.name,
        requiredHosts: request.requiredHosts,
        reason,
      });
      continue;
    }

    // Halve the chosen block down to the required size, releasing the halves.
    let block = free.splice(chosenIndex, 1)[0];
    while (block.prefixLength < neededPrefix.value) {
      const halfPrefix = block.prefixLength + 1;
      const halfSize = 1n << BigInt(32 - halfPrefix);
      const net = netOf(block);
      free.push(v4CidrOf(net + halfSize, halfPrefix));
      block = v4CidrOf(net, halfPrefix);
    }

    allocations.push(toAllocation(block, request));
  }

  const unallocatedSpace = sortFree(free);
  const totalRequestedHosts = requests.reduce((sum, r) => sum + r.requiredHosts, 0);
  const totalAllocatedUsable = allocations.reduce((sum, a) => sum + a.usable, 0);
  const totalWaste = allocations.reduce((sum, a) => sum + a.waste, 0);
  const unallocatedAddresses = unallocatedSpace.reduce((sum, c) => sum + blockAddresses(c), 0);

  return ok({
    base,
    allocations,
    unallocatedSpace,
    fits: failures.length === 0,
    failures,
    totalRequestedHosts,
    totalAllocatedUsable,
    totalWaste,
    unallocatedAddresses,
  });
}
