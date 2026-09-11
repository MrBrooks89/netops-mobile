#!/usr/bin/env bash
# dev.sh — one-command dev environment for netops-mobile (Fedora host).
#
# Wraps every piece of toolchain state that lives under .tools/ so you never
# need to export anything manually:
#   JAVA_HOME, ANDROID_HOME, ANDROID_AVD_HOME, ANDROID_SDK_HOME,
#   ANDROID_USER_HOME, GRADLE_USER_HOME, DOCKER_CONFIG, HOME (toolchain-local)
#
# Usage:
#   scripts/dev.sh up        start emulator (docker, KVM) and wait for boot
#   scripts/dev.sh install   build + install the debug APK on the emulator
#   scripts/dev.sh start     start Metro on 8081 (foreground)
#   scripts/dev.sh open      (re)launch the app on the emulator
#   scripts/dev.sh stop      stop the emulator container
#   scripts/dev.sh status    show what's running
#   scripts/dev.sh shell     bash with all env vars exported (for ad-hoc work)
#
# Tip: to see the emulator screen on your desktop, install scrcpy:
#   sudo dnf copr enable zeno/scrcpy && sudo dnf install scrcpy
#   scrcpy -s emulator-5554
# (scrcpy is not in mainline Fedora repos — it lives in the zeno/scrcpy COPR.)

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

# ---- toolchain env (all state stays under .tools/, gitignored) ----
export HOME="$ROOT/.tools/home"
export JAVA_HOME="$ROOT/.tools/opt/jdk-21.0.9+10"
export PATH="$JAVA_HOME/bin:$ROOT/.tools/android-sdk/platform-tools:$PATH"
export ANDROID_HOME="$ROOT/.tools/android-sdk"
export ANDROID_AVD_HOME="$ROOT/.tools/home/.android/avd"
export ANDROID_SDK_HOME="$ROOT/.tools/home"
export ANDROID_USER_HOME="$ROOT/.tools/home/.android"
export GRADLE_USER_HOME="$ROOT/.tools/gradle-home"
export DOCKER_CONFIG="$ROOT/.tools/docker-config"
export npm_config_cache="$ROOT/.tools/npm-cache"
ADB="adb"
PKG="com.anonymous.netopsmobile"

case "${1:-status}" in
  up)
    scripts/emu.sh up
    scripts/emu.sh wait
    ;;
  install)
    ( cd android && ./gradlew assembleDebug )
    adb install -r android/app/build/outputs/apk/debug/app-debug.apk
    ;;
  start)
    exec npx expo start --port 8081
    ;;
  open)
    adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null
    echo "app launched"
    ;;
  stop)
    scripts/emu.sh down
    ;;
  status)
    echo "== docker =="
    docker ps --filter name=netops-emulator --format "table {{.Names}}\t{{.Status}}" || true
    echo "== adb =="
    adb devices || true
    echo "== metro (8081) =="
    ss -tln | grep -q ":8081" && echo "listening" || echo "not running"
    ;;
  shell)
    exec bash
    ;;
  *)
    echo "unknown command: $1 (see header of this script)" >&2
    exit 1
    ;;
esac
