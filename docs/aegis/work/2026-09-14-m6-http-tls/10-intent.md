# M6 HTTP diagnostics + TLS inspection - Intent

## TaskIntentDraft

- Requested outcome: Raw-socket HTTP/1.1 diagnostics (status/headers/redirect chain/phase timings) and TLS chain capture with cert report screens, device-verified
- Goal: All M6 acceptance criteria green on the emulator build
- Success evidence:
- none
- Stop condition: Done when acceptance passes on a clean build; blocked if raw sockets cannot deliver a hand-rolled HTTP/1.1 exchange or TLS chain capture on the emulator
- Non-goals:
- none
- Scope: plan M6 #41-#43 + M6 acceptance criteria (§18)
- Change kinds:
- feature
- Risk hints:
- first TLS/cert work (trust manager capture); hand-rolled HTTP parser edge cases (chunked encoding, header casing, redirect loops); cleartext policy must be exercised and documented (D9)

## BaselineReadSetHint

- plan §6 contracts, §8 native table, §16.4/16.7 security, §18 M6
- ADR-005 operations path, ADR-006 seam pattern
- M4/M5 device-verification lessons (device catches what Jest cannot)

## BaselineUsageDraft

- Required baseline refs:
- plan §6 contracts, §8 native table, §16.4/16.7 security, §18 M6
- ADR-005 operations path, ADR-006 seam pattern
- M4/M5 device-verification lessons (device catches what Jest cannot)
- Acknowledged before plan:
- none
- Cited in plan:
- none
- Missing refs:
- plan §6 contracts, §8 native table, §16.4/16.7 security, §18 M6
- ADR-005 operations path, ADR-006 seam pattern
- M4/M5 device-verification lessons (device catches what Jest cannot)
- Advisory decision: needs-baseline-readback

## ImpactStatementDraft

- Compatibility boundary: CapabilityMap gains httpProbe + tlsInspect (nullable); no existing tool id changes; no new app permission (INTERNET already present)
- Affected layers:
- modules/netops
- src/platform
- src/core/model
- src/core/registry
- src/features/http-diagnostics
- src/features/tls-inspector
- Owners:
- none
- Invariants:
- requireNativeModule + tcp-socket imports only under src/platform/android/; core models import nothing from modules/; TLS capture is display-only (never disables validation elsewhere); HTTP diagnostics render parsed text, never HTML (no webview)
- Non-goals:
- none

These records are Method Pack drafts / hints, not authoritative runtime decisions.
