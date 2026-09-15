# M8 device verification — iOS groundwork

M8's acceptance criteria include one that **cannot be checked on this project's
hardware**: "an iOS dev build launches with calculators, ports, saved data,
history, export and DoH DNS working — and native-gated tools showing
degraded-state cards." The development host is Fedora with no macOS, no Xcode
and no Swift toolchain, so M8 added a `macos-26` CI job that prebuilds, builds
Release for the simulator, asserts the built app's declarations, boots a
simulator, installs, launches and screenshots the app.

That job is also what compiled the Swift for the first time — and it found
things that reading could not.

**CI:** `CI` workflow, `ios` job on `macos-26` (Xcode 26.6, Swift 6.2,
iPhoneSimulator 26.5 SDK), ~22 minutes including pods and the full RN build.

## Result: M8 acceptance criteria met

| Criterion | Evidence |
|---|---|
| iOS parity matrix published | `docs/IOS_PARITY.md` — a capability table (Android vs iOS vs caveat) and a tool × availability × caveat table for all 14 tools, plus what a bare iOS build gives you. Guarded by `src/platform/iosParity.test.ts`: every `CapabilityMap` key and every registered tool must be named, and every tool row must carry a verdict. A negative control (renaming one tool row) fails the guard. |
| `Platform.OS` appears nowhere outside `src/platform/**`, enforced in CI | `scripts/check-platform-leaks.mjs`, run as `pnpm check:platform` in the ubuntu job. It scans `src/**` and `app/**` for `Platform.OS`/`.select`/`.Version`/`.constants` and reports file:line for each leak; a negative control (a file containing `Platform.OS`) exits 1. Today it is clean. |
| An iOS dev build launches with the non-native tools working, and native-gated tools degraded | The `ios` job builds `netopsmobile.app` (Release, embedded bundle), installs it on a booted simulator, launches it, proves the process survives (a crashed app leaves no `launchctl` entry) and screenshots the rendered dashboard: **the onboarding card, the IPV4 calculators and Ports Reference are all on screen**, with the star toggles and the Saved/History/Settings tabs. Degraded-state cards are verified by the registry-wide `CapabilityGate` tests, which run as iOS (jest-expo's platform is iOS) and assert that every native-backed tool is gated and every pure tool plus both DoH tools still runs. Simulator-driving the route is **not** done — see the deep-link finding below. |
| Entitlements/Info.plist keys documented in an ADR | `docs/adr/010-ios-entitlements-and-plist.md`, and asserted against the **artifact** rather than the config: `scripts/check-ios-plist.mjs` runs on the generated `Info.plist` and again on the built app's copy, checking `NSLocalNetworkUsageDescription`, `NSBonjourServices` (superset — Expo adds its own `_expo._tcp`), `NSAllowsArbitraryLoads` and the `com.apple.developer.networking.wifi-info` entitlement. Both steps pass in CI. |
| Swift halves implemented (#50) | Five new files plus the module definition replace the M5 stubs; they **compile** in the `Netops` pod target on both simulator architectures. |

## What the first iOS build taught us

Verified facts, each found by running something rather than by reading:

| # | Finding | Fix |
|---|---|---|
| 1 | **The podspec had never been validated.** `pod install` rejected the module: missing required `authors`, `homepage`, `source`, and a description equal to the summary. Written at M5, never installed, because nothing built for iOS until M8. | Metadata comes from the module's `package.json` (which gains `author`/`homepage`/`repository`); the description adds a sentence. Commit `2c5c1e9`. |
| 2 | **Expo SDK 57's iOS build needs Swift 6.2 = Xcode 26.** The `macos-15` default (Xcode 16.4 / Swift 6.1) failed inside the `ExpoModulesJSI` pod script: `package 'apple' is using Swift tools version 6.2.0 but the installed version is 6.1.0` — that package is `expo-modules-jsi/apple/Package.swift`. | The job runs on `macos-26`, selects the newest Xcode present (robust to image updates) and asserts Swift ≥ 6.2 up front, so a future image change fails with a readable message. Commit `1d8947a`. |
| 3 | **`SecCertificateCopyValues`, the `kSecOID…` constants, `SecCertificateCopyDNSNames` and `kSecAttrKeyTypeDSA` are macOS-only.** Twelve compile errors, all in the TLS mapping. | `modules/netops/ios/X509Fields.swift`: a small DER reader (tag/length cursor, OID/string/time decoding, positional X.509 walk) supplies issuer, validity, SANs and signature algorithm; `selfSigned` still compares the normalised DER sequences, so a parse mistake cannot claim a certificate signs itself. It is a reader, never a validator. Commits `849bb97`, `7b01aac`. |
| 4 | **`simctl openurl` on iOS 26 raises a system confirmation dialog** ("Open in netops-mobile?" with Cancel/Open), so a script cannot navigate the app. The first version of the smoke test screenshotted after `openurl` and compared with the dashboard: it "passed" because the app had been backgrounded to the home screen with the dialog up — a **false positive** that looked like success. | The route assertion is gone rather than faked. The script verifies install → launch → alive → dashboard, captures the dialog as `deep-link-confirmation.png` so the limitation is documented by evidence, and route rendering stays with the `CapabilityGate` tests. Commits `66a86e6`, `ae927ed`. |

The dialog artifact is worth keeping: any future attempt to drive these screens
from CI (XCUITest, a UI-test scheme, or a launch-argument hook) starts from that
constraint.

## What is verified where

| Claim | Verified by |
|---|---|
| The Swift halves compile against the real SDK | `ios` job, `Netops` pod target, both simulator slices |
| The iOS app builds, installs, launches, renders | `ios` job: `xcodebuild` Release + `simctl` install/launch/screenshot |
| Declared plist/entitlement keys reach the shipping artifact | `scripts/check-ios-plist.mjs` on the generated and built plists |
| Bare-build degraded states are correct | `CapabilityGate.test.tsx` (registry-wide, iOS platform) |
| Parity matrix stays complete | `iosParity.test.ts` |
| mDNS service-type list agrees across app.json / Kotlin / Swift | `mdnsServiceTypes.test.ts` (three-way) |
| Nothing branches on the OS outside the platform seam | `check:platform` in CI |
| The JS/TS side of every tool | The existing 55-suite Jest run (617 tests) |

## Honest gaps

- **No iOS hardware.** The simulator proves build + boot + render, not radio
  behaviour, permissions or the Local Network prompt. The Wi-Fi entitlement in
  particular is a *declaration* here: real builds also need the capability
  enabled on the App ID in the developer portal (ADR-010).
- **Route-level UI on iOS is not exercised.** See finding 4. The gate logic is
  unit-tested on the iOS capability map, but nobody has *looked at* the degraded
  card on iOS; the same card is device-verified on Android (M7) and is one
  shared component.
- **The Swift halves are not wired into `getCapabilities()`.** Deliberate: M8
  implements and compiles them, M9 wires them, because claiming a capability
  promises it works (`docs/IOS_PARITY.md` explains the split).
- **ICMP, mDNS resolution and the TLS field parser have never run.** They
  compile and degrade honestly by construction; device work is M9+.

## Cost note

The `ios` job takes ~22 minutes of a **free** macOS runner (the repo is public).
It runs on every push to `main` and every PR, and `workflow_dispatch` allows a
manual run. If that becomes annoying the job can be gated on path filters
(`modules/netops/ios/**`, `app.json`, `src/platform/**`), which is the obvious
first optimisation rather than deleting coverage.
