/**
 * Deep-link prefill: the receiving half of the feed-forward contract. LAN
 * discovery pushes `/tool/port-scanner?host=…`; this pins that the target
 * screen starts from that address and from nothing else.
 */

import { renderHook } from '@testing-library/react-native';
import { usePrefilledHost } from './deepLink';

let mockParams: Record<string, unknown> = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
}));

beforeEach(() => {
  mockParams = {};
});

describe('usePrefilledHost', () => {
  it('uses the host another tool handed over', async () => {
    mockParams = { host: '10.0.2.2' };
    const { result } = await renderHook(() => usePrefilledHost('example.com'));
    expect(result.current).toBe('10.0.2.2');
  });

  it('falls back for a plain launch', async () => {
    const { result } = await renderHook(() => usePrefilledHost('example.com'));
    expect(result.current).toBe('example.com');
  });

  it('ignores a blank or non-string host', async () => {
    mockParams = { host: '   ' };
    expect((await renderHook(() => usePrefilledHost('example.com'))).result.current).toBe(
      'example.com',
    );

    mockParams = { host: ['10.0.2.2', '10.0.2.3'] };
    expect((await renderHook(() => usePrefilledHost('example.com'))).result.current).toBe(
      'example.com',
    );
  });
});
