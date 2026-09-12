/**
 * React Query provider.
 *
 * Queries (rare in this app) get a short stale window; mutations are the main
 * use, and their retry behaviour is decided per operation (see useOperation) so
 * a non-retryable failure like REFUSED never retries.
 */

import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export interface QueryClientOptions {
  /** Cache retention for inactive entries; 0 in tests so timers never linger. */
  readonly gcTime?: number;
  /** Backoff before a retry; 0 in tests to keep them fast. */
  readonly retryDelay?: number;
}

export function createQueryClient(options: QueryClientOptions = {}): QueryClient {
  // gcTime/retryDelay live under queries/mutations in v5; putting them at the
  // top level is silently ignored.
  const timing = {
    ...(options.gcTime === undefined ? {} : { gcTime: options.gcTime }),
    ...(options.retryDelay === undefined ? {} : { retryDelay: options.retryDelay }),
  };

  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 30_000,
        // Mobile networks flap; refetching on every focus is noisy for a tool
        // that the user drives explicitly.
        refetchOnWindowFocus: false,
        ...timing,
      },
      // Operations opt into retry themselves (useOperation), so the client
      // default stays out of the way.
      mutations: { retry: 0, ...timing },
    },
  });
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(createQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
