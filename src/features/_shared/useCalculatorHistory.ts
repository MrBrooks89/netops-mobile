/**
 * Auto-record calculator runs into history.
 *
 * Recording on every keystroke would be noise, so a run is recorded only after
 * the input has been valid and unchanged for a moment, and only once per
 * distinct input. Recording itself is best-effort: a storage failure must never
 * disturb the calculator, so the result is deliberately ignored.
 */

import { useEffect, useRef } from 'react';
import type { ToolId } from '../../core/registry/types';
import { useAppData } from '../../app/AppProviders';

/** How long an input must stay unchanged before it counts as a run. */
export const RECORD_DEBOUNCE_MS = 1200;

export interface CalculatorHistoryOptions {
  readonly toolId: ToolId;
  /** Raw input text, exactly as typed. */
  readonly input: string;
  /** One-line summary, or null while the input is empty or invalid. */
  readonly summary: string | null;
  /** Structured detail to store alongside the summary. */
  readonly detail: unknown;
}

export function useCalculatorHistory(options: CalculatorHistoryOptions): void {
  const data = useAppData();
  const { historyEnabled, historyRetentionLimit } = data.appSettings;
  const lastRecorded = useRef<string | null>(null);

  useEffect(() => {
    if (!historyEnabled) return;
    const trimmed = options.input.trim();
    if (trimmed === '' || options.summary === null) return;
    if (lastRecorded.current === trimmed) return;

    const timer = setTimeout(() => {
      lastRecorded.current = trimmed;
      const timestamp = new Date().toISOString();
      void (async () => {
        await data.runs.record({
          toolId: options.toolId,
          status: 'success',
          input: { input: trimmed },
          summary: options.summary ?? '',
          detail: options.detail,
          startedAt: timestamp,
          finishedAt: timestamp,
          durationMs: null,
        });
        // Keep the cap tight without waiting for the next app start.
        await data.runs.prune(historyRetentionLimit);
      })();
    }, RECORD_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [
    data,
    historyEnabled,
    historyRetentionLimit,
    options.toolId,
    options.input,
    options.summary,
    options.detail,
  ]);
}
