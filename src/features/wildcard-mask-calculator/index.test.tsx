import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { ToolModule } from '../../core/registry/types';
import { WildcardMaskScreen } from './index';

const tool: ToolModule = {
  id: 'wildcard-mask-calculator',
  title: 'Wildcard Mask',
  description: 'Cisco-style wildcard masks from netmasks and CIDR',
  category: 'ipv4',
  icon: 'swap-horizontal',
  requiredCapabilities: [],
  Component: () => null,
};

describe('WildcardMaskScreen', () => {
  it('derives the wildcard mask from a netmask by default', async () => {
    const { getAllByText, getByText } = await render(<WildcardMaskScreen tool={tool} />);
    // the netmask also appears in the input field and as an example chip
    expect(getAllByText('255.255.255.0').length).toBeGreaterThan(0);
    expect(getByText('0.0.0.255')).toBeTruthy();
    expect(getByText('254 hosts')).toBeTruthy();
  });

  it('accepts a bare prefix', async () => {
    const { getByTestId, getByText } = await render(<WildcardMaskScreen tool={tool} />);
    await fireEvent.changeText(getByTestId('wildcard-input'), '/30');
    expect(getByText('0.0.0.3')).toBeTruthy();
    expect(getByText('2 hosts')).toBeTruthy();
  });

  it('accepts a CIDR', async () => {
    const { getByTestId, getByText } = await render(<WildcardMaskScreen tool={tool} />);
    await fireEvent.changeText(getByTestId('wildcard-input'), '10.0.0.0/8');
    expect(getByText('0.255.255.255')).toBeTruthy();
    expect(getByText('16,777,214 hosts')).toBeTruthy();
  });

  it('renders the ACL shorthand for a host route', async () => {
    const { getByTestId, getByText } = await render(<WildcardMaskScreen tool={tool} />);
    await fireEvent.changeText(getByTestId('wildcard-input'), '/32');
    expect(getByText('host (single address)')).toBeTruthy();
    expect(getByText('1 host')).toBeTruthy();
  });

  it('renders the ACL shorthand for any', async () => {
    const { getByTestId, getByText } = await render(<WildcardMaskScreen tool={tool} />);
    await fireEvent.changeText(getByTestId('wildcard-input'), '/0');
    expect(getByText('any (all addresses)')).toBeTruthy();
  });

  it('shows the binary views', async () => {
    const { getByTestId, getByText } = await render(<WildcardMaskScreen tool={tool} />);
    await fireEvent.changeText(getByTestId('wildcard-input'), '/24');
    expect(getByText('11111111.11111111.11111111.00000000')).toBeTruthy();
    expect(getByText('00000000.00000000.00000000.11111111')).toBeTruthy();
  });

  it('rejects a non-contiguous netmask', async () => {
    const { getByTestId } = await render(<WildcardMaskScreen tool={tool} />);
    await fireEvent.changeText(getByTestId('wildcard-input'), '255.0.255.0');
    expect(getByTestId('wildcard-input-error')).toBeTruthy();
  });

  it('shows an empty state when cleared', async () => {
    const { getByTestId } = await render(<WildcardMaskScreen tool={tool} />);
    await fireEvent.changeText(getByTestId('wildcard-input'), '');
    expect(getByTestId('wildcard-empty')).toBeTruthy();
  });
});
