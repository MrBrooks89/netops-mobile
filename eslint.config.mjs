// eslint-config-expo (SDK 57) ships a flat-config entry: eslint-config-expo/flat.js
import expoFlat from 'eslint-config-expo/flat.js';

export default [
  {
    ignores: [
      'dist/',
      'node_modules/',
      '.tools/',
      '.toolcache/',
      '.expo/',
      'android/',
      'ios/',
      'coverage/',
      'docker/',
    ],
  },
  ...expoFlat,
];
