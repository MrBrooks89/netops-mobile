/**
 * Minimal Result type for the pure core.
 *
 * Exceptions in `core` are reserved for programmer errors (invariants,
 * assertions). All expected failures — bad input, network states, missing
 * capabilities — flow through Result values so feature code never needs
 * try/catch around domain logic.
 */

import type { ToolError } from './toolError';

export type Result<T, E = ToolError> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** Unwrap the value or throw the error — use only in tests and assertions. */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw r.error;
}

/** Map the value, preserve the error. */
export function map<T, U, E>(r: Result<T, E>, f: (v: T) => U): Result<U, E> {
  return r.ok ? ok(f(r.value)) : r;
}

/** Chain a Result-returning function onto a Result. */
export function flatMap<T, U, E>(r: Result<T, E>, f: (v: T) => Result<U, E>): Result<U, E> {
  return r.ok ? f(r.value) : r;
}

/**
 * Collect a list of Results into a Result of list.
 * Fail-fast on the first error (order-preserving).
 */
export function all<T, E>(rs: Result<T, E>[]): Result<T[], E> {
  const out: T[] = [];
  for (const r of rs) {
    if (!r.ok) return r;
    out.push(r.value);
  }
  return ok(out);
}
