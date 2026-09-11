# NetOps Mobile — Implementation Plan

**Status:** Planning (no code implemented yet)
**Target:** React Native + Expo + TypeScript, Android-first on Fedora Linux, iOS later, optional Linux remote probe later
**Prime directives:** simplicity, maintainability, independently-addable tool modules, small first milestone

---

## 0. Guiding Principles

1. **Pure-TypeScript core, platform shell.** All math, parsing, formatting, and orchestration logic lives in a platform-free core. React Native is only a presentation + capability layer.
2. **Feature modules are independent.** Each tool is a self-contained directory registered in a central tool registry. Adding a tool never touches existing tools.
3. **Capabilities, not platforms.** Features depend on *interfaces* (`TcpScan`, `DnsResolve`, …), never on `Platform.OS` checks or specific native modules. Android implementations are injected; iOS implementations can be injected later without feature changes.
4. **Degrade gracefully.** If a capability is unavailable (no native module, missing permission), the tool renders a degraded state instead of crashing or hiding itself.
5. **Batch native work.** Cross-boundary APIs operate on whole jobs (`scan(host, ports, opts)`) with throttled progress events — never per-item JS↔native chatter.
6. **No shelling out.** Never `Runtime.exec()` with user input. All network operations use socket/manager APIs via native modules. This is a security and iOS-compatibility decision made once, up front.
7. **Address-family-aware from day one.** Core IP types model IPv4 and IPv6 from the start, even though MVP ships only IPv4 tools. Retrofitting IPv6 into a v4-only core is a rewrite; a union type now costs nothing.

---

## 1. Recommended MVP Scope

**MVP = Milestone 1 ("First Usable").** It must be completable quickly, run with zero native code, and already deliver real value:

| Included | Notes |
|---|---|
| App shell: bottom tabs (Tools / Saved / History / Settings) | expo-router |
| Dashboard: category-grouped tool grid driven by tool registry | Recents + quick search |
| **Subnet calculator (IPv4)** | address + CIDR → mask, wildcard mask (Cisco style), network/broadcast, first/last usable, host count, binary view, class (legacy info) |
| **CIDR calculator** | mask ↔ prefix conversion, "split into N subnets", "subnets with ≥ N hosts" |
| **Wildcard mask calculator** | (folded into subnet calc output; standalone input mode) |
| **VLSM calculator** | base network + list of required host counts → greedy allocation table with ranges, usable counts, waste |
| Ports/protocol reference | seeded table (~200 common ports), search by port/service/protocol |
| Theme + light/dark, type-safe navigation | |
| Test harness, CI (lint + typecheck + unit tests) | |

Deliberately **not** in MVP: DNS, TCP/ping/port scanning, HTTP/TLS, Wi-Fi, LAN discovery, storage, sharing, history. These arrive in later milestones.

### 1.1 Milestone 2 (fast follow — still no native code)
- Saved hosts/networks + SQLite storage (hosts, networks)
- Ports reference from DB (replace bundled JSON)
- Export/share results (Share sheet + file export)
- IPv6 subnet/CIDR calculator (core is already address-family-aware)
- Calculator "saved results" and history of calculator runs

### 1.2 Milestone 3 (first networked features — still pure JS via HTTP)
- DNS lookup + reverse DNS via **DNS-over-HTTPS** (Cloudflare/Google JSON APIs) — works with plain `fetch`, no native module, works on both OSes
- History now covers operation runs (not just calculator runs)

Milestones 4+ introduce the dev-client/native foundation (see §17).

---

## 2. Features to Defer (and why)

| Feature | Defer because |
|---|---|
| ICMP ping (native) | Requires native module + Android restrictions on ICMP for untrusted apps; TCP-ping covers most user needs first |
| Port scanning | Depends on native TCP sockets (M4); needs rate-limiting/ethics UX design |
| TLS/certificate inspection | Needs a custom native module (X509 chain capture); well-defined but non-trivial |
| Wi-Fi information (SSID etc.) | Android location-permission UX + native module; hot to get right, low value for MVP |
| LAN discovery | Depends on TCP sweep (native) + multicast lock + optional mDNS; largest native surface |
| HTTP diagnostics (full) | Basic fetch-based checks are easy; redirect chains, per-phase timing, raw header control need sockets — phase it |
| IPv6 tools beyond calculators | Core types ready; feature work later |
| Remote Linux probe | Backend + protocol design is a project of its own; only the abstraction seam is preserved now |
| i18n | Centralize strings from day one, but no translation framework yet |
| Sync/cloud accounts | Against the tool's privacy story; no backend in MVP at all |
| Tablet/adaptive layouts, RTL | Post-MVP polish |
| Background scanning / foreground service | Android complexity + battery/review concerns; not needed by the target users initially |
| OAuth/secrets vault | No accounts; nothing to protect beyond local history |

---

## 3. Overall Architecture

### 3.1 Layers

```
┌────────────────────────────────────────────────────────┐
│ src/app            expo-router routes, app shell, tabs │
├────────────────────────────────────────────────────────┤
│ src/features/*     one dir per tool: UI + orchestration│
│  (subnet-calculator, dns-lookup, port-scanner, ...)    │
├────────────────────────────────────────────────────────┤
│ src/platform       capability INTERFACES + impls       │
│   capabilities/      TcpScan, DnsResolve, Ping, ...     │
│   android/           impls backed by native modules    │
│   fallback/          pure-JS impls (DoH fetch, etc.)   │
│   registry.ts        getCapabilities(): CapabilitiesMap│
├────────────────────────────────────────────────────────┤
│ src/core           PURE TypeScript: IP math, VLSM,     │
│                    parsers, port data, Result, errors, │
│                    formatting, tool registry types      │
│           (zero React Native imports — reusable by a    │
│            future Node-based Linux probe CLI)           │
├────────────────────────────────────────────────────────┤
│ src/data           repositories (storage adapters),     │
│                    DB schema/migrations, export logic   │
├────────────────────────────────────────────────────────┤
│ src/ui             shared theme, components, primitives │
├────────────────────────────────────────────────────────┤
│ modules/netops-*   local Expo native modules (Kotlin/Swift) │
│ node_modules       react-native-tcp-socket, mmkv, ...  │
└────────────────────────────────────────────────────────┘
```

Dependency rules (enforced by convention, optionally by `eslint-plugin-boundaries` later):

- `core` imports nothing above it (pure TS, no RN, no storage).
- `data` and `platform` may import `core` only.
- `features` may import `core`, `platform/capabilities` (interfaces), `data`, `ui` — **never** `platform/android/*`, native modules, or `Platform.OS` directly.
- `app` may import everything.
- Only `platform/*` knows what OS we're on. Only `platform/android/*` knows which native module provides a capability.

### 3.2 Tool registry (the module system)

```ts
// src/core/registry/types.ts
export interface ToolModule {
  id: ToolId;                     // 'subnet-calculator' | 'dns-lookup' | ...
  title: string;
  category: ToolCategory;         // 'ipv4' | 'ipv6' | 'dns' | 'connectivity' | ...
  icon: string;                   // vector icon name
  requiredCapabilities: CapabilityId[]; // [] for pure tools
  Component: React.ComponentType<ToolScreenProps>;
}

export const TOOL_REGISTRY: ToolModule[] = [ /* each feature registers itself here */ ];
```

- Dashboard renders purely from `TOOL_REGISTRY` (grouped by category).
- A tool with unmet `requiredCapabilities` renders a "requires native module / permission" card instead of being hidden (see §6.4).
- Adding tool #15 = one new directory + one registry entry. No core changes.

### 3.3 Capability pattern

```ts
// src/platform/capabilities/tcp.ts
export interface TcpScanCapability {
  scan(host: string, ports: PortSpec[], opts: ScanOptions,
       onProgress?: (p: ScanProgress) => void): Promise<ScanReport>;
}
// src/platform/registry.ts
export interface CapabilitiesMap {
  dnsResolve?: DnsResolveCapability;
  dnsReverse?: DnsReverseCapability;
  tcpConnect?: TcpConnectCapability;
  tcpScan?: TcpScanCapability;
  tcpPing?: TcpPingCapability;
  icmpPing?: IcmpPingCapability;
  wifiInfo?: WifiInfoCapability;
  lanDiscovery?: LanDiscoveryCapability;
  tlsInspect?: TlsInspectCapability;
  httpProbe?: HttpProbeCapability;
}
export function getCapabilities(): CapabilitiesMap { /* platform-aware singleton */ }
```

- Optional properties = feature detection, not OS detection. Android fills what it can today; iOS fills the same map later; a remote-probe implementation fills it over WebSocket/HTTP someday. Features never change.
- Every capability method takes a **job description and options**, returns typed reports, streams throttled progress. Batching rule from §0.6.

### 3.4 Operation flow (networked tools)

```
UI (feature) → useOperation hook (TanStack Query mutation)
             → capability interface
             → impl (platform/android or platform/fallback)
             → native module / fetch
Result (Result<T, ToolError>) → UI render + repository.persistRun() → History
```

### 3.5 Native strategy

1. **Prefer pure JS** where genuinely sufficient (calculators, ports DB, DoH).
2. **Prefer maintained community libraries** where they exist (`react-native-tcp-socket`, `@react-native-community/netinfo`).
3. **Write local Expo Modules** (`modules/netops` using Expo Modules API, Kotlin + Swift) for anything missing: ICMP ping, TLS chain inspection, Wi-Fi/SSID, ARP fallback. The Expo Modules API is explicitly designed so the Swift half of each module comes almost for free — this *is* the iOS-later strategy.
4. All native modules ship through **CNG** (`expo prebuild`) + **expo-dev-client** from day one (decision D1, §20). No `android/` directory in git (generated, gitignored).

### 3.6 Future Linux probe seam (design now, build never)

Because features call capability interfaces, a future `RemoteProbeCapabilities` (implementing the same map over a WebSocket to a Linux agent) slots in as *one more implementation*. Preserve the seam by: (a) keeping `core` pure TS (a Node CLI can reuse it), (b) keeping capability inputs/outputs JSON-serializable, (c) never leaking Android types into capability signatures.

---

## 4. Project Directory Structure

```
netops-mobile/
├── docs/                      # this plan, ADRs, decision log
├── app.config.ts              # Expo config (CNG; permissions, plugins)
├── eas.json                   # build profiles (dev / preview / production)
├── tsconfig.json
├── package.json               # single package (NO monorepo yet — see §20 D14)
├── jest.config.js
├── eslint.config.mjs
├── .gitignore                 # android/, ios/ generated by prebuild
│
├── src/
│   ├── app/                   # expo-router file routes
│   │   ├── _layout.tsx        # root layout, theme provider, tabs
│   │   ├── (tabs)/
│   │   │   ├── index.tsx      # dashboard (renders TOOL_REGISTRY)
│   │   │   ├── saved.tsx
│   │   │   ├── history.tsx
│   │   │   └── settings.tsx
│   │   └── tool/[toolId].tsx  # generic tool route → registry lookup
│   │
│   ├── core/                  # ★ PURE TS — no RN imports, fully unit-testable
│   │   ├── ip/                # IpAddress (v4|v6 union), parse/format/validate
│   │   ├── subnet/            # subnet math, split, aggregate
│   │   ├── vlsm/              # VLSM allocation algorithm
│   │   ├── ports/             # port reference dataset + search
│   │   ├── result/            # Result<T,E> + ToolError taxonomy
│   │   ├── registry/          # ToolModule/ToolCategory types (no React impls)
│   │   └── util/              # formatting (bytes, durations), helpers
│   │
│   ├── platform/
│   │   ├── capabilities/      # ★ all interfaces (iOS-contract, see §6)
│   │   ├── fallback/          # DoH resolver, fetch-based probes
│   │   ├── android/           # adapters over native modules (tcp-socket, netops module)
│   │   ├── registry.ts        # getCapabilities()
│   │   └── permissions.ts      # permission request flows (capability-level, typed)
│   │
│   ├── features/
│   │   ├── subnet-calculator/
│   │   │   ├── index.tsx      # registers ToolModule
│   │   │   ├── SubnetCalculatorScreen.tsx
│   │   │   ├── components/
│   │   │   └── useSubnetCalc.ts
│   │   ├── cidr-calculator/
│   │   ├── vlsm-calculator/
│   │   ├── ports-reference/
│   │   ├── dns-lookup/        # (M3)
│   │   ├── tcp-connect/       # (M4)
│   │   ├── port-scanner/      # (M4)
│   │   ├── http-diagnostics/  # (M6)
│   │   ├── tls-inspector/     # (M6)
│   │   ├── lan-discovery/     # (M7)
│   │   └── wifi-info/         # (M5)
│   │
│   ├── data/
│   │   ├── db/                # expo-sqlite client, migrations, seeds
│   │   ├── repositories/      # hosts, networks, runs, ports (typed, async)
│   │   └── export/            # JSON/CSV/text renderers of results
│   │
│   ├── ui/
│   │   ├── theme.ts           # tokens (colors, spacing, type), light/dark
│   │   ├── components/        # Screen, Card, Field, ResultBlock, CopyButton, ...
│   │   └── hooks/
│   │
│   └── stores/               # zustand stores: settings, recents
│
├── modules/
│   └── netops/                # (later) local Expo native module: ping/icmp,
│                              #   tls chain, wifi, arp — Kotlin + Swift halves
├── assets/                    # icons, splash, fonts
└── scripts/                   # seed-ports.ts, etc.
```

Notes:

- `android/` and (later) `ios/` are **generated** by `npx expo prebuild` and gitignored — native source of truth stays in `app.config.ts`, config plugins, and `modules/`.
- One package, no monorepo, until the Linux probe forces extraction (then `core` moves out first, and it's already dependency-free).

---

## 5. Shared vs Android-Specific Code Boundaries

| Concern | Layer | Shared? |
|---|---|---|
| IP/subnet/VLSM math, parsers, formatters | `core` | 100% shared (OS-agnostic; reusable by future probe CLI) |
| Port reference dataset | `core` | 100% shared |
| Error taxonomy + Result | `core` | 100% shared |
| Tool registry types + dashboard logic | `core` + `ui` | 100% shared |
| Feature screens/orchestration | `features` | 100% shared — depend only on capability interfaces |
| Capability *interfaces* | `platform/capabilities` | 100% shared (this is the iOS contract) |
| DoH resolver, fetch-based HTTP probe | `platform/fallback` | 100% shared |
| Adapters over `react-native-tcp-socket` | `platform/android` | Android-specific (iOS will supply its own adapter or a shared one if the lib is cross-platform — evaluate in M4 spike) |
| Expo native module Kotlin half (`modules/netops/android`) | Android-specific | Swift half written alongside from day one of each module |
| Permission request flows | `platform/permissions.ts` | Interface shared; Android copy/rationales in `platform/android/permissions.ts` |
| SQLite schema/repositories | `data` | Shared (expo-sqlite is cross-platform) |
| Wi-Fi SSID/BSSID, ARP, multicast lock | native only | Android-specific today; iOS counterparts via entitlements (§10) |

**Hard rules:**

1. `grep -r "Platform.OS" src/features src/app src/core` must return **nothing** (platform checks live only in `src/platform/**`).
2. `grep -r "from 'react-native-tcp-socket'" src/features` must return **nothing** (native imports live only in `src/platform/android/**`).
3. No feature may import from another feature — shared UI goes to `src/ui`, shared logic to `core`.

---

## 6. Interfaces/Abstractions for iOS Later

### 6.1 Capability interfaces are the contract

Every capability interface in `src/platform/capabilities/` is written as if it will have three implementations someday: Android-native, iOS-native, remote-probe. Signatures must therefore be:

- **JSON-serializable in/out** (no Android/iOS types, no functions in payloads except explicit progress callbacks).
- **Feature-detected** (`CapabilitiesMap` optional props) — see §3.3.
- **Batched** (whole jobs, throttled progress) — the JS↔native bridge on either OS punishes per-item chatter.

### 6.2 Concrete interface sketch

```ts
// src/platform/capabilities/dns.ts
export interface DnsResolveCapability {
  resolve(host: string, opts: { type?: 'A'|'AAAA'|'CNAME'|'MX'|'TXT'|'NS'|'SRV';
                                server?: DnsServerRef }): Promise<DnsAnswer[]>;
}
export interface DnsServerRef { kind: 'system' | 'doh'; url?: string } // 'system' needs native; 'doh' is pure JS

// src/platform/capabilities/tcp.ts
export interface TcpConnectCapability {
  connect(host: string, port: number, opts: ConnectOptions): Promise<ConnectReport>;
}
export interface TcpScanCapability {
  scan(host: string, ports: PortSpec[], opts: ScanOptions,
       onProgress?: (p: ScanProgress) => void): Promise<ScanReport>;
}
export interface PingCapability {           // implemented first by TCP ping
  ping(host: string, count: number, opts): Promise<PingReport>;
}

// src/platform/capabilities/wifi.ts
export interface WifiInfoCapability { getInfo(): Promise<WifiInfo> } // SSID nullable — it is gated by permissions on BOTH OSes

// src/platform/capabilities/lan.ts
export interface LanDiscoveryCapability {
  discover(opts: LanDiscoveryOptions, onProgress?: (p) => void): Promise<LanHostReport[]>;
}
```

### 6.3 Rules that keep iOS cheap

1. **Feature-detect, don't OS-detect** (§6.1). An iOS build that hasn't implemented `icmpPing` yet simply omits it from the map; the ping tool still works via `tcpPing`.
2. **Write the Swift half of every custom Expo module at the same time as the Kotlin half**, even if untested on a device. Expo Modules API makes this nearly free, and it prevents "Kotlin-shaped" APIs (e.g., callbacks with Java maps) that are awkward in Swift.
3. **No Linux-isms in shared code**: no `/proc` parsing, no `ip`/`ping` CLI assumptions, no `Runtime.exec`. ARP-table access, for example, is a capability (`arpTable?`) that Android may implement via a native read of neighbor data *if* permitted, and iOS would implement via its own API or not at all.
4. **Permissions are part of capability UX, not OS branches.** `platform/permissions.ts` exposes typed flows (`requestFor('wifiInfo')`); each OS module supplies rationale strings and the actual request. Features call the typed flow.
5. **Inputs validated in `core`** before any capability call — iOS never receives malformed input and the validation is shared/tested once.
6. **No "Android forever" shortcuts in storage**: timestamps as ISO strings/UTC epoch, no path assumptions (`expo-file-system`/`expo-sharing` for all file IO).

### 6.4 Degraded-state UX contract

Every tool screen implements, via registry metadata: `unavailable (module)`, `unavailable (permission)`, `partial (fallback active)`. The UI kit provides these states once. This is what lets an incomplete iOS build still ship with the tools it has implemented.

---

## 7. Recommended React Native/Expo Libraries

**Verify versions against the current Expo SDK at M0 — this table is directional, not a lockfile.**

| Purpose | Choice | Notes / alternatives |
|---|---|---|
| Runtime | Expo SDK (latest stable) | CNG (`expo prebuild`) + `expo-dev-client` from day one |
| Navigation | `expo-router` | File routes, typed links, deep links per tool for free |
| Language | TypeScript `strict` | |
| UI kit | `react-native-paper` | Fast, complete (DataTable is perfect for VLSM/subnet output); wrapped in `ui/` tokens so swappable. Alt: gluestack/Tamagui (styling-only) if Paper feels heavy |
| Icons | `@expo/vector-icons` | ships with Expo |
| Lists | `@shopify/flash-list` | history/ports lists |
| Storage (entities) | `expo-sqlite` | hosts, networks, runs, ports. Repos in `data/` keep it swappable; add Drizzle only if SQL grows |
| Storage (settings) | `react-native-mmkv` | sync reads for settings/recents; works via config plugin. (Alternative: skip and use a SQLite `settings` table — one fewer lib) |
| State | `zustand` (+ `@tanstack/react-query` from M3) | zustand: settings/recents/UI; React Query: networked operations (loading/error/retry/cache) |
| TCP sockets | `react-native-tcp-socket` | For TCP connect/ping/scan + manual HTTP. **M4 spike must verify maintenance + New Architecture compat**; fallback = ~200-line Expo module (Kotlin `Socket`/Swift `Network.framework`) |
| Network info | `@react-native-community/netinfo` | reachability, current connection; cross-platform |
| Result type | hand-rolled `Result<T,E>` (~40 LOC in `core`) | `neverthrow` acceptable; avoid try/catch leaking into feature code |
| Share/export | `expo-sharing` + `expo-file-system` + `expo-print` (optional PDF) | Share sheet needs no permissions on either OS |
| Permissions | `react-native-permissions` (M5) OR Expo Modules calls | evaluate when Wi-Fi/ping land |
| Logging | small logger util in `core` (levels, redaction) | `react-native-logs` optional; never raw `console` in production paths |
| Tests | Jest + `@testing-library/react-native`; Detox later (M8) | Expo-standard; pure `core` tests need no RN |
| Native modules | Expo Modules API (`modules/netops`) | for ping(ICMP)/TLS/WiFi/ARP — Kotlin+Swift halves together |
| Lint/format | ESLint (typescript-eslint) + Prettier + `tsc --noEmit` in CI | |

Not adopted (yet): state containers beyond zustand, form libraries (controlled inputs suffice), i18n framework (centralized strings only), ORM, monorepo tooling, analytics.

---

## 8. Features Requiring Native Android APIs/Modules

| Feature | Why native | Approach |
|---|---|---|
| DNS (arbitrary records, system resolver) | JS has no UDP sockets; `fetch` DNS is HTTP-only | **MVP/M3: DoH via fetch (no native).** Later: `netops` module or community lib for system-resolver + record types DoH can't see on LAN split-horizon |
| TCP connectivity test | raw sockets | `react-native-tcp-socket` (M4), fallback custom module |
| Port scanning | raw sockets, concurrency, timeouts | same lib, **batched native scan** (spike decides lib vs custom module for the batch API) |
| TCP ping | raw sockets + timing | tcp-socket connect+measure |
| ICMP ping | ICMP unavailable to untrusted apps via simple APIs; `exec('ping')` restricted by SELinux on modern Android & banned by our no-shelling rule | `netops` module: `InetAddress.isReachable()` heuristics + TCP fallback; honest "TCP ping" default (see D5) |
| TLS/cert inspection | JS `fetch` gives no certificate access | `netops` module: `SSLContext` + custom `X509TrustManager` capturing chain → typed report |
| HTTP diagnostics (full: redirect chain, phase timings, raw headers) | fetch follows redirects, hides timings | M6: raw-socket HTTP/1.1 (tcp-socket) for full control; native module only if sockets prove limiting |
| Wi-Fi info (SSID/BSSID/freq/channel/gateway/DNS) | no public JS/Expo API; SSID gated by location permission | `netops` module (`WifiManager` + `ConnectivityManager`), with `netinfo` for basics |
| LAN discovery | ARP `/proc/net/arp` blocked for apps on Android 10+; needs multicast lock for mDNS/SSDP | TCP sweep via tcp-socket (primary) + NSD/mDNS via `NsdManager` (optional) in `netops`; multicast lock held only during discovery |
| Background/notifications for long scans | Android foreground service + POST_NOTIFICATIONS | **Deferred** (§2) |

Everything else (calculators, ports reference, saved data, history, export, DoH DNS) is pure JS + Expo managed libs.

---

## 9. Android Permission Requirements

Declared in `app.config.ts` (CNG) — **only when the milestone that needs them lands** (least-privilege, staged declarations):

| Permission | Needed by | Milestone | Notes |
|---|---|---|---|
| `INTERNET` | everything networked | M3 | normal |
| `ACCESS_NETWORK_STATE` | netinfo, HTTP/DNS probes | M3 | normal |
| `ACCESS_WIFI_STATE` | Wi-Fi basics | M5 | normal; **not sufficient for SSID** |
| `ACCESS_FINE_LOCATION` (+ `ACCESS_COARSE_LOCATION`) | SSID/BSSID, Wi-Fi channel/frequency | M5 | **runtime**; Android 8.1+ requires fine location; Android 9+ also requires Location Services **enabled** — UX must explain this (classic "why does a network tool need location?" moment) |
| `CHANGE_WIFI_MULTICAST_STATE` | mDNS/SSDP receive during LAN discovery | M7 | acquire `MulticastLock` only while scanning, release immediately |
| `POST_NOTIFICATIONS` | scan-complete notifications | deferred | skip until background work exists |

Never needed: `READ_EXTERNAL_STORAGE` (Share sheet), `ACCESS_BACKGROUND_LOCATION`, `REQUEST_INSTALL_PACKAGES`, `FOREGROUND_SERVICE` (until background scans).

Also configure once at M0 (CNG): `usesCleartextTraffic` strategy (see §16.5), `targetSdk`/`minSdk` (target latest required by Play; min ~API 24), disabled by default permissions we don't use.

---

## 10. iOS Compatibility Problems to Account For Now

Design-time mitigations are what make "iOS later" cheap; the goal is **no architectural change** when iOS starts — only new capability implementations.

1. **Local Network privacy (iOS 14+):** any LAN traffic (TCP to LAN, mDNS, ARP-ish probing) triggers the Local Network permission dialog. **Now:** keep all LAN-facing operations behind capabilities (`lanDiscovery`, `tcpConnect`) so iOS can attach the `NSLocalNetworkUsageDescription` rationale + trigger the prompt at first use, and add `NSBonjourServices` when mDNS lands. Never do silent LAN traffic on app open.
2. **Bonjour entitlement reality:** receiving multicast/broadcast UDP generally needs the multicast entitlement or Bonjour-specific usage declarations; system Bonjour browsing (`NWBrowser`) does not. **Now:** implement LAN discovery as TCP-sweep-first with mDNS optional — the sweep needs no special iOS treatment beyond Local Network permission.
3. **Wi-Fi info is harder than Android:** SSID/BSSID require location permission **plus** the `com.apple.developer.networking.wifi-info` entitlement; gateway/DNS via `getaddrinfo`/route reads. **Now:** `WifiInfo` fields are all nullable; UI renders "unavailable on this platform/permission state" gracefully (§6.4).
4. **ICMP:** raw-socket ICMP is possible on iOS (SimplePing-style) but must be its own capability, never assumed. **Now:** ping tool defaults to TCP ping; ICMP is `icmpPing?` capability shown as "best-effort" when available.
5. **ATS (App Transport Security) blocks cleartext HTTP by default.** An HTTP-diagnostics tool must test `http://` arbitrary hosts → needs `NSAllowsArbitraryLoads` (or scoped exceptions), which App Review scrutinizes. **Now:** keep the "this app deliberately performs network diagnostics, including cleartext" justification in docs; centralize all such config in `app.config.ts`/Info.plist keys via CNG so both platforms' declarations live in one reviewed place.
6. **App Store review risk for security tooling:** port scanners get extra scrutiny. **Now:** plan TestFlight/personal-team distribution as the fallback channel; keep scanning UX conservative (rate-limited, single-host by default, explicit "authorize networks you own" copy) — good ethics that also reads well in review.
7. **No `/proc`, no ARP table, no neighbor data** — iOS simply won't have some Android capabilities. **Now:** `CapabilitiesMap` optional fields + degraded states make "Android-only features" a non-event on iOS.
8. **Background execution differences** (no long-running background scans): keep all current tools foreground-interactive; if background ever lands, design it per-OS from the start (deferred anyway).
9. **Expo native modules must ship Swift halves from day one** (§6.3.2) — retrofitting Swift after Kotlin APIs calcify is the #1 source of iOS-later pain.
10. **Different permission metaphors** ("Nearby"/Local Network vs Android runtime dialogs): capability-level typed permission flows (§6.3.4) keep feature code identical while each platform supplies its UX.

---

## 11. Data Models

`src/core/model/` — pure TS interfaces (DB rows in `src/data/db/` mirror them 1:1).

```ts
// --- Addresses (address-family-aware from day one) ---
export type IpAddress = IpV4Address | IpV6Address;
export interface IpV4Address { family: 4; value: string /* dotted */; int: bigint }
export interface IpV6Address { family: 6; value: string /* canonical */; int: bigint }
export interface IpCidr { address: IpAddress; prefixLength: number }

// --- Calculators ---
export interface SubnetReport {          // subnet/cidr calculators output
  cidr: IpCidr; netmask: string; wildcardMask: string;
  networkAddress: IpAddress; broadcastAddress: IpAddress | null; // null for v6
  firstHost: IpAddress | null; lastHost: IpAddress | null;
  hostCount: number | null;  // null for v6 link-local style edge cases
  binaryView: string[];      // per-octet (v4) / per-hextet (v6)
  classLegacy?: 'A'|'B'|'C'|'D'|'E';   // v4 legacy info only
}
export interface VlsmAllocation { name?: string; requiredHosts: number;
  cidr: IpCidr; firstHost: IpAddress; lastHost: IpAddress; usable: number; waste: number }
export interface VlsmReport { base: IpCidr; allocations: VlsmAllocation[];
  unallocatedSpace: IpCidr[] | null; fits: boolean; totalWaste: number }

// --- Saved entities ---
export interface SavedHost { id: string; label: string; host: string; /* ip or hostname */
  tags: string[]; notes: string; createdAt: string; updatedAt: string }
export interface SavedNetwork { id: string; label: string; cidr: string;
  tags: string[]; notes: string; createdAt: string; updatedAt: string }

// --- Operations / history (generic envelope + typed payloads) ---
export type RunStatus = 'running' | 'success' | 'partial' | 'error' | 'cancelled';
export interface RunRecord {
  id: string; toolId: ToolId;
  input: unknown;              // typed per-tool at app layer (discriminated by toolId)
  status: RunStatus;
  startedAt: string; finishedAt: string | null; durationMs: number | null;
  summary: string;             // one-line human summary for history lists
  detail: unknown | null;     // typed tool output (JSON) — resolved by toolId
  errorCode?: ToolErrorCode; errorMessage?: string;
}
// Typed payloads, e.g.:
export interface PortScanReport { host: string; ports: { port: number; proto: 'tcp';
  state: 'open'|'closed'|'filtered'; service?: string; latencyMs?: number }[];
  scannedCount: number; durationMs: number }
export interface DnsAnswer { name: string; type: string; value: string; ttl?: number }
export interface TlsReport { subject: string; issuer: string; validFrom: string;
  validTo: string; daysRemaining: number; sans: string[]; serial: string;
  sigAlgorithm: string; keyBits: number; selfSigned: boolean; chainOrder: string[] }
export interface WifiInfo { ssid: string | null; bssid: string | null;
  frequencyMhz: number | null; channel: number | null; linkSpeedMbps: number | null;
  gateway: string | null; dnsServers: string[] | null }
export interface LanHostReport { ip: string; hostname: string | null;
  sources: ('tcp-sweep'|'mdns'|'arp')[]; openPorts?: number[] }

// --- Reference data & settings ---
export interface PortEntry { port: number; proto: 'tcp'|'udp'|'sctp';
  service: string; description: string }
export interface AppSettings { theme: 'system'|'light'|'dark';
  dohProvider: 'cloudflare'|'google'|'custom'; customDohUrl?: string;
  defaultTimeoutMs: number; maxConcurrency: number; scanRateLimit: number;
  historyRetentionLimit: number; reducedMotion: boolean }
```

DB schema (SQLite, `src/data/db/migrations`):

```sql
CREATE TABLE hosts(id TEXT PRIMARY KEY, label TEXT NOT NULL, host TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]', notes TEXT DEFAULT '', created_at TEXT, updated_at TEXT);
CREATE TABLE networks(id TEXT PRIMARY KEY, label TEXT NOT NULL, cidr TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]', notes TEXT DEFAULT '', created_at TEXT, updated_at TEXT);
CREATE TABLE runs(id TEXT PRIMARY KEY, tool_id TEXT NOT NULL, status TEXT NOT NULL,
  input TEXT NOT NULL, summary TEXT NOT NULL, detail TEXT, error_code TEXT, error_message TEXT,
  started_at TEXT NOT NULL, finished_at TEXT, duration_ms INTEGER);
CREATE INDEX idx_runs_tool_started ON runs(tool_id, started_at DESC);
CREATE TABLE ports(port INTEGER NOT NULL, proto TEXT NOT NULL, service TEXT,
  description TEXT, PRIMARY KEY(port, proto));
CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);
```

Key choices: `detail`/`input` as JSON validated at repository boundary by per-tool codecs (`src/data/records/<toolId>.ts`) — history stays generic while remaining type-safe; no polymorphic-table gymnastics; UTC ISO timestamps; soft cap on `runs` via retention setting.

---

## 12. State-Management Approach

**Rule: state lives at the lowest level that needs it.**

| State kind | Where | Mechanism |
|---|---|---|
| Form inputs (calculator fields, scan targets) | feature component | `useState`/small hook; reset on unmount |
| Computed results (subnet math) | feature | derived via `useMemo` from `core` — never stored in state |
| Settings (theme, timeouts, DoH provider) | global | zustand store, persisted to MMKV, hydrated before shell renders |
| Recents/favorites | global | zustand slice persisted to MMKV (small) |
| Saved hosts/networks | server-cache-like | repository + zustand cache slice (SQLite is source of truth) |
| Networked operations (DNS, scans, pings) | per-run | **TanStack Query mutations** (from M3): loading/error/success, retry, cancellation — a scan *is* a mutation |
| Tool availability (capabilities map) | global singleton | `getCapabilities()` + `<CapabilityGate>` component |
| Navigation/route state | expo-router | typed links |

Notes:
- No Redux, no Context tree for app state — two zustand slices + React Query cover everything with minimal ceremony.
- Calculators never touch global state or storage on their own; "save result" is an explicit user action (except M2 adds optional auto-history for calculator runs — behind settings toggle).
- Operation runs are persisted to SQLite by the mutation's `onSuccess`/`onError` — the query layer stays disposable; the DB is durable.

---

## 13. Storage Approach

- **Entities** (`hosts`, `networks`, `runs`, `ports`) → `expo-sqlite`:
  - migrations = ordered SQL files in `src/data/db/migrations/`, applied at startup under a global `schema_migrations` table; repositories are the only SQL-speaking layer.
  - ports table seeded from `core/ports` dataset at first run (updates on app update).
  - history pruning job on startup (`historyRetentionLimit`, default e.g. 500 runs).
- **Settings + recents** → `react-native-mmkv` (synchronous, fast, no async-gate complexity). *Alternative if we want one fewer native dep: a SQLite `settings` table — acceptable, decide at M0.*
- **No sensitive secrets** are ever stored (no accounts, no credentials); if future features need them (probe auth tokens), plan SQLCipher or Keychain/Keystore then — do not prebuild.
- **Export/share**: `src/data/export/` renders a `RunRecord` (+ typed detail) to JSON, CSV, or plain text via codecs → `expo-file-system` temp file → `expo-sharing`. Export is opt-in per item or per history filter. This is also the migration path for the future probe/backend.
- **Backups**: none by design in MVP (local-only tool = privacy feature, market it as such).

---

## 14. Error-Handling Strategy

1. **Result type at the core boundary.** All `core` functions and capability methods return `Result<T, ToolError>` — exceptions are reserved for programmer errors (assertions) and React rendering. Feature components don't write `try/catch`.
2. **Typed error taxonomy in `core`** (one enum + metadata, extensible):

```ts
export type ToolErrorCode =
  | 'INVALID_INPUT'          // parse/validation failure (core, before any I/O)
  | 'NETWORK_UNREACHABLE'    // device offline / no route
  | 'DNS_FAILURE'           // resolution failed
  | 'TIMEOUT'
  | 'REFUSED' | 'UNREACHABLE_PORT' | 'RESET'
  | 'PERMISSION_DENIED'      // runtime permission declined
  | 'CAPABILITY_UNAVAILABLE' // native module missing / not implemented (e.g. iOS build pre-M8)
  | 'RATE_LIMITED'
  | 'NATIVE_ERROR'          // unexpected native exception, details attached
  | 'CANCELLED' | 'STORAGE_ERROR' | 'UNKNOWN';
export interface ToolError { code: ToolErrorCode; message: string; /* user-facing */
  technical?: string; /* raw detail for engineers — collapsible in UI */ retryable: boolean }
```
3. **User-facing messages: two audiences.** Every error renders a plain-language sentence + a collapsible "technical details" block (raw error, timings) — the app serves beginners *and* engineers.
4. **Mapping layer** in `platform/android/*`: native exceptions/errno → taxonomy (e.g., `ECONNREFUSED` → `REFUSED`, `ENETUNREACH` → `NETWORK_UNREACHABLE`). Mapping code is the only place raw native errors are handled.
5. **Boundaries:** one React error boundary per tool screen (a crash in one tool degrades that tool, never the app) + root boundary with a recovery screen.
6. **Cancellation is first-class** (AbortController-style tokens threaded through capability options; long scans always cancellable; React Query mutations make this natural).
7. **Logging:** `core` logger with levels + redaction (targets/hosts are fine to log locally; never log full scan payloads in production level). Dev-only verbose logging via `__DEV__`.
8. **Partial results:** batch operations return `status: 'partial'` + per-item results where applicable (port scan with some filtered ports, LAN sweep with some unreachable ranges).

---

## 15. Testing Strategy

| Layer | Tooling | What's tested |
|---|---|---|
| `core` (math, parsers, VLSM, codecs) | Jest, table-driven golden tests | Exhaustive: known subnet/CIDR/VLSM fixtures, edge cases (v4 /31, /32, v6 edge, zero-host requests, overflow), property-style fuzz for round-trip parse/format; port search; error taxonomy mapping |
| `data` repositories | Jest + in-memory SQLite (`expo-sqlite` supports it in tests) | CRUD, migrations, retention pruning, export codecs |
| `platform` adapters | Jest with mocked native modules | Mapping native errors → taxonomy, batch/progress behavior, cancellation |
| `features` | Jest + `@testing-library/react-native` | Rendering registry-driven UI, degraded states, input validation UX, history write on success/error |
| Native modules (`modules/netops`) | Instrumented tests where practical + scripted manual matrix | Keep native surface tiny and capability-shaped so this stays small |
| E2E | **Detox from M4** (first native milestone) | One smoke flow per milestone: M1 dashboard→subnet calc→result; M4 scan a local test server started by the test harness (e.g., a Node TCP server fixture) |
| Manual device matrix | Fedora host + Android Studio emulator (KVM) + 1–2 physical devices | Wi-Fi/SSID flows, multicast discovery, permission denials, OEM quirks (Samsung/Xiaomi network stack) |

Practical Fedora notes: `dnf install java-17-openjdk-devel`, Android Studio (SDK + emulator + udev rules for physical devices), enable libvirt/KVM group for emulator acceleration; EAS cloud builds work regardless of host OS for release profiles.

CI (GitHub Actions): `tsc --noEmit` + ESLint + Prettier check + Jest unit/component suite on every PR; Detox on a single Android emulator for milestone tags; EAS build submit on `main` for the dev-client profile (nightly or on demand).

**Definition of Done for every tool module:** core logic ≥ 95% line coverage with golden fixtures; screen test for empty/error/degraded states; one E2E if networked; docs entry in tool registry (title/description/category) updated.

---

## 16. Security Considerations

1. **Authorized-use stance (ethical + legal):** the app is for networks you own/administer. Onboarding copy + scan screens state this; default rate limits (`scanRateLimit`), single-target default, explicit progress/duration estimates, no "sweep the /24 by default without asking" behavior. This also materially improves App Store review odds on iOS (§10.6).
2. **No shell execution, ever** (§0.6): eliminates command injection wholesale — the classic vulnerability of "network tool" apps. All I/O via sockets and platform APIs.
3. **Strict input validation in `core`** before any capability call: IP/CIDR/hostname parsing with explicit character-set rules; no regex on unbounded input; hostname length/port range clamps. Capability layer additionally re-validates defensively.
4. **Cleartext traffic policy (Android) + ATS (iOS) are app-wide, deliberate, documented:** the tool *must* be able to speak plain HTTP (diagnostics). Declare via `app.config.ts` (`usesCleartextTraffic` / network security config) and Info.plist keys in one reviewed place, with the justification recorded in an ADR. Never silently scope per-run.
5. **Privacy story is a feature:** all data stays on-device; no analytics/tracking/crash reporting by default (opt-in later, if ever); DoH provider is user-visible in Settings — queries go to Cloudflare/Google by choice; document that DoH bypasses the local resolver (split-horizon DNS won't be visible — offer `system` resolver capability later when native lands).
6. **Storage hygiene:** no credentials stored (none exist); scan history is user-purged any time ("clear history" in Settings); export includes exactly what the user selected (no ambient telemetry fields).
7. **TLS inspection scope:** when `tlsInspect` exists, it captures chains *for display only* — it must not disable validation for any other network call; no "ignore certificate errors globally" switch ever exists.
8. **Dependency hygiene:** lockfile committed; native deps minimal and audited (`npm audit` in CI); every third-party native module needs a one-paragraph justification ADR (attack surface lives in native code).
9. **Rate limiting + resource caps** are core features, not afterthoughts: bounded concurrency (`maxConcurrency`), bounded open sockets per scan, mandatory progress/cancel, watchdog timeouts on every capability method.
10. **NoWebView policy:** no embedded webviews rendering remote content (attack surface + useless for this tool); HTTP diagnostics render parsed text, never rendered HTML.

---

## 17. Milestones in Implementation Order

> M0–M3 are intentionally tiny and pure-JS. M4 is the native pivot point — everything after it reuses the foundation laid there. Acceptance criteria for each milestone are in §18 below.

### M0 — Bootstrap (½–1 day)
Expo+TS app via CNG (`expo prebuild`), expo-router tabs, ESLint/Prettier/tsc, Jest, GitHub Actions CI, `eas.json` dev profile, theme tokens, `core` skeleton with Result + IP union types, tool registry types, dashboard rendering a hardcoded registry. **Repo conventions + ADR 001 (dev-client from day one).**

### M1 — First Usable: Dashboard + IPv4 tools ⭐ (2–4 days)
Subnet calculator, CIDR calculator, wildcard output, VLSM calculator, ports reference (bundled JSON), copy-to-clipboard, calculator form validation with inline errors.

### M2 — Persistence + saved entities + export (2–3 days)
SQLite + migrations + repositories; hosts/networks CRUD with tags; ports from DB; calculator-run history (settings toggle); export/share as JSON/CSV/text via Share sheet; settings screen (theme, retention).

### M3 — DNS via DoH + operations foundation (2–3 days)
DoH resolver (Cloudflare/Google, custom URL in settings), A/AAAA/CNAME/MX/NS/TXT; reverse DNS via PTR over DoH; TanStack Query introduced with `useOperation`; runs now auto-persisted; history screen gains filters; offline detection via netinfo (graceful error states).

### M4 — Native pivot: TCP + port scanner (3–5 days) 🔧
**Spike first (1 day):** evaluate `react-native-tcp-socket` (maintenance, New Architecture compat, batch scan feasibility) vs custom Expo module — decision recorded in ADR. Then: TCP connect test (host:port with timeout + latency), TCP ping (count/interval/stats), port scanner (range/common-ports presets, top-100/top-1000, concurrency caps, progress + cancel, service names from ports DB).

### M5 — Ping (TCP default + ICMP best-effort) + Wi-Fi info (3–4 days)
`netops` Expo module v1: ICMP best-effort (`isReachable` path) + `WifiManager`/`ConnectivityManager` info; permission flows (`platform/permissions.ts` typed API + rationale UX); Wi-Fi screen (SSID/BSSID/channel/frequency/gateway/DNS with "unavailable" states); ping tool with stats (min/avg/max/loss) + hop-less "host unreachable" reporting.

### M6 — HTTP diagnostics + TLS inspection (3–5 days)
Raw-socket HTTP/1.1 client (status, headers, redirects chain, timing phases DNS/connect/TLS/TTFB/total) + `netops` TLS chain capture (subject/issuer/SANs/validity/serial/sig/key size/self-signed, expiry countdown).

### M7 — LAN discovery + dashboard polish (3–5 days)
TCP sweep engine (bounded concurrency, ARP optional best-effort), optional mDNS via `NsdManager` (multicast lock held only during scan); discovered-hosts list with source badges, feed-forward into saved hosts / port scanner / ping; dashboard recents + favorites; onboarding copy (authorized use + privacy).

### M8 — iOS groundwork (audit + parity, not full port) (2–3 days + later device work)
Capability parity audit vs §6 contracts; Swift halves implemented for whatever is feasible without macOS hardware (compile/type-check via CI mac runner or collaborator); Info.plist keys (Local Network usage, Bonjour services, ATS exceptions), entitlements list documented; degraded-state matrix tested (which tools run on a bare iOS build: calculators, ports, saved data, history, export, DoH DNS — everything except native-gated tools).

### M9+ — Deferred roadmap
Full iOS port; remote Linux probe (WebSocket agent + `RemoteProbeCapabilities`); background scan service; more IPv6 feature tools (expanded beyond calculators); batch/multi-target operations; watch companion (never, probably 😄).

---

## 18. Acceptance Criteria per Milestone

> Each milestone is "done" only when its criteria below pass on a clean build. Every GitHub issue (§19) carries its milestone's criteria as a checklist.

### M0 — Bootstrap
- App runs in the dev client on an Android emulator and on a physical device.
- CI is green (lint, `tsc --noEmit`, Jest on the seed test suite).
- `npx expo prebuild` regenerates `android/` reproducibly; `android/` is gitignored.
- Tabs navigate; dashboard renders the (hardcoded) tool registry grouped by category.

### M1 — First Usable: Dashboard + IPv4 tools ⭐
- Subnet calculator returns correct netmask, wildcard mask, network/broadcast, first/last host, host count, and binary view for the full golden fixture set — including `/0`, `/31`, `/32` edge cases.
- CIDR calculator: mask↔prefix conversion round-trips; "split into N" and "fit ≥ N hosts" produce valid child CIDRs (property-tested).
- VLSM calculator produces correct greedy allocation tables (ranges, usable counts, waste) for all fixture sets, and reports `fits: false` cleanly when the base network is too small.
- Ports reference is searchable by port number, service name, and protocol.
- Every result value is copyable with one tap.
- **Zero native code** — the app still runs in Expo Go.
- `core` test coverage ≥ 95% lines on new modules.
- Dashboard groups tools by category; navigation to each tool works via the generic registry-driven route.

### M2 — Persistence + saved entities + export
- Hosts and networks can be created, edited, deleted, tagged — and survive app restart.
- Calculator runs are recorded in history (when the settings toggle is on); history is capped at the retention limit and purgeable from Settings.
- Exports (JSON/CSV/text) open correctly in other apps via the Share sheet.
- Migrations are exercised by a version-bump test (create at v1, migrate to v2, data intact).
- Zero regressions against M1 acceptance.

### M3 — DNS via DoH + operations foundation
- Lookups of stable public fixture domains return the expected record types/values (A, AAAA, CNAME, MX, NS, TXT).
- Reverse lookup of a well-known IP (e.g., 8.8.8.8 → dns.google) resolves via PTR.
- Offline mode yields a `NETWORK_UNREACHABLE` error with friendly copy, no crash.
- Every run appears in History with a one-line summary and a drill-in detail view.
- DoH provider is switchable in Settings (Cloudflare/Google/custom URL) and takes effect immediately.
- `useOperation` hook standardizes loading/error/retry/cancel across networked tools.

### M4 — Native pivot: TCP + port scanner 🔧
- Spike ADR recorded (tcp-socket vs custom module) with New Architecture compatibility verified.
- Dev-client build with the native TCP dependency installs and runs (EAS or local Fedora build).
- Connect test against a local fixture TCP server succeeds and reports measured latency.
- Closed port reports `REFUSED`; firewalled/filtered port reports `TIMEOUT` within the configured timeout.
- Scan of 100 ports on a LAN host completes in < 30s with live progress and working cancel.
- Results persist as typed `PortScanReport` and render service names from the ports DB.
- Offline scan attempt yields a taxonomy error, not a crash.
- Rate limits and concurrency caps are respected (verified by timing logs).
- Detox smoke test runs against the Node TCP fixture server.

### M5 — Ping + Wi-Fi info
- Ping tool shows min/avg/max/loss stats for a reachable host, and clean `TIMEOUT`/`UNREACHABLE` states for unreachable ones.
- Permission-denied path shows a rationale card with a settings deep-link; the tool degrades, never crashes.
- Wi-Fi screen renders "unavailable" placeholders gracefully when location permission/services are off — no blank rows, no crash.
- ICMP capability is labeled "best-effort" in the UI; TCP ping is the default.
- Android permission declarations (`ACCESS_FINE_LOCATION`, etc.) appear in the build exactly from this milestone.
- Both Kotlin and Swift halves of `modules/netops` compile (Swift smoke-checked on macOS if available, else type-checked).

### M6 — HTTP diagnostics + TLS inspection
- HTTP diagnostics show the full redirect chain (e.g., `http://` → `https://` → final) with per-phase timings (DNS/connect/TLS/TTFB/total).
- Header dump matches `curl -v` on the same fixture hosts (spot-checked).
- Self-signed certificates are flagged; expiring-cert warning fires < 14 days before expiry.
- TLS report is exportable.
- Cleartext `http://` targets work per the §16.4 policy configuration.

### M7 — LAN discovery + dashboard polish
- TCP sweep of the local /24 finds the fixture hosts (known open ports) within the bounded time budget.
- Multicast lock is acquired only during discovery and released after (verified by code review + manual log).
- A discovered host can be saved or sent to scanner/ping in ≤ 2 taps.
- Cancel works mid-sweep.
- mDNS permission-denied state doesn't break TCP-sweep-only mode.
- Onboarding copy (authorized use + privacy) shown on first run.

### M8 — iOS groundwork
- iOS parity matrix published in docs (tool × availability × caveat).
- `Platform.OS` appears nowhere outside `src/platform/**` (enforced by grep check in CI).
- An iOS dev build launches with calculators, ports, saved data, history, export, and DoH DNS working — and native-gated tools showing degraded-state cards.
- Entitlements/Info.plist keys documented in an ADR (Local Network usage, Bonjour services, ATS exceptions, wifi-info).

---

## 19. Suggested GitHub Issue/Task Breakdown

**Labels:** `area:core` `area:platform` `area:ui` `area:data` `area:native` `area:infra` `tool:<id>` `platform:android` `platform:ios` `type:spike` `type:adr` `milestone:M0-M8`

### M0 — Bootstrap
- #1 `infra`: Expo + TS + CNG + dev-client bootstrap, prebuild reproducibility check
- #2 `infra`: ESLint/Prettier/tsc/Jest/CI pipeline + branch protection
- #3 `ui`: theme tokens + light/dark + Screen/Card primitives
- #4 `core`: Result type + ToolError taxonomy (+ tests)
- #5 `core`: `IpAddress` v4/v6 union + parser/formatter (+ golden tests)
- #6 `core`: tool registry types + registry scaffold; `app`: tabs + registry-driven dashboard

### M1 — IPv4 tools ⭐
- #7 `core`+`tool:subnet-calculator`: subnet math (mask/wildcard/network/broadcast/hosts/binary/class) + fixtures
- #8 `tool:subnet-calculator`: screen + input validation + copy buttons
- #9 `core`+`tool:cidr-calculator`: mask↔prefix + split/aggregation math + property tests
- #10 `tool:cidr-calculator`: screen
- #11 `core`+`tool:vlsm-calculator`: VLSM greedy allocation algorithm + waste math + fixtures
- #12 `tool:vlsm-calculator`: allocation-table screen
- #13 `core`+`tool:ports-reference`: port dataset (top ~200) + search index
- #14 `tool:ports-reference`: browsable/searchable screen
- #15 `ui`: dashboard category grouping + recents placeholder; E2E smoke (dashboard→subnet→result)

### M2 — Persistence
- #16 `data`: SQLite client + migration runner + test harness
- #17 `data`: hosts/networks repositories + CRUD + tags
- #18 `data`: ports seed-to-DB + repository swap
- #19 `data`: runs repository + retention pruning
- #20 `app`: Saved tab (hosts/networks screens, edit flows)
- #21 `data`+`app`: History tab for calculator runs + settings toggle
- #22 `data`: export codecs (JSON/CSV/text) + Share-sheet integration
- #23 `app`: Settings screen v1 (theme, retention)

### M3 — DNS
- #24 `platform:capabilities`: DnsResolve/DnsReverse interfaces + DoH fallback impl (provider config)
- #25 `ui`+`infra`: `useOperation` hook (React Query mutation wrapper) + run persistence middleware
- #26 `tool:dns-lookup`: lookup screen (record types, DoH provider picker) + error states
- #27 `tool:dns-lookup`: reverse-DNS screen + drill-in to forward lookup
- #28 `platform`: netinfo availability gating + offline error UX

### M4 — Native pivot 🔧
- #29 `type:spike`+`adr`: tcp library evaluation (tcp-socket vs custom Expo module) — **blocking for #30-33**
- #30 `platform:android`: TcpConnect/TcpPing adapters (+ error mapping tests)
- #31 `platform:android`: TcpScan batched adapter (progress, cancel, concurrency caps)
- #32 `tool:tcp-connect`: connectivity test screen
- #33 `tool:port-scanner`: port scanner screen (presets, progress, cancel, service names)
- #34 `infra`: Detox setup + TCP fixture server harness

### M5 — Ping + Wi-Fi
- #35 `area:native`: `modules/netops` scaffold (Kotlin + Swift skeletons, CNG wiring)
- #36 `area:native`: ICMP best-effort + `platform:android` adapter + degraded UX
- #37 `area:native`: Wi-Fi info module (WifiManager/ConnectivityManager) + null-safe WifiInfo mapping
- #38 `platform`: typed permission-flow API + Android rationale UX
- #39 `tool:ping`: ping screen (stats, loss, best-effort ICMP toggle)
- #40 `tool:wifi-info`: Wi-Fi screen + "why location?" explainer

### M6 — HTTP/TLS
- #41 `core`+`tool:http-diagnostics`: raw-socket HTTP/1.1 client (status/headers/redirects/timings)
- #42 `area:native`: TLS chain capture module + TlsReport mapping
- #43 `tool:tls-inspector`: cert report screen (expiry countdown, export)

### M7 — LAN discovery
- #44 `core`: sweep planner (ranges, concurrency, caps) + source-annotated results
- #45 `area:native`: multicast lock + optional NSD/mDNS discovery
- #46 `tool:lan-discovery`: discovery screen + feed-forward actions (save host → scan/ping)
- #47 `ui`: dashboard favorites/recents + onboarding copy (authorized use, privacy)

### M8 — iOS groundwork
- #48 `platform:ios`: parity audit vs capability contracts (matrix published)
- #49 `platform:ios`: entitlements/Info.plist keys ADR (Local Network, Bonjour, ATS, wifi-info)
- #50 `platform:ios`: Swift halves implemented + degraded-state verification build

Each issue carries its milestone's acceptance criteria (§17/§18) as a checklist. Spikes (#29) and ADRs (#1 D1, #29, #49) get explicit decision records in `docs/adr/`.

---

## 20. Risks & Architectural Decisions to Resolve Before Implementation

| # | Decision / Risk | Options | Recommendation | Resolve by |
|---|---|---|---|---|
| D1 | Expo workflow | (a) Expo Go first, migrate later (b) CNG + dev-client from day one | **(b)** — avoids a painful mid-project workflow migration; M0 costs half a day | M0 (ADR-001) |
| D2 | `react-native-tcp-socket` health & New Architecture compat | (a) community lib (b) custom Expo module (~200 LOC) | Spike M4; **(a)** if maintained, else (b); custom module is small — TCP client is trivial in Kotlin/Swift | M4 spike (#29) |
| D3 | DNS strategy | (a) DoH-only (b) native resolver from start | **(a) DoH-only for M3**; `DnsServerRef{kind:'system'}` in the interface reserves (b). Document split-horizon limitation in-tool | Interface frozen at M3; native later |
| D4 | ICMP reality | (a) require native ICMP (b) TCP-ping default + ICMP best-effort | **(b)** — honest, cross-platform, no SELinux fights; UI labels methods clearly | M5 design |
| D5 | LAN discovery approach | (a) TCP sweep only (b) + mDNS (c) ARP-table read | **(a) primary, (b) optional, (c) best-effort only** (ARP blocked on Android 10+; iOS has neither) | M7; architecture allows all three as sources |
| D6 | UI kit | Paper vs styling-only (Tamagui/gluestack) vs primitives | **Paper**, wrapped in `ui/` tokens; swap cost contained by wrapper | M0 (low risk, reversible) |
| D7 | ORM | Drizzle vs raw SQL repositories | **Raw SQL + typed repositories for MVP** (4 tables); revisit if queries grow joins | M2; revisit M4 |
| D8 | State libs | Context-only vs zustand vs (+) React Query | **zustand M1, React Query M3** — calculators don't need query infra; networked ops do | M1/M3 |
| D9 | Cleartext traffic / ATS policy | (a) allow globally w/ ADR (b) per-domain runtime config | **(a) with explicit ADR + in-app justification** — a diagnostics tool must reach cleartext targets; runtime scoping isn't supported on either OS | M0 config, M6 exercised |
| D10 | Port-scan ethics/UX & App Store risk | aggressive defaults vs conservative | **Conservative defaults + rate limits + authorized-use copy**; iOS fallback = TestFlight/personal team | M4 UX review; iOS revisit M8 |
| D11 | History retention/growth | unbounded vs capped | **Capped (default 500) + purge setting + per-tool export before purge** | M2 |
| D12 | Monorepo now? | single package vs turborepo | **Single package**; `core` stays dependency-free so extraction (for Node probe CLI) is mechanical later | Defer until probe starts |
| D13 | React 19/New Architecture bridgeless compat for chosen native libs | assume works vs verify | **Verify in #29 spike** (interop layer usually present; don't get surprised in M4) | M4 spike |
| D14 | Wi-Fi SSID location-permission UX (Android 9+ needs location *services on*) | hide feature vs explain + degrade | **Explain + degrade** with a dedicated rationale card; classic Android gotcha | M5 |
| D15 | Tool registry shape freeze | ad-hoc screens vs registry contract | **Freeze registry contract at M0** (`id/category/capabilities/Component`); it's the module-system seam — churn here touches every tool | M0 |
| D16 | IPv6 scope creep | full v6 tools now vs types-now-tools-later | **Types + calculators-ready core now; v6 feature screens M2+** — prevents the v4-only rewrite | M1 core, M2 UI |
| D17 | iOS native module parity without macOS hardware | Swift-now vs Swift-when-iOS-starts | **Swift halves written with each Kotlin module** (Expo Modules API makes it cheap); type-check via CI mac runner | M5 onward |
| D18 | Probe protocol (future) | design now vs preserve seam only | **Seam only** (§3.6): JSON-serializable capabilities + pure core. Zero probe code before Android is stable | N/A (M9+) |

**Standing risk register (maintained in `docs/risks.md`):** community-lib abandonment (mitigated: custom-module fallback designed per §8), OEM network stack quirks (manual matrix §15), Play/App Store policy changes for security tools (conservative UX + TestFlight fallback), JS-bridge perf on scans (batched native APIs — §3.3), history DB bloat (D11).

---

*This plan is the source of truth until ADRs supersede sections of it. Every D-item above gets a one-page ADR in `docs/adr/` as it resolves.*
