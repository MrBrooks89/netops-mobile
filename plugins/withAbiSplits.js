/**
 * Local config plugin: per-ABI **release** APKs (plus a universal one).
 *
 * Why this exists: `expo-build-properties` can restrict which ABIs are built,
 * but it cannot ask AGP for *split* APKs — so a sideloadable release APK was
 * 111 MB, carrying four architectures' native libraries (59% of the artifact)
 * for a device that needs exactly one. Splitting keeps every ABI supported while
 * making each file small: 38 MB for a phone instead of 100 MB.
 *
 * Scoping matters, and was learned by breaking things:
 *
 *  - **Release only.** `assembleDebug` must keep producing the single
 *    `app-debug.apk` that `scripts/dev.sh install` pushes to the emulator; with
 *    splits enabled the debug output is per-ABI and that path breaks.
 *  - **Never alongside a bundle task.** AGP refuses to build an app bundle while
 *    multiple APK outputs exist ("Multiple shrunk-resources files found … Please
 *    disable building multiple APKs when building an Android app bundle"), which
 *    is exactly the Play path — so a run that asks for `bundleRelease` gets no
 *    splits even if `assembleRelease` is requested in the same invocation.
 *
 * The split APKs deliberately share a versionCode: Play rejects duplicate codes
 * and these are never uploaded (the AAB is the upload artifact). If that ever
 * changes, add the usual `versionCodeOverride` loop here.
 *
 * Ordering: this must run *after* expo-build-properties, so it is listed last in
 * app.json's plugin array.
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = 'abi splits (plugins/withAbiSplits.js)';

const withAbiSplits = (config) =>
  withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      throw new Error('withAbiSplits: expected a Groovy build.gradle');
    }
    const contents = config.modResults.contents;
    if (contents.includes(MARKER)) return config;

    const block = `android {
    // ${MARKER}
    // Split APKs only for a release *APK* build: a bundle build must not see
    // multiple APK outputs, and a debug build must stay a single APK.
    def netopsRequested = gradle.startParameter.taskNames.collect { it.toLowerCase() }
    def netopsSplitApks = netopsRequested.any { it.contains('assemblerelease') } && !netopsRequested.any { it.contains('bundle') }
    splits {
        abi {
            enable netopsSplitApks
            reset()
            include 'arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'
            universalApk netopsSplitApks
        }
    }
`;

    if (!contents.includes('android {')) {
      throw new Error('withAbiSplits: could not find the android {} block in app/build.gradle');
    }

    config.modResults.contents = contents.replace('android {', block);
    return config;
  });

module.exports = withAbiSplits;
