import { addressesLabel, groupDigits, hostsLabel } from './format';

describe('groupDigits', () => {
  it.each([
    [0, '0'],
    [7, '7'],
    [254, '254'],
    [1000, '1,000'],
    [65534, '65,534'],
    [4294967294, '4,294,967,294'],
    [-1234, '-1,234'],
  ])('%i → %s', (n, expected) => {
    expect(groupDigits(n)).toBe(expected);
  });
});

describe('labels', () => {
  it('pluralises host counts', () => {
    expect(hostsLabel(1)).toBe('1 host');
    expect(hostsLabel(2)).toBe('2 hosts');
    expect(hostsLabel(4294967294)).toBe('4,294,967,294 hosts');
  });

  it('pluralises address counts', () => {
    expect(addressesLabel(1)).toBe('1 address');
    expect(addressesLabel(256)).toBe('256 addresses');
  });
});
