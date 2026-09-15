# ADR-010: iOS entitlements, Info.plist keys, and the App Store posture

**Status:** Accepted (M8)
**Deciders:** implementation agent + repo owner (M8 approval)
**Date:** 2026-09-15 (M8)
**Relates to:** ADR-007 (cleartext/ATS), ADR-008 (LAN sources), ADR-009 (Android LNP), plan §9 (permissions), §10 (iOS compatibility), §16 (security), D9/D10

## Context

M8 has to answer, before any iOS port: what does the iOS build declare, where,
and why — and what will App Review see? Three of those declarations can get an
app rejected or silently broken, so they are recorded here rather than left in
`app.json`:

1. **Local Network access** (iOS 14+): any LAN traffic triggers a system prompt.
2. **Bonjour/mDNS**: browsing services needs the service types declared up front.
3. **Wi-Fi information**: SSID/BSSID need an Apple-granted entitlement.
4. **Planned D-item revisit:** D10 (port-scan ethics / App Store risk) was
   scheduled for "iOS revisit M8".

## Decision

All iOS declarations live in `app.json` under `ios.infoPlist` and
`ios.entitlements` — both are first-class SDK 57 CNG paths (verified in the
versioned config reference), so no config plugin is needed and there is exactly
one reviewed place for them, mirroring the Android side's module manifest.

**Declared now:**

| Key | Value | Why |
|---|---|---|
| `NSLocalNetworkUsageDescription` | "NetOps Toolkit sends traffic to your local network only when you ask it to…" | The prompt appears at first LAN use. The description states the *user-initiated* rule, which is also the app's actual behaviour: nothing scans on launch. |
| `NSBonjourServices` | the ten service types the mDNS browse listens for | iOS refuses to browse an undeclared type. The list must equal `MDNS_SERVICE_TYPES` (Kotlin) and the Swift browse list; a unit test fails the build if the three drift apart. |
| `NSAppTransportSecurity.NSAllowsArbitraryLoads` | `true` | Unchanged from ADR-007. The HTTP diagnostics tool must reach plain `http://` targets; the justification lives in that ADR, not here. |
| `com.apple.developer.networking.wifi-info` | `true` | Required for `NEHotspotNetwork` to return SSID/BSSID. Real builds also need the capability enabled on the App ID in the developer portal — an operational step, not a code one. |

**Deliberately not declared:**

- **`com.apple.developer.networking.multicast`.** Bonjour browsing through
  `NWBrowser` does not require the multicast entitlement (plan §10.2); raw
  multicast/broadcast sockets would. Since LAN discovery is TCP-sweep-first with
  `NWBrowser` for mDNS (ADR-008), the entitlement is not needed — and asking
  Apple for a capability the app does not use is pure review risk.
- **Any background mode.** All tools are foreground-interactive (plan §10.8).
- **`NSLocationWhenInUseUsageDescription` is *not* added yet.** The Wi-Fi tool
  needs location authorisation to read SSID/BSSID on iOS, and the Swift
  permission flow will request it — but the string belongs with that flow, and
  shipping a permission prompt whose rationale is missing would be worse than
  not shipping it. M9 work item: add the key together with the Swift
  `NEHotspotNetwork` path being enabled on a real device.

**D10 revisit (App Store risk for scanning tools).** No new exposure is created
by M8: the defaults shipped in M4–M7 are already conservative (single host,
explicit port lists, bounded concurrency, a 20 s sweep budget, authorized-use
copy on the dashboard and on both scan screens), and the iOS build declares
nothing that broadens them. The distribution fallback stays TestFlight /
personal team if review objects; that is a process decision, and this ADR
records that the product behaviour would not need to change to satisfy it.

## Consequences

- `expo prebuild -p ios` writes the keys into `Info.plist` and the entitlement
  into the generated `.entitlements` file, so the *built artifact* is what CI
  asserts against (`PlistBuddy` checks in the macOS job) rather than `app.json`
  being trusted.
- A simulator build ignores entitlements (no provisioning), so passing CI means
  "the declaration and the plist are correct", not "Apple granted the
  capability". The portal step is documented here for the first real device
  build.
- Because `NSBonjourServices` is the browse allow-list, adding an mDNS service
  type is a three-file change (Kotlin list, Swift list, app config) guarded by a
  test — deliberate friction for a list that silently fails when it drifts.
