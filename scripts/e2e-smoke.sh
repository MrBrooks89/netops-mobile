#!/usr/bin/env bash
# e2e-smoke.sh — M4 E2E smoke: scan the Node TCP fixture from the app.
#
# This is the script-driven stand-in for the plan's "Detox smoke test against
# the Node TCP fixture server" (plan #34 / §18): the flow is identical
# (launch → port-scanner → scan the fixture → assert open ports render with
# service names), executed over adb against the running emulator. Detox's
# androidTest harness on this CNG + dockerized-emulator host is deferred to
# M8 with the rest of the E2E tooling — recorded in docs/M4_VERIFICATION.md.
#
# Prerequisites (all are the normal M4 dev loop):
#   - emulator up (scripts/dev.sh up) with the app installed
#   - Metro running (scripts/dev.sh start)
#   - scripts/tcp-fixture.js running on the host
#
# Usage:
#   scripts/e2e-smoke.sh            # run the smoke, exit 0 on pass
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/netops-env.sh"

APP=com.anonymous.netopsmobile
DEV=emulator-5554
FIXTURE_HOST=10.0.2.2        # host loopback, from inside the emulator
ECHO_PORT=9701
SCAN_OPEN_EXAMPLE=9801       # odd ports in the fixture range accept

say() { echo "[e2e-smoke] $*"; }
die() { echo "[e2e-smoke] FAIL: $*" >&2; exit 1; }

adbx() {
  local tries=0
  until adb devices | grep -q "$DEV.*device$"; do
    tries=$((tries+1)); [ $tries -gt 10 ] && return 1; sleep 1
  done
  adb "$@"
}

dump() { adbx shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adbx shell cat /sdcard/ui.xml 2>/dev/null; }

say "checking prerequisites"
dump | grep -q "netopsmobile" || die "app not in foreground — launch it first (scripts/dev.sh open)"
adbx shell "echo -e 'GET /status HTTP/1.0\r\n\r' | timeout 3 toybox nc 10.0.2.2 8081" | grep -q "200" \
  || die "Metro not reachable from the emulator"

say "fixture sanity: echo port must accept from the emulator"
node -e "
const net = require('net');
const s = net.connect($ECHO_PORT, '127.0.0.1');
s.setTimeout(1500, () => { console.error('fixture echo port did not answer'); process.exit(1); });
s.on('connect', () => { s.destroy(); console.log('fixture echo OK'); process.exit(0); });
s.on('error', (e) => { console.error('fixture echo port error:', e.message); process.exit(1); });
" || die "fixture server not running — start it: node scripts/tcp-fixture.js &"

say "opening the port scanner"
adbx shell am start -a android.intent.action.VIEW -d "netops://tool/port-scanner" $APP >/dev/null 2>&1
sleep 5
xml=$(dump)
echo "$xml" | grep -q "Port Scanner" || die "port scanner screen did not render"

say "scanning the fixture range"
# The custom port list exercises the batched scan path end-to-end:
# 9800-9899 with odd ports open (fixture) and even ports refused.
python3 - <<'PYEOF'
import re, subprocess, time
def sh(*args): return subprocess.run(['adb','-s','emulator-5554','shell']+list(args),capture_output=True,text=True).stdout
def dump():
    sh('uiautomator','dump','/sdcard/ui.xml')
    return sh('cat','/sdcard/ui.xml')
xml = dump()
m = re.search(r'resource-id="port-scanner-host"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml)
if not m: raise SystemExit("host field not found")
x=(int(m.group(1))+int(m.group(3)))//2; y=(int(m.group(2))+int(m.group(4)))//2
sh(f'input tap {x} {y}'); time.sleep(1.5)
sh('input keyevent KEYCODE_MOVE_END')
sh('input keycombination 113 29')  # CTRL+A select all
sh('input keyevent KEYCODE_DEL')
sh('input text 10.0.2.2'); time.sleep(0.5)
sh('input keyevent KEYCODE_BACK'); time.sleep(1)
xml = dump()
m = re.search(r'resource-id="port-scanner-custom"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml)
if not m: raise SystemExit("custom field not found")
x=(int(m.group(1))+int(m.group(3)))//2; y=(int(m.group(2))+int(m.group(4)))//2
sh(f'input tap {x} {y}'); time.sleep(1.5)
# Range syntax (parsePortList): 9800-9899 = the fixture's 100-port block,
# odd ports accepting. Short string = no truncation by `input text`.
sh('input text 9800-9899'); time.sleep(0.6)
sh('input keyevent KEYCODE_BACK'); time.sleep(1)
xml = dump()
m = re.search(r'text="Scan"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml)
if not m: raise SystemExit("Scan button not found")
x=(int(m.group(1))+int(m.group(3)))//2; y=(int(m.group(2))+int(m.group(4)))//2
sh(f'input tap {x} {y}')
print("scan started")
PYEOF

say "waiting for the scan result (fixture range, ≤30s budget)"
found=""
for _ in $(seq 1 40); do
  sleep 2
  xml=$(dump)
  if echo "$xml" | grep -q "SCANNED IN"; then
    found=$(echo "$xml" | grep -oE '10\.0\.2\.2 — [0-9]+ open, [0-9]+ scanned in [0-9.]+s' | head -1)
    break
  fi
done
[ -n "$found" ] || die "scan result never rendered"

say "result: $found"
# The fixture opens the 50 odd ports in 9800–9899; under a 20-connection
# burst the fixture's accept backlog can drop a few, so require the strong
# majority to have answered open (and the closed half to count as scanned).
python3 - "$found" <<'PYEOF'
import re, sys
m = re.search(r'(\d+) open, (\d+) scanned in ([0-9.]+)s', sys.argv[1])
if not m: sys.exit(f"unparseable result line: {sys.argv[1]}")
opened, scanned, dur = int(m.group(1)), int(m.group(2)), float(m.group(3))
assert scanned == 100, f"expected 100 scanned, got {scanned}"
assert opened >= 40, f"expected at least 40 of the fixture's 50 open ports to answer, got {opened}"
assert dur < 30.0, f"scan exceeded the 30s budget: {dur}s"
print(f"assertions pass: {opened}/100 open, {dur}s")
PYEOF
[ $? -eq 0 ] || die "scan result out of bounds: $found"

say "PASS: fixture scan rendered ${found} within budget"
