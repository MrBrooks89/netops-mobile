import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import type { ToolModule } from '../../core/registry/types';
import { renderWithApp } from '../../../test-utils/appTestKit';
import { VlsmCalculatorScreen } from './index';

const tool: ToolModule = {
  id: 'vlsm-calculator',
  title: 'VLSM Calculator',
  description: 'Allocate subnets from a base network to fit host needs',
  category: 'ipv4',
  icon: 'layers',
  requiredCapabilities: [],
  Component: () => null,
};

describe('VlsmCalculatorScreen', () => {
  it('allocates the seeded requirements largest-first', async () => {
    const { getByText } = await renderWithApp(<VlsmCalculatorScreen tool={tool} />);
    expect(getByText('VLSM Calculator')).toBeTruthy();
    expect(getByText('Sales')).toBeTruthy();
    expect(getByText('Engineering')).toBeTruthy();
    expect(getByText('VoIP')).toBeTruthy();
    expect(getByText('192.168.1.0/25')).toBeTruthy();
    expect(getByText('192.168.1.128/26')).toBeTruthy();
    expect(getByText('192.168.1.192/27')).toBeTruthy();
  });

  it('shows range, usable and waste for each allocation', async () => {
    const { getByText } = await renderWithApp(<VlsmCalculatorScreen tool={tool} />);
    expect(getByText('192.168.1.1 - 192.168.1.126')).toBeTruthy();
    expect(getByText('126 hosts')).toBeTruthy(); // usable
    expect(getByText('100 hosts')).toBeTruthy(); // requested
    expect(getByText('26 hosts')).toBeTruthy(); // waste
  });

  it('reports totals and remaining space', async () => {
    const { getByText } = await renderWithApp(<VlsmCalculatorScreen tool={tool} />);
    expect(getByText('170 hosts')).toBeTruthy(); // requested: 100 + 50 + 20
    expect(getByText('218 hosts')).toBeTruthy(); // allocated usable: 126 + 62 + 30
    expect(getByText('48 hosts')).toBeTruthy(); // waste: 26 + 12 + 10
    expect(getByText('32 addresses')).toBeTruthy(); // unallocated
    expect(getByText('192.168.1.224/27')).toBeTruthy();
  });

  it('explains cleanly when the requirements do not fit', async () => {
    const { getByTestId, getByText } = await renderWithApp(<VlsmCalculatorScreen tool={tool} />);
    // three /25-sized requests cannot fit in a /24
    await fireEvent.changeText(getByTestId('vlsm-hosts-1'), '100');
    await fireEvent.changeText(getByTestId('vlsm-hosts-2'), '100');
    await fireEvent.changeText(getByTestId('vlsm-hosts-3'), '100');
    expect(getByTestId('vlsm-does-not-fit')).toBeTruthy();
    expect(getByText('Could not place (1)')).toBeTruthy();
  });

  it('rejects a host count larger than the base capacity', async () => {
    const { getByTestId } = await renderWithApp(<VlsmCalculatorScreen tool={tool} />);
    await fireEvent.changeText(getByTestId('vlsm-hosts-1'), '5000');
    expect(getByTestId('vlsm-row-error')).toBeTruthy();
  });

  it('rejects a fractional host count', async () => {
    const { getByTestId } = await renderWithApp(<VlsmCalculatorScreen tool={tool} />);
    await fireEvent.changeText(getByTestId('vlsm-hosts-1'), '10.5');
    expect(getByTestId('vlsm-row-error')).toBeTruthy();
  });

  it('accepts a different base network', async () => {
    const { getByTestId, getByText } = await renderWithApp(<VlsmCalculatorScreen tool={tool} />);
    await fireEvent.changeText(getByTestId('vlsm-base'), '10.0.0.0/22');
    expect(getByText('10.0.0.0/25')).toBeTruthy();
  });

  it('adds and removes requirement rows', async () => {
    const { getByTestId, getByText } = await renderWithApp(<VlsmCalculatorScreen tool={tool} />);
    expect(getByText('Requirements (3)')).toBeTruthy();
    await fireEvent.press(getByTestId('vlsm-add'));
    expect(getByText('Requirements (4)')).toBeTruthy();
    await fireEvent.press(getByTestId('vlsm-remove-3'));
    expect(getByText('Requirements (3)')).toBeTruthy();
  });

  it('shows an empty state when the base is cleared', async () => {
    const { getByTestId } = await renderWithApp(<VlsmCalculatorScreen tool={tool} />);
    await fireEvent.changeText(getByTestId('vlsm-base'), '');
    expect(getByTestId('vlsm-empty')).toBeTruthy();
  });
});
