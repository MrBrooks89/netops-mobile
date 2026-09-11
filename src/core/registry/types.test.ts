import { cidrToString, parseCidr, TOOL_CATEGORY_LABELS } from './types';
import { unwrap } from '../result/result';

describe('parseCidr', () => {
  it('parses address/prefix form', () => {
    const r = parseCidr('192.168.1.0/24');
    expect(r.ok).toBe(true);
    const c = unwrap(r);
    expect(c.address.value).toBe('192.168.1.0');
    expect(c.prefixLength).toBe(24);
    expect(cidrToString(c)).toBe('192.168.1.0/24');
  });

  it('parses address + dotted netmask form', () => {
    const r = parseCidr('192.168.1.0 255.255.255.0');
    expect(r.ok).toBe(true);
    expect(unwrap(r).prefixLength).toBe(24);
  });

  it('parses non-contiguous netmask as invalid', () => {
    expect(parseCidr('10.0.0.0 255.0.255.0').ok).toBe(false);
  });

  it('rejects v4 prefix > 32', () => {
    expect(parseCidr('10.0.0.0/33').ok).toBe(false);
  });

  it('rejects v6 prefix > 128', () => {
    expect(parseCidr('::/129').ok).toBe(false);
  });

  it('accepts v6 CIDRs', () => {
    const r = parseCidr('2001:db8::/32');
    expect(r.ok).toBe(true);
    expect(unwrap(r).prefixLength).toBe(32);
  });

  it('rejects garbage', () => {
    expect(parseCidr('nonsense').ok).toBe(false);
  });
});

describe('category labels', () => {
  it('has a label for every category', () => {
    for (const label of Object.values(TOOL_CATEGORY_LABELS)) {
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
