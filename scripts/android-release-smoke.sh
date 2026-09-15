#!/usr/bin/env bash
# android-release-smoke.sh — install a *release* APK, launch it with no dev
# server, and assert what actually renders.
#
# This is the Android counterpart of scripts/ios-smoke.sh, and it exists for the
# same reason: a release build is a different artifact from a dev-client build
# (Hermes bundle baked in, R8 shrinking, merged manifest), and the failure modes
# are invisible until it runs. It checks, in order:
#
#   1. the APK installs and the app process stays alive after launch,
#   2. the dashboard renders (registry-driven UI is alive),
#   3. a native-gated tool renders its screen rather than the degraded-state
#      card — i.e. the native module survived R8 and the manifest kept its
#      permissions,
#   4. a pure tool renders its report.
#
# Run it with Metro stopped for an airtight check (a release build never looks
# for a dev server, but a listening port 8081 cannot then hide a mistake).
#
# Usage: scripts/android-release-smoke.sh [path/to.apk]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APK="${1:-$ROOT/android/app/build/outputs/apk/release/app-release.apk}"
SETTLE_SECONDS="${SETTLE_SECONDS:-12}"
UI_XML="/sdcard/netops-smoke-ui.xml"

if [[ ! -f "$APK" ]]; then
  echo "android-release-smoke: no APK at $APK" >&2
  echo "build one first: (cd android && ./gradlew assembleRelease)" >&2
  exit 1
fi

if [[ -n "${ANDROID_HOME:-}" && -x "$ANDROID_HOME/platform-tools/adb" ]]; then
  ADB="$ANDROID_HOME/platform-tools/adb"
else
  ADB="$(command -v adb || true)"
fi
if [[ -z "$ADB" ]]; then
  echo "android-release-smoke: adb not found (set ANDROID_HOME or put adb on PATH)" >&2
  exit 1
fi

PKG="$(node -e "process.stdout.write(require('$ROOT/app.json').expo.android.package)")"

if ! "$ADB" get-state >/dev/null 2>&1; then
  echo "android-release-smoke: no device/emulator attached" >&2
  "$ADB" devices >&2
  exit 1
fi

# Current screen text, one label per line, from the accessibility tree.
screen() {
  "$ADB" shell uiautomator dump "$UI_XML" >/dev/null 2>&1 || true
  "$ADB" shell cat "$UI_XML" 2>/dev/null |
    grep -oE '(text|content-desc)="[^"]+"' |
    sed -E 's/^(text|content-desc)="//; s/"$//' |
    grep -v '^$'
}

# Case-insensitive on purpose: RN's `textTransform: 'uppercase'` changes the
# rendered text of section titles ("CURRENT CONNECTION"), and the accessibility
# tree reports what is rendered, not what the source says.
expect() {
  local what="$1" needle="$2" haystack="$3"
  if ! grep -qiF -- "$needle" <<<"$haystack"; then
    echo "android-release-smoke: $what — expected to find \"$needle\"" >&2
    echo "--- screen text ---" >&2
    echo "$haystack" >&2
    return 1
  fi
  echo "android-release-smoke: ok — $what"
}

refuse() {
  local what="$1" needle="$2" haystack="$3"
  if grep -qiF -- "$needle" <<<"$haystack"; then
    echo "android-release-smoke: $what — found \"$needle\", which must not appear" >&2
    return 1
  fi
  echo "android-release-smoke: ok — $what"
}

echo "android-release-smoke: installing $APK"
"$ADB" install -r "$APK" | tail -1

"$ADB" shell am force-stop "$PKG" || true
"$ADB" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep "$SETTLE_SECONDS"

# 1. Alive. A crash between launch and here leaves no process.
if [[ -z "$("$ADB" shell pidof "$PKG" | tr -d '\r')" ]]; then
  echo "android-release-smoke: $PKG is not running ${SETTLE_SECONDS}s after launch" >&2
  "$ADB" logcat -d -b crash | tail -40 >&2 || true
  exit 1
fi
echo "android-release-smoke: ok — app is running"

# 2. Dashboard.
DASHBOARD="$(screen)"
expect "dashboard renders" "NetOps Toolkit" "$DASHBOARD"
expect "tool registry is alive" "IPv6 Calculator" "$DASHBOARD"
refuse "no missing-capability banner" "is not available in this build" "$DASHBOARD"

# 3. Native-gated tool: the module must be reachable (not the §6.4 card).
"$ADB" shell am start -a android.intent.action.VIEW -d "netops://tool/wifi-info" >/dev/null 2>&1
sleep 6
WIFI="$(screen)"
expect "native module answers (Wi-Fi screen)" "Current connection" "$WIFI"
expect "gateway row renders" "Gateway" "$WIFI"
expect "dns row renders" "DNS" "$WIFI"
refuse "native capability is present" "is not available in this build" "$WIFI"

# 4. Pure tool: the report renders without a network.
"$ADB" shell am start -a android.intent.action.VIEW -d "netops://tool/ipv6-calculator" >/dev/null 2>&1
sleep 6
IPV6="$(screen)"
expect "pure tool renders its report" "Prefix mask" "$IPV6"
expect "report has real values" "2001:db8:abcd:12::" "$IPV6"

"$ADB" shell am force-stop "$PKG" || true
echo "android-release-smoke: ok"
