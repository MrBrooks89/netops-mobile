# M6 device verification

Verified on the Android 16 emulator (KVM, API 36) with a dev build
containing the M6 additions to the local `modules/netops` Expo module
(TLS chain capture, Kotlin half) plus the raw-socket HTTP client:
`expo prebuild` regenerated `android/` (CNG, now with
`android:usesCleartextTraffic="true"` via the local config plugin),
`./gradlew assembleDebug`, `adb install` (~1m incremental after the
first M6 build; 754 tasks), Metro on 8081.

New fixtures (all under `scripts/`, host = `10.0.2.2` from the
emulator): `scripts/http-fixture.js` serves plain-HTTP on 9805 (redirect
chain `/start` → 301 `/login` → 200) and 9806 (direct 200), plus HTTPS on
9443 (self-signed `CN=fixture.local`, 365-day cert) and 9444
(self-signed `CN=expiring.fixture.local`, 3-day cert). The two
self-signed certs are PKCS12 keystores generated with the project JDK's
`keytool` (`scripts/fixtures/certs/`, passphrase `netopsfix`) — Node's
`https` server mounts them as `pfx`.

## Result: M6 acceptance criteria met

| Criterion | Evidence |
|---|---|
| Full redirect chain with per-phase timings | `http://10.0.2.2:9805/start`: headline `HTTP://10.0.2.2:9805/START — 200 OK`, Hops row `1 redirect → final`, hop line `301 → /login`, final-hop phase timings Connect `495 ms`, First byte `498 ms`, Total (all hops) `1283 ms`. DNS row reads `—` with the honesty note (DNS resolves inside the native connect — not separately observable from JS; no invented numbers, D4). TLS row `—` because the chain is cleartext. |
| Header dump matches `curl -v` spot-check | App's Response headers card for the final hop: `Content-Type: text/plain`, `X-Fixture: final-hop`, `X-Directive: netops-m6-fixture`, `Date`, `Connection: close`, `Transfer-Encoding: chunked`, Body `37 bytes` with preview `fixture login page reached`. Host-side `curl -v http://127.0.0.1:9805/start` (and `-L`) returns the same header set (`Content-Type`, `X-Fixture`, `X-Directive`, `Transfer-Encoding: chunked`) — the only difference is `Connection: close`, which the tool sends deliberately on its single raw socket (curl uses keep-alive). |
| Self-signed flagged | TLS Inspector against `10.0.2.2:9443`: chain card `LEAF CERTIFICATE — SELF-SIGNED`, Subject = Issuer = `CN=fixture.local,O=NetOps Fixture`, red note "Self-signed certificate — a standard client would reject this chain unless the CA is manually trusted." The HTTP *client* (separate concern) rejects the same server with `Trust anchor for certification path not found` — raw-socket exchanges validate against system CAs; inspection never bypasses anything (§16.7). |
| Expiring-cert warning < 14 days | TLS Inspector against `10.0.2.2:9444` (3-day cert): `Expires in 2 days` + red note "Expiring in 2 days — plan the renewal now." Healthy certs show no warning: example.com leaf `Expires in 42 days` (no note), fixture.local `in 364 days` (no note). |
| TLS report exportable | "Export report" button → Android share sheet: `Sharing 1 file` / `tls-10.0.2.2-2026-09-15T03-13-43-743Z.json` with Drive/Gmail/Quick Share targets. The JSON carries `schema: netops.tls-report/1`, full chain, timings, and export timestamp. |
| Cleartext http:// per §16.4/§17 config | `aapt2 dump` on the built APK's merged manifest: `usesCleartextTraffic="true"` on `<application>`; iOS `NSAppTransportSecurity.NSAllowsArbitraryLoads` set in app.json (ADR-007). The probe to `http://10.0.2.2:9805/...` completed over cleartext from inside the app. |
| https:// with TLS phase visible | `https://example.com/`: `HTTPS://EXAMPLE.COM/ — 200 OK`, direct (no redirects), Connect `728 ms`, **TLS `13 ms`**, First byte `32 ms`, Total `656 ms`. (First build read TLS as `—`: the `secureConnect` listener attached inside the connect callback missed events that fire earlier on Android; fixed by deriving the phase from timestamps with listeners attached at socket creation — re-verified.) |
| Real-CA chain renders fully | TLS Inspector against `example.com:443`: `Chain length 4 certificates`, leaf `CN=example.com` / `CN=Cloudflare TLS Issuing ECC CA 3,O=SSL Corporation,C=US`, Valid `2026-07-29 → 2026-10-27`, SANs `example.com`, `*.example.com`, Serial, `SHA256withECDSA`, `EC 256`, then CHAIN 2 (issuing CA) and below. No self-signed flag (correct). |
| Key info correctness | `keyInfoOf` initially reported `RSA 2352` for a 2048-bit fixture cert — it multiplied the SPKI DER length (ASN.1 header included) by 8. Fixed to read the typed key: `RSAPublicKey.modulus.bitLength()` / `ECPublicKey` curve field size / `DSAPublicKey` params. Re-verified on-device: fixture leaf reads `RSA 2048`, example.com leaf reads `EC 256`. |

## Security boundaries re-checked on-device (§16.7, ADR-007)

- TLS inspection is **capture-only**: the netops module's trust manager
  records the chain the server presents and never installs itself
  anywhere else; the app's other connections keep full system
  validation (the self-signed rejection by the HTTP client above is the
  proof).
- The HTTP client **validates TLS by default** (`connectTLS` with system
  trust; `tlsCheckValidity` never disabled). There is no "ignore cert"
  switch in any screen (ADR-007 boundary).
- Cleartext is a deliberate, ADR-recorded global allow scoped to this
  diagnostics app's purpose, declared in the manifest and surfaced
  in-app (the HTTP screen's note references ADR-007), not hidden.
- Body content renders as plain-text preview only (no HTML rendering,
  §16.10); preview capped at 2 KiB, whole response capped at 16 KiB.

## Honest-null contract (D4) in the shipped UI

DNS is null on Android (resolved inside native connect) → rendered `—`
with an explanatory note, never a fabricated number. Cleartext exchanges
show TLS as `—` (no TLS phase exists on http://). Cancelled and timeout
paths surface the taxonomy (`CANCELLED`, `TIMEOUT`, `REFUSED`,
`NETWORK_UNREACHABLE`) with technical details.
