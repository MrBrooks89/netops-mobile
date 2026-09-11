# M2 device verification

Verified on the Android 16 emulator (KVM, API 36) with the M2 dev-client build.

## Result: M2 acceptance criteria met

| Criterion | Evidence |
|---|---|
| Hosts and networks can be created, edited, deleted, tagged, and survive a restart | Created a host (`192.168.1.1`) and a network (`10.20.0.0/16`) on the device, force-stopped and relaunched the app, and both were still listed. `sqlite3` on the device confirms the rows in `hosts` / `networks`. |
| Calculator runs are recorded in history when the toggle is on | Opening the subnet calculator recorded a run; the History tab showed "1 run" with tool, status, input and timestamp. `runs` count in the database went 2 → 3 after a run with recording enabled. |
| Recording is suppressed when the toggle is off | With recording off, opening the wildcard calculator left the run count unchanged (2 → 2); the kv-store held `settings.historyEnabled=false`. |
| History is capped and purgeable from Settings | Settings → "Clear history now" → confirm: `runs` went 3 → 0 and the on-screen counts updated. Pruning keeps the newest N (unit-tested) and runs at startup and after every write. |
| Exports open in other apps via the Share sheet | Tapping JSON opened the system share sheet: "Sharing 1 file — netops-history-…json" with Quick Share / Drive / Gmail targets. |
| Migrations survive a version bump with data intact | `schema_migrations` on the device holds v1 (`initial schema`) and v2 (`list indexes`). A Jest test seeds rows at v1, applies v2 and asserts every value is unchanged. |
| Zero regressions against M1 | 366 Jest tests green; the dashboard and all four M1 calculators still render and compute on the device. |
| Settings screen v1 (theme, history, retention) | Theme set to Light, app restarted, and the rendered background was sampled from a screenshot as `#f6f8fa` — the light theme token — proving the preference was read at boot and applied. |

Ports: the table holds 311 rows seeded from the bundled dataset, and the
reference screen reads from the database (`ports.fingerprint` recorded in the
kv-store).

## Two real bugs found by this verification

1. **`src/app/` hijacked expo-router's routes root.** Creating
   `src/app/AppProviders.tsx` made expo-router log *"Using src/app as the root
   directory for Expo Router"* and pick it as the routes directory, so every
   route in `app/` disappeared and the app showed *Unmatched Route* for all
   URLs, including a plain launcher start. Fixed by moving the provider to
   `src/providers/`. **An earlier version of this document blamed the
   asynchronous bootstrap gate for this symptom — that diagnosis was wrong.**
   The synchronous bootstrap was still worth keeping (see ADR-004), but it was
   not the cause.
2. **History entries were silently dropped.** Core reports carry `bigint` values
   (`IpAddress.int`), and `JSON.stringify` throws on a bigint. Because history
   recording is best-effort, the failure was invisible: the database stayed
   empty while the calculator worked. Fixed with a bigint-aware serialiser
   (`toJson` in `runs.ts`), a regression test, and a `__DEV__` warning so a
   future payload problem cannot hide.

## Also fixed during verification

The history toggle did not take effect until a restart: `AppData` carried a
*boot-time snapshot* of `appSettings` while the provider held the live value —
two owners for one setting. `appSettings` is now removed from `AppData` and the
recording hook reads the live settings from `useAppSettings()`.

## Known follow-ups (not blockers)

- The Settings screen loads its "stored on this device" counts on mount, so they
  can be stale if runs are recorded while it is open. Refreshing on focus would
  fix it.
- Single-choice chips (`System`/`Light`/`Dark`, retention) do not report
  `selected=true` through the Android accessibility tree after a fresh render,
  even though the selection is correct and persists. Using
  `accessibilityRole="radio"` with `checked` would report it properly and make it
  assertable from tests.
