/**
 * Local config plugin: allow cleartext traffic app-wide (ADR-007, plan D9).
 *
 * An HTTP diagnostics tool must speak plain http:// to user-entered targets.
 * Android 9+ blocks cleartext by default; the single reviewed place for this
 * declaration is the CNG pipeline (plan §16.4), so this plugin writes
 * android:usesCleartextTraffic="true" onto <application> during prebuild.
 * The iOS side (NSAllowsArbitraryLoads) is handled by the app config's
 * ios.infoPlist keys, which CNG already merges into Info.plist.
 *
 * Justification: docs/adr/007-cleartext-traffic-policy.md
 */
const { withAndroidManifest } = require('expo/config-plugins');

const withCleartext = (config) => {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (application) {
      application.$ = {
        ...(application.$ ?? {}),
        'android:usesCleartextTraffic': 'true',
      };
    }
    return config;
  });
};

module.exports = withCleartext;
