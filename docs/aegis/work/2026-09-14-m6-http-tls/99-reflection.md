# M6 HTTP diagnostics + TLS inspection - Reflection

Completion reflection for the M6 milestone (device verification closeout).

## What the verification changed

Two real-device catches, both timing/correctness bugs that every unit
test happily missed — the third milestone in a row proving the point
(M4 timeout messages, M5 factory-vs-module, M6 event ordering + key
size):

1. **The TLS phase read `—` on real https while the mocked test passed.**
   The unit test fires `secureConnect` after the connect callback, so a
   listener attached inside the callback works there — on Android the
   event can precede the callback, and the phase silently nulls. The
   honest-null contract (D4) made this *visible* instead of fabricated,
   which is exactly what it is for: the bug surfaced as "a phase is
   missing," not as a wrong number that would have shipped.
2. **`RSA 2352` for a 2048-bit key.** `publicKey.encoded` is SPKI DER
   including the ASN.1 header; multiplying its length by 8 invents a
   bit count that is plausible-looking and wrong — the worst kind of
   diagnostics-tool bug. The device run against a cert whose size I knew
   (keytool RSA 2048) is what exposed it. Fixture determinism is not
   decoration: known-answer inputs are the only cheap way to catch
   plausible-but-wrong numbers.

## Design decisions that held up

- **Raw sockets over fetch** (user-confirmed): per-phase timings and the
  `curl -v`-comparable header dump came out naturally; no fetch
  interception layer could have shown the TLS phase or hop-by-hop
  exchanges this honestly.
- **Byte math instead of Buffer types**: the Buffer v5-vs-v6 type clash
  (tcp-socket's transitive vs any root install) is structural, not
  fixable by adding a dep. Working in plain `Uint8Array` with
  `toBytes`/`concatBytes`/`bytesIndexOf` helpers sidestepped the entire
  problem and is more portable anyway.
- **Capture-only trust manager in the module** proved itself in one
   device session: the inspector displays the self-signed chain while the
   HTTP client *rejects the same server* — the boundary (§16.7) is
   demonstrably not just documentation.
- **Cleartext via a local config plugin** rather than a schema field
   that does not exist in SDK 57: the manifest attr is in the shipped
   APK (aapt2) and the decision is ADR-007 + in-app note, not a hidden
   flag.

## What M5's lesson prompted here

M5's reflection suggested a registry integration test for new
capability wiring. The M6 adapter tests cover exchangeOnce-shaped
behavior through fake sockets and the module handle, which caught the
URL "repair" regression (`http://h:99999` re-parsed as host `http`) —
a validation-level lie that only a determined boundary test would find.
The remaining gap (real-assembly mistakes) still belongs to device
verification; that division is now deliberate rather than accidental.

## Carrying forward

- Ctrl+A + DEL (via `input keycombination`) is the reliable way to clear
  a focused RN TextInput over adb; per-key DEL loops are flaky with
  GBoard swallowing events. Recorded for M7+ device sessions.
- The fixture pattern (keytool keystores + Node `pfx`) gives this
  host deterministic TLS answers without openssl; M8's iOS work can
  reuse the exact certs.
- Expiry math lives in `core/model/tls.ts` with floor semantics and
  boundary tests at 14 days — when M7's history browser renders TLS runs,
  reuse `tlsExpiry`, don't re-derive.
