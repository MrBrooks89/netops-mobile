# M5 ping + Wi-Fi info: netops module — Intent

## TaskIntentDraft

- Requested outcome: M5 from docs/IMPLEMENTATION_PLAN.md — the project's
  first local Expo module `modules/netops` (#35: Kotlin + Swift halves,
  CNG wiring, permission declarations enter the build here), ICMP
  best-effort capability (#36), Wi-Fi info capability (#37), typed
  permission flow (#38), the unified Ping screen (#39), and the Wi-Fi
  info screen (#40).
- Goal: all M5 acceptance criteria (plan §18) green on the emulator
  build; both module halves compile (Swift type-checked only — no macOS
  in this environment).
- Success evidence (plan §18 M5):
  - Ping tool shows min/avg/max/loss for a reachable host; clean
    TIMEOUT/UNREACHABLE states for unreachable ones.
  - Permission-denied path shows a rationale card with a settings
    deep-link; the tool degrades, never crashes.
  - Wi-Fi screen renders "unavailable" placeholders gracefully when
    location permission/services are off — no blank rows, no crash.
  - ICMP labeled "best-effort" in the UI; TCP ping is the default.
  - `ACCESS_FINE_LOCATION` etc. appear in the build exactly from this
    milestone.
  - Both Kotlin and Swift halves compile (Swift smoke-checked on macOS
    if available, else type-checked).
- User-confirmed scope decisions (ask_user_question, this session):
  1. One unified Ping tool — TCP (default) / ICMP best-effort toggle;
     the `icmp-ping` placeholder registry entry is retired; tool id
     stays `tcp-ping` (history rows keep working).
  2. Permissions via Expo Modules calls, NOT `react-native-permissions`
     — no new dependency.
  3. Wi-Fi info is a live state read with a Refresh button — NOT
     recorded to run history.
- Stop condition: done when acceptance passes on a clean build; blocked
  if the Expo Modules surface cannot deliver an honest best-effort ICMP
  or the permission flow on the emulator; needs-verification pauses
  per-slice.
- Non-goals: real ICMP sockets (impossible for apps — best-effort
  `isReachable` only), HTTP/TLS (M6), LAN sweep (M7), iOS device work
  (M8+), gateway/DNS readouts on the Wi-Fi screen (plan copy was
  aspirational; the delivered screen reads what Android actually gates).
- Scope: plan issues #35–#40 + M5 acceptance criteria.
- Change kinds: feature (local Expo module + capabilities + 2 screens +
  registry retirement).
- Risk hints: first module-code in the repo (autolinking, manifest
  merge, Swift half unverifiable here); honesty rules (D4) — no
  invented latency for ICMP; Android permission UX is easy to get
  subtly wrong (canAskAgain vs askable states).

## BaselineReadSetHint

- Candidate docs: docs/IMPLEMENTATION_PLAN.md §6.3–§6.4, §17 M5, §18 M5;
  docs/adr/005 (operations path — the ping screens ride `useOperation`);
  docs/adr/006 (native seam pattern this module extends);
  docs/M4_VERIFICATION.md (device-verification habit + environment
  realities: adb flapping, Metro restart rules).
- Why relevant: M5 is the first milestone that owns module code and
  permission UX; the plan's capability-seam and honesty rules are the
  constraints most at risk of drift.
- Missing authority: none identified.

## BaselineUsageDraft

- Required baseline refs: plan §3.1 (core dependency-free), §3.3
  (capability indirection), §6.4 (honesty/unavailable states), D4 (ICMP
  honesty), ADR-005 (one operations path), ADR-006 (seam pattern).
- Delivered context refs: Expo SDK 57 versioned docs (modules
  get-started, native-module-tutorial, permissions guide) read before
  module code per AGENTS.md.
- Acknowledged before plan refs: verified `ModuleDefinition` DSL +
  permission helper signatures against installed
  `node_modules/expo-modules-core` sources (SDK 57.0.17).
- Cited in plan refs: plan §17 M5 scope.
- Missing refs: none.
- Decision: continue.

## ImpactStatementDraft

- Affected layers: modules/netops (new), src/platform (capabilities +
  adapters + registry), src/core/model (ping + wifi models), core
  registry (unified Ping + retired placeholder), features/tcp-ping
  (unified screen), features/wifi-info (new screen).
- Owners: single-owner milestone (this session).
- Invariants: `requireNativeModule` only under src/platform/android/
  seam; core models import nothing from modules/; every gated value
  renders an explicit "unavailable" row; ICMP never reports latency.
- Compat boundary: tool id `tcp-ping` unchanged (history + deep links
  stable); `ToolId` union loses the never-shipped `icmp-ping` entry;
  CapabilityMap gains three nullable keys (screens feature-detect).
- Non-goals: real ICMP, iOS runtime verification, gateway/DNS rows.
