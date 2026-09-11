/**
 * The only module that touches `expo-sqlite/kv-store`.
 *
 * Kept separate so every other module (and every test) depends on the pure
 * SettingsStore interface rather than on a native module.
 */

import Storage from 'expo-sqlite/kv-store';
import type { SettingsStore } from './store';

export function createKvSettingsStore(): SettingsStore {
  return {
    get: (key) => Storage.getItemSync(key),
    set: (key, value) => Storage.setItemSync(key, value),
    remove: (key) => Storage.removeItemSync(key),
  };
}
