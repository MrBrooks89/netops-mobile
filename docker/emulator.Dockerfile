# Android emulator image for netops-mobile automated testing (headless, KVM).
# Build:  docker build -t netops-emulator -f docker/emulator.Dockerfile docker/
# Run:    see scripts/emu.sh
FROM ubuntu:24.04

# Emulator runtime dependencies (X/GL software rendering, pulse stub, png, fonts).
RUN apt-get update && apt-get install -y --no-install-recommends \
      libx11-6 libxcb1 libxau6 libxdmcp6 \
      libgl1 libegl1 libglx0 libopengl0 \
      libpulse0 libpng16-16 \
      fontconfig fonts-dejavu-core \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# SDK and AVD home are expected to be mounted at runtime:
#   -v $ANDROID_HOME:/opt/android-sdk
#   -v $ANDROID_AVD_HOME:/avd
ENV ANDROID_HOME=/opt/android-sdk \
    ANDROID_AVD_HOME=/avd \
    QTWEBENGINE_DISABLE_SANDBOX=1

WORKDIR /opt
ENTRYPOINT ["/opt/android-sdk/emulator/emulator"]
