# ADR-003: Storage and state choices for the persistence milestone

**Status:** Accepted (M2)
**Deciders:** implementation agent + repo owner (M2 approval)
**Date:** 2026-09-13 (M2 implementation)
**Relates to:** plan D6/D7 (library table), §12 (state) and §13 (storage)

## Context

The plan specified `expo-sqlite` for entities, `react-native-mmkv` for settings,
`zustand` for global state, and left one explicit open question: *"Settings +
recents → react-native-mmkv (synchronous, fast, no async-gate complexity).
Alternative if we want one fewer native dep: a SQLite `settings` table —
acceptable, decide at M0."*

M2 had to settle those choices while building the data layer.

## Decisions

### 1. Settings use `expo-sqlite/kv-store`, not `react-native-mmkv`

The reason to prefer MMKV was synchronous reads: the theme must be correct on
the first frame, and a seeding decision should not need an `await`. Expo ships a
key-value store **backed by the SQLite database we already depend on**, with the
same synchronous API (`getItemSync`/`setItemSync`).

So we get the property that motivated MMKV without a second native storage
engine. The plan's "one fewer lib" alternative is satisfied without giving up
synchronous reads.

### 2. No `zustand` yet — React context is enough

The plan allocated two zustand slices (settings, recents). At M2 there is
exactly one piece of genuinely global state (settings + the repositories), it is
read by three screens, and it is written in one place. A context provider with
`useApp()`/`useAppSettings()` is ~80 lines, has no store lifecycle to reason
about, and keeps "state lives at the lowest level that needs it" (plan §12)
literally true.

Recents and any cross-screen cache will arrive with the dashboard work in M7;
if a store is needed then, the provider is a contained seam to replace.

### 3. `SqlDriver` port, with real SQLite in Jest

Repositories depend on a narrow interface rather than `expo-sqlite` directly,
and `test-utils/sqljsDriver.ts` implements it with sql.js (SQLite compiled to
WebAssembly). The risk in a persistence layer is the SQL — schema, constraints,
migrations, pruning — and this runs the *same* statements through a real SQLite
engine in CI, including the version-bump and rollback tests. The alternative
(a hand-written fake) would have tested the fake.

Consequence: `sql.js` is a devDependency. The native edges (`db/driver.ts`,
`export/share.ts`, `settings/kvStore.ts`) cannot run under Jest and are excluded
from coverage; they are verified on a device.

### 4. One owner for saved-entity CRUD

`savedEntity.ts` implements hosts and networks once, parameterised by a
type-checked table config. Table and column names are literal unions, so the
interpolated SQL cannot receive user input.

## Consequences

- Fewer dependencies than the plan listed (no MMKV, no zustand at M2). Both can
  still be added later behind seams that already exist.
- Settings reads are synchronous, so there is no theme flash and no loading gate
  for preferences; the database itself still has an async startup, which the
  provider hides behind a loading view.
- The test suite runs real SQL in CI, which is slower than fake objects but is
  the only way these bugs get caught before a device.
- `sql.js` must be kept in step with the SQLite the app actually ships;
  differences in SQLite version could mask a problem. The device verification
  for each milestone is the backstop.
