# iOS parity matrix (M8)

**Status:** published at M8 (issue #48). Android is device-verified through M7;
iOS rows describe an **iOS dev build from this repo** and state exactly how far
each one is verified — simulator, compile-only, or not yet.

This is the audit the plan asks for (§3.3, §10, §17 M8): for every tool and
every capability, *what works on iOS today, what does not, and why*. It is
drift-guarded by `src/platform/iosParity.test.ts`, which fails if a tool id or
capability id from the frozen contracts is missing here — so adding a tool
without auditing it breaks CI rather than quietly leaving this page stale.

## How to read the "iOS" column

| Mark | Meaning |
|---|---|
| **works** | Pure TS or fetch-based. Runs on any platform with no native module. |
| **built (sim)** | Capability-level: implemented in the Swift half of `modules/netops` (or in the cross-platform `react-native-tcp-socket`), compiled and smoke-launched in CI on a macOS simulator. Not yet exercised on iOS hardware. |
| **gated** | Tool-level: the app's capability registry does not expose this on iOS yet, so the tool renders the degraded-state card. Implemented but not promised — see the note below the tool table. |
| **gated** | Unavailable in the build being described; the tool renders the degraded-state card from `CapabilityGate` (plan §6.4) instead of failing on run. |

## Capability availability

| Capability | Android | iOS | Caveat / plan reference |
|---|---|---|---|
| `dnsResolve` | works | **works** | DoH over `fetch` (ADR-005 era, D3). No system resolver on either platform yet, so split-horizon LAN names are invisible by design — documented in-tool. iOS needs no ATS exception for HTTPS. |
| `dnsReverse` | works | **works** | PTR over DoH. Private ranges have no PTR record; the screen says so. |
| `tcpConnect` | device-verified (M4) | **built (sim)** | `react-native-tcp-socket` (ADR-006) ships a Swift half; no extra module code. Any LAN target triggers the iOS 14+ Local Network prompt. |
| `tcpPing` | device-verified (M4) | **built (sim)** | Same library. The ICMP *method* additionally needs `icmpPing`. |
| `tcpScan` | device-verified (M4, 100 ports in 21 s) | **built (sim)** | Same library. Defaults stay conservative for review risk (D10). |
| `icmpPing` | best-effort, device-verified (M5) | **built (sim)** | iOS: unprivileged ICMP datagram socket (the SimplePing approach) — honest reachability, and timing only where the kernel gives it. Label stays "best-effort" (D4). |
| `wifiInfo` | device-verified (M5); SSID/BSSID need location + Location Services on | **built (sim), degraded** | iOS needs the `com.apple.developer.networking.wifi-info` entitlement **and** location authorisation for SSID/BSSID. Frequency and RSSI have no iOS equivalent → honest `null`s, rendered as "unavailable" rows (§6.4, D14). |
| `permissions` | typed flow via Expo Modules (M5) | **built (sim)** | iOS maps to `CLLocationManager` authorisation for the Wi-Fi scope. Same JSON shape, so screens are identical. |
| `httpProbe` | device-verified (M6) | **built (sim)** | Raw sockets via the same TCP library. Cleartext targets need the ATS exception (ADR-007). |
| `tlsInspect` | device-verified (M6) | **built (sim)** | iOS: `URLSession` trust challenge → `SecTrustCopyCertificateChain`. Display-only; no validation bypass exists anywhere (§16.7). |
| `lanDiscovery` | device-verified (M7) | **built (sim)** | TCP sweep needs only the socket library; mDNS uses `NWBrowser` (no multicast lock on iOS — that is an Android-only concept). Needs `NSLocalNetworkUsageDescription` and `NSBonjourServices` (ADR-010). No ARP on either platform (ADR-008). |

## Tool × iOS availability

Every tool listed here is in `TOOL_REGISTRY`; `requiredCapabilities` is what the
gate checks.

| Tool | Requires | iOS | Caveat |
|---|---|---|---|
| `subnet-calculator` | — | **works** | Pure `src/core` math. |
| `cidr-calculator` | — | **works** | Pure math, including split/aggregate. |
| `wildcard-mask-calculator` | — | **works** | Pure math. |
| `vlsm-calculator` | — | **works** | Pure greedy allocator. |
| `ipv6-calculator` | — | **works** | Pure `src/core` maths over 128-bit values (bigint), including the exact block size, scope classification and the /64 rules. Added after M8, which is why the parity guard exists: the audit had to be extended for it. |
| `ports-reference` | — | **works** | Bundled dataset, seeded into SQLite. |
| `dns-lookup` | `dnsResolve` | **works** | DoH only; no system-resolver view (D3). |
| `reverse-dns` | `dnsReverse` | **works** | DoH only. |
| `tcp-connect` | `tcpConnect` | **gated** | Local Network permission dialog on first LAN use — never triggered silently on app open (§10.1). |
| `tcp-ping` | `tcpPing` | **gated** | TCP is the default method; ICMP toggle needs `icmpPing`. |
| `port-scanner` | `tcpScan` | **gated** | Extra App Store scrutiny for scanning tools (D10); conservative defaults and authorized-use copy are the mitigation. |
| `http-diagnostics` | `httpProbe` | **gated** | ATS exception is app-wide and deliberate (ADR-007). |
| `tls-inspector` | `tlsInspect` | **gated** | Certificate chain is display-only; expiry countdown works offline. |
| `lan-discovery` | `lanDiscovery` | **gated** | Prompt-free until the user starts a sweep; mDNS may need the Bonjour service list to match the browsed types. |
| `wifi-info` | `wifiInfo` | **gated** | Entitlement + location; frequency/RSSI unavailable → nulls. |

### Why the tool table says "gated" while the capability table says "built (sim)"

Those two columns answer different questions. The Swift halves exist and compile
(M8, issue #50), but `getCapabilities()` still returns `null` for every native
capability on iOS, so the app gates those tools. That is deliberate:

- **Claiming a capability promises it works.** Handing iOS screens a `tcpScan`
  that has never run on an iOS device would turn "not available yet" into "it
  crashes" — the opposite of the degraded-state contract (§6.4).
- **M8's acceptance criterion asks for exactly this state**: a bare iOS build
  that launches, works for everything native-free, and shows degraded cards.
- Wiring the iOS adapters (and device-verifying them) is M9 work. The seam is
  ready: when that happens, the change is in `src/platform/registry.ts` alone
  and every screen keeps working unchanged.

## What a bare iOS build gives you today

This is the M8 acceptance criterion, and it is what the CI simulator smoke test
exercises: a build with **no** native capabilities available still launches and
works for everything that does not need native code —

- the four IPv4 calculators, the IPv6 calculator, and the ports reference,
- saved hosts and networks, history (including filters and drill-in), export
  through the share sheet,
- Settings (theme, retention, DoH provider),
- DNS lookups and reverse DNS over DoH,
- and, for every native-gated tool, a degraded-state card naming the missing
  module instead of a screen that fails on run.

The unit test that pins this is `src/features/_shared/CapabilityGate.test.tsx`
(registry-wide: every native tool gated, every pure tool and both DoH tools
available). Note that under `jest-expo` the default platform is **iOS**, so the
real capability registry already is a bare iOS build — that is why the
dashboard's marker test needs no mocking.

## iOS-specific realities this matrix encodes

1. **Local Network privacy (iOS 14+).** Any LAN traffic triggers the system
   prompt. All LAN-facing work sits behind `lanDiscovery`/`tcpConnect`, so the
   prompt appears at first use, never on app open (`NSLocalNetworkUsageDescription`
   supplies the rationale; ADR-010).
2. **Bonjour.** The mDNS browse is `NWBrowser`, which needs no multicast
   entitlement but does need the browsed service types declared in
   `NSBonjourServices` (ADR-010).
3. **ATS.** `NSAllowsArbitraryLoads` stays, deliberately, for the HTTP
   diagnostics tool (ADR-007) — a diagnostics tool that cannot reach a plain
   `http://` target is not doing its job.
4. **No ARP, no `/proc`.** Both are Android-or-Linux concepts; the LAN sweep was
   built TCP-first for exactly this reason (ADR-008).
5. **Wi-Fi info is the weakest parity.** SSID/BSSID need an entitlement *and*
   location authorisation; channel/frequency/RSSI are not exposed at all. The
   screen renders explicit "unavailable" rows rather than inventing values (§6.4).
6. **ICMP has no privileged path.** iOS unprivileged ICMP is reachability-only
   in practice, which is why TCP ping remains the default method (D4).

## Not covered by this audit

- **Real-device behaviour** (OEM stacks, roaming, hotspot quirks) — needs
  hardware; the CI simulator proves the build and the JS contract, not radio
  behaviour.
- **App Store review outcome** for scanning tools (D10) — a process risk, not a
  capability gap; TestFlight/personal-team distribution is the documented
  fallback.
- **A full iOS port** of features that are Android-only by design (none today:
  every capability above has an iOS implementation path). Background scans
  remain explicitly out of scope (§10.8).
