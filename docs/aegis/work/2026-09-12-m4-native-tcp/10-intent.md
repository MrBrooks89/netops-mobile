# M4 native pivot: TCP + port scanner — Intent

## TaskIntentDraft

- Requested outcome: M4 from docs/IMPLEMENTATION_PLAN.md — spike ADR first
  (#29, blocking for #30–33), then TCP connect test, TCP ping, port scanner
  behind new capabilities, typed reports, fixture-server verified on device.
- Goal: all M4 acceptance criteria (plan §18) green on the emulator build.
- Success evidence (plan §18 M4):
  - Spike ADR recorded with New Architecture compatibility verified.
  - Dev-client build with the native TCP dep installs and runs.
  - Connect test against local fixture TCP server succeeds with measured latency.
  - Closed port → REFUSED; filtered port → TIMEOUT within configured timeout.
  - 100-port scan on LAN host < 30 s with live progress and working cancel.
  - Results persist as typed PortScanReport; service names from ports DB.
  - Offline scan attempt → taxonomy error, not a crash.
  - Rate limits and concurrency caps respected (timing logs).
  - Detox smoke test against the Node TCP fixture server.
- Stop condition: done when acceptance passes on a clean build; blocked when a
  spike finding invalidates the native approach or the chosen library cannot
  support the batch scan contract; needs-verification pauses per-slice.
- Non-goals: ICMP ping, Wi-Fi info (M5), HTTP/TLS (M6), LAN sweep (M7), iOS
  build work (M8+), background scanning (deferred §2).
- Scope: plan issues #29–#34 + M4 acceptance criteria.
- Change kinds: feature (native dependency + adapters + 3 screens + fixture).
- Risk hints: project's first runtime native dependency; New Architecture
  (bridgeless) compat is the known unknown (plan D2/D13); library maintenance
  health; react-native-tcp-socket batch-scan API fit.

## BaselineReadSetHint

Required baseline refs before edits:

- docs/IMPLEMENTATION_PLAN.md §6.2 (capability contracts), §7 (library
  table), §17 M4 (spike-first ordering), §18 M4 (acceptance), D2/D13
- docs/adr/001-cng-dev-client-from-day-one.md (native dep flow)
- docs/adr/005-operations-path.md (screens must use useOperation)
- src/platform/capabilities.ts + src/platform/registry.ts (capability seam)
- src/core/registry/registry.ts (placeholders to replace: tcp-connect,
  tcp-ping, port-scanner)
- AGENTS.md: read https://docs.expo.dev/versions/v57.0.0/ before native code

## BaselineUsageDraft

- Required refs: plan sections above; ADR-001/005; capability/registry
  sources; Expo v57 versioned docs; react-native-tcp-socket repo state.
- Acknowledged before plan: plan §6.2/§7/§17/§18/D2/D13; ADR-001/005;
  registry.ts; capabilities.ts; http.ts; useOperation.ts.
- Cited in plan: all of the above will be cited in the ADR + verification doc.
- Missing refs: Expo v57 docs pages (before adapter code), tcp-socket repo
  (before decision).
- Advisory decision: continue — missing refs are fetched in the spike slice
  before any native edits.

## ImpactStatementDraft

- Compatibility boundary: no changes to existing capabilities, tools, or
  data models. New capabilities (tcpConnect, tcpPing, tcpScan) join the map
  as optional properties; three PlaceholderTool entries become live
  registrations. Existing screens/DB untouched.
- Affected layers: src/platform (new capability types + android adapter),
  src/core/model (new report types), src/features (3 new screens),
  test-utils/fixtures (TCP fixture server), package.json (1 native dep),
  registry wiring.
- Owners: capability contracts in src/platform/capabilities.ts; adapters in
  src/platform/android/; reports in src/core; screens in src/features/*;
  registry in src/core/registry/registry.ts.
- Invariants: features never import native libs directly (plan §6.4 grep
  rule: `from 'react-native-tcp-socket'` only under src/platform/android/**);
  all runs through useOperation (ADR-005); Result/ToolError everywhere;
  cancellation via AbortSignal-compatible contract.
- Non-goals: ICMP, Wi-Fi, HTTP/TLS, LAN discovery, iOS-native work.

These records are Method Pack drafts / hints, not authoritative runtime
decisions.
