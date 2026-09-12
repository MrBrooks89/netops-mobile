#!/usr/bin/env bash
# netops-env.sh — source to get the .tools/-wrapped toolchain env (mirrors scripts/dev.sh).
# Usage: source scripts/netops-env.sh
ROOT="/home/mrbrooks/Projects/netops-mobile"
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

# The adb server is shared but flaps when many shells race it; wait for
# emulator-5554 to report "device" (not "offline") before running a command.
adbx() {
  local tries=0
  until adb devices | grep -q "emulator-5554.*device$"; do
    tries=$((tries+1))
    [ $tries -gt 10 ] && { echo "device never came online" >&2; return 1; }
    sleep 1
  done
  adb "$@"
}
