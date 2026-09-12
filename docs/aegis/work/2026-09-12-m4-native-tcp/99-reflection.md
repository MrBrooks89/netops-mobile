# M4 native pivot: TCP connect/ping + port scanner - Reflection

Completion reflection for the M4 milestone (device verification closeout).

## What the verification changed

Three of the milestone's "done-looking" states were wrong until the device
said otherwise: the TIMEOUT classification (Android's exception text
differs from every documented/Jest-imaginable shape — only a real device
run exposed it, exactly what the plan's D13 warned), Metro's resolution
layout (twice), and the DB-pull path under adb flapping. The pattern from
M3 held: verification is where the real bugs live, and the plan's
"device-verified error mapping, not Jest doubles" note earned its keep.

## What the deviation cost

Detox's androidTest harness was replaced by a script-driven smoke
(`scripts/e2e-smoke.sh`) against the same Node fixture the plan named. The
flow and assertions match the acceptance line; what is lost is Detox's
grey-box determinism (by-id element queries vs coordinate taps). The smoke
is honest about that: it polls for the result line rather than tapping
assertions into the mid-scan UI. The plan itself was split (§7 table says
Detox at M8; §7 strategy + #34 say M4), so M4 records the choice rather
than silently half-doing it. `detox` stays installed for the M8 decision.

## What to carry into M5

- Keep the fixture-first habit: the echo/dual-range fixture drove every
  acceptance number in minutes once it existed.
- `parsePortList` ranges reduced the smoke's input from a 400-char CSV to
  9 chars — the fewer bytes adb has to type, the more reliable the drive.
- `.npmrc` hoist patterns are now load-bearing: any future `pnpm add`
  reshuffle should not re-break Metro, but if the app crash-loops with
  UnableToResolveError, restart Metro before debugging anything else.

Method Pack output does not grant completion authority.
