#!/usr/bin/env bash
# Headless Android emulator for netops-mobile dev/testing on this Fedora host.
#
# Usage:
#   scripts/emu.sh up           # boot emulator in background (KVM-accelerated)
#   scripts/emu.sh down         # stop emulator container
#   scripts/emu.sh adb <args>   # run adb (host adb talks to emulator over host network)
#   scripts/emu.sh wait         # block until sys.boot_completed=1
#   scripts/emu.sh status       # show container + device state
#
# All state lives under .tools/ (workspace-local) — nothing touches $HOME.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK="$ROOT/.tools/android-sdk"
AVD_HOME="$ROOT/.tools/home/.android/avd"
IMG=netops-emulator
NAME=netops-emulator

export ANDROID_HOME="$SDK"
# Workspace-local client state (this repo's tooling must never write $HOME).
export DOCKER_CONFIG="$ROOT/.tools/docker-config"
export HOME="$ROOT/.tools/home"
mkdir -p "$DOCKER_CONFIG"

ADB="$SDK/platform-tools/adb"
EMU='@netops-test -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -accel on -memory 3072 -cores 2'

cmd="${1:-status}"

case "$cmd" in
  up)
    # Build the image once
    if ! docker image inspect "$IMG" >/dev/null 2>&1; then
      echo "Building $IMG image (first run only)…"
      docker build -q -t "$IMG" -f "$ROOT/docker/emulator.Dockerfile" "$ROOT/docker/" >/dev/null
    fi
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    # clear stale AVD locks from an unclean shutdown (docker kill leaves them)
    rm -f "$AVD_HOME"/netops-test.avd/*.lock 2>/dev/null || true
    # --network host: host adb sees the emulator on localhost:5554/5555 and
    # the emulator reaches host Metro via the standard 10.0.2.2 alias.
    docker run -d --name "$NAME" \
      --device /dev/kvm --device /dev/dri \
      --network host \
      -v "$SDK":/opt/android-sdk \
      -v "$AVD_HOME":/avd \
      -e LD_LIBRARY_PATH=/opt/android-sdk/emulator/lib64:/opt/android-sdk/emulator/lib64/qt/lib \
      "$IMG" \
      $EMU >/dev/null
    echo "Emulator booting (container: $NAME, host network)…"
    ;;
  down)
    docker rm -f "$NAME" >/dev/null 2>&1 && echo "stopped" || echo "not running"
    ;;
  adb)
    shift
    "$ADB" "$@"
    ;;
  wait)
    echo -n "waiting for boot…"
    for i in $(seq 1 60); do
      if [ "$("$ADB" -s emulator-5554 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; then
        echo " done"
        exit 0
      fi
      echo -n "."
      sleep 5
    done
    echo " TIMEOUT" >&2
    exit 1
    ;;
  status)
    if docker container inspect -f '{{.State.Status}}' "$NAME" 2>/dev/null | grep -q running; then
      echo "container: running"
      "$ADB" devices 2>/dev/null | tail -n +2
    else
      echo "container: stopped"
    fi
    ;;
  *)
    echo "usage: $0 {up|down|adb|wait|status}" >&2
    exit 2
    ;;
esac
