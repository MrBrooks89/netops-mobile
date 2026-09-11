import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import type { ToolModule } from '../../core/registry/types';
import { renderWithApp } from '../../../test-utils/appTestKit';
import { CidrCalculatorScreen } from './index';

const tool: ToolModule = {
  id: 'cidr-calculator',
  title: 'CIDR Calculator',
  description: 'Mask ↔ prefix conversion and subnet splitting',
  category: 'ipv4',
  icon: 'git-network',
  requiredCapabilities: [],
  Component: () => null,
};

describe('CidrCalculatorScreen', () => {
  it('converts prefix ↔ mask by default', async () => {
    const { getAllByText, getByText } = await renderWithApp(<CidrCalculatorScreen tool={tool} />);
    // the CIDR also appears in the input field and example chips
    expect(getAllByText('192.168.1.0/24').length).toBeGreaterThan(0);
    expect(getByText('255.255.255.0')).toBeTruthy();
    expect(getByText('0.0.0.255')).toBeTruthy();
    expect(getByText('254 hosts')).toBeTruthy();
  });

  it('splits into N equal subnets', async () => {
    const { getByTestId, getByText } = await renderWithApp(<CidrCalculatorScreen tool={tool} />);
    await fireEvent.press(getByTestId('mode-split'));
    expect(getByText('4 subnets')).toBeTruthy();
    expect(getByText('192.168.1.0/26')).toBeTruthy();
    expect(getByText('192.168.1.64/26')).toBeTruthy();
    expect(getByText('192.168.1.128/26')).toBeTruthy();
    expect(getByText('192.168.1.192/26')).toBeTruthy();
  });

  it('rejects a non-power-of-two split count', async () => {
    const { getByTestId } = await renderWithApp(<CidrCalculatorScreen tool={tool} />);
    await fireEvent.press(getByTestId('mode-split'));
    await fireEvent.changeText(getByTestId('cidr-count'), '6');
    expect(getByTestId('cidr-split-error')).toBeTruthy();
  });

  it('sizes subnets for a minimum host count', async () => {
    const { getByTestId, getByText } = await renderWithApp(<CidrCalculatorScreen tool={tool} />);
    await fireEvent.press(getByTestId('mode-hosts'));
    // 50 hosts → /26; a /24 holds four of them
    expect(getByText('/26')).toBeTruthy();
    expect(getByText('62 hosts')).toBeTruthy();
    expect(getByText('4')).toBeTruthy(); // subnets that fit
    expect(getByText('192.168.1.0/26')).toBeTruthy();
  });

  it('reports when a host requirement cannot fit the base', async () => {
    const { getByTestId } = await renderWithApp(<CidrCalculatorScreen tool={tool} />);
    await fireEvent.press(getByTestId('mode-hosts'));
    await fireEvent.changeText(getByTestId('cidr-hosts'), '1000');
    expect(getByTestId('cidr-hosts-error')).toBeTruthy();
  });

  it('summarises several networks into the tightest supernet', async () => {
    const { getByTestId, getByText } = await renderWithApp(<CidrCalculatorScreen tool={tool} />);
    await fireEvent.press(getByTestId('mode-summarise'));
    expect(getByText('192.168.0.0/23')).toBeTruthy();
    expect(getByText('2')).toBeTruthy(); // networks combined
  });

  it('reports a bad line in summarise mode', async () => {
    const { getByTestId } = await renderWithApp(<CidrCalculatorScreen tool={tool} />);
    await fireEvent.press(getByTestId('mode-summarise'));
    await fireEvent.changeText(getByTestId('cidr-summarise'), '192.168.0.0/24\nnot-a-network');
    expect(getByTestId('cidr-summarise-error')).toBeTruthy();
  });

  it('reports the active mode to assistive tech as a checked radio', async () => {
    const { getByLabelText } = await renderWithApp(<CidrCalculatorScreen tool={tool} />);
    // Chips are a single-choice group, so the selected one must be *checked*
    // (Android only reports a selected state for checkable roles).
    expect(getByLabelText('Convert').props.accessibilityState.checked).toBe(true);
    expect(getByLabelText('Split into N').props.accessibilityState.checked).toBe(false);
  });

  it('shows an inline error for an invalid network', async () => {
    const { getByTestId } = await renderWithApp(<CidrCalculatorScreen tool={tool} />);
    await fireEvent.changeText(getByTestId('cidr-input'), '10.0.0.0/33');
    expect(getByTestId('cidr-input-error')).toBeTruthy();
  });

  it('shows an empty state when the network is cleared', async () => {
    const { getByTestId } = await renderWithApp(<CidrCalculatorScreen tool={tool} />);
    await fireEvent.changeText(getByTestId('cidr-input'), '');
    expect(getByTestId('cidr-empty')).toBeTruthy();
  });
});
