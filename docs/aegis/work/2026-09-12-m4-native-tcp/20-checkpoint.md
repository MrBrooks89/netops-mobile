# M4 native pivot: TCP connect/ping + port scanner - Checkpoint

- Task ID: 2026-09-12-m4-native-tcp
- Current todo: none — milestone complete.
- Active slice: done (all slices executed).
- Blocked on: none
- Next step: none. M4 closed at commit on `main`; M5 (ping + Wi-Fi) is the
  next milestone per the plan.

## Slice record

1. **Spike (#29)** — `react-native-tcp-socket@6.4.3` adopted (ADR-006) after
   source-level New-Arch verification: legacy `ReactPackage` over the
   RN 0.86.3 TurboModule interop layer, `RCTDeviceEventEmitter` events,
   Expo SDK 57 autolinking resolves it with no extra CLI.
2. **Seam + models (#30–31)** — capability interfaces
   (`src/platform/capabilities/tcp.ts`), typed reports
   (`src/core/model/tcp.ts`), `lookupTcpService` join, `parsePortInput`.
3. **Adapter (#32)** — `src/platform/android/tcp.ts`: event-socket connect
   with JS watchdog, device-verified `mapConnectError`, ping aggregation,
   worker-pool scan (concurrency 20 default / 50 cap, throttled progress,
   CANCELLED-on-abort). Registry lazy-`require` keeps jest/web/iOS safe.
4. **Screens (#33)** — TCP Connect, TCP Ping, Port Scanner screens +
   registry entries; port-list parsing shared via `parsePortList`
   (singles, ranges, dedup, 1024-port cap).
5. **Fixture + smoke (#34)** — `scripts/tcp-fixture.js` (echo 9701, scan
   block 9800–9899), `scripts/e2e-smoke.sh` script-driven smoke; Detox
   androidTest harness documented as a deviation (deferred with the rest of
   E2E tooling; see `docs/M4_VERIFICATION.md`).
6. **Device verification** — full pass recorded in
   `docs/M4_VERIFICATION.md`; three real bugs found and fixed (Android
   timeout-message mapping, pnpm hoist breaks for Metro, adb stability →
   `adbx` helper).
