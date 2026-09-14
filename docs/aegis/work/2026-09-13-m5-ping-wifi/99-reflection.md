# M5 ping + Wi-Fi info: netops module - Reflection

Completion reflection for the M5 milestone (device verification closeout).

## What the verification changed

The registry factory-vs-module bug is the milestone's defining catch:
every unit test passed, typecheck passed, and the module itself worked —
but the single line assembling the real adapter handed the *accessor
function* where the *module handle* was expected, and only a real device
run surfaced it ("undefined is not a function" with no stack in the UI).
The seam pattern is exactly right; its cost is that nothing below the
real assembly point can catch assembly mistakes. The lesson mirrors M4's
timeout-message lesson at a different layer: device verification is not
ceremony, it is the only test that exercises the whole path. A registry
integration test (mock the module package, assert the capability calls
through to it) would have caught this and is worth adding when a second
consumer makes the seam's shape stable.

## Design decisions that held up on the device

The three scope decisions (unified Ping with the id kept stable, Expo
Modules permissions instead of a library, Wi-Fi as live state not
history) each removed a whole failure class: no tool-id migration for
history rows, no new dependency whose hoist could break Metro again
(M4's bug 2), and no half-informative "runs" cluttering history with
state reads. The honesty rules paid for themselves twice — the emulator's
virtual Wi-Fi reads SSID `AndroidWifi` only after the grant, so the
"unavailable — reason" placeholder rows *are* the correct first-run
state the plan asked for, and ICMP's `min — ms` nulls make the
best-effort label self-evidently true rather than marketing copy.

## What to carry into M6

- The channel/band math bug (5/6 GHz range overlap) is a reminder that
  "well-known constants" need boundary tests at both edges — the first
  version was wrong in the direction nobody eyeballs (5955 in the 5 GHz
  branch).
- RNTL v14 + React 19 flushes `fireEvent` state updates asynchronously:
  every post-press assertion needs `await waitFor`. Half a debugging
  session went into rediscovering that; the M5 tests now document it.
- The `set-state-in-effect` lint rule accepts an inline async IIFE with an
  `alive` flag, and rejects calling an async helper that sets state —
  even when every setState follows an await. Pattern is in
  `src/features/wifi-info/index.tsx`.
- `pm revoke` restarts the app (Android kills it) — re-launch before
  re-driving the permission flow.

Method Pack output does not grant completion authority.
