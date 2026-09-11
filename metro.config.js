/**
 * Metro config — excludes the local dev toolchain (.tools/) from the file
 * watcher. The Android SDK/AVDs/JDK live there (see docs/ENVIRONMENT.md);
 * watching them crashes Metro (permission errors on AVD snapshots) and
 * would be pointless anyway.
 */

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Block .tools from resolution-walks AND the incremental file watcher.
// Expo SDK 57's default blockList is a single RegExp — merge via lookahead.
const TOOLS_BLOCK = /(^|\/)\.tools(\/|$)/;

if (config.resolver?.blockList instanceof RegExp) {
  config.resolver.blockList = new RegExp(
    `(${config.resolver.blockList.source})|(${TOOLS_BLOCK.source})`,
  );
} else if (Array.isArray(config.resolver?.blockList)) {
  config.resolver.blockList = [...config.resolver.blockList, TOOLS_BLOCK];
} else {
  config.resolver = { ...config.resolver, blockList: TOOLS_BLOCK };
}

// Keep the watcher's health check away from .tools (it clears prefixes by
// touching files; AVD snapshot dirs are unreadable and crash the check).
config.watcher = {
  ...config.watcher,
  healthCheck: {
    ...config.watcher?.healthCheck,
    filePrefixes: [...(config.watcher?.healthCheck?.filePrefixes ?? []), 'node_modules', '.expo'],
  },
};

module.exports = config;
