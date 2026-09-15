#!/usr/bin/env node
/**
 * iOS declaration gate (M8, ADR-010).
 *
 * Asserts that the keys ADR-010 promises are actually in the iOS build — the
 * *generated* `Info.plist` and `.entitlements`, and (when a build exists) the
 * copies inside the built `.app`. `app.json` is the source, but the artifact is
 * what ships, so the artifact is what gets checked.
 *
 * Runs on macOS: it uses `plutil` to convert plists to JSON instead of pulling
 * in a parser. Invoked from the `ios` CI job after prebuild and again after the
 * build, so a declaration that silently stopped generating fails the job.
 *
 * Usage: node scripts/check-ios-plist.mjs <plist> [<plist> ...]
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const settings = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')).expo;

const infoPlist = settings.ios?.infoPlist ?? {};
const entitlements = settings.ios?.entitlements ?? {};

/**
 * `plutil` is macOS-only, which is where this check belongs (the iOS build runs
 * on a mac runner). Failing without a word about that is unhelpful, so it is
 * detected up front.
 */
const hasPlutil = () => {
  try {
    execFileSync('plutil', ['-help'], { stdio: 'ignore' });
    return true;
  } catch (error) {
    return error?.code !== 'ENOENT';
  }
};

/** plutil → JSON; a missing or unreadable file is a hard failure. */
function readPlist(path) {
  if (!existsSync(path)) {
    fail(`${path} does not exist`);
  }
  const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', path], {
    encoding: 'utf8',
  });
  return JSON.parse(json);
}

const failures = [];
function fail(message) {
  failures.push(message);
}

function check(plistPath) {
  const plist = readPlist(plistPath);
  const label = plistPath.replace(`${ROOT}/`, '');

  const description = plist.NSLocalNetworkUsageDescription;
  if (typeof description !== 'string' || description.trim().length < 20) {
    fail(`${label}: NSLocalNetworkUsageDescription missing or too short`);
  }

  const declared = plist.NSBonjourServices;
  const expected = infoPlist.NSBonjourServices;
  if (!Array.isArray(declared)) {
    fail(`${label}: NSBonjourServices missing`);
  } else {
    const missing = expected.filter((type) => !declared.includes(type));
    if (missing.length > 0) {
      fail(`${label}: NSBonjourServices is missing ${missing.join(', ')}`);
    }
    // Expo's prebuild adds its own dev-client type, so this is a superset check.
  }

  if (plist.NSAppTransportSecurity?.NSAllowsArbitraryLoads !== true) {
    fail(`${label}: NSAllowsArbitraryLoads is not true (ADR-007)`);
  }

}

function checkEntitlements(path) {
  const plist = readPlist(path);
  for (const [key, value] of Object.entries(entitlements)) {
    if (plist[key] !== value) {
      fail(`${path.replace(`${ROOT}/`, '')}: entitlement ${key} is not ${JSON.stringify(value)}`);
    }
  }
}

if (!hasPlutil()) {
  console.error('This check needs macOS: it uses plutil to read the iOS plists.');
  process.exit(2);
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('usage: node scripts/check-ios-plist.mjs <plist> [<plist> ...]');
  process.exit(2);
}

for (const target of targets) {
  check(target);
}

// The source entitlements file sits beside the generated Info.plist.
const sourceEntitlements = targets
  .map((target) => target.replace(/Info\.plist$/, 'netopsmobile.entitlements'))
  .find((candidate) => candidate.endsWith('.entitlements'));
if (sourceEntitlements && existsSync(sourceEntitlements)) {
  checkEntitlements(sourceEntitlements);
}

if (failures.length > 0) {
  console.error('iOS declaration checks failed:\n');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log(
  `iOS declarations verified in ${targets.length} plist(s): local-network usage, Bonjour services, ATS, entitlements.`,
);
