/**
 * Local config plugin: per-ABI release APKs (plus a universal one).
 *
 * `expo-build-properties` can restrict which ABIs are built, but it cannot ask
 * AGP for **split** APKs — so a sideloadable release APK was 111 MB, carrying
 * four architectures' native libraries (59% of the artifact) for a device that
 * needs exactly one.
 *
 * Splitting keeps every ABI supported while making each file small: AGP emits
 * `app-<abi>-release.apk` for each, and `app-universal-release.apk` for the
 * "send it to anyone" case. Google Play does the same split automatically from
 * an AAB, so this plugin is about sideloading and local verification, not the
 * store path.
 *
 * The split APKs deliberately share a versionCode: Play rejects duplicate
 * codes, and these are never uploaded — the AAB is the upload artifact. If that
 * ever changes, add the usual `versionCodeOverride` loop here.
 *
 * Ordering: this must run *after* expo-build-properties, so it is listed last
 * in app.json's plugin array.
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
    splits {
        abi {
            enable true
            reset()
            include 'arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'
            universalApk true
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
