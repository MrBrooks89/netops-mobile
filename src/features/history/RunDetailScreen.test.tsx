import { renderWithApp } from '../../../test-utils/appTestKit';
import { RunDetailScreen } from './RunDetailScreen';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  Stack: { Screen: () => null },
}));

const RUN = {
  toolId: 'dns-lookup' as const,
  status: 'success' as const,
  input: { name: 'example.com', type: 'A' },
  summary: 'A example.com → 93.184.216.34',
  detail: [{ type: 'A', value: '93.184.216.34', ttl: 300 }],
  startedAt: '2026-09-13T10:00:00.000Z',
  finishedAt: '2026-09-13T10:00:00.120Z',
  durationMs: 120,
};

describe('RunDetailScreen', () => {
  it('shows the recorded summary, payloads and timings', async () => {
    // The harness gives each render its own database, so seed and re-render
    // inside one context rather than rendering twice.
    const utils = await renderWithApp(<RunDetailScreen runId="placeholder" />);
    const recorded = utils.data.runs.record(RUN);
    if (!recorded.ok) throw new Error('could not seed a run');
    await utils.rerender(<RunDetailScreen runId={recorded.value.id} />);

    expect(utils.getByText('A example.com → 93.184.216.34')).toBeTruthy();
    expect(utils.getByText('DNS Lookup')).toBeTruthy(); // tool id resolved to its title
    expect(utils.getByText('120 ms')).toBeTruthy();
    expect(utils.getByTestId('run-input').props.children).toContain('example.com');
    expect(utils.getByTestId('run-detail').props.children).toContain('93.184.216.34');
  });

  it('shows the error for a failed run', async () => {
    const utils = await renderWithApp(<RunDetailScreen runId="placeholder" />);
    const recorded = utils.data.runs.record({
      ...RUN,
      status: 'error',
      detail: null,
      errorCode: 'NETWORK_UNREACHABLE',
      errorMessage: 'You appear to be offline.',
    });
    if (!recorded.ok) throw new Error('could not seed a run');
    await utils.rerender(<RunDetailScreen runId={recorded.value.id} />);

    expect(utils.getByText('You appear to be offline.')).toBeTruthy();
    expect(utils.getByText('NETWORK_UNREACHABLE')).toBeTruthy();
  });

  it('explains when the entry is gone (e.g. purged by retention)', async () => {
    const { getByTestId } = await renderWithApp(<RunDetailScreen runId="r_missing" />);
    expect(getByTestId('run-missing')).toBeTruthy();
  });
});
