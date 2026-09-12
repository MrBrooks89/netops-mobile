#!/usr/bin/env bash
# find-tap.sh — find a UI element by visible label substring and tap its center.
# Usage: scripts/find-tap.sh "DNS Lookup"
# Exits 1 if the label is not on screen.
set -euo pipefail
LABEL="${1:?usage: find-tap.sh <label-substring>}"

# uiautomator sometimes returns a stale dump on first read; retry once.
for i in 1 2; do
  scripts/emu.sh adb shell uiautomator dump /sdcard/window_dump.xml >/dev/null 2>&1
  NODES=$(scripts/emu.sh adb exec-out cat /sdcard/window_dump.xml | python3 scripts/ui-nodes.py "$LABEL")
  [ -n "$NODES" ] && break
  sleep 1
done
if [ -z "$NODES" ]; then
  echo "not found: $LABEL" >&2
  exit 1
fi
# Take the first (topmost) match. bounds format: [x1,y1][x2,y2]
BOUNDS=$(echo "$NODES" | head -1 | cut -f1)
XY=$(echo "$BOUNDS" | sed 's/\]\[/ /; s/\[//g; s/\]//g; s/,/ /g')
X=$(echo "$XY" | awk '{print int(($1+$3)/2)}')
Y=$(echo "$XY" | awk '{print int(($2+$4)/2)}')
echo "tapping '$LABEL' at $X,$Y (bounds $BOUNDS)"
scripts/emu.sh adb shell input tap "$X" "$Y"
