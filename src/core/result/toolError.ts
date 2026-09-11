/**
 * Typed error taxonomy shared by every tool.
 *
 * One closed set of codes covering validation, network, permission, and
 * capability failures. Every layer maps its platform-specific errors into
 * this taxonomy; UI renders `message` (beginner-friendly) with optional
 * `technical` details (engineer-friendly, collapsible).
 *
 * ToolError extends Error so it carries a stack trace, integrates with
 * Jest's toThrow(), and satisfies `unknown`-catch ergonomics at boundaries.
 */

export type ToolErrorCode =
  | 'INVALID_INPUT'
  | 'NETWORK_UNREACHABLE'
  | 'DNS_FAILURE'
  | 'TIMEOUT'
  | 'REFUSED'
  | 'UNREACHABLE_PORT'
  | 'RESET'
  | 'PERMISSION_DENIED'
  | 'CAPABILITY_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'NATIVE_ERROR'
  | 'CANCELLED'
  | 'STORAGE_ERROR'
  | 'UNKNOWN';

export class ToolError extends Error {
  readonly code: ToolErrorCode;
  /** Raw technical detail for the collapsible "technical details" block. */
  readonly technical?: string;
  /** Can retrying the operation plausibly succeed? */
  readonly retryable: boolean;

  constructor(
    code: ToolErrorCode,
    message: string,
    opts: { technical?: string; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'ToolError';
    this.code = code;
    this.technical = opts.technical;
    this.retryable = opts.retryable ?? DEFAULT_RETRYABLE[code];
  }
}

export const toolError = (
  code: ToolErrorCode,
  message: string,
  opts: { technical?: string; retryable?: boolean; cause?: unknown } = {},
): ToolError => new ToolError(code, message, opts);

const DEFAULT_RETRYABLE: Record<ToolErrorCode, boolean> = {
  INVALID_INPUT: false,
  NETWORK_UNREACHABLE: true,
  DNS_FAILURE: true,
  TIMEOUT: true,
  REFUSED: false,
  UNREACHABLE_PORT: false,
  RESET: true,
  PERMISSION_DENIED: false,
  CAPABILITY_UNAVAILABLE: false,
  RATE_LIMITED: true,
  NATIVE_ERROR: true,
  CANCELLED: false,
  STORAGE_ERROR: true,
  UNKNOWN: true,
};

/** Narrow an unknown caught value into a ToolError (fallback: UNKNOWN). */
export function asToolError(e: unknown): ToolError {
  if (e instanceof ToolError) return e;
  const message = e instanceof Error ? e.message : String(e);
  return toolError('UNKNOWN', message, { technical: String(e), cause: e });
}
