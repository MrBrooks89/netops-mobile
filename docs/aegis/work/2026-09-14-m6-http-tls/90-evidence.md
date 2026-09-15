# M6 HTTP diagnostics + TLS inspection - Evidence

Primary record: `docs/M6_VERIFICATION.md` (device verification table,
security-boundary re-checks, honest-null contract). Summary:

## Gates (all fresh at closeout)

- Jest: 545/545 tests, 47/47 suites — includes 12 httpUrl parse tests
  (bare-host https default, port bounds, credential rejection, the
  scheme-mangling regression: a malformed `http://h:99999` must NOT be
  "repaired" into host `http`), 6 tls expiry-math tests (floor semantics,
  the 14-day boundary, expired-is-not-expiring-soon, expires-today = 0),
  13 http adapter tests (fake tcp-socket: status/header/body parsing,
  relative + cap-limited redirects, Content-Length and close-delimited
  framing, REFUSED/TIMEOUT taxonomy from real Android message text,
  pre-abort CANCELLED, https connectTLS with secureConnect timing),
  3 tls adapter tests (capture mapping, error-as-value, thrown-exception
  mapping), 8 M6 screen tests (report rendering incl. honest dashes,
  expiry warning/expired/self-signed states, export button presence,
  CAPABILITY_UNAVAILABLE degradation, invalid-URL disable).
- Coverage: `core/model/http.ts` + `core/model/tls.ts` added to the ≥95%
  threshold map (both met); `core/validation/` already thresholded and
  covers httpUrl.
- `tsc --noEmit` clean; ESLint 0/0; Prettier clean.
- Seam invariants held: `react-native-tcp-socket` touched only by
  `src/platform/android/tcp.ts` + `src/platform/android/http.ts` (lazy
  inside `Platform.OS === 'android'`); `getTlsInfo` typed in
  `modules/netops/src/NetopsModule.ts`, called only by the TLS adapter;
  core models have zero RN/socket imports (pure byte math in the
  adapter, no `Buffer` types anywhere — the v5-vs-v6 clash is structural
  and avoided by design).

## Device (Android 16 emulator, API 36)

- Cleartext policy in the shipped APK: merged manifest carries
  `usesCleartextTraffic="true"` (aapt2-verified) written by the local
  config plugin `plugins/withCleartext.js`; iOS side is the ATS
  `NSAllowsArbitraryLoads` key in app.json (ADR-007).
- Redirect chain: `http://10.0.2.2:9805/start` → headline `200 OK`,
  `1 redirect → final`, hop `301 → /login`, Connect 495 / TTFB 498 /
  Total 1283 ms; header card matches `curl -v` (Connection: close
  difference is the tool's deliberate single-socket request).
- TLS inspection: self-signed fixture (`fixture.local`) flagged with the
  reject note; 3-day cert → `Expires in 2 days` + "Expiring in 2 days —
  plan the renewal now."; example.com → 4-cert chain, `EC 256` leaf, no
  self-signed flag, `in 42 days` (no warning).
- Export: share sheet with `tls-10.0.2.2-2026-09-15T03-13-43-743Z.json`
  (`netops.tls-report/1` schema).
- Security boundary proof: the same self-signed server that the
  *inspector* displays is *rejected* by the HTTP client ("Trust anchor
  for certification path not found") — capture never disables validation
  elsewhere (§16.7, ADR-007).

## Bugs found by device verification (fixed + re-verified)

1. TLS phase read `—` on real https: `secureConnect` can fire before the
   connect callback on Android, so a listener attached inside the
   callback misses it. Fix: attach the listener at socket creation and
   derive the phase from timestamps (either event order yields the same
   number). Re-verified: example.com Connect 728 / TLS 13 / TTFB 32 ms.
2. `keyInfoOf` reported `RSA 2352` for a 2048-bit key — it multiplied
   the SPKI DER length (ASN.1 header included) by 8. Fix: typed-key bit
   lengths (`RSAPublicKey.modulus.bitLength()`, EC curve field size,
   DSA params). Re-verified: fixture `RSA 2048`, example.com `EC 256`.

## Fixtures (new, committed)

- `scripts/http-fixture.js`: 9805 redirect chain, 9806 plain 200, 9443
  self-signed TLS (365-day), 9444 expiring TLS (3-day).
- `scripts/fixtures/certs/`: two keytool-generated PKCS12 keystores
  (passphrase `netopsfix`) mounted by the Node https server as `pfx` —
  no openssl on this host.
