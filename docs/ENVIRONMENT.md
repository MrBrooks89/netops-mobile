# Dev Environment (this Fedora host)

Everything the project needs lives **inside the workspace** under `.tools/` —
nothing writes to `$HOME`. This keeps the sandbox happy and the setup portable.

## Layout

```
.tools/
├── opt/jdk-21.0.9+10/       # Temurin JDK 21 (Android Gradle Plugin requirement)
├── android-sdk/             # ANDROID_HOME: cmdline-tools, platform-tools (adb),
│                            #   emulator, platforms;android-36, system image (API 36 x86_64), build-tools;36.0.0
├── home/                    # redirected HOME for sandboxed tooling (AVD lives here:
│                            #   .tools/home/.android/avd/netops-test.{avd,ini})
├── npm-cache/               # npm cache for the few npx-style calls
├── home/.local/share/pnpm/store/   # pnpm content-addressable store (pnpm's default,
│                            #   resolved from the redirected HOME — deliberately NOT
│                            #   pinned in pnpm-workspace.yaml, which would embed an
│                            #   absolute host path and break CI)
└── docker-config/           # DOCKER_CONFIG so docker CLI state stays workspace-local
```

`.tools/` is gitignored — it's reproducible from `scripts/setup-env.sh`.

## Android emulator (headless, KVM-accelerated)

The host has KVM (`kvm_amd`), but this shell runs sandboxed without `/dev/kvm`,
so the emulator runs as a Docker container (`docker/emulator.Dockerfile`, image
`netops-emulator`) with `--device /dev/kvm` and `--network host`:

- host adb talks to `emulator-5554` directly on localhost (host network mode)
- the guest can reach host Metro via the standard `10.0.2.2:8081` alias

```bash
scripts/emu.sh up      # boot (builds docker image first run)
scripts/emu.sh wait    # block until sys.boot_completed=1 (~40 s warm)
scripts/emu.sh status  # container + adb device state
scripts/emu.sh adb shell ...   # anything
scripts/emu.sh down    # stop
```

Test AVD: `netops-test` — Pixel 7 profile, Android 16 (API 36), google_apis/x86_64, 3 GB RAM.

## Env vars for any manual shell work

Prefer `scripts/dev.sh` (below), which exports all of these for you. Manually:

```bash
export JAVA_HOME=$PWD/.tools/opt/jdk-21.0.9+10
export ANDROID_HOME=$PWD/.tools/android-sdk
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH
export HOME=$PWD/.tools/home           # sandbox-safe; AVD + adb keys live here
export DOCKER_CONFIG=$PWD/.tools/docker-config
```

## scripts/dev.sh — one-command dev loop

Wraps all toolchain env (no manual exports ever needed):

```bash
scripts/dev.sh up        # start emulator (docker, KVM) and wait for boot
scripts/dev.sh install   # gradle assembleDebug + adb install
scripts/dev.sh start     # Metro on 8081 (foreground; Ctrl+C to stop)
scripts/dev.sh open      # (re)launch the app on the emulator
scripts/dev.sh stop      # stop emulator
scripts/dev.sh status    # what's running
scripts/dev.sh shell     # bash with all env exported
```

First launch after installing a fresh dev-client build shows the **dev
launcher** screen. Connect it to Metro: type `10.0.2.2:8081` in the URL field
and tap Connect (or pick the auto-discovered `http://<your-LAN-IP>:8081` entry).
The first bundle load also pops the Expo dev menu — tap **Go home** to see the
app. Thereafter the app reconnects to the last server automatically.

## Viewing the emulator screen (scrcpy)

scrcpy is **not in mainline Fedora repos** — it lives in the `zeno/scrcpy` COPR:

```bash
sudo dnf copr enable zeno/scrcpy
sudo dnf install scrcpy
scrcpy -s emulator-5554
```

(Hit `Ctrl+h` in the scrcpy window to send HOME, right-click = BACK.)

## Notes

- SDK package installs go through the new `android` CLI (`android sdk install …`),
  `sdkmanager` is deprecated in cmdline-tools 23.
- `pnpm approve-builds --all` was run once to allow `@parcel/watcher` and
  `unrs-resolver` postinstall scripts (Expo CLI needs them).
- Fedora's system Java is 25 — do **not** use it for Gradle; use the staged JDK 21.
