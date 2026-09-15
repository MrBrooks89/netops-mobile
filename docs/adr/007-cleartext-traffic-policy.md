# ADR-007: Cleartext traffic allowed globally, with in-app justification (D9)

**Status:** Accepted (M6)
**Deciders:** implementation agent + repo owner (M6 scope confirmation)
**Date:** 2026-09-14 (M6, plan D9 / §16.4 / §18 M6 acceptance)
**Relates to:** ADR-001 (CNG + dev-client), plan §16 security (items 4/5), §18 M6 ("Cleartext `http://` targets work per the policy configuration")

## Context

An HTTP **diagnostics** tool must be able to speak plain `http://` to
arbitrary user-entered targets — half of what the tool exists for is
observing exactly what a server says before/without TLS. Both platforms
block cleartext by default: Android 9+ (`usesCleartextTraffic=false`
effective default) and iOS ATS (`NSAllowsArbitraryLoads=false` default).

Plan D9 chose between (a) allow globally with an explicit ADR +
in-app justification, and (b) per-domain runtime configuration — and
recorded: "**(a)** — a diagnostics tool must reach cleartext targets;
runtime scoping isn't supported on either OS". Android's
`networkSecurityConfig` can scope cleartext by *build-time* domain
list, but targets here are user-entered at runtime, so any scoping
would silently break legitimate diagnostics. This ADR records the M6
confirmation of that decision (user-approved: "Global allow + ADR").

## Decision

Allow cleartext globally, declared in the single reviewed config place
(CNG), with the justification visible to users in-app:

1. **Android:** `app.json` → `expo.android.usesCleartextTraffic: true`
   (CNG writes it into the manifest as
   `android:usesCleartextTraffic="true"`).
2. **iOS (when it builds):** `expo.ios.infoPlist.NSAppTransportTransportSecurity`
   → `NSAllowsArbitraryLoads: true` — declared now so the M8 iOS
   groundwork inherits it intentionally, not by accident.
3. **In-app justification:** the HTTP Diagnostics screen shows a short
   plain-language note that the tool deliberately speaks plain HTTP
   when asked, because that is what it diagnoses (plan §16.4's
   "documented, deliberate" requirement).
4. **Boundary (plan §16.7, unchanged):** TLS *inspection* captures
   chains **for display only**. Nothing in this ADR disables
   certificate validation for any other network call (DoH, exports,
   future features), and no global "ignore certificate errors" switch
   exists. Cleartext allowance ≠ validation bypass.

## Consequences

- Cleartext `http://` targets work from M6 on — the acceptance line is
  exercised, not deviated from.
- App Store/Play review scrutiny: mitigated by the diagnostics purpose
  being obvious in the app's own UI and docs; this ADR is the
  paper trail.
- The allowance is app-wide: the DoH resolver and every other https
  call are unaffected (they use TLS regardless); the only new
  capability is that plain-HTTP user targets no longer fail at the
  platform gate.
- If a future milestone adds a privacy-sensitive networked feature
  that should never be downgraded, that feature pins its own scheme —
  it does not narrow this global setting.
