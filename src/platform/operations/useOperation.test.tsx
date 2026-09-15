import { act, waitFor } from '@testing-library/react-native';
import NetInfo from '@react-native-community/netinfo';
import { renderHookWithApp } from '../../../test-utils/appTestKit';
import { err, ok } from '../../core/result/result';
import { toolError } from '../../core/result/toolError';
import type { RunRecord } from '../../core/model/entities';
import { useOperation, type OperationSpec } from './useOperation';

// The module under test holds the screen awake while an operation runs; the
// native calls are recorded so a test can assert the lock's lifetime.
jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn().mockResolvedValue(undefined),
  deactivateKeepAwake: jest.fn(),
}));
const keepAwake = jest.requireMock('expo-keep-awake') as {
  activateKeepAwakeAsync: jest.Mock;
  deactivateKeepAwake: jest.Mock;
};

/** The automatic netinfo mock, with its test helpers. */
const netinfo = NetInfo as unknown as {
  setConnected(value: boolean | null): void;
  reset(): void;
};

interface Input {
  readonly name: string;
}
interface Output {
  readonly answers: string[];
}

beforeEach(() => {
  netinfo.reset();
  keepAwake.activateKeepAwakeAsync.mockClear();
  keepAwake.deactivateKeepAwake.mockClear();
});

function makeSpec(overrides: Partial<OperationSpec<Input, Output>> = {}) {
  return {
    toolId: 'dns-lookup' as const,
    describeInput: (input: Input) => `lookup ${input.name}`,
    summarize: (input: Input, output: Output) =>
      `${output.answers.length} answer(s) for ${input.name}`,
    run: jest.fn(async (): Promise<ReturnType<typeof ok<Output>>> => ok({ answers: ['1.2.3.4'] })),
    ...overrides,
  } satisfies OperationSpec<Input, Output>;
}

const runsOf = (data: { runs: { list(): { ok: boolean; value?: RunRecord[] } } }) => {
  const result = data.runs.list();
  if (!result.ok || !result.value) throw new Error('could not read runs');
  return result.value;
};

describe('useOperation', () => {
  it('runs the operation and records a successful history entry', async () => {
    const spec = makeSpec();
    const { result, data } = await renderHookWithApp(() => useOperation(spec));

    await act(async () => {
      result.current.run({ name: 'example.com' });
    });
    await waitFor(() => expect(result.current.isRunning).toBe(false), { timeout: 3000 });

    expect(result.current.data).toEqual({ answers: ['1.2.3.4'] });
    expect(result.current.error).toBeNull();

    const runs = runsOf(data);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      toolId: 'dns-lookup',
      status: 'success',
      summary: '1 answer(s) for example.com',
      input: { name: 'example.com' },
      detail: { answers: ['1.2.3.4'] },
    });
    expect(runs[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('retries a retryable failure once, then records one error entry', async () => {
    const run = jest.fn(async () => err(toolError('TIMEOUT', 'The request timed out.')));
    const spec = makeSpec({ run: run as never });
    const { result, data } = await renderHookWithApp(() => useOperation(spec));

    await act(async () => {
      result.current.run({ name: 'slow.example' });
    });
    await waitFor(() => expect(result.current.isRunning).toBe(false), { timeout: 3000 });

    await waitFor(() => expect(result.current.error?.code).toBe('TIMEOUT'), { timeout: 3000 });
    expect(run).toHaveBeenCalledTimes(2); // initial attempt + one retry

    const runs = runsOf(data);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      status: 'error',
      errorCode: 'TIMEOUT',
      summary: 'lookup slow.example',
      detail: null,
    });
    expect(result.current.canRetry).toBe(true);
  });

  it('does not retry a non-retryable failure', async () => {
    const run = jest.fn(async () => err(toolError('REFUSED', 'Connection refused.')));
    const { result } = await renderHookWithApp(() => useOperation(makeSpec({ run: run as never })));

    await act(async () => {
      result.current.run({ name: 'refused.example' });
    });
    await waitFor(() => expect(result.current.isRunning).toBe(false), { timeout: 3000 });

    expect(run).toHaveBeenCalledTimes(1);
    expect(result.current.error?.code).toBe('REFUSED');
  });

  it('short-circuits when offline and never calls the operation', async () => {
    netinfo.setConnected(false);
    const run = jest.fn(async () => ok({ answers: [] }));
    const { result, data } = await renderHookWithApp(() =>
      useOperation(makeSpec({ run: run as never })),
    );

    await act(async () => {
      result.current.run({ name: 'example.com' });
    });
    await waitFor(() => expect(result.current.isRunning).toBe(false), { timeout: 3000 });

    expect(run).not.toHaveBeenCalled();
    expect(result.current.error?.code).toBe('NETWORK_UNREACHABLE');
    expect(result.current.error?.message).toContain('offline');
    expect(runsOf(data)).toHaveLength(1);
  });

  it('cancels a running operation and records nothing for it', async () => {
    const run = jest.fn(
      (_input: Input, context: { signal: AbortSignal }) =>
        new Promise<ReturnType<typeof err>>((resolve) => {
          context.signal.addEventListener('abort', () =>
            resolve(err(toolError('CANCELLED', 'The request was cancelled.'))),
          );
        }),
    );
    const { result, data } = await renderHookWithApp(() =>
      useOperation(makeSpec({ run: run as never })),
    );

    await act(async () => {
      result.current.run({ name: 'slow.example' });
    });
    await act(async () => {
      result.current.cancel();
    });
    // Wait for the outcome, not an intermediate flag: `isRunning` can be false
    // for a tick before the error propagates.
    await waitFor(() => expect(result.current.error?.code).toBe('CANCELLED'), { timeout: 3000 });
    expect(result.current.canRetry).toBe(false);
    // A cancellation is a user action, not a result worth keeping.
    expect(runsOf(data)).toHaveLength(0);
  });

  it('exposes retry and reset', async () => {
    const run = jest
      .fn()
      .mockResolvedValueOnce(err(toolError('REFUSED', 'nope')))
      .mockResolvedValueOnce(ok({ answers: ['9.9.9.9'] }));
    const { result } = await renderHookWithApp(() => useOperation(makeSpec({ run: run as never })));

    await act(async () => {
      await result.current.runAsync({ name: 'example.com' }).catch(() => undefined);
    });
    await waitFor(() => expect(result.current.error?.code).toBe('REFUSED'));

    await act(async () => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.data).toEqual({ answers: ['9.9.9.9'] }));

    await act(async () => {
      result.current.reset();
    });
    await waitFor(() => expect(result.current.data).toBeNull());
  });
});

describe('keep-awake', () => {
  it('holds the screen awake only while an operation runs', async () => {
    let release: (() => void) | null = null;
    const spec = makeSpec({
      run: () =>
        new Promise((resolve) => {
          release = () => resolve(ok({ answers: ['1.2.3.4'] }));
        }),
    });
    const { result } = await renderHookWithApp(() => useOperation(spec));

    expect(keepAwake.activateKeepAwakeAsync).not.toHaveBeenCalled();

    // The mutation becomes pending on a later tick, so the lock is asserted with
    // waitFor; and the operation is always released in `finally`, because a
    // never-settling mutation would leave Jest waiting on it forever.
    try {
      await act(async () => {
        result.current.run({ name: 'example.com' });
      });
      await waitFor(() =>
        expect(keepAwake.activateKeepAwakeAsync).toHaveBeenCalledWith('netops-operation'),
      );
      expect(keepAwake.deactivateKeepAwake).not.toHaveBeenCalled();
      expect(result.current.isRunning).toBe(true);
    } finally {
      await act(async () => {
        release?.();
      });
    }

    await waitFor(() => expect(result.current.isRunning).toBe(false));
    expect(keepAwake.deactivateKeepAwake).toHaveBeenCalledWith('netops-operation');
  });
});
