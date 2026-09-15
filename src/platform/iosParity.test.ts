/**
 * Drift guard for the iOS parity audit (M8 acceptance).
 *
 * `docs/IOS_PARITY.md` is prose, but the thing it must not do is go stale: a new
 * tool or capability that nobody audited is exactly the gap M8 exists to close.
 * This test reads the published matrix and fails if any registered tool or any
 * capability in `CapabilityMap` is missing from it, so adding one means updating
 * the audit — or CI says why not.
 *
 * The runtime list of capability ids comes from an exhaustive `CapabilityMap`
 * literal: TypeScript already refuses to compile that object when a capability
 * is added to the interface, so the list cannot silently fall behind.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOL_REGISTRY } from '../core/registry/registry';
import type { CapabilityMap } from './capabilities';

const doc = readFileSync(join(__dirname, '..', '..', 'docs', 'IOS_PARITY.md'), 'utf8');

/** Exhaustive by construction: a new CapabilityMap key breaks the build here. */
const ALL_CAPABILITIES: CapabilityMap = {
  dnsResolve: null,
  dnsReverse: null,
  tcpConnect: null,
  tcpScan: null,
  tcpPing: null,
  icmpPing: null,
  wifiInfo: null,
  permissions: null,
  httpProbe: null,
  tlsInspect: null,
  lanDiscovery: null,
};

const mentions = (id: string): boolean => new RegExp(`\\b${id}\\b`).test(doc);

describe('docs/IOS_PARITY.md', () => {
  it('names every capability the platform layer can provide', () => {
    const missing = (Object.keys(ALL_CAPABILITIES) as (keyof CapabilityMap)[]).filter(
      (id) => !mentions(id),
    );
    expect(missing).toEqual([]);
  });

  it('names every registered tool', () => {
    const missing = TOOL_REGISTRY.filter((tool) => !mentions(tool.id)).map((tool) => tool.id);
    expect(missing).toEqual([]);
  });

  it('gives every tool an iOS verdict, not just a mention', () => {
    // Each tool row must carry one of the three marks the legend defines.
    const rows = doc
      .split('\n')
      .filter((line) => TOOL_REGISTRY.some((tool) => line.startsWith(`| \`${tool.id}\``)));
    expect(rows).toHaveLength(TOOL_REGISTRY.length);
    for (const row of rows) {
      expect(row).toMatch(/\*\*(works|built \(sim\)|gated)/);
    }
  });
});
