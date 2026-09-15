# ADR-008: LAN discovery sources — TCP sweep primary, mDNS optional, no ARP

**Status:** Accepted (M7, plan #44/#45 / D5)
**Deciders:** implementation agent + repo owner (M7 approval)
**Date:** 2026-09-13 (M7)
**Relates to:** ADR-005 (operations path), ADR-006 (TCP sockets), plan §3.3 (capability pattern), §6.4 (native seam), §9 (permissions), §18 M7

## Context

Plan D5 left three possible discovery sources: (a) TCP sweep, (b) mDNS, (c)
reading the ARP table — recommending "**(a) primary, (b) optional, (c)
best-effort only**", with the note that ARP is blocked on Android 10+ and
absent on iOS.

M7 has to answer what "best-effort ARP" actually buys on the platforms this app
targets (Android 10+ today, iOS later).

## Evidence

- **ARP (`/proc/net/arp`) is unreadable for apps on Android 10+.** SELinux
  denies `proc_net` reads to untrusted apps; the file either fails to open or
  returns only the app's own entry. The app's `minSdk` is far above 10, so this
  is not a "some devices" caveat — it is every supported device.
- **iOS has no ARP table and no `/proc`** (plan §10 note 7).
- **TCP sweep needs nothing beyond sockets.** A connect that is *refused*
  already proves the address is live; a connect that *opens* proves it and
  gives a port. This works wherever `tcpScan` works, which is where every other
  connectivity tool already works.
- **mDNS adds what the sweep cannot see.** `NsdManager` discovers service
  instances with their `host` name and IPv4 addresses (Android 14+/API 34
  fills both during discovery, so no resolve round-trip is needed). It receives
  multicast, so it needs a `MulticastLock` — and therefore
  `CHANGE_WIFI_MULTICAST_STATE`.
- **Meta-discovery is not available.** `NsdManager` does not support browsing
  `_services._dns-sd._udp`, so a browse must name service types. The adapter
  uses a curated list of types that actually appear on home/office LANs.

## Decision

1. **The TCP sweep is the engine**, driven by the existing `tcpScan` capability
   (ADR-006) and the pure-TS planner/runner in `src/core/lan/`. A host is
   reported when one of the probed ports accepts a connection; the probed port
   list is the user-facing tuning knob and the screen says so explicitly.
2. **mDNS is a second, optional, best-effort source.** It runs alongside the
   sweep, adds hostnames to rows the sweep already found, and contributes
   mDNS-only devices (e.g. a printer that blocks the probed ports). Its failure
   is a value: `MdnsBrowse.available === false` plus a reason, which the screen
   states as "TCP sweep only" (M7 acceptance criterion).
3. **ARP is dropped entirely** — not implemented, not configurable, and removed
   from the `LanSource` union. It cannot work on any supported device, and an
   always-empty source is complexity that hides which sources were actually
   used.
4. **The multicast lock is scoped to the browse**, acquired immediately before
   the listeners start and released in a `finally`, with logcat lines at both
   ends so the lifetime is checkable on a device (plan §9).

## Consequences

- Discovery is honest about evidence: a row's source badges (`TCP`, `mDNS`) say
  how the address was found, and nothing is reported that was not observed.
- A device with *none* of the probed ports open stays invisible to the sweep.
  That is a real limitation, documented in the tool, not a bug.
- The mDNS half is Android-only for now; the Swift half carries stubs that
  report `available: false`, which is exactly the degraded state the UI already
  renders (M8 groundwork, plan §10 note 9).
- D5's "architecture allows all three sources" is narrowed: `mergeLanHits`
  still merges any source set, so a future source (SSDP, remote probe) is an
  additive change in the adapter — but no dead source ships in the meantime.
