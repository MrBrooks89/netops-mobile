# M5 device verification

Verified on the Android 16 emulator (KVM, API 36) with a dev build
containing the project's **first local Expo module** — `modules/netops`
(Kotlin half; plan #35, ADR trail M5+): `expo prebuild` regenerated
`android/` (CNG), `./gradlew assembleDebug` merged the module's manifest,
`adb install` (24s incremental; first full build 6m38s, 754 tasks), app
launched through the dev launcher, Metro on 8081.

## Result: M5 acceptance criteria met

| Criterion | Evidence |
|---|---|
| Ping stats for reachable hosts | TCP (default): `EXAMPLE.COM:443 (TCP) — 4/4 RECEIVED`, `min 57 / avg 496 / max 1006 / loss 0%`, probe lines `#1 ok 1006 ms … #4 ok 57 ms`. ICMP: `EXAMPLE.COM (ICMP, BEST-EFFORT) — 4/4 RECEIVED`, probes `#1..#4 reachable`, `min — / avg — / max — ms` (honest nulls — see D4). |
| Clean `TIMEOUT`/`UNREACHABLE` states | TCP to `192.0.2.1:443` (TEST-NET black hole): `0/4 RECEIVED`, `loss 100%`, every probe `#N failed (TIMEOUT)`. ICMP to the same host: `0/4 RECEIVED`, `loss 100%`, `#N failed (UNREACHABLE)`. No invented latencies anywhere. |
| Permission rationale card + settings deep-link | Wi-Fi screen pre-permission: "LOCATION PERMISSION NEEDED" card with "Allow location access". Granting via the system dialog ("While using the app") unlocks SSID `AndroidWifi` + BSSID — the exact gated fields. Denying (counts as don't-ask-again on the emulator): card flips to "The permission was permanently denied. Enable it in system settings…​" + "Open settings" button, which deep-links to the app's system settings page (verified: Archive/Uninstall/Permissions screen). The tool never crashes through any of it. |
| Wi-Fi "unavailable" placeholders, no blanks | With permission off: SSID/BSSID rows read `unavailable — needs location permission + Location Services on`; frequency (`2447 MHz`), channel (8), band (2.4 GHz), signal (−50 dBm), link speed, and transports (Wi-Fi) still render — Android allows those without location. With permission granted: SSID/BSSID fill in. Refresh re-reads live state. |
| ICMP labeled "best-effort"; TCP default | Method chips "TCP (default)" / "ICMP — best-effort"; ICMP mode shows the note "Best-effort reachability only (no timing data) — mobile apps cannot send real ICMP echoes." and hides the port field. Method resets to TCP on app restart (default). |
| Permission declarations appear in the build exactly from M5 | `aapt2 dump permissions` on the built APK lists `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `ACCESS_WIFI_STATE` (the module's own manifest; the app's CNG manifest declares none of them — netinfo's `ACCESS_NETWORK_STATE`/`ACCESS_WIFI_STATE` overlaps pre-existed from M3, the **location** pair is new at M5). |
| Both Kotlin and Swift halves compile | Kotlin: compiled into the APK (dex contains `netops.modules.netops.NetopsModule`; `ExpoModulesCore` initialized at app start; all four module functions answer at runtime). Swift: **type-checked only** — no macOS/mac runner available in this environment (recorded deviation; the Swift half mirrors the Kotlin surface and returns unavailable/null honestly, with the wifi-info entitlement + SimplePing notes in comments). Full compile deferred to the M8 iOS groundwork / a mac runner. |

## Verified user-confirmed decisions (M5 scope negotiation)

1. **One unified Ping tool.** The M4 `tcp-ping` screen became "Ping" with a
   TCP (default)/ICMP best-effort method toggle. The separate `icmp-ping`
   placeholder registry entry and its `ToolId` were removed; the tool id
   stays `tcp-ping` so history rows and deep links keep working.
2. **Permissions via Expo Modules calls** — `Permissions.getPermissionsWithPermissionsManager`/`askForPermissionsWithPermissionsManager`
   from `expo-modules-core`, driven through the module's typed
   `getWifiPermissions`/`requestWifiPermissions` (no `react-native-permissions`
   dependency added).
3. **Wi-Fi info is a live state read, not a run** — nothing is recorded to
   history; the screen has a Refresh button instead.

## One real bug found by this verification

**The registry handed the adapters the module factory instead of the
module.** `src/platform/registry.ts` read `const module = netops.netopsModule`
— the *function* — and passed it to `makeIcmpPingCapability`, so
`module.isReachable` was `undefined` and every ICMP run failed with
"undefined is not a function". Jest never caught it: the netops adapter
tests inject a real fake module handle, and the screen tests mock
`getCapabilities` wholesale — nothing exercised the registry's assembly
of the real adapter. Only the device did. Fixed by calling the lazy
accessor (`netops.netopsModule()`); the fix was verified live on the
emulator (ICMP reachable + unreachable both re-run after restart).

## Test/gate status

- 502/502 tests, 42 suites (was 473/38 at the M4 baseline; +29: ICMP
  stats model 4, Wi-Fi model 8, netops adapter 7, M5 screen tests 9,
  fixture/type fixes elsewhere).
- `tsc --noEmit`, ESLint, Prettier check: clean.
- Coverage thresholds ≥95% met on the new models (`core/model/ping.ts`,
  `core/model/wifi.ts` both added to the threshold map).
- Local full-suite runs use `--maxWorkers=4` on this loaded host; CI
  runners run the default worker count.

## Notes for future milestones

- The emulator's Wi-Fi is virtual; SSID reads `AndroidWifi` once
  permission + Location Services are on — the "unavailable" placeholder
  path is the *expected* first-run state, not a bug.
- `adb shell pm revoke com.anonymous.netopsmobile android.permission.ACCESS_FINE_LOCATION`
  resets the permission flow for re-testing (the app restarts on revoke —
  Android kills it).
- The react-hooks `set-state-in-effect` rule rejects calling an async
  helper that sets state from an effect even when every setState follows
  an await; the compliant shape is an inline async IIFE with an `alive`
  flag (see `src/features/wifi-info/index.tsx`).
- RNTL v14 + React 19: `fireEvent.press` state updates flush
  asynchronously — assertions after a press need `await waitFor(...)`
  (cost us a debugging detour; the M5 tests document the pattern).
