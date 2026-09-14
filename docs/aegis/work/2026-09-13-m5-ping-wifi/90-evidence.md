# M5 ping + Wi-Fi info: netops module - Evidence

Primary record: `docs/M5_VERIFICATION.md` (device verification table,
decisions, bug findings, gate status). Summary of what was captured:

## Gates (all fresh at closeout)

- Jest: 502/502 tests, 42/42 suites — includes 4 ICMP stats model tests,
  8 Wi-Fi model tests (channel/band math incl. the 5925/5955 5↔6 GHz
  boundary), 7 netops adapter tests (fake module handle: honest no-timing
  probes, INVALID_INPUT bounds, NETWORK_UNREACHABLE mapping, pre-abort +
  mid-series CANCELLED), 9 M5 screen tests (method toggle + no-timing
  copy, port-field hide, CAPABILITY_UNAVAILABLE degradation, unavailable
  rows, rationale card, settings deep-link, module-unavailable note).
- Coverage: `core/model/ping.ts` + `core/model/wifi.ts` added to the ≥95%
  threshold map (both met); no gate failures.
- `tsc --noEmit` clean; ESLint 0 errors/0 warnings; Prettier check clean.
- Seam invariants (plan §3.1/§3.3): `requireNativeModule` appears only in
  `modules/netops/src/NetopsModule.ts`, imported only by
  `src/platform/android/netops.ts` (lazy inside `Platform.OS === 'android'`);
  `core/model/wifi.ts` owns a `RawWifiInfo` shape — no core→modules import.

## Device (Android 16 emulator, API 36, bridgeless RN 0.86.3, Expo SDK 57)

- Module merged into the build: `aapt2 dump permissions` on the built APK
  lists `ACCESS_FINE_LOCATION` + `ACCESS_COARSE_LOCATION` +
  `ACCESS_WIFI_STATE` (the location pair enters the build at M5 exactly —
  the app's own CNG manifest declares none).
- Unified Ping, TCP default: `EXAMPLE.COM:443 (TCP) — 4/4 RECEIVED`,
  min/avg/max/loss real numbers; ICMP: `EXAMPLE.COM (ICMP, BEST-EFFORT)
  — 4/4 RECEIVED` with `#N reachable` probe lines and `min — ms` honest
  nulls; black-hole `192.0.2.1` → 0/4, `loss 100%`, `#N failed
  (UNREACHABLE)` both methods.
- Wi-Fi screen: pre-permission → rationale card + explicit
  "unavailable — needs location permission + Location Services on" rows
  (frequency/channel/band/RSSI still render — Android allows those);
  grant via system dialog → SSID `AndroidWifi` + BSSID unlock; deny →
  permanent-deny card + "Open settings" deep-link lands on the app's
  system settings page. No crash on any path.

## Bugs found and fixed during verification

1. **Registry passed the module factory, not the module** —
   `netops.netopsModule` (a function) reached `makeIcmpPingCapability`,
   so every native call was `undefined is not a function`. Jest missed it
   (adapters tested with fakes; screens tested with mocked
   `getCapabilities`) — only the device caught it. Fixed by calling the
   lazy accessor; re-verified live on the emulator.
2. `pingStats` counts "received" as latency-bearing probes — wrong for
   ICMP (ok-but-no-latency). Split into an honest `icmpStats` reducer
   (counts `ok`, keeps min/avg/max null).
3. 6 GHz channel math overlapped the 5 GHz range (5955 ≤ 5995 matched
   5 GHz first → ch 191 nonsense). Corrected band split: 5 GHz ≤ 5925,
   6 GHz ≥ 5955 (gap is intentionally unmapped); boundary tests pin it.
4. react-hooks `set-state-in-effect` rejects effect→async-helper→setState
   even when every setState follows an await; the wifi screen's initial
   load became an inline async IIFE with an `alive` cleanup flag.
