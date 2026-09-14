# M5 ping + wifi: Ping tool + Wi-Fi info - Checkpoint

- Task ID: 2026-09-13-m5-ping-wifi
- Current todo: Slice 1 — netops module scaffold (#35).
- Active slice: scaffold
- Blocked on: none
- Next step: create modules/netops (Kotlin + Swift skeletons), wire CNG
  (app.json permissions + module inclusion), verify the dev-client builds.

## Confirmed design decisions (user, this session)

1. **One unified Ping tool**: the M4 TCP Ping tool becomes "Ping" with a
   TCP (default) / ICMP best-effort method toggle; the separate `icmp-ping`
   placeholder registry entry is retired. Tool id stays `tcp-ping` so
   history rows remain valid.
2. **Permissions via Expo Modules calls** (no `react-native-permissions`):
   the netops module exposes typed permission functions over
   `appContext.permissions`; `platform/permissions.ts` holds the shared
   typed flow.
3. **Wi-Fi info is not recorded to history** — live state read with
   Refresh; history stays network-probe-shaped.

## Plan anchors

- Acceptance: docs/IMPLEMENTATION_PLAN.md §18 M5 (lines 708–713).
- Issues: #35 scaffold, #36 ICMP best-effort adapter, #37 Wi-Fi info
  module, #38 typed permission flows, #39 ping screen, #40 Wi-Fi screen.
- D4: TCP ping default, ICMP best-effort labeled.
- §6.3.4: permissions as capability UX, not OS branches.
- §6.4: degraded states (module/permission) via registry metadata.
