import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import type { ToolModule } from '../../core/registry/types';
import { PortsReferenceScreen } from './index';

const tool: ToolModule = {
  id: 'ports-reference',
  title: 'Ports Reference',
  description: 'Common TCP/UDP ports and their services',
  category: 'reference',
  icon: 'list',
  requiredCapabilities: [],
  Component: () => null,
};

describe('PortsReferenceScreen', () => {
  it('lists ports by default', async () => {
    const { getByTestId, getByText } = await render(<PortsReferenceScreen tool={tool} />);
    expect(getByText('Ports Reference')).toBeTruthy();
    expect(getByTestId('port-row-22-tcp')).toBeTruthy();
    expect(getByText('ssh')).toBeTruthy();
  });

  it('searches by service name', async () => {
    const { getByTestId, getByText, queryByTestId } = await render(
      <PortsReferenceScreen tool={tool} />,
    );
    await fireEvent.changeText(getByTestId('ports-search'), 'mysql');
    expect(getByTestId('port-row-3306-tcp')).toBeTruthy();
    expect(getByText('1 result')).toBeTruthy();
    expect(queryByTestId('port-row-22-tcp')).toBeNull();
  });

  it('searches by port number', async () => {
    const { getByTestId } = await render(<PortsReferenceScreen tool={tool} />);
    await fireEvent.changeText(getByTestId('ports-search'), '443');
    expect(getByTestId('port-row-443-tcp')).toBeTruthy();
  });

  it('searches by protocol token', async () => {
    const { getByTestId, queryByTestId } = await render(<PortsReferenceScreen tool={tool} />);
    await fireEvent.changeText(getByTestId('ports-search'), 'udp 53');
    expect(getByTestId('port-row-53-udp')).toBeTruthy();
    expect(queryByTestId('port-row-53-tcp')).toBeNull();
  });

  it('filters by protocol chip', async () => {
    const { getByTestId, queryByTestId } = await render(<PortsReferenceScreen tool={tool} />);
    await fireEvent.press(getByTestId('ports-filter-udp'));
    expect(getByTestId('port-row-53-udp')).toBeTruthy();
    // ssh is TCP-only in the dataset
    expect(queryByTestId('port-row-22-tcp')).toBeNull();
  });

  it('combines the protocol filter with a text search', async () => {
    const { getByTestId, queryByTestId } = await render(<PortsReferenceScreen tool={tool} />);
    await fireEvent.press(getByTestId('ports-filter-udp'));
    await fireEvent.changeText(getByTestId('ports-search'), 'ssh');
    expect(getByTestId('ports-empty')).toBeTruthy();
    expect(queryByTestId('port-row-22-tcp')).toBeNull();
  });

  it('shows an empty state for no matches', async () => {
    const { getByTestId } = await render(<PortsReferenceScreen tool={tool} />);
    await fireEvent.changeText(getByTestId('ports-search'), 'zzzznotaservice');
    expect(getByTestId('ports-empty')).toBeTruthy();
  });

  it('clears back to the full list', async () => {
    const { getByTestId } = await render(<PortsReferenceScreen tool={tool} />);
    await fireEvent.changeText(getByTestId('ports-search'), 'mysql');
    await fireEvent.changeText(getByTestId('ports-search'), '');
    expect(getByTestId('port-row-22-tcp')).toBeTruthy();
  });

  it('copies a port when its row is tapped', async () => {
    const { getByTestId } = await render(<PortsReferenceScreen tool={tool} />);
    await fireEvent.press(getByTestId('port-row-22-tcp'));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('22');
  });
});
