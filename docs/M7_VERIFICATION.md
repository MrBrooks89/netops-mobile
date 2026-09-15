# M7 device verification

Verified on the Android 16 emulator (KVM, API 36, x86_64) with a dev-client
build containing the M7 native additions (`localSubnet`, `discoverMdns`, the
mDNS `MulticastLock` and the `CHANGE_WIFI_MULTICAST_STATE` declaration):
`scripts/dev.sh install` → `adb install`, app launched through the dev
launcher, Metro on 8081, host reachable from the emulator as `10.0.2.2`,
`adb reverse tcp:8081` in place.

**Fixtures used (all three live simultaneously):**

| Fixture | Address | Open port |
|---|---|---|
| `python3 -m http.server` on the host | `10.0.2.2` | 3000 |
| `python3 -m http.server` on the host | `10.0.2.2` | 8000 |
| host `sshd` (already listening) | `10.0.2.2` | 22 |
| `toybox nc -4 -l -p 9001` loop on the device | `10.0.2.15` (eth0) and `10.0.2.16` (wlan0) | 9001 |

The emulator image has **two** IPv4 interfaces on the same /24 (`eth0`
10.0.2.15, `wlan0` 10.0.2.16), which turned out to be useful: one listener
bound to `0.0.0.0` is discovered at both addresses.

## Result: M7 acceptance criteria met

| Criterion | Evidence |
|---|---|
| TCP sweep of the local /24 finds the fixture hosts (known open ports) within the bounded time budget | `/28` sweep of `10.0.2.0/28`, ports `3000,8000,9001`: **"10.0.2.0/28 — 1 HOST (TCP 1) IN 9.8S"**, row `10.0.2.2 [TCP] 11 ms · Open: 3000, 8000`. `/24` sweep with the default ports: **"10.0.2.0/24 — 1 HOST (TCP 1) IN 22.1S"**, row `10.0.2.2 [TCP] 54 ms · Open: 22`. `/24` with `3000,8000,9001`: **3 hosts** — `10.0.2.2` (open 3000/8000), `10.0.2.15` and `10.0.2.16` (open 9001) — which is exactly the fixture set. Every sweep stops at the 20 s budget and reports how much of the block it covered (see the coverage note below). |
| Multicast lock acquired only during discovery and released after (code review + manual log) | logcat shows exactly one pair per run and nothing else: `mDNS browse start (multicast lock acquired)` at 13:38:21.394, `mDNS browse end (multicast lock released)` at 13:38:23.917 — 2.52 s apart, i.e. the 2500 ms browse window. **While idle**, `dumpsys wifi` reports `Active lock owners: {}`, `Multicast Locks held:` (empty) and `mMulticastEnabled 6 / mMulticastDisabled 6` (balanced across all runs). **During a sweep**, the same dump reports `Active lock owners: {10216=1, 1000=1}` with `Multicaster{netops-mdns uid=10216}` held alongside the system NSD's lock. Code review: the lock is acquired immediately before the listeners start and released in the `finally` of `browseMdns`; no other code path holds one. |
| A discovered host can be saved or sent to scanner/ping in ≤ 2 taps | One tap each, on the result row for `10.0.2.2`: **Scan ports** → Port Scanner opens with `Host = 10.0.2.2`; **Ping** → Ping opens with `Host = 10.0.2.2`; **Save host** → the button flips to `Saved` and the message "Saved 10.0.2.2 to Saved hosts." appears. The Saved tab then lists `10.0.2.2`, tag `discovered`, note `Open: 3000, 8000`; on a later sweep the row already read `Saved` (state comes from the persisted host list). |
| Cancel works mid-sweep | `10.0.0.0/16` (capped to 1024 addresses), **Cancel** tapped 10 s in: the screen settles on **"10.0.0.0/16 — NO HOSTS FOUND IN 17.2S (CANCELLED)"** with the partial-coverage note "the sweep covered the first 24"; no crash, no hang, the progress card disappears and the form stays usable. |
| mDNS permission-denied state doesn't break TCP-sweep-only mode | See "The mDNS-denied path" below: unit tests cover the lock-denied and browse-rejected paths, and a device run with Android's local-network restriction enabled showed the sweep completing and rendering TCP-only results with the mDNS browse doing nothing and no crash. |
| Onboarding copy (authorized use + privacy) shown on first run | First launch after install renders the "Before you start" card: *"Use these tools only on networks you own or have permission to test."* / *"Results stay on this device. No accounts, no telemetry."* / *"Tap the star beside any tool to pin it to the top."* with a **Got it** button. After tapping it the card is gone, and it stays gone across `am force-stop` + relaunch (persisted `onboardingDismissed`). |

Dashboard polish (#47) was verified in the same session, since "dashboard
recents + favorites" is part of M7:

- **Favorites:** starring Ping from a Recent row made the `FAVORITES` card
  appear with Ping at the top, and the star's accessibility label flipped to
  "Remove Ping from favorites". After a full restart the card was still there.
- **Recent:** the `RECENT` card listed five distinct tools newest-first from
  the persisted runs, and the list refreshed when the tab regained focus.
- **Onboarding:** shown once, dismissed once, never again.

## The mDNS-denied path (criterion 5)

Two things had to be untangled here.

1. **The permission cannot be revoked at runtime.** `CHANGE_WIFI_MULTICAST_STATE`
   is an install-time permission with no app-op, and in a dev-client build it is
   *also* contributed by `expo-dev-launcher` — the manifest-merger blame report
   attributes the merged entry to `[:expo-dev-launcher]`, not to `netops`.
   Removing our own declaration therefore changes nothing in this build, and a
   temporary no-permission build was abandoned as unverifiable.
2. **So the restriction was produced the other way**: Android 16's Local
   Network Protections opt-in (`adb shell am compat enable RESTRICT_LOCAL_NETWORK
   com.anonymous.netopsmobile`, then a reboot), which is exactly the future
   scenario ADR-009 plans for.

Result of that run: the sweep completed in 10.6 s and reported **"NO HOSTS
FOUND"** with its honest empty-state copy, the mDNS browse still acquired and
released the lock and found zero services, and the app neither crashed nor
claimed success. Decisively, the same fixtures were **reachable from the device
shell at that moment** (`10.0.2.2:3000 OK`, `10.0.2.2:8000 OK`, `10.0.2.16:9001
OK`), so the app-only failure is attributable to the restriction and not to a
dead fixture. This also confirms ADR-009's key claim: **LNP-blocked TCP presents
as silence, not as a permission error.**

One finding worth recording: under LNP, `NsdManager` accepted every browse
registration and simply heard nothing — no `onStartDiscoveryFailed`, no error.
The platform does not surface the denial through NSD, so the report can only
honestly say "no services heard". The adapter's new
`"mDNS discovery could not start"` state covers the case where NSD *does* refuse
(the documented Android 17 behaviour with `ACCESS_LOCAL_NETWORK` denied), and it
is unit-tested rather than device-exercised.

The restriction was disabled and the device rebooted afterwards
(`rawOverrides={com.anonymous.netopsmobile=false}`); the follow-up sweep found
`10.0.2.2:22` again, which is the shipped configuration.

## The coverage note (what "within the bounded time budget" means here)

The emulator's user-mode network **silently drops** connections to unused
addresses. Every silent address therefore costs a full probe timeout, and the
sweep's throughput is capped by Android's TCP library, which runs connects on a
fixed **2-thread pool** (ADR-006). At a 500 ms timeout that is ~4 addresses/s,
so a 20 s budget covers ~25–33 addresses of a /24 *in this environment*:

```
10.0.2.0/24  → "Stopped at the 20s time budget after probing 25 of 254 addresses"
             → 1 host found (10.0.2.2:22)   ← the fixture, found in the first batch
```

On a LAN whose hosts answer with RST (the normal case — a dead address on a
switched network still gets a refusal from the gateway, and live hosts refuse
closed ports instantly) the same sweep finishes in seconds. The point of the
budget is that the user gets an answer either way, and the screen states plainly
how much of the block was covered instead of spinning. Narrowing the CIDR
(the `/28` run above) or shortening the port list are the documented remedies.

## Bugs found by this verification (all fixed and covered by tests)

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | A sweep with fixtures listening found **no hosts at all** | 48 sockets were left in flight through a **2-thread** native connect pool; queued sockets exceeded the adapter's watchdog and were all reported as timeouts | `DEFAULT_LAN_CONCURRENCY` 16 → 4, one port probed per socket, timeout 800 → 500 ms (commit `5684820`). More JS concurrency cannot help: the native pool is the ceiling. |
| 2 | `10.0.2.2` was reported as `Open: 3000` while `8000` was also open | the probe short-circuited at the first open port | probe every port and report them all; a live host refuses closed ports instantly, so the extra probes are cheap |
| 3 | A /24 sweep on a silent network ran for minutes with no end in sight | no time bound on the sweep | `runSweep` takes a `budgetMs` and returns `stopped: 'complete' \| 'cancelled' \| 'budget'`; the screen reports partial coverage |
| 4 | mDNS could report `available: true` when no browse ever started | `available` only reflected a failed multicast lock | NSD `onDiscoveryStarted` is counted; zero started browses now report `available: false` with a reason |
| 5 | `tcp.test.ts` ping-stats intermittently measured 9 ms against a `>= 10` bound; sql.js suites timed out under parallel coverage | Node truncates timer delays; every screen test migrates a real database | 1 ms tolerance in the assertion, `testTimeout: 15s` (commit `6e85ebb`) |

## Deviations and honest gaps

- **ARP is not implemented** (ADR-008): `/proc/net/arp` is unreadable for apps
  on Android 10+, so it could never work on a supported device.
- **mDNS contributes no addresses on Android < 14**: `NsdServiceInfo.host` and
  `getHostAddresses()` are API 34+, so instances without an address are dropped
  rather than guessed. The TCP sweep is unaffected.
- **mDNS finding a real service was not verified on device.** The emulator
  network has no mDNS responders, so the device only demonstrates "the browse
  runs, holds the lock for its window, and hears nothing". The merge path
  (hostname + advertised port folded into sweep rows, mDNS-only hosts included)
  is unit-tested with fake services (`src/platform/android/lan.test.ts`).
- **Cancelling mid-sweep records a partial run.** The capability returns a
  `Result` report with `stopped: 'cancelled'`, so the operation *succeeds* and
  history keeps what was found. ADR-005's "cancellations are not recorded" rule
  applies to operations that abort with a `CANCELLED` error; here the user gets
  partial results, and a partial result is a result (plan §14.8). The screen
  labels it "(cancelled)".
- **Live progress was observed in the UI dump** ("Sweeping — 19/1024 addresses,
  0 found…" with the progress bar), unlike M4 where uiautomator could not expose
  mid-operation views; the throttling itself remains unit-tested.

## Commands used

```bash
scripts/dev.sh install                     # prebuild-free gradle build + adb install
adb reverse tcp:8081 tcp:8081
adb shell monkey -p com.anonymous.netopsmobile -c android.intent.category.LAUNCHER 1
adb shell am start -a android.intent.action.VIEW -d "netops://tool/lan-discovery"
adb shell uiautomator dump /sdcard/ui.xml  # drove taps by testID (resource-id)
adb shell logcat -d -s Netops              # multicast lock lifetime
adb shell dumpsys wifi | grep -i multicast # lock owners, held/not held
adb shell netstat -tln                     # fixture listeners
adb shell 'toybox nc -w 3 10.0.2.2 8000'   # fixture reachability from the device
adb shell am compat enable RESTRICT_LOCAL_NETWORK com.anonymous.netopsmobile
```
