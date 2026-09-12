import {
  parseHostInput,
  isValidHostname,
  isValidHostInput,
  parsePortInput,
  parsePortList,
} from './host';

describe('parseHostInput', () => {
  it('accepts IPv4 and returns the canonical form', () => {
    const result = parseHostInput(' 192.168.1.10 ');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('192.168.1.10');
  });

  it('accepts IPv6 and canonicalises it', () => {
    const result = parseHostInput('2001:0DB8:0000:0000:0000:0000:0000:0001');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('2001:db8::1');
  });

  it('accepts hostnames and lower-cases them', () => {
    for (const [input, expected] of [
      ['Router.LAN', 'router.lan'],
      ['example.com', 'example.com'],
      ['a-b.c-d.example', 'a-b.c-d.example'],
      ['x1.example.com', 'x1.example.com'],
      ['example.com.', 'example.com'],
    ] as const) {
      const result = parseHostInput(input);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(expected);
    }
  });

  it('rejects empty, spaced and malformed input', () => {
    for (const bad of [
      '',
      '   ',
      'has space',
      '-leading.example',
      'trailing-.example',
      'double..dot',
      'under_score.example',
      'toolong'.padEnd(64, 'a') + '.com',
    ]) {
      const result = parseHostInput(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_INPUT');
        expect(result.error.message).toBeTruthy();
      }
    }
  });

  it('rejects a hostname longer than 253 characters', () => {
    const long = Array.from({ length: 5 }, () => 'a'.repeat(60)).join('.');
    expect(parseHostInput(long).ok).toBe(false);
  });
});

describe('isValidHostname', () => {
  it('enforces label and total length limits', () => {
    expect(isValidHostname('a'.repeat(63))).toBe(true);
    expect(isValidHostname('a'.repeat(64))).toBe(false);
    expect(isValidHostname('a'.repeat(253))).toBe(false);
  });

  it('accepts digits-only labels but not an empty string', () => {
    expect(isValidHostname('123')).toBe(true);
    expect(isValidHostname('')).toBe(false);
  });
});

describe('isValidHostInput', () => {
  it('mirrors parseHostInput for live field validation', () => {
    expect(isValidHostInput('192.168.1.1')).toBe(true);
    expect(isValidHostInput('router.lan')).toBe(true);
    expect(isValidHostInput('nope nope')).toBe(false);
  });
});

describe('parsePortInput', () => {
  it('accepts ports in range and trims whitespace', () => {
    for (const [input, expected] of [
      ['443', 443],
      [' 80 ', 80],
      ['1', 1],
      ['65535', 65535],
      ['0080', 80],
    ] as const) {
      const result = parsePortInput(input);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(expected);
    }
  });

  it('rejects out-of-range, non-numeric and over-long input with INVALID_INPUT', () => {
    for (const bad of ['', '  ', '0', '65536', '99999', 'abc', '44.3', '-1', '123456', '1e3']) {
      const result = parsePortInput(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_INPUT');
        expect(result.error.message).toBeTruthy();
      }
    }
  });
});

describe('parsePortList', () => {
  it('parses singles and ranges into ascending unique ports', () => {
    expect(parsePortList('80 443')).toEqual([80, 443]);
    expect(parsePortList('9800-9803')).toEqual([9800, 9801, 9802, 9803]);
    expect(parsePortList(' 443 , 9800-9802 ,80 ')).toEqual([80, 443, 9800, 9801, 9802]);
  });

  it('deduplicates overlapping ranges and repeated ports', () => {
    expect(parsePortList('80 80 9800-9802 9801')).toEqual([80, 9800, 9801, 9802]);
  });

  it('returns null for empty or invalid tokens', () => {
    for (const bad of ['', '   ', '0', 'abc', '9803-9800', '65536', '80-65536', '9800-']) {
      expect(parsePortList(bad)).toBeNull();
    }
  });

  it('caps the parsed list at 1024 ports so a typo cannot scan everything', () => {
    expect(parsePortList('1-1024')).toHaveLength(1024);
    expect(parsePortList('1-1025')).toBeNull();
  });
});
