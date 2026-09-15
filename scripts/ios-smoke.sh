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
# A route opened by URL still has to boot the app (Release build, embedded
# bundle), so it needs most of the same budget.
ROUTE_SETTLE_SECONDS="${ROUTE_SETTLE_SECONDS:-25}"

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

# Routes are opened by URL, in two ways, because they are not equivalent:
#   cold  — terminate first, so the URL arrives as the app's launch URL and
#           expo-router sees it on the first render;
#   warm  — the URL is delivered to the running app.
# A route screenshot that is byte-identical to the dashboard means the URL did
# not route at all, which is exactly the sort of silent no-op this script
# exists to catch, so each route must differ from the dashboard in at least one
# mode. The mode that worked is reported, and every screenshot is uploaded.
open_route() {
  local url="$1" name="$2"
  xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null || true
  sleep 2
  xcrun simctl openurl "$UDID" "$url"
  sleep "$ROUTE_SETTLE_SECONDS"
  xcrun simctl io "$UDID" screenshot "$OUT/$name-cold.png"
  echo "ios-smoke: captured $name-cold.png"
}

open_route_warm() {
  local url="$1" name="$2"
  xcrun simctl openurl "$UDID" "$url"
  sleep 8
  xcrun simctl io "$UDID" screenshot "$OUT/$name-warm.png"
  echo "ios-smoke: captured $name-warm.png"
}

assert_routed() {
  local name="$1" label="$2"
  local cold="$OUT/$name-cold.png" warm="$OUT/$name-warm.png"
  if ! cmp -s "$OUT/dashboard.png" "$cold" || ! cmp -s "$OUT/dashboard.png" "$warm"; then
    # Keep a stable name for the mode that actually rendered the route.
    if ! cmp -s "$OUT/dashboard.png" "$cold"; then
      cp "$cold" "$OUT/$name.png"
    else
      cp "$warm" "$OUT/$name.png"
    fi
    echo "ios-smoke: $label routed"
    return 0
  fi
  echo "::error::ios-smoke: $label did not route — both screenshots are identical to the dashboard"
  xcrun simctl spawn "$UDID" log show --last 3m --style compact \
    --predicate "processImagePath CONTAINS \"netopsmobile\"" 2>/dev/null | tail -30 >&2 || true
  return 1
}

# The native-gated tool: on this build every native capability is null, so the
# route must render the degraded card rather than a screen that fails on run.
open_route "netops://tool/port-scanner" "tool-gated"
open_route_warm "netops://tool/port-scanner" "tool-gated"

# A pure tool must still work in the same build.
open_route "netops://tool/subnet-calculator" "tool-available"
open_route_warm "netops://tool/subnet-calculator" "tool-available"

failed=0
assert_routed "tool-gated" "the native-gated tool screen" || failed=1
assert_routed "tool-available" "the always-available tool screen" || failed=1
if [[ "$failed" -ne 0 ]]; then
  xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null || true
  exit 1
fi

xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null || true
echo "ios-smoke: ok"
