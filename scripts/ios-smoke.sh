#!/usr/bin/env bash
# ios-smoke.sh — boot a simulator, install the built app, prove it stays up, and
# capture the two screens the M8 acceptance criterion is about.
#
# Runs on macOS (the `ios` CI job). It answers a question unit tests cannot:
# does the *built* app launch and render, including the degraded-state card for
# a native-gated tool on a build with no native capabilities wired?
#
# Usage: scripts/ios-smoke.sh [path/to/netopsmobile.app] [artifact-dir]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$ROOT/ios/build/Build/Products/Release-iphonesimulator/netopsmobile.app}"
OUT="${2:-$ROOT/artifacts/ios}"
BUNDLE_ID="com.anonymous.netopsmobile"
# How long to let the bundle load and the first frame render before judging.
SETTLE_SECONDS="${SETTLE_SECONDS:-25}"

if [[ ! -d "$APP" ]]; then
  echo "ios-smoke: no app bundle at $APP" >&2
  exit 1
fi

if ! xcodebuild -version >/dev/null 2>&1; then
  echo "ios-smoke: needs macOS with Xcode" >&2
  exit 1
fi

mkdir -p "$OUT"

# Pick the first available iPhone simulator: the runner image decides which
# device types and runtimes exist, so naming one here would rot.
UDID="$(xcrun simctl list devices available | awk -F '[()]' '/iPhone/ {print $2; exit}' | tr -d ' ')"
if [[ -z "$UDID" ]]; then
  echo "ios-smoke: no available iPhone simulator" >&2
  xcrun simctl list devices available >&2
  exit 1
fi
echo "ios-smoke: using simulator $UDID"

xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b

xcrun simctl install "$UDID" "$APP"
echo "ios-smoke: installed $APP"

xcrun simctl launch "$UDID" "$BUNDLE_ID"
sleep "$SETTLE_SECONDS"

# A crashed app leaves no running entry, so this is the "it launches" assertion.
if ! xcrun simctl spawn "$UDID" launchctl list | grep -q "$BUNDLE_ID"; then
  echo "ios-smoke: $BUNDLE_ID is not running ${SETTLE_SECONDS}s after launch" >&2
  echo "--- recent app log ---" >&2
  xcrun simctl spawn "$UDID" log show --last 2m --style compact \
    --predicate "processImagePath CONTAINS \"netopsmobile\"" 2>/dev/null | tail -40 >&2 || true
  xcrun simctl io "$UDID" screenshot "$OUT/crashed.png" || true
  exit 1
fi

xcrun simctl io "$UDID" screenshot "$OUT/dashboard.png"
echo "ios-smoke: captured dashboard.png"

# The native-gated tool: on this build every native capability is null, so the
# route must render the degraded card rather than a screen that fails on run.
xcrun simctl openurl "$UDID" "netops://tool/port-scanner"
sleep 6
xcrun simctl io "$UDID" screenshot "$OUT/tool-gated.png"
echo "ios-smoke: captured tool-gated.png"

# A pure tool must still work in the same build.
xcrun simctl openurl "$UDID" "netops://tool/subnet-calculator"
sleep 6
xcrun simctl io "$UDID" screenshot "$OUT/tool-available.png"
echo "ios-smoke: captured tool-available.png"

xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null || true
echo "ios-smoke: ok"
