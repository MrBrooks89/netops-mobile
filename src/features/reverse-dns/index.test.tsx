import { fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { withFetchStub, dohAnswer } from '../../../test-utils/fetchStub';
import { renderWithApp } from '../../../test-utils/appTestKit';
import type { ToolModule } from '../../core/registry/types';
import { ReverseDnsScreen } from './index';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  router: { push: jest.fn() },
}));

const push = router.push as unknown as jest.Mock;

const tool: ToolModule = {
  id: 'reverse-dns',
  title: 'Reverse DNS',
  description: 'PTR record lookup for an IP address',
  category: 'dns',
  icon: 'arrow-undo',
  requiredCapabilities: ['dnsReverse'],
  Component: () => null,
};

beforeEach(() => push.mockClear());

describe('ReverseDnsScreen', () => {
  it('shows the PTR name it will ask for', async () => {
    const { getByText } = await renderWithApp(<ReverseDnsScreen tool={tool} />);
    expect(getByText(/8\.8\.8\.8\.in-addr\.arpa/)).toBeTruthy();
  });

  it('rejects an invalid address and disables the lookup', async () => {
    const { getByTestId, getByText } = await renderWithApp(<ReverseDnsScreen tool={tool} />);
    await fireEvent.changeText(getByTestId('reverse-ip'), '999.1.1.1');
    // The parser's own message is surfaced verbatim in the field's error slot.
    expect(getByTestId('reverse-ip-error')).toBeTruthy();
    expect(getByText(/999.1.1.1/)).toBeTruthy();
    expect(getByTestId('reverse-submit').props.accessibilityState.disabled).toBe(true);
  });

  it('resolves 8.8.8.8 to dns.google and records the run', async () => {
    const { getByTestId, getByText, data } = await renderWithApp(<ReverseDnsScreen tool={tool} />);

    const { calls } = await withFetchStub(
      () => dohAnswer(12, 'dns.google.', '8.8.8.8.in-addr.arpa.'),
      async () => {
        await fireEvent.press(getByTestId('reverse-submit'));
        await waitFor(() => expect(getByText('dns.google')).toBeTruthy(), { timeout: 3000 });
      },
    );

    expect(calls[0]).toContain('name=8.8.8.8.in-addr.arpa');
    expect(calls[0]).toContain('type=PTR');
    expect(getByText('1 PTR record')).toBeTruthy();

    const runs = data.runs.list();
    if (runs.ok) {
      expect(runs.value[0]).toMatchObject({
        toolId: 'reverse-dns',
        status: 'success',
        summary: 'PTR 8.8.8.8 → dns.google',
      });
    }
  });

  it('drills in to the forward lookup for a resolved name', async () => {
    const { getByTestId, getByText } = await renderWithApp(<ReverseDnsScreen tool={tool} />);
    await withFetchStub(
      () => dohAnswer(12, 'dns.google.', '8.8.8.8.in-addr.arpa.'),
      async () => {
        await fireEvent.press(getByTestId('reverse-submit'));
        await waitFor(() => expect(getByText('dns.google')).toBeTruthy(), { timeout: 3000 });
      },
    );

    await fireEvent.press(getByTestId('reverse-forward-0'));
    expect(push).toHaveBeenCalledWith({
      pathname: '/tool/[id]',
      params: { id: 'dns-lookup', name: 'dns.google' },
    });
  });

  it('says so when an address has no PTR record', async () => {
    const { getByTestId, getByText } = await renderWithApp(<ReverseDnsScreen tool={tool} />);
    await withFetchStub(
      () => ({ Status: 0, Answer: [] }),
      async () => {
        await fireEvent.press(getByTestId('reverse-submit'));
        await waitFor(() => expect(getByTestId('reverse-no-records')).toBeTruthy(), {
          timeout: 3000,
        });
      },
    );
    expect(getByText(/No PTR record is published/)).toBeTruthy();
  });

  it('keeps the empty-state labelled with the address that was looked up', async () => {
    // Regression: the empty state read live form state, so editing the address
    // after a lookup rewrote history of what had been queried.
    const { getByTestId, getByText, queryByText } = await renderWithApp(
      <ReverseDnsScreen tool={tool} />,
    );
    await withFetchStub(
      () => ({ Status: 0, Answer: [] }),
      async () => {
        await fireEvent.press(getByTestId('reverse-submit'));
        await waitFor(() => expect(getByTestId('reverse-no-records')).toBeTruthy(), {
          timeout: 3000,
        });
      },
    );

    await fireEvent.changeText(getByTestId('reverse-ip'), '1.1.1.1');
    expect(getByText(/No PTR record is published for 8\.8\.8\.8/)).toBeTruthy();
    expect(queryByText(/No PTR record is published for 1\.1\.1\.1/)).toBeNull();
  });
});
