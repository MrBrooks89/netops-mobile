/**
 * Bounded-concurrency sweep runner (plan #44).
 *
 * Takes a probe function and a host list, keeps at most `concurrency` probes in
 * flight, throttles progress, and stops promptly when the caller aborts. It
 * never throws: a probe that fails is simply "not a host", which is the normal
 * outcome for most addresses in a sweep.
 */

import { DEFAULT_PROGRESS_INTERVAL_MS, DEFAULT_SWEEP_CONCURRENCY, type LanHit } from './lan';

export interface SweepProgress {
  readonly done: number;
  readonly total: number;
  readonly found: number;
}

export interface SweepOptions {
  readonly concurrency?: number;
  /** Abort signal from the operation layer; stops scheduling and probing. */
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: SweepProgress) => void;
  /** Minimum gap between progress callbacks (default 250ms). */
  readonly progressIntervalMs?: number;
}

export interface SweepResult {
  readonly hits: readonly LanHit[];
  /** True when the sweep stopped early because the caller cancelled. */
  readonly cancelled: boolean;
  readonly probed: number;
}

export async function runSweep(
  hosts: readonly string[],
  probe: (ip: string, signal?: AbortSignal) => Promise<LanHit | null>,
  options: SweepOptions = {},
): Promise<SweepResult> {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_SWEEP_CONCURRENCY);
  const interval = options.progressIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS;
  const { signal, onProgress } = options;

  const hits: LanHit[] = [];
  let next = 0;
  let probed = 0;
  let lastProgressAt = 0;

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

  return { hits, cancelled: signal?.aborted === true, probed };
}
