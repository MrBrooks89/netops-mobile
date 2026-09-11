import { aclForm, parseWildcardInput } from './parse';

describe('parseWildcardInput', () => {
  it('accepts a bare prefix with or without a slash', () => {
    expect(parseWildcardInput('/24')).toEqual({ state: 'valid', prefix: 24 });
    expect(parseWildcardInput('24')).toEqual({ state: 'valid', prefix: 24 });
    expect(parseWildcardInput('/0')).toEqual({ state: 'valid', prefix: 0 });
    expect(parseWildcardInput('/32')).toEqual({ state: 'valid', prefix: 32 });
  });

  it('rejects prefixes above 32', () => {
    const result = parseWildcardInput('/33');
    expect(result.state).toBe('error');
    if (result.state === 'error') expect(result.message).toContain('/33');
  });

  it('accepts a dotted netmask', () => {
    expect(parseWildcardInput('255.255.255.0')).toEqual({ state: 'valid', prefix: 24 });
    expect(parseWildcardInput('255.255.255.252')).toEqual({ state: 'valid', prefix: 30 });
    expect(parseWildcardInput('0.0.0.0')).toEqual({ state: 'valid', prefix: 0 });
  });

  it('rejects a non-contiguous netmask', () => {
    const result = parseWildcardInput('255.0.255.0');
    expect(result.state).toBe('error');
    if (result.state === 'error') expect(result.message).toContain('contiguous');
  });

  it('accepts CIDR and address + netmask forms', () => {
    expect(parseWildcardInput('192.168.1.0/24')).toEqual({ state: 'valid', prefix: 24 });
    expect(parseWildcardInput('192.168.1.0 255.255.255.0')).toEqual({ state: 'valid', prefix: 24 });
  });

  it('treats blank input as empty and garbage as an error', () => {
    expect(parseWildcardInput('')).toEqual({ state: 'empty' });
    expect(parseWildcardInput('   ')).toEqual({ state: 'empty' });
    expect(parseWildcardInput('not-a-mask').state).toBe('error');
    expect(parseWildcardInput('999.1.1.1').state).toBe('error');
  });

  it('does not confuse a netmask with a prefix', () => {
    // 0 and 32 are prefixes; 0.0.0.0 and 255.255.255.255 are netmasks
    expect(parseWildcardInput('0')).toEqual({ state: 'valid', prefix: 0 });
    expect(parseWildcardInput('0.0.0.0')).toEqual({ state: 'valid', prefix: 0 });
    expect(parseWildcardInput('32')).toEqual({ state: 'valid', prefix: 32 });
    expect(parseWildcardInput('255.255.255.255')).toEqual({ state: 'valid', prefix: 32 });
  });
});

describe('aclForm', () => {
  it('uses the host/any shorthand for /32 and /0', () => {
    expect(aclForm(32, '0.0.0.0')).toContain('host');
    expect(aclForm(0, '255.255.255.255')).toContain('any');
  });

  it('renders an ip wildcard pair otherwise', () => {
    expect(aclForm(24, '0.0.0.255')).toBe('ip wildcard 0.0.0.255');
  });
});
