#!/usr/bin/env bash
# Reproduces the dev toolchain under .tools/ from scratch (see docs/ENVIRONMENT.md).
# Safe to re-run; existing artifacts are kept.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p .tools/dl .tools/opt .tools/npm-cache .tools/docker-config

JDK_DIR=".tools/opt/jdk-21.0.9+10"
if [ ! -x "$JDK_DIR/bin/java" ]; then
  echo "==> Downloading Temurin JDK 21 (glibc x64)…"
  URL=$(curl -sL "https://api.github.com/repos/adoptium/temurin21-binaries/releases?per_page=1" | python3 -c "
import json,sys
for a in json.load(sys.stdin)[0]['assets']:
    n=a['name']
    if 'x64_linux' in n and n.endswith('.tar.gz') and 'sbom' not in n.lower() and 'sig' not in n.lower() and 'sha' not in n.lower() and 'debug' not in n.lower():
        print(a['browser_download_url']); break
")
  curl -sL -o .tools/dl/jdk21.tar.gz "$URL"
  tar xzf .tools/dl/jdk21.tar.gz -C .tools/opt
fi

export JAVA_HOME="$ROOT/$JDK_DIR"
export PATH="$JAVA_HOME/bin:$PATH"
export ANDROID_HOME="$ROOT/.tools/android-sdk"
export HOME="$ROOT/.tools/home"
export ANDROID_AVD_HOME="$HOME/.android/avd"
export ANDROID_SDK_HOME="$HOME"
mkdir -p "$ANDROID_AVD_HOME"

if [ ! -d "$ANDROID_HOME/cmdline-tools/latest" ]; then
  echo "==> Downloading Android cmdline-tools…"
  curl -sL -o .tools/dl/cmdline-tools.zip "https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip"
  unzip -q -o .tools/dl/cmdline-tools.zip -d .tools/dl/ct-extract
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  mv .tools/dl/ct-extract/cmdline-tools "$ANDROID_HOME/cmdline-tools/latest"
fi

CLI="$ANDROID_HOME/cmdline-tools/latest/bin/android"
if [ ! -d "$ANDROID_HOME/platform-tools" ]; then
  echo "==> Installing SDK packages (platform-tools, emulator, API 36)…"
  yes | "$CLI" sdk install --sdk="$ANDROID_HOME" \
    "platform-tools" "emulator" "platforms;android-36" \
    "system-images;android-36;google_apis;x86_64" "build-tools;36.0.0" >/dev/null
fi

if [ ! -f "$ANDROID_AVD_HOME/netops-test.ini" ]; then
  echo "==> Creating AVD netops-test…"
  echo n | "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd \
    --name netops-test \
    --package "system-images;android-36;google_apis;x86_64" \
    --device pixel_7 >/dev/null
fi

echo "==> Done. Emulator: scripts/emu.sh up && scripts/emu.sh wait"
