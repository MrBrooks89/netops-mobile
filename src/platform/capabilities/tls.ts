/**
 * TLS inspection capability (M6, plan #42) — chain capture for display.
 *
 * The native half presents a capture-only trust path (§16.7): it records
 * the chain the server sends, the negotiated version/cipher, and hands
 * back a typed report. It never disables validation anywhere else.
 */

import type { Result } from '../../core/result/result';
import type { TlsReport } from '../../core/model/tls';

export interface TlsInspectOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface TlsInspectCapability {
  inspect(host: string, port: number, options?: TlsInspectOptions): Promise<Result<TlsReport>>;
}

export const DEFAULT_TLS_TIMEOUT_MS = 10_000;
