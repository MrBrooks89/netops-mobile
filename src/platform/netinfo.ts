/**
 * Connectivity awareness.
 *
 * The offline *error* is constructed here (pure, so it is testable) and the
 * subscription is a thin hook. Operations consult this before touching the
 * network so an offline user gets an instant, friendly message instead of a
 * five-second timeout.
 */

import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { toolError, type ToolError } from '../core/result/toolError';

/** Friendly copy for the offline case (M3 acceptance). */
export function offlineToolError(): ToolError {
  return toolError('NETWORK_UNREACHABLE', 'You appear to be offline.', {
    technical: 'netinfo: isConnected === false',
    retryable: true,
  });
}

/**
 * True only when the platform positively reports no connection. An unknown state
 * (`null`) is treated as online: attempting the request gives a better error
 * than refusing to try.
 */
export function useIsOffline(): boolean {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setOffline(state.isConnected === false);
    });
    return unsubscribe;
  }, []);

  return offline;
}
