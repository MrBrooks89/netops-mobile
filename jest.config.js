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
  transformIgnorePatterns: [
    'node_modules/(?!(.pnpm|(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg))',
  ],
  collectCoverageFrom: ['src/core/**/*.ts', '!src/core/**/*.test.ts'],
  coverageThreshold: {
    './src/core/ip/cidr.ts': { lines: 95 },
    './src/core/subnet/': { lines: 95 },
    './src/core/vlsm/': { lines: 95 },
    './src/core/ports/': { lines: 95 },
  },
};
