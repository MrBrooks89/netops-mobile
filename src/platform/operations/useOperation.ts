/**
 * `useOperation` — the single way networked tools run (plan §12, M3).
 *
 * One hook standardises, for every networked feature:
 *   - loading / error / data state            (React Query)
 *   - retry, but only when the error is retryable
 *   - cancellation via AbortController        (first-class, not an afterthought)
 *   - offline short-circuit with friendly copy
 *   - automatic run persistence to history    (summary + drill-in detail)
 *
 * Recording happens once per user-initiated operation, in React Query's
 * settle callbacks, so automatic retries do not litter history with failures
 * that were then recovered from.
 */

import { useCallback, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { RunStatus } from '../../core/model/entities';
import type { ToolId } from '../../core/registry/types';
import type { Result } from '../../core/result/result';
import type { ToolError } from '../../core/result/toolError';
import { useAppData, useAppSettings } from '../../providers/AppProviders';
import { offlineToolError, useIsOffline } from '../netinfo';

export interface OperationContext {
  /** Aborted when the user cancels or the screen unmounts. */
  readonly signal: AbortSignal;
}

export interface OperationSpec<TInput, TOutput> {
  readonly toolId: ToolId;
  /** The work. Return a Result — failures are values, not exceptions. */
  readonly run: (input: TInput, context: OperationContext) => Promise<Result<TOutput>>;
  /** One-line history summary for a successful run. */
  readonly summarize: (input: TInput, output: TOutput) => string;
  /** One-line description of the input, used when the run fails. */
  readonly describeInput: (input: TInput) => string;
}

export interface Operation<TInput, TOutput> {
  run: (input: TInput) => void;
  /** Awaitable form, for callers that need the outcome. */
  runAsync: (input: TInput) => Promise<TOutput>;
  retry: () => void;
  cancel: () => void;
  reset: () => void;
  readonly isRunning: boolean;
  readonly data: TOutput | null;
  /**
   * The input of the run that produced `data` — never live form state. Screens
   * label their results with this so editing the form afterwards cannot
   * mislabel (or relabel) the results already on screen.
   */
  readonly dataInput: TInput | null;
  readonly error: ToolError | null;
  /** True once a run has finished and can be retried. */
  readonly canRetry: boolean;
}

export function useOperation<TInput, TOutput>(
  spec: OperationSpec<TInput, TOutput>,
): Operation<TInput, TOutput> {
  const data = useAppData();
  const { settings } = useAppSettings();
  const offline = useIsOffline();

  // React Query refreshes the observer's options on every render, so the
  // callbacks below always see the current `spec` and `offline` without needing
  // a ref (and writing a ref during render is not allowed).
  const controllerRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef<string | null>(null);
  const lastInputRef = useRef<TInput | null>(null);
  const [dataInput, setDataInput] = useState<TInput | null>(null);

  const persist = useCallback(
    (
      input: TInput,
      status: RunStatus,
      summary: string,
      detail: unknown,
      error: ToolError | null,
      startedAt: string,
    ) => {
      data.runs.record({
        toolId: spec.toolId,
        status,
        input,
        summary,
        detail,
        errorCode: error?.code,
        errorMessage: error?.message,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Math.max(0, Date.now() - new Date(startedAt).getTime()),
      });
      // Keep the retention cap tight without waiting for the next app start.
      data.runs.prune(settings.historyRetentionLimit);
    },
    [data, settings.historyRetentionLimit, spec.toolId],
  );

  const mutation = useMutation<TOutput, ToolError, TInput>({
    mutationFn: async (input) => {
      if (offline) throw offlineToolError();

      const controller = new AbortController();
      controllerRef.current = controller;
      const result = await spec.run(input, { signal: controller.signal });
      if (!result.ok) throw result.error;
      return result.value;
    },

    onSuccess: (output, input) => {
      setDataInput(input);
      persist(
        input,
        'success',
        spec.summarize(input, output),
        output,
        null,
        startedAtRef.current ?? new Date().toISOString(),
      );
    },

    onError: (error, input) => {
      // A cancellation is a user action, not a result worth recording.
      if (error.code === 'CANCELLED') return;
      persist(
        input,
        'error',
        spec.describeInput(input),
        null,
        error,
        startedAtRef.current ?? new Date().toISOString(),
      );
    },

    onSettled: () => {
      controllerRef.current = null;
    },

    // One automatic retry, and only when retrying could plausibly help. While
    // offline there is nothing to retry — the user has to reconnect first.
    retry: (attempt, error) => !offline && error.retryable && attempt < 1,
  });

  const start = useCallback((input: TInput) => {
    startedAtRef.current = new Date().toISOString();
    lastInputRef.current = input;
  }, []);

  const run = useCallback(
    (input: TInput) => {
      start(input);
      mutation.mutate(input);
    },
    [mutation, start],
  );

  const runAsync = useCallback(
    async (input: TInput) => {
      start(input);
      return mutation.mutateAsync(input);
    },
    [mutation, start],
  );

  const retry = useCallback(() => {
    const input = lastInputRef.current;
    if (input === null) return;
    run(input);
  }, [run]);

  const cancel = useCallback(() => controllerRef.current?.abort(), []);

  const error = mutation.error ?? null;

  return {
    run,
    runAsync,
    retry,
    cancel,
    reset: () => {
      mutation.reset();
      setDataInput(null);
    },
    isRunning: mutation.isPending,
    data: mutation.data ?? null,
    dataInput,
    error,
    canRetry: error !== null && error.code !== 'CANCELLED' && error.code !== 'INVALID_INPUT',
  };
}
