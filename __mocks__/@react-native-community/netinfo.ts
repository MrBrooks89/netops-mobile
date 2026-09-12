/**
 * Automatic Jest mock for netinfo.
 *
 * Connectivity is native, and the offline path is an acceptance criterion, so
 * tests need to drive it: call `setConnected(false)` to simulate being offline.
 */

type Listener = (state: {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}) => void;

let currentState = {
  isConnected: true as boolean | null,
  isInternetReachable: true as boolean | null,
};
const listeners = new Set<Listener>();

const NetInfo = {
  addEventListener(listener: Listener): () => void {
    listeners.add(listener);
    listener(currentState);
    return () => {
      listeners.delete(listener);
    };
  },
  async fetch() {
    return currentState;
  },
  /** Test helper: change connectivity and notify subscribers. */
  setConnected(isConnected: boolean | null): void {
    currentState = { isConnected, isInternetReachable: isConnected };
    for (const listener of listeners) listener(currentState);
  },
  reset(): void {
    currentState = { isConnected: true, isInternetReachable: true };
    listeners.clear();
  },
};

export default NetInfo;
