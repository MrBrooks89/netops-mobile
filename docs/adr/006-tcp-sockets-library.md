# ADR-006: TCP sockets via react-native-tcp-socket (community library)

**Status:** Accepted (M4) — runtime-confirmed on device (bridgeless interop verified; see `docs/M4_VERIFICATION.md`)
**Deciders:** implementation agent + repo owner (M4 approval)
**Date:** 2026-09-13 (M4 spike, plan #29 / D2 / D13)
**Relates to:** ADR-001 (CNG + dev-client), ADR-005 (operations path), plan §6.5 native strategy, §7 library table (TCP row), §17 M4

## Context

M4 needs raw TCP sockets for the connect test, TCP ping, and port scanner.
Plan D2 left the choice between (a) the community library
`react-native-tcp-socket` and (b) a ~200-line custom Expo module
(Kotlin `Socket` / Swift `Network.framework`), gated on one spike
(§17 M4: "spike first"): the library must be maintained, compatible with
the **New Architecture (bridgeless)**, and feasible for batched scanning.
D13 adds: verify React 19 / bridgeless interop for chosen native libs —
"don't get surprised in M4".

The project builds with `newArchEnabled=true` (bridgeless, Fabric) on
Expo SDK 57 / RN 0.86.3, so the interop question is decisive, not academic.

## Evidence (spike, 2026-09)

**Maintenance.** Actively maintained: v6.4.3 published 2026-09-10 (semantic
release, ~yearly minor with timely fixes); 6.3.0 added Android 15
concurrent-connection compatibility (2025-04); TLS via BouncyCastle 1.78.1.
Single maintainer (Rapsssito) — a real but acceptable risk for a lib of this
size, and the fallback (b) remains small.

**New Architecture / bridgeless compatibility — verified in RN 0.86.3
sources, not assumed.** The library's Android side is a *legacy-architecture*
module (`ReactContextBaseJavaModule` + `ReactPackage`, no TurboModule
codegen). RN 0.86.3 still loads exactly this shape through the TurboModule
interop layer:

- `ReactNativeNewArchitectureFeatureFlagsDefaults.kt` (applies whenever the
  new architecture is enabled) sets `useTurboModuleInterop() = true`.
- `ReactPackageTurboModuleManagerDelegate.getLegacyModule()` then resolves
  legacy `ReactPackage` modules when a TurboModule is not registered, gated
  on `shouldEnableLegacyModuleInterop` (= bridgeless && interop).
- JS side: `TurboModuleRegistry.js` → `NativeModules[name]` →
  `global.nativeModuleProxy` → `TurboModuleBinding` constructed with a legacy
  module provider (TurboModuleBinding.cpp keeps both bindings).
- Socket events: the module emits through `DeviceEventManagerModule.RCTDeviceEventEmitter`;
  in bridgeless, `BridgelessReactContext.emitDeviceEvent` maps that to
  `callFunctionOnModule("RCTDeviceEventEmitter", "emit", …)`, and
  `setUpBatchedBridge.js` registers `RCTDeviceEventEmitter` as a callable
  module **unconditionally** (bridgeless included). `NativeEventEmitter`
  over the module object (`Socket.js`/`Globals.js`) uses the standard
  `addListener`/`removeListeners` `@ReactMethod`s the module implements.

The interop layer is deprecated in spirit (RN logs a soft warning for
`RCTEventEmitter` users) and "will stop working with interop disabled" — but
interop is on by default in 0.86. This is the same boat as every
not-yet-migrated community library; if RN removes the layer before the
library migrates, fallback (b) is the escape hatch.

**Expo SDK 57 autolinking.** `expo-modules-autolinking react-native-config
--platform android` resolves the package natively (`new TcpSocketPackage()`)
with no community CLI and no `EXPO_USE_COMMUNITY_AUTOLINKING` env (that path
requires `@react-native-community/cli`, which is not a dependency here).
`./gradlew :app:dependencies` confirms `project :react-native-tcp-socket`
in the debug runtime classpath of a plain CNG build.

**Batch-scan feasibility.** The API is per-socket (`createConnection`); there
is no native batch scan. The native module holds a fixed 2-thread executor
(`N_THREADS = 2`) for connect operations and a `ConcurrentHashMap` of live
sockets. A 100-port scan therefore = ~N concurrent JS sockets over a 2-thread
native connect pool, paced by JS (bounded worker pool in the adapter). Whether
that meets the <30s / 100-port budget is measurable, not guessable — it is an
M4 acceptance criterion and will be verified on device (timing logs).

## Decision

**Adopt `react-native-tcp-socket@6.4.3` (option a)** for M4's TCP connect
test, TCP ping, and port scanner.

- All usage stays inside `src/platform/android/**` per the plan §6.4 rule
  (features see only capability interfaces — `tcpConnect`, `tcpPing`,
  `tcpScan`), so the library remains swappable behind the seam.
- The scan adapter owns bounded JS-side concurrency (worker pool, cap ~20
  sockets) and rate pacing; the per-socket native executor is left alone.
- **Fallback (b)** (custom Expo module, Kotlin `Socket` + Swift
  `Network.framework`) is triggered if: device verification shows the
  interop path does not work at runtime, or the 100-port scan cannot meet
  the <30s budget with JS-side concurrency, or RN removes the TurboModule
  interop layer in a future upgrade before the library migrates. The
  capability contracts make this a contained change.

**Runtime confirmation is part of M4 verification**, not a precondition of
this ADR: the acceptance criteria (fixture connect with latency, REFUSED vs
TIMEOUT mapping, <30s scan with progress + cancel) are the tests that
confirm or refute the spike's static analysis. If they fail for
library-interop reasons, this ADR is superseded by (b).

## Consequences

- First runtime-native dependency in the project; `pnpm lockfile` and the
  dev-client build (ADR-001) gain a community lib with a BouncyCastle
  transitive dep (TLS support we do not use yet).
- The dependency must not leak into `src/features/**` (grep gate, plan §6.4).
- iOS gets the same library's Swift half for free if compatible; otherwise
  the `src/platform/ios/**` adapters (M8) can supply their own — the seam
  decides, not the library.
- Dev-client rebuild required (native code changed) — first since M2.
