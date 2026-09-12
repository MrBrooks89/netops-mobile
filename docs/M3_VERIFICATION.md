# M3 device verification

Verified on the Android 16 emulator (KVM, API 36) with the M3 dev-client build
(JS-only milestone: DoH is fetch-based, so the M2 APK runs M3 via Metro).

**Network note.** Public DoH resolvers are unreachable from this network
(`cloudflare-dns.com`, `dns.google`, `1.1.1.1`, `8.8.8.8` all fail — this is
why live Jest tests pin captured payloads in
`__fixtures__/doh-responses.json` instead). `dns.adguard-dns.com` speaks the
same Cloudflare/Google JSON convention and answers, so on-device lookups used
it via the **Custom** provider — which is itself acceptance criterion 5's
"custom endpoint" path.

## Result: M3 acceptance criteria met

| Criterion | Evidence |
|---|---|
| Fixture domains return the expected records per type | Live lookups through the custom endpoint (AdGuard), each compared against a `curl` of the same resolver from the host: A `example.com` → `104.20.23.154, 172.66.147.243` with TTLs; AAAA → canonical `2606:4700:10::6814:179a, 2606:4700:10::ac42:93f3`; MX → the null MX rendered as `example.com (priority 0)` (real-world "0 ." edge case, parser keeps the preference without inventing an exchange); NS → `elliott/hera.ns.cloudflare.com`; TXT → quote-stripped `v=spf1 -all` and `_k2n1y4…`; CNAME for `www.example.com` → empty answer set shown as "No CNAME records exist for www.example.com." |
| Reverse of 8.8.8.8 → `dns.google` via PTR | Reverse DNS screen: `8.8.8.8.in-addr.arpa` → `dns.google`, TTL 54001s; "Look up this name" drills into DNS Lookup pre-filled with `dns.google`, whose A records (`8.8.8.8, 8.8.4.4`) close the loop. |
| Offline → `NETWORK_UNREACHABLE` friendly copy | With `svc wifi/data disable` (`Active default network: none`), lookups short-circuit to "You appear to be offline." (`netinfo: isConnected === false`) with Try again, and the failed run is recorded in history with that message. |
| Every run in History + drill-in detail | The History tab lists DNS Lookup / Reverse DNS runs with status, summary, and timestamp (count 25 → 27 as lookups were added); filter chips scope by tool; Details opens the run view with outcome, input JSON (including the resolver endpoint), and the answers as DETAIL JSON. The `runs` table in the on-device SQLite (`files/SQLite/netops.db`, WAL) matches the UI row-for-row. |
| DoH provider switchable in Settings, immediate effect | Settings → DNS RESOLVER radio chips: switching Cloudflare/Google/Custom updates "Currently using … New lookups use this immediately."; the DNS screen's hint ("Queries go to …") and the fetch URL change without restart. Switching to the blocked Cloudflare produced the unreachable error, then back to Custom restored working lookups — immediate in both directions. |
| `useOperation` standardises loading / error / retry / cancel | Loading: "Looking up A records…" spinner row. Error + retry: unreachable/timeout errors render the friendly sentence plus technical line, and "Try again" re-runs (verified against a non-routable endpoint). Timeout: the 10 s `fetchJson` timeout fires as "The request timed out." with the full technical detail. Cancel: a Cancel button appears while running; pressing it aborts the in-flight fetch, the UI settles silently, and **no history entry is recorded** for a cancellation. |

## Two real bugs found by this verification

1. **Results were labelled with live form state.** After an A lookup, tapping
   another record-type chip (without re-running) re-labelled the on-screen
   results "2 AAAA RECORDS" over IPv4 rows — and the reverse-DNS empty state
   had the same flaw for the queried IP. Fixed in `useOperation`: it now
   exposes `dataInput` (the input that produced the settled `data`), and both
   DNS screens label results from it. Regression tests switch the form after a
   lookup and assert the labels stay put
   (`src/features/dns-lookup/index.test.tsx`,
   `src/features/reverse-dns/index.test.tsx`).
2. **Cancellation surfaced as a network error on Android.** Expo's native
   fetch rejects an aborted request with a plain
   `Error("fetch failed: Fetch request has been canceled")` — no `AbortError`
   name — so `mapFetchFailure` mapped a user cancel to
   `NETWORK_UNREACHABLE` ("Could not reach the network."). The Jest fetch
   double rejects with a named `AbortError`, which is why tests never saw it.
   Fixed in `fetchJson`: when the catch runs and the *caller's* signal is
   aborted, it is a cancellation regardless of transport error shape. Verified
   on device: cancel settles silently and records nothing.

## Also fixed during verification

- **No Cancel affordance existed.** `useOperation` exposed `cancel()` (tested
  at the hook level) but no screen rendered it — a hanging lookup had no
  escape. `OperationStatus` now renders a Cancel button while running, wired to
  `operation.cancel` in both DNS screens.
- **`OperationStatus` stayed silent on `CANCELLED` by convention only.** The
  abort mapping in `platform/http.ts` documents "the UI can stay silent", but
  nothing enforced it. `OperationStatus` now returns `null` for `CANCELLED`
  errors explicitly.
- **Require cycle** `src/ui/components/index.tsx` → `src/ui/OperationStatus.tsx`
  → `src/ui/components/index.tsx` (Metro warned on every bundle).
  `OperationStatus` imports its primitives directly; the barrel still
  re-exported it, now cycle-free.
- **Stale "Calculator runs" copy.** The History header and Settings history
  card said "Calculator runs …" from the M1 era; DNS runs are recorded too.
  Both now say "Tool runs …".

## Verification environment

- Emulator: `scripts/emu.sh up` (docker, KVM, `@netops-test` AVD, cold boot),
  API 36, dev-client APK from the M2 build (M3 added no native code).
- Metro on 8081; the app at `10.0.2.2:8081`.
- UI driven with `adb input tap` via `scripts/find-tap.sh` (label/testID →
  bounds → centre tap) and read back with `uiautomator dump` +
  `scripts/ui-nodes.py`; screen text via `scripts/emu.sh text`.
- Database inspected by `adb shell run-as … cat` of the db + WAL, opened with
  Python `sqlite3` on the host.
- Offline simulation: `adb shell svc wifi disable && adb shell svc data disable`
  (netinfo short-circuits before any fetch; unknown connectivity counts as
  online per ADR-005).
- Quality gates after the fixes: `pnpm test` 445/445 (36 suites),
  `pnpm typecheck`, `pnpm lint`, `pnpm format:check` — all green.
