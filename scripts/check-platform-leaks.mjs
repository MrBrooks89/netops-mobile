#!/usr/bin/env node
/**
 * CI gate: `Platform.OS` (and `Platform.select`) must not appear outside
 * `src/platform/**` (plan §3.3, M8 acceptance).
 *
 * Availability is data, not an operating-system check: features ask
 * `getCapabilities()` and render a degraded state, which is what keeps one
 * codebase honest across Android, iOS and the deferred remote-probe backend.
 * A stray `Platform.OS` in a screen silently forks the app instead.
 *
 * Written in Node rather than grep so it behaves identically on the ubuntu and
 * macOS runners and can be run locally as `pnpm check:platform`.
 *
 * Usage: node scripts/check-platform-leaks.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCAN_DIRS = ['src', 'app'];
/** The capability seam is the one place allowed to know the platform. */
const ALLOWED_PREFIX = join('src', 'platform');
const SOURCE = /\.(ts|tsx)$/;
const SKIP_DIRS = new Set(['node_modules', '.git', 'android', 'ios', 'build', '__mocks__']);
const PATTERN = /\bPlatform\s*\.\s*(OS|select|Version|constants)\b/;

/** Every .ts/.tsx file under the scan directories. */
function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) yield* sourceFiles(full);
      continue;
    }
    if (SOURCE.test(entry)) yield full;
  }
}

const leaks = [];
for (const dir of SCAN_DIRS) {
  for (const file of sourceFiles(join(ROOT, dir))) {
    const rel = relative(ROOT, file);
    if (rel.startsWith(ALLOWED_PREFIX + sep)) continue;
    // Test files may assert platform behaviour through the seam; production
    // code may not branch on it at all.
    const text = readFileSync(file, 'utf8');
    text.split('\n').forEach((line, index) => {
      if (PATTERN.test(line)) leaks.push(`${rel}:${index + 1}: ${line.trim()}`);
    });
  }
}

if (leaks.length > 0) {
  console.error('Platform checks found outside src/platform/**:\n');
  for (const leak of leaks) console.error(`  ${leak}`);
  console.error(
    '\nAsk getCapabilities() for the capability instead, and render a degraded state when it is null (plan §3.3, §6.4).',
  );
  process.exit(1);
}

console.log('No Platform.OS usage outside src/platform/** — availability stays data.');
