/**
 * Key-value settings port.
 *
 * The app needs *synchronous* reads for two things: the theme (so the first
 * frame is already correct) and the ports dataset fingerprint (so seeding can
 * decide without awaiting). `expo-sqlite/kv-store` provides exactly that on top
 * of the database we already ship, which is why M2 does not add
 * `react-native-mmkv`.
 *
 * The native implementation lives in ./kvStore.ts so this module stays pure and
 * tests can use an in-memory store.
 */

export interface SettingsStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** Keys used by the data layer (user-facing settings live in ./appSettings.ts). */
export const DATA_KEYS = {
  portsFingerprint: 'data.ports.fingerprint',
} as const;
