#!/usr/bin/env bash
# ios-smoke.sh — boot a simulator, install the built app, prove it stays up, and
# capture what it renders.
#
# Runs on macOS (the `ios` CI job). It answers the question unit tests cannot:
# does the *built* iOS app launch and render the registry-driven dashboard?
#
# What this does NOT do, and why (M8 finding): drive the UI to a tool screen.
# `simctl openurl` on iOS 26 puts up a system "Open in <app>?" confirmation for
# custom schemes, and there is no supported way to tap it from a script
# (simctl has no tap/sendkey, and XCUITest is a bigger hammer than M8 needs).
# The first version of this script took a screenshot after openurl and compared
# it with the dashboard — which "passed" on the confirmation dialog itself, a
# false positive worth remembering. Route rendering is instead covered where it
# can be checked honestly: the registry-wide CapabilityGate tests (which run as
# iOS, since that is jest-expo's platform), plus the proof here that the same
# build boots and renders.
#
# The dialog is captured as `deep-link-confirmation.png` so the limitation is
# documented by evidence rather than by comment.
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
if [[ ! -s "$OUT/dashboard.png" ]]; then
  echo "::error::ios-smoke: no dashboard screenshot was written" >&2
  exit 1
fi
echo "ios-smoke: captured dashboard.png"

# Evidence for the deep-link limitation above: on iOS 26 this raises a system
# confirmation dialog instead of opening the app.
xcrun simctl openurl "$UDID" "netops://tool/port-scanner" || true
sleep 5
xcrun simctl io "$UDID" screenshot "$OUT/deep-link-confirmation.png"
echo "ios-smoke: captured deep-link-confirmation.png (see header)"

xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null || true
echo "ios-smoke: ok"
