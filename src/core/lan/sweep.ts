/**
 * Bounded-concurrency sweep runner (plan #44).
 *
 * Takes a probe function and a host list, keeps at most `concurrency` probes in
 * flight, throttles progress, stops promptly when the caller aborts, and stops
 * cleanly when the caller's time budget runs out. It never throws: a probe that
 * fails is simply "not a host", which is the normal outcome for most addresses
 * in a sweep.
 *
 * Why a budget is not optional: on a network that drops probes instead of
 * refusing them, every address costs a full timeout, and the sweep's speed is
 * capped by whatever the socket layer can do in parallel (on Android that is
 * the TCP library's fixed 2-thread connect pool). A /24 with a few ports is
 * then minutes of work. `budgetMs` turns that into a bounded run with honest
 * partial coverage instead of a spinner the user has to cancel.
 */

import { DEFAULT_PROGRESS_INTERVAL_MS, DEFAULT_SWEEP_CONCURRENCY, type LanHit } from './lan';

export interface SweepProgress {
  readonly done: number;
  readonly total: number;
  readonly found: number;
}

/** Why the sweep stopped. `budget` means the host list was not fully covered. */
export type SweepStop = 'complete' | 'cancelled' | 'budget';

export interface SweepOptions {
  readonly concurrency?: number;
  /** Abort signal from the operation layer; stops scheduling and probing. */
  readonly signal?: AbortSignal;
  /** Stop scheduling new probes after this many ms (unset = no budget). */
  readonly budgetMs?: number;
  readonly onProgress?: (progress: SweepProgress) => void;
  /** Minimum gap between progress callbacks (default 250ms). */
  readonly progressIntervalMs?: number;
}

export interface SweepResult {
  readonly hits: readonly LanHit[];
  readonly stopped: SweepStop;
  readonly probed: number;
}

export async function runSweep(
  hosts: readonly string[],
  probe: (ip: string, signal?: AbortSignal) => Promise<LanHit | null>,
  options: SweepOptions = {},
): Promise<SweepResult> {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_SWEEP_CONCURRENCY);
  const interval = options.progressIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS;
  const { signal, onProgress, budgetMs } = options;
  const startedAt = Date.now();

  const hits: LanHit[] = [];
  let next = 0;
  let probed = 0;
  let lastProgressAt = 0;
  let overBudget = false;

  const report = (force: boolean) => {
    if (!onProgress) return;
    const now = Date.now();
    if (!force && now - lastProgressAt < interval) return;
    lastProgressAt = now;
    onProgress({ done: probed, total: hosts.length, found: hits.length });
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      if (signal?.aborted) return;
      if (budgetMs !== undefined && Date.now() - startedAt >= budgetMs) {
        overBudget = true;
        return;
      }
      const index = next++;
      if (index >= hosts.length) return;

      const ip = hosts[index];
      try {
        const hit = await probe(ip, signal);
        if (hit) hits.push(hit);
      } catch {
        // A probe failure means "not a host" — the common case in a sweep.
      }
      probed += 1;
      report(false);
    }
  };

  report(true);
  await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, worker));
  report(true);

  const stopped: SweepStop = signal?.aborted ? 'cancelled' : overBudget ? 'budget' : 'complete';
  return { hits, stopped, probed };
}
