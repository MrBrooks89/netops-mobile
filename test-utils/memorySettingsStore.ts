/**
 * In-memory SettingsStore for tests. Test-only — never import from app code.
 */

import type { SettingsStore } from '../src/data/settings/store';

export function createMemorySettingsStore(initial: Record<string, string> = {}): SettingsStore & {
  readonly snapshot: () => Record<string, string>;
} {
  const values = new Map<string, string>(Object.entries(initial));
  return {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => {
      values.set(key, value);
    },
    remove: (key) => {
      values.delete(key);
    },
    snapshot: () => Object.fromEntries(values),
  };
}
