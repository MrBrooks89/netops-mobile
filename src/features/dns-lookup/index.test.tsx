import { fireEvent, waitFor } from '@testing-library/react-native';
import { withFetchStub, dohAnswer } from '../../../test-utils/fetchStub';
import { renderWithApp } from '../../../test-utils/appTestKit';
import type { ToolModule } from '../../core/registry/types';
import { DnsLookupScreen } from './index';

// The screen reads an optional `name` search param so reverse DNS can drill in.
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  router: { push: jest.fn() },
}));

const tool: ToolModule = {
  id: 'dns-lookup',
  title: 'DNS Lookup',
  description: 'Resolve A, AAAA, CNAME, MX, TXT records via DoH',
  category: 'dns',
  icon: 'search',
  requiredCapabilities: ['dnsResolve'],
  Component: () => null,
};

describe('DnsLookupScreen', () => {
  it('starts on a valid example and shows which resolver will be used', async () => {
    const { getByText, getByTestId } = await renderWithApp(<DnsLookupScreen tool={tool} />);
    expect(getByText(/Queries go to Cloudflare/)).toBeTruthy();
    expect(getByTestId('dns-submit')).toBeTruthy();
    expect(getByTestId('dns-idle')).toBeTruthy();
  });

  it('reports an invalid name inline and disables the lookup', async () => {
    const { getByTestId, getByText } = await renderWithApp(<DnsLookupScreen tool={tool} />);
    await fireEvent.changeText(getByTestId('dns-name'), 'not a name');
    expect(getByText(/not a valid DNS name/)).toBeTruthy();
    expect(getByTestId('dns-submit').props.accessibilityState.disabled).toBe(true);
  });

  it('resolves a name, shows the answer, and records the run in history', async () => {
    const { getByTestId, getByText, data } = await renderWithApp(<DnsLookupScreen tool={tool} />);

    const { calls } = await withFetchStub(
      () => dohAnswer(1, '93.184.216.34'),
      async () => {
        await fireEvent.press(getByTestId('dns-submit'));
        await waitFor(() => expect(getByText('93.184.216.34')).toBeTruthy(), { timeout: 3000 });
      },
    );

    expect(calls[0]).toContain('name=example.com');
    expect(calls[0]).toContain('type=A');
    expect(getByText('1 A record')).toBeTruthy();

    const runs = data.runs.list();
    expect(runs.ok).toBe(true);
    if (runs.ok) {
      expect(runs.value).toHaveLength(1);
      expect(runs.value[0]).toMatchObject({
        toolId: 'dns-lookup',
        status: 'success',
        summary: 'A example.com → 93.184.216.34',
        detail: [{ type: 'A', value: '93.184.216.34' }],
      });
    }
  });

  it('queries the selected record type', async () => {
    const { getByTestId, getByText } = await renderWithApp(<DnsLookupScreen tool={tool} />);
    await fireEvent.press(getByTestId('dns-type-MX'));

    const { calls } = await withFetchStub(
      () => dohAnswer(15, '10 mail.example.com.'),
      async () => {
        await fireEvent.press(getByTestId('dns-submit'));
        await waitFor(() => expect(getByText('mail.example.com')).toBeTruthy(), { timeout: 3000 });
      },
    );

    expect(calls[0]).toContain('type=MX');
    // MX keeps its preference, shown alongside the exchange.
    expect(getByText(/priority 10/)).toBeTruthy();
  });

  it('says so when a name has no records of the requested type', async () => {
    const { getByTestId, getByText } = await renderWithApp(<DnsLookupScreen tool={tool} />);
    await withFetchStub(
      () => ({ Status: 0, Answer: [] }),
      async () => {
        await fireEvent.press(getByTestId('dns-submit'));
        await waitFor(() => expect(getByTestId('dns-no-records')).toBeTruthy(), { timeout: 3000 });
      },
    );
    expect(getByText(/No A records exist for example.com/)).toBeTruthy();
  });

  it('uses the provider chosen in Settings immediately', async () => {
    const { getByText, getByTestId } = await renderWithApp(<DnsLookupScreen tool={tool} />, {
      appSettings: { dohProvider: 'google' },
    });
    expect(getByText(/Queries go to Google/)).toBeTruthy();

    const { calls } = await withFetchStub(
      () => dohAnswer(1, '93.184.216.34'),
      async () => {
        await fireEvent.press(getByTestId('dns-submit'));
        await waitFor(() => expect(getByText('93.184.216.34')).toBeTruthy(), { timeout: 3000 });
      },
    );
    expect(calls[0]).toContain('dns.google');
  });

  it('blocks lookups when a custom endpoint is not configured', async () => {
    const { getByTestId, getByText } = await renderWithApp(<DnsLookupScreen tool={tool} />, {
      appSettings: { dohProvider: 'custom', customDohUrl: '' },
    });
    expect(getByText(/Enter the custom DNS-over-HTTPS URL/)).toBeTruthy();
    expect(getByTestId('dns-submit').props.accessibilityState.disabled).toBe(true);
  });

  it('keeps the results labelled with the type that produced them', async () => {
    // Regression: the header read live form state, so switching the record
    // type without re-running mislabelled the results still on screen.
    const { getByTestId, getByText, queryByText } = await renderWithApp(
      <DnsLookupScreen tool={tool} />,
    );
    await withFetchStub(
      () => dohAnswer(1, '93.184.216.34'),
      async () => {
        await fireEvent.press(getByTestId('dns-submit'));
        await waitFor(() => expect(getByText('93.184.216.34')).toBeTruthy(), { timeout: 3000 });
      },
    );

    await fireEvent.press(getByTestId('dns-type-MX'));
    expect(getByText('1 A record')).toBeTruthy();
    expect(queryByText(/No MX records exist/)).toBeNull();
  });

  it('cancels a hanging lookup without recording it in history', async () => {
    const { getByTestId, queryByTestId, data } = await renderWithApp(
      <DnsLookupScreen tool={tool} />,
    );

    const original = globalThis.fetch;
    // A faithful fetch double: rejects with AbortError when the caller's
    // signal aborts, exactly like the real transport.
    globalThis.fetch = ((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('The operation was aborted.');
          error.name = 'AbortError';
          reject(error);
        });
      })) as unknown as typeof fetch;

    try {
      await fireEvent.press(getByTestId('dns-submit'));
      await waitFor(() => expect(getByTestId('operation-running')).toBeTruthy());
      await fireEvent.press(getByTestId('operation-cancel'));
      // The run settles as cancelled: no running indicator, no error card.
      await waitFor(() => expect(queryByTestId('operation-running')).toBeNull());
      expect(queryByTestId('operation-error')).toBeNull();
    } finally {
      globalThis.fetch = original;
    }

    const runs = data.runs.list();
    expect(runs.ok).toBe(true);
    if (runs.ok) {
      const cancelled = runs.value.filter((r) => r.status === 'cancelled');
      expect(cancelled).toHaveLength(0);
    }
  });

  it('reports NXDOMAIN as a friendly not-found error', async () => {
    const { getByTestId, getByText } = await renderWithApp(<DnsLookupScreen tool={tool} />);
    await withFetchStub(
      () => ({ Status: 3 }),
      async () => {
        await fireEvent.press(getByTestId('dns-submit'));
        await waitFor(() => expect(getByTestId('operation-error')).toBeTruthy(), { timeout: 3000 });
      },
    );
    expect(getByText('That name does not exist.')).toBeTruthy();
  });
});
