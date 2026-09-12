# ADR-005: One operations path for networked tools

**Status:** Accepted (M3)
**Deciders:** implementation agent + repo owner (M3 approval)
**Date:** 2026-09-13 (M3 implementation)
**Relates to:** ADR-003 (storage/state), ADR-004 (synchronous data layer), plan §12/§14

## Context

M3 introduces the first networked features. They bring concerns every such tool
will share: loading and error state, cancellation, retry, offline handling, and
recording what happened in history. Writing that per tool would produce as many
variants as there are tools, and the plan already committed to TanStack Query for
networked work (§12) and to a capability indirection instead of platform checks
(§3.3).

M2 also left an inconsistency worth resolving now: calculator runs were recorded
by a screen-level hook (`useCalculatorHistory`) while operations record through
the new path — two ways to write history.

## Decision

1. **`useOperation(spec)` is the only way a networked tool runs.** It owns
   loading/error/data (React Query), cancellation (AbortController), retry, the
   offline short-circuit, and run persistence. A tool supplies its capability
   call, a summary line, and an input description.
2. **Capabilities, not platforms.** Tools call `getCapabilities().dnsResolve`;
   availability is data (`null` when absent), and a missing capability becomes a
   `CAPABILITY_UNAVAILABLE` result the UI can explain.
3. **Runs are recorded once per user-initiated operation**, in React Query's
   settle callbacks. An automatic retry that succeeds therefore does not leave a
   failure in history, and a cancellation records nothing at all — it is a user
   action, not a result.
4. **Offline is checked before the network**, so an offline user gets an instant
   friendly message instead of a timeout, and no retries are burned while
   offline. Unknown connectivity counts as online: attempting gives a better
   error than refusing to try.
5. **Calculators keep their debounce recorder.** They run continuously as the
   user types, so there is no explicit "run" to wrap in an operation. The
   duplicated-looking paths are genuinely different: one records on settle of an
   explicit action, the other records on a settled input.

## Consequences

- Every networked tool gets the same states, and a new one costs a spec object
  rather than a state machine.
- History summaries are produced by the tool (`summarize`), so the list stays
  readable without the history screen knowing anything about DNS.
- The error surface is the taxonomy: `useOperation` exposes a `ToolError`, and
  `OperationStatus` renders the two audiences (plain sentence + technical detail)
  in one place.
- `useCalculatorHistory` remains a second writer to the runs repository. If a
  third appears, the recorder should move behind the same seam.
