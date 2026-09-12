# M4 native pivot: TCP connect/ping + port scanner - Evidence

Primary record: `docs/M4_VERIFICATION.md` (device verification table, bug
findings, gate status). Summary of what was captured:

## Gates (all fresh at closeout)

- Jest: 473/473 tests, 38/38 suites — includes 17 adapter tests over the
  real `react-native-tcp-socket` API surface (FakeSocket event machine),
  5 TCP screen tests, 14 validation tests incl. `parsePortList`.
- Coverage (CI mode): 98.36% lines overall; `core/validation` 100%;
  ≥95% thresholds met (no gate failures).
- `tsc --noEmit` clean; ESLint 0 warnings; Prettier check clean.
- Seam invariant (plan §6.4): no `react-native-tcp-socket` import outside
  `src/platform/android/` (grep over `src/features` + `src/app`: clean).

## Device (Android 16 emulator, API 36, bridgeless RN 0.86.3, API 57)

- Fresh dev-client APK with the native dep: built, installed, launched;
  `NativeModules.TcpSockets` answers over the TurboModule interop layer.
- Connect: fixture `10.0.2.2:9701` OPEN, handshake 310 ms.
- REFUSED: `10.0.2.2:9800` closed-port copy, `Code REFUSED`.
- TIMEOUT: `192.0.2.1:81` filtered copy, `Code TIMEOUT` (after the
  device-message mapping fix; regression test pins the literal Android
  exception text).
- Ping: `×4/4 RECEIVED`, min/avg/max/loss rendered from `pingStats`.
- Scan: `scripts/e2e-smoke.sh` twice → "45 open, 100 scanned in 21.3s" /
  "46 open, 100 scanned in 21.2s" (< 30 s budget); service names on open
  ports (`22/tcp open — ssh (1378 ms)`); typed `PortScanReport` in the
  `runs` table (pulled SQLite + WAL).
- Cancel: blind-tap mid-scan + post-headroom wait → run count unchanged
  (nothing recorded; ADR-005 cancel semantics), corroborated by adapter
  CANCELLED tests.

## Bugs found and fixed during verification

1. Android `SocketTimeoutException` message (`"failed to connect … after
   3000ms"`) lacks "timeout" → filtered ports misclassified as
   NETWORK_UNREACHABLE. Fixed `mapConnectError` + regression test +
   `technicalMessage` on the report.
2. pnpm hoist reshuffles (after `pnpm add` of the native dep, then detox)
   broke Metro resolution of `base64-js` and `@expo/metro-runtime`;
   app crash-looped on stale Metro cache. Fixed via `.npmrc`
   `public-hoist-pattern`s + clean reinstall + Metro restart.
3. adb daemon flapping under host load → truncated DB pulls and stale
   uiautomator dumps. Fixed with the `adbx` wait-for-device helper
   (`scripts/netops-env.sh`) and retry-until-nonempty pulls.
