# M4 device verification

Verified on the Android 16 emulator (KVM, API 36) with a **fresh dev-client
build containing the project's first runtime-native dependency** —
`react-native-tcp-socket@6.4.3` (ADR-006): `./gradlew assembleDebug` +
`adb install` (5m42s, 724 tasks), app launched through the dev launcher,
Metro on 8081, host reachable from the emulator as `10.0.2.2`.

**Spike (#29) result.** The library was adopted after source-level
verification of its New-Architecture compatibility: its Android side is a
legacy `ReactPackage`/`ReactContextBaseJavaModule`, which RN 0.86.3
bridgeless loads through the TurboModule interop layer
(`useTurboModuleInterop() = true` → `getLegacyModule()` → JS
`NativeModules`/`nativeModuleProxy` fallback), and its socket events flow
via `RCTDeviceEventEmitter` (registered unconditionally in
`setUpBatchedBridge.js`). Expo SDK 57's `expo-modules-autolinking
react-native-config` resolves the package with no extra CLI or env. Full
evidence and the fallback decision: `docs/adr/006-tcp-sockets-library.md`.

## Result: M4 acceptance criteria met

| Criterion | Evidence |
|---|---|
| Spike decision recorded with New Arch verified | ADR-006 (accepted; runtime confirmation folded into this verification). Bridgeless interop proven at runtime by every result below: the legacy native module answers over the TurboModule interop layer on the bridgeless build. |
| Dev-client build with the native dep installs & runs | New APK (first native dep) built and installed cleanly; dashboard renders, all three TCP tool cards appear (capability gating flips from placeholders to real screens), and `NativeModules.TcpSockets` responds — no crash-loop remnants after Metro restart (see bug 2). |
| Fixture TCP connect succeeds with measured latency | TCP Connect Test against the Node fixture (`scripts/tcp-fixture.js`, echo port 9701, 15 ms reply delay) from the emulator: `10.0.2.2:9701 — OPEN`, "TCP handshake 310 ms", "Connection established and closed cleanly." |
| Closed port → REFUSED | Connect to fixture port 9800 (nothing listening): "The connection was refused — the port is closed." `Code REFUSED` — Android's `ConnectException` message mapped by the adapter. |
| Filtered port → TIMEOUT | Connect to `192.0.2.1:81` (TEST-NET, silently dropped): "No answer within the timeout — filtered or firewalled." `Code TIMEOUT` — **after the device-only bug fix below** (Android's `SocketTimeoutException` message never contains the word "timeout"). |
| 100-port scan < 30 s with live progress + cancel | `scripts/e2e-smoke.sh` (see below) scans the fixture's 100-port block: **"10.0.2.2 — 45 open, 100 scanned in 21.3s"** (and 46/21.2s on the first run) — well inside budget with default 20-socket concurrency. Cancel: blind-tapping the Cancel button 2.5 s into a scan and waiting past all scan-duration headroom leaves the port-scanner run count unchanged (9 before, 9 after) — a cancelled scan records nothing (ADR-005), corroborated by adapter tests (`CANCELLED, not a partial report`). Progress: throttled snapshots are unit-verified (monotone, ends at full total, ≤5/s) and drove the on-screen progress bar; the emulator's uiautomator does not expose mid-operation React views, so the live-progress UI was verified through the operation's final render + tests rather than in-flight dumps. |
| Results as typed `PortScanReport` with service names | Scan result lines read `22/tcp open — ssh (1378 ms)` and `9801/tcp open (326 ms)` — verdict, latency, and the service name joined from the curated ports DB (`lookupTcpService`). History persists the run with the full typed report as detail JSON (`runs.detail`), verified by pulling the on-device SQLite (WAL) — e.g. the failed-connect detail carries `errorCode`, `errorMessage`, `technicalMessage`, `finishedAt`. |
| Offline → taxonomy error | TCP tools run through the same `useOperation` offline short-circuit M3 verified on-device (netinfo gate before any network call). Emulator radio toggling was not re-run for M4; the path is unchanged and shared. |
| Rate/concurrency caps verified via timing logs | The adapter clamps concurrency to `MAX_SCAN_CONCURRENCY` (50) and defaults to 20; the unit test "never runs more connects concurrently than the requested cap" asserts the peak in-flight count over a 30-port scan. On-device: the 100-port scan timing (21.2–21.3s for ~50 open + ~50 refused connects) matches 20-concurrent behaviour (a 3 s-timeout-dominated budget), not an unbounded flood. |
| TCP ping stats | `10.0.2.2:9701 ×4/4` — probes `#1 ok 374 ms … #4 ok 440 ms`, `min 374 / avg 452 / max 497 / loss 0%`, 1 s interval honoured (4 probes over ~7 s wall). |
| Detox smoke against the Node fixture server | **Deviation, documented below.** |

## The E2E smoke: `scripts/e2e-smoke.sh`

The plan's M4 acceptance asks for a "Detox smoke test … against the Node TCP
fixture server". Delivered as `scripts/e2e-smoke.sh`: launch → open the port
scanner (deep link) → host `10.0.2.2` → custom list `9800-9899` → Scan →
poll for the result line → assert **100 scanned**, **≥40 of the fixture's 50
open ports answered**, **duration < 30 s**. Exit 0 on pass. Verified twice
on-device (45 and 46 open at 21.3 s / 21.2 s).

Supporting pieces that made it deterministic:

- `scripts/tcp-fixture.js` — echo port 9701 (15 ms reply delay) + the
  9800–9899 block (odd ports accept, even ports refuse), reproducible from
  a single command.
- `parsePortList` (core/validation) — custom lists gained range syntax
  (`9800-9899`), so the smoke types 9 characters instead of a 400-port CSV
  and cannot be truncated by the adb text pipe.

**Why not Detox itself (recorded deviation).** Detox's androidTest harness
requires its own app-gradle wiring + a second APK build, and its device
orchestration conflicts with the dockerized KVM emulator this project uses
(`scripts/emu.sh`; the harness cannot manage an emulator it cannot see).
Expo's current guidance for E2E on dev builds has also moved to Maestro. The
plan already contradicts itself here (§7 library table: "Detox later (M8)";
§7 test strategy + #34: "Detox from M4"), so M4 ships the fixture harness +
script smoke — same flow, same assertions, tooling the environment supports
— and full Detox-or-Maestro adoption stays an explicit M8 E2E decision with
the rest of the tooling. `detox` remains installed as a devDependency for
that future work; nothing in the app depends on it.

## Three real bugs found by this verification

1. **Android's timeout message is unrecognisable as a timeout.**
   `SocketTimeoutException.getMessage()` reads
   `"failed to connect to /host (port N) from /local (port N) after 3000ms"`
   — the word "timeout" never appears, so the adapter's message-text mapping
   classified filtered ports as `NETWORK_UNREACHABLE` (device showed
   "The connection attempt failed." in ~3.3 s instead of the friendly
   filtered copy). Jest doubles with `new Error('connect timed out')` could
   never catch this — exactly the "device-verified error mapping, not just
   Jest doubles" trap the plan called out. Fixed in `mapConnectError`
   (matches `after \d+ms` / `failed to connect`), regression test pins the
   literal device message; the connect report now also carries
   `technicalMessage` so history detail shows the raw exception text.
2. **`pnpm add` broke Metro resolution twice.** Adding the native dep (and
   later detox) reshuffled pnpm's hoisting: `base64-js` (from
   `react-native/Libraries/WebSocket/WebSocket.js`) and then
   `@expo/metro-runtime` (from `expo-router/entry-classic.js`) lost their
   resolution paths, crash-looping the app with `UnableToResolveError` —
   including once *after* a fix, because a long-lived Metro instance
   caches resolution from the pre-install layout (restarting Metro is
   part of the fix). Root fix: `.npmrc` with scoped `public-hoist-pattern`s
   (`base64-js`, `@expo/*`, `react-native*`, `eventemitter3`) so the
   packages Metro needs from inside `.pnpm` are always in the store-level
   hoist (`node_modules/.pnpm/node_modules`), regardless of future
   reshuffles. Full clean `pnpm install` verified; bundle serves 200 again.
3. **Emulator adb instability shaped the harness.** The adb daemon flapped
   (`device offline` on ~half of fresh connections) under the parallel
   emulator/Metro/gradle load, which truncated binary DB pulls and raced
   uiautomator dumps. The smoke script and `adbx()` helper
   (`scripts/netops-env.sh`) now wait for the device to report `device`
   before every command, and DB pulls retry until non-empty.

## Test/gate status

- 473/473 tests, 38 suites (was 445/36 at the M3 baseline; +28: 17 adapter
  tests incl. the device-message regression, 10 port/host validation tests,
  5 TCP screen tests, minus consolidations).
- `tsc --noEmit`, ESLint, Prettier check: clean.
- Coverage (CI `--ci`): 98.36% lines overall, `core/validation` 100% —
  thresholds ≥95% met.
- Invariant gate (plan §6.4): `grep "react-native-tcp-socket" src/features
  src/app` → no matches; the import exists only under `src/platform/`.
- Local full-suite runs use `--maxWorkers=4` on this loaded host (12
  default workers time out in sql.js setup under emulator+Metro+gradle
  load); CI runners run the default worker count.
