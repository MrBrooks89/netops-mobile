# ADR-004: A synchronous data layer

**Status:** Accepted (M2)
**Deciders:** implementation agent + repo owner (M2 approval)
**Date:** 2026-09-13 (M2 implementation)
**Relates to:** ADR-003 (storage choices), plan §13 (storage), docs/M2_VERIFICATION.md

## Context

The plan assumed an asynchronous data layer: `expo-sqlite`'s promise API,
`async` repositories, and a bootstrap that opens the database before the UI can
render. M2 was implemented that way first, with the root layout gating its
children behind a loading state while storage opened.

Device verification then showed the app failing to route at all (*Unmatched
Route* for every URL). The immediate cause turned out to be unrelated — a
`src/app/` directory hijacking expo-router's routes root — but investigating it
exposed the gate as a latent hazard: **anything that stops the root layout
rendering `<Stack>` on the first frame breaks routing**, because expo-router
builds its route tree from that render.

## Decision

Make the whole data layer synchronous:

- `SqlDriver` methods (`exec`, `run`, `all`, `first`, `transaction`) return
  values, not promises, backed by `openDatabaseSync` / `execSync` / `runSync` /
  `getAllSync` / `getFirstSync` / `withTransactionSync`.
- `migrate()` and `openAppData()` are synchronous functions returning `Result`.
- The root layout bootstraps storage in a `useState` initialiser, so the first
  render already has repositories and the navigator mounts immediately. There is
  no loading state to gate on and no transient "not ready" case for screens.
- Repositories may still be declared `async` where a caller finds it convenient;
  `await` on a plain value is a no-op. Transaction callbacks must be
  synchronous — an `async` callback would let the transaction commit before its
  statements ran.

## Rationale

1. **The volumes are tiny.** A few hundred rows, single-user, local. Async I/O
   buys nothing and costs a state machine.
2. **It removes a failure mode instead of managing it.** With synchronous
   bootstrap there is no window in which the app exists without storage, so no
   screen needs a loading branch and the navigator is never deferred.
3. **Both drivers are synchronous anyway.** sql.js (the test driver) was always
   synchronous; expo-sqlite exposes the same operations synchronously.
4. **Errors stay explicit.** `Result` still carries `STORAGE_ERROR`; the root
   layout shows a recovery screen when storage genuinely cannot be opened. That
   is a terminal state, not a transient one, so replacing the navigator there is
   acceptable.

## Consequences

- Migration and seeding run on the JS thread at startup. Seeding is batched
  (200 rows per INSERT) to keep that in the low milliseconds.
- A future move to a remote or genuinely slow store would need the async shape
  back. The seam is `SqlDriver`; repositories are written against it, so the
  change is contained — but it would also reintroduce the gating problem, which
  is why the recommendation then would be to keep the navigator mounted and
  give screens an explicit loading state rather than gating the root layout.
- Tests needed no changes beyond dropping `Promise<…>` from a helper signature:
  `await` on a value is a no-op, so the existing suite kept working.
