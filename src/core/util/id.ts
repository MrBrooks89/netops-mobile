/**
 * Identifier generation for persisted entities.
 *
 * Deliberately dependency-free: these ids are local row keys, not security
 * tokens, so `Math.random` is sufficient. The shape is
 * `<prefix>_<time-base36><random-base36>`, which sorts roughly by creation time
 * and is readable in the sqlite inspector.
 *
 * `random` is injectable so tests can assert exact ids.
 */

const RANDOM_WIDTH = 6;
const RANDOM_SPACE = 36 ** RANDOM_WIDTH;

export function createId(
  prefix: string,
  random: () => number = Math.random,
  now: () => number = Date.now,
): string {
  const time = now().toString(36);
  const suffix = Math.floor(random() * RANDOM_SPACE)
    .toString(36)
    .padStart(RANDOM_WIDTH, '0');
  return `${prefix}_${time}${suffix}`;
}

export const newHostId = (random?: () => number, now?: () => number) => createId('h', random, now);
export const newNetworkId = (random?: () => number, now?: () => number) =>
  createId('n', random, now);
export const newRunId = (random?: () => number, now?: () => number) => createId('r', random, now);
