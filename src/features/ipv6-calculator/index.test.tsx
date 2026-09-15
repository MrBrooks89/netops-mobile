/**
 * IPv6 calculator screen tests: the report renders, the prefix chips retarget
 * the address in place, a bare address defaults to /64, and a v4 address gets
 * pointed at the right tool.
 */

import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderWithApp } from '../../../test-utils/appTestKit';
import { Ipv6CalculatorScreen } from '../ipv6-calculator';
import { getTool } from '../../core/registry/registry';

const tool = getTool('ipv6-calculator')!;

describe('Ipv6CalculatorScreen', () => {
  it('renders the network, sizing and forms for the default input', async () => {
    const { getByTestId, getByText } = await renderWithApp(<Ipv6CalculatorScreen tool={tool} />);

    expect(getByTestId('ipv6-screen')).toBeTruthy();
    // CIDR row keeps the input as written; the network row is the masked form.
    expect(getByText('2001:db8:abcd:12::1/64')).toBeTruthy();
    expect(getByText('2001:db8:abcd:12::')).toBeTruthy();
    expect(getByText('2001:0db8:abcd:0012:0000:0000:0000:0000')).toBeTruthy();
    // A /64 is 18,446,744,073,709,551,616 addresses — shown in full.
    expect(getByText('18,446,744,073,709,551,616')).toBeTruthy();
    // The default example sits in the documentation range, and says so.
    expect(getByText('documentation')).toBeTruthy();
  });

  it('applies a prefix chip to the address already typed', async () => {
    const { getByTestId, getByText } = await renderWithApp(<Ipv6CalculatorScreen tool={tool} />);

    await fireEvent.press(getByTestId('ipv6-prefix-48'));
    expect(getByTestId('ipv6-input').props.value).toBe('2001:db8:abcd:12::1/48');
    expect(getByText('2001:db8:abcd::')).toBeTruthy();
    // /48 is 2^80: too many digits to be worth printing.
    expect(getByText('2^80')).toBeTruthy();

    await fireEvent.press(getByTestId('ipv6-prefix-127'));
    // getByText matches the whole string, so a note needs a matcher.
    expect(getByText(/RFC 6164 recommends \/127/)).toBeTruthy();
  });

  it('defaults a bare address to /64 and says what it does', async () => {
    const { getByTestId, getByText } = await renderWithApp(<Ipv6CalculatorScreen tool={tool} />);

    await fireEvent.changeText(getByTestId('ipv6-input'), 'fd12:3456:789a::1');
    // unique-local, /64 assumed
    expect(getByText('fd12:3456:789a::')).toBeTruthy();
    expect(getByText('unique-local')).toBeTruthy();
    expect(getByTestId('ipv6-prefix-64').props.accessibilityState.selected).toBe(true);
  });

  it('points a v4 address at the IPv4 tools instead of failing obscurely', async () => {
    const { getByTestId, getByText } = await renderWithApp(<Ipv6CalculatorScreen tool={tool} />);

    await fireEvent.changeText(getByTestId('ipv6-input'), '192.168.1.0/24');
    expect(getByText(/handles IPv6, e\.g\. 2001:db8::\/32/)).toBeTruthy();
  });

  it('shows the empty state before anything is typed', async () => {
    const { getByTestId, queryByTestId } = await renderWithApp(
      <Ipv6CalculatorScreen tool={tool} />,
    );

    await fireEvent.changeText(getByTestId('ipv6-input'), '');
    expect(getByTestId('ipv6-empty')).toBeTruthy();
    expect(queryByTestId('copy-CIDR')).toBeNull();
  });

  it('lists the /64 rules as notes', async () => {
    const { getAllByTestId, getByText } = await renderWithApp(<Ipv6CalculatorScreen tool={tool} />);

    expect(getAllByTestId('ipv6-note').length).toBeGreaterThan(0);
    expect(getByText(/standard subnet size/)).toBeTruthy();
    expect(getByText(/no network or broadcast address to subtract/)).toBeTruthy();
  });
});
