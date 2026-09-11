import { TOOL_CATEGORIES } from './types';
import { TOOL_REGISTRY, getTool, toolsByCategory } from './registry';

describe('tool registry', () => {
  it('has unique ids', () => {
    const ids = TOOL_REGISTRY.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every tool complete metadata', () => {
    for (const tool of TOOL_REGISTRY) {
      expect(tool.title.trim().length).toBeGreaterThan(0);
      expect(tool.description.trim().length).toBeGreaterThan(0);
      expect(tool.icon.trim().length).toBeGreaterThan(0);
      expect(TOOL_CATEGORIES).toContain(tool.category);
      expect(typeof tool.Component).toBe('function');
    }
  });

  it('marks the M1 calculators as pure (no required capabilities)', () => {
    for (const id of [
      'subnet-calculator',
      'cidr-calculator',
      'wildcard-mask-calculator',
      'vlsm-calculator',
      'ports-reference',
    ]) {
      expect(getTool(id)?.requiredCapabilities).toEqual([]);
    }
  });

  it('exposes the five M1 tools in their categories', () => {
    expect(getTool('subnet-calculator')?.category).toBe('ipv4');
    expect(getTool('cidr-calculator')?.category).toBe('ipv4');
    expect(getTool('wildcard-mask-calculator')?.category).toBe('ipv4');
    expect(getTool('vlsm-calculator')?.category).toBe('ipv4');
    expect(getTool('ports-reference')?.category).toBe('reference');
  });

  it('looks tools up by id and returns undefined for unknown ids', () => {
    expect(getTool('vlsm-calculator')?.title).toBe('VLSM Calculator');
    expect(getTool('does-not-exist')).toBeUndefined();
  });
});

describe('toolsByCategory', () => {
  it('groups every tool exactly once', () => {
    const grouped = toolsByCategory();
    const flattened = [...grouped.values()].flat();
    expect(flattened).toHaveLength(TOOL_REGISTRY.length);
    expect(new Set(flattened.map((t) => t.id)).size).toBe(TOOL_REGISTRY.length);
  });

  it('puts each tool under its own category', () => {
    for (const [category, tools] of toolsByCategory()) {
      expect(TOOL_CATEGORIES).toContain(category);
      for (const tool of tools) expect(tool.category).toBe(category);
    }
  });

  it('groups the four IPv4 calculators together', () => {
    const ipv4 = toolsByCategory().get('ipv4') ?? [];
    expect(ipv4.map((t) => t.id)).toEqual([
      'subnet-calculator',
      'cidr-calculator',
      'wildcard-mask-calculator',
      'vlsm-calculator',
    ]);
  });

  it('preserves registry declaration order within a category', () => {
    const reference = toolsByCategory().get('reference') ?? [];
    expect(reference.map((t) => t.id)).toEqual(['ports-reference']);
  });
});
