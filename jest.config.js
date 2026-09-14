/**
 * Jest config — jest-expo preset (SDK 57) with the pnpm-specific
 * transformIgnorePatterns from the Expo unit-testing docs.
 *
 * Coverage thresholds enforce the M1 acceptance criterion "core test coverage
 * ≥ 95% lines on new modules". They only apply when --coverage is passed
 * (CI runs `pnpm test:coverage`).
 */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  // pnpm puts packages one level deeper, and expo-router pulls in several
  // ESM-only packages; anything not matching this lookahead is left untransformed
  // and Jest then fails on its `import` statements.
  transformIgnorePatterns: [
    'node_modules/(?!(.pnpm|(jest-)?react-native|@react-native(-community)?|expo(nent)?|expo-.*|@expo(nent)?/.*|@expo-google-fonts/.*|expo-router|standard-navigation|react-navigation|@react-navigation/.*|react-native-screens|react-native-safe-area-context|react-native-is-edge-to-edge|use-latest-callback|nanoid|@sentry/react-native|native-base|react-native-svg))',
  ],
  collectCoverageFrom: [
    'src/core/**/*.ts',
    '!src/core/**/*.test.ts',
    // Data-layer modules with real logic. The native edges (db/driver.ts,
    // export/share.ts, settings/kvStore.ts) are excluded: they cannot run under
    // Jest and are verified on a device instead.
    'src/data/db/migrations.ts',
    'src/data/db/migrate.ts',
    'src/data/repositories/*.ts',
    'src/data/settings/appSettings.ts',
    'src/data/settings/store.ts',
    'src/data/export/codecs.ts',
    '!src/**/*.test.ts',
  ],
  coverageThreshold: {
    './src/core/ip/cidr.ts': { lines: 95 },
    './src/core/subnet/': { lines: 95 },
    './src/core/vlsm/': { lines: 95 },
    './src/core/ports/': { lines: 95 },
    './src/core/validation/': { lines: 95 },
    './src/core/util/': { lines: 95 },
    './src/core/model/ping.ts': { lines: 95 },
    './src/core/model/wifi.ts': { lines: 95 },
    './src/data/db/': { lines: 95 },
    './src/data/repositories/': { lines: 95 },
    './src/data/settings/': { lines: 95 },
    './src/data/export/codecs.ts': { lines: 95 },
  },
};
