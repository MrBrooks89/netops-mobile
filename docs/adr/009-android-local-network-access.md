# ADR-009: Android local network access (LNP) — forward compatibility

**Status:** Accepted (M7) — **no code change required at targetSdk 36**; the action is deferred to the SDK 37 upgrade
**Deciders:** implementation agent + repo owner (M7 approval)
**Date:** 2026-09-13 (M7)
**Relates to:** ADR-008 (LAN discovery sources), plan §9 (Android permissions), §10 note 1 (iOS Local Network privacy), §16 (risks)

## Context

Android 16 (API 36) introduced **Local Network Protections (LNP)**: access to
LAN addresses (outgoing/incoming TCP, UDP unicast/multicast/broadcast,
`NsdManager`) becomes permission-gated. Every M7 tool — LAN sweep, port scanner,
TCP connect/ping against a private address, and the mDNS browse — is exactly the
traffic class LNP governs, so this is a future breakage risk for the milestone's
core feature, not a nice-to-have.

## Evidence (Android developer documentation, checked 2026-09)

| | Android 16 (SDK 36) | Android 17 (SDK 37+) |
|---|---|---|
| Enforcement | **Opt-in only**, via `adb shell am compat enable RESTRICT_LOCAL_NETWORK <pkg>` | Mandatory for apps targeting 37+ |
| Permission | Temporarily `NEARBY_WIFI_DEVICES` | `ACCESS_LOCAL_NETWORK` (runtime, `NEARBY_DEVICES` group) |
| Default access | **Open** | **Blocked by default** |
| Failure mode when blocked | TCP connections time out; UDP gives `EPERM` | same |

Two consequences worth stating plainly:

- **At targetSdk 36 nothing changes.** Our build targets 36 and does not opt
  into the compat flag, so the sweep and the mDNS browse work today. M7
  verification on the API 36 emulator confirms this in practice.
- **Blocked TCP presents as a *timeout*, not a permission error.** If LNP ever
  engages without the permission granted, every LAN tool degrades into "nothing
  answered" — the most misleading possible failure. That is why this is
  recorded as a decision rather than left as a footnote.

## Decision

1. **Do not request `ACCESS_LOCAL_NETWORK` at targetSdk 36.** The docs say not
   to: legacy apps (< 37) receive an implicit grant via `INTERNET`, and
   requesting the permission before targeting 37 is explicitly discouraged.
2. **Keep all LAN-facing traffic behind capabilities** (`lanDiscovery`,
   `tcpScan`, and the mDNS bridge), which M7 already does. The permission work
   then has one place to land: the adapter's entry points, not the screens.
3. **When the project raises `targetSdk` to 37:** declare
   `ACCESS_LOCAL_NETWORK` in the `netops` module manifest, extend the typed
   permission flow (`src/platform/permissions.ts`, plan §6.3.4) with a
   `localNetwork` scope, request it before the first sweep with a rationale
   explaining *why a network tool needs it*, and map a denial to
   `CAPABILITY_UNAVAILABLE`-style copy plus the "TCP sweep only" degraded state
   the screen already renders.
4. **Treat "everything times out" as a possible permission symptom** in the M8
   parity/degraded-state work: the LAN screen's advice text and the Runbook for
   the SDK bump should both mention it, because the platform reports it as a
   timeout rather than a denial.

## Consequences

- No new permission is requested today (least privilege, plan §9's staged
  declarations), and no user-visible runtime dialog is added.
- `CHANGE_WIFI_MULTICAST_STATE` **is** declared now, in
  `modules/netops/android/src/main/AndroidManifest.xml`: it is required for the
  mDNS `MulticastLock` on every current Android version and is a normal
  (install-time) permission.
- The SDK 37 upgrade becomes a planned, bounded change instead of an emergency
  where LAN discovery silently stops finding hosts.
