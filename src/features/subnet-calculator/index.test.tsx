import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import type { ToolModule } from '../../core/registry/types';
import { SubnetCalculatorScreen } from './index';

const tool: ToolModule = {
  id: 'subnet-calculator',
  title: 'Subnet Calculator',
  description: 'IPv4 address + CIDR → mask, wildcard, ranges, host count',
  category: 'ipv4',
  icon: 'calculator',
  requiredCapabilities: [],
  Component: () => null,
};

const setStringAsync = Clipboard.setStringAsync as jest.Mock;

beforeEach(() => setStringAsync.mockClear());

describe('SubnetCalculatorScreen', () => {
  it('shows the default report for the seeded example', async () => {
    const { getByText } = await render(<SubnetCalculatorScreen tool={tool} />);
    expect(getByText('Subnet Calculator')).toBeTruthy();
    expect(getByText('192.168.1.0')).toBeTruthy(); // network
    expect(getByText('255.255.255.0')).toBeTruthy(); // netmask
    expect(getByText('0.0.0.255')).toBeTruthy(); // wildcard
    expect(getByText('192.168.1.255')).toBeTruthy(); // broadcast
    expect(getByText('254 hosts')).toBeTruthy();
  });

  it('recomputes when the input changes', async () => {
    const { getByTestId, getByText } = await render(<SubnetCalculatorScreen tool={tool} />);
    await fireEvent.changeText(getByTestId('subnet-input'), '10.0.0.0/8');
    expect(getByText('10.0.0.0')).toBeTruthy();
    expect(getByText('10.255.255.255')).toBeTruthy();
    expect(getByText('16,777,214 hosts')).toBeTruthy();
  });

  it('shows an inline error for invalid input', async () => {
    const { getByTestId, queryByText } = await render(<SubnetCalculatorScreen tool={tool} />);
    await fireEvent.changeText(getByTestId('subnet-input'), '192.168.1.0/33');
    expect(getByTestId('subnet-input-error')).toBeTruthy();
    expect(queryByText('255.255.255.0')).toBeNull();
  });

  it('shows an empty state when the input is cleared', async () => {
    const { getByTestId } = await render(<SubnetCalculatorScreen tool={tool} />);
    await fireEvent.changeText(getByTestId('subnet-input'), '');
    expect(getByTestId('subnet-empty')).toBeTruthy();
  });

  it('explains IPv6 input rather than failing silently', async () => {
    const { getByTestId } = await render(<SubnetCalculatorScreen tool={tool} />);
    await fireEvent.changeText(getByTestId('subnet-input'), '2001:db8::/32');
    expect(getByTestId('subnet-input-error')).toBeTruthy();
  });

  it('copies a value when its copy button is tapped', async () => {
    const { getByTestId } = await render(<SubnetCalculatorScreen tool={tool} />);
    await fireEvent.press(getByTestId('copy-Netmask'));
    expect(setStringAsync).toHaveBeenCalledWith('255.255.255.0');
  });

  it('renders RFC 3021 detail for a /31', async () => {
    const { getByTestId, getByText } = await render(<SubnetCalculatorScreen tool={tool} />);
    await fireEvent.changeText(getByTestId('subnet-input'), '192.168.1.1/31');
    expect(getByText('none (RFC 3021)')).toBeTruthy();
    expect(getByText('2 hosts')).toBeTruthy();
    expect(getByText(/RFC 3021 point-to-point/)).toBeTruthy();
  });
});
