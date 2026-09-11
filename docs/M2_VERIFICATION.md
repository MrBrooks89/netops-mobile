# M2 device verification — findings

Verified on the Android 16 emulator with the M2 dev-client build.

## Blocker: cold start does not mount the navigator

**Symptom.** On launch the app shows expo-router's *Unmatched Route* screen
(`netops:///`), and deep links to valid routes (e.g.
`netops://tool/subnet-calculator`) show the same. No route resolves, so the app
is unusable at startup.

**Cause.** `src/app/AppProviders.tsx` gates its children behind the asynchronous
database bootstrap:

```tsx
{boot.status === 'loading' && <LoadingView />}
{value && <AppContext.Provider value={value}>{children}</AppContext.Provider>}
```

`children` is the expo-router `<Stack>` from `app/_layout.tsx`. expo-router must
mount the navigator during the first render to build its route tree; deferring it
while storage opens leaves the router with no routes, and the unmatched-route
screen sticks. M1 had no provider gate, which is why this appeared only now.

**Not the cause.** The empty-path URL is a red herring: a normal launcher start
(no deep link) fails identically.

## Fix options

1. **Synchronous bootstrap (preferred).** `expo-sqlite` exposes a synchronous API
   (`openDatabaseSync`, `execSync`, `runSync`, `getAllSync`, `getFirstSync`,
   `withTransactionSync`) and the settings store is already synchronous. Making
   the `SqlDriver` port synchronous removes the loading state entirely: the first
   render already has data, the `<Stack>` mounts immediately, and routing works.
   The test driver (sql.js) is synchronous too, so `await` in existing tests
   keeps working; the migration runner, repositories and bootstrap lose their
   `Promise` wrapping.
2. **Deferred repositories.** Keep the async open, always render `<Stack>`, and
   hand screens repositories that `await` an internal readiness promise. Fixes
   routing without changing the port, at the cost of wrapper boilerplate for
   every repository method.
3. **Gate below the navigator.** Render `<Stack>` unconditionally and have each
   screen handle a not-ready context. Rejected: it pushes the same null-check
   into every screen, which is what the gate was avoiding.

Option 1 is recommended: it is the smallest total change, removes a state
machine rather than adding one, and matches how the storage is actually used
(small, local, synchronous reads).

## Not yet verified on device

Everything else in M2 is unverified on device because of the blocker above:
saved entities surviving a restart, history recording, exports through the share
sheet, theme switching, and retention pruning. The data layer behind them is
covered by 365 Jest tests against real SQLite.
