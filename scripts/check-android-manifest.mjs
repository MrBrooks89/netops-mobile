#!/usr/bin/env node
/**
 * Android release-artifact gate.
 *
 * M8 taught the lesson on iOS and the Android release build repeated it: the
 * thing that ships is the *manifest inside the APK*, and library manifests get
 * merged into it. Two defects were found exactly here — `SYSTEM_ALERT_WINDOW`
 * (contributed by expo-dev-client into every variant, a Play review flag) and
 * `allowBackup=true` (which would upload the app's SQLite data to the user's
 * Google Drive, contradicting the in-app "results stay on this device").
 *
 * So this asserts the artifact rather than `app.json`:
 *   · package id and versionCode match the app config,
 *   · allowBackup is off,
 *   · the dev-only permissions are absent,
 *   · the permissions the tools actually need are present,
 *   · cleartext traffic stays on (ADR-007) — noticed if someone flips it,
 *   · no dev-client component leaked into the release manifest.
 *
 * Usage: node scripts/check-android-manifest.mjs [apk ...]
 *        (default: android/app/build/outputs/apk/release/*.apk)
 *
 * Needs `aapt2` from the Android SDK build-tools, the same tool the Gradle
 * build uses; ANDROID_HOME (or ANDROID_SDK_ROOT) tells it where to look.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const config = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')).expo;
const expectedPackage = config.android?.package;
const expectedVersionCode = config.android?.versionCode;

/** Permission the app must not ship: dev tooling only, and a Play flag. */
const FORBIDDEN_PERMISSIONS = ['android.permission.SYSTEM_ALERT_WINDOW'];

/** Permissions the tools genuinely need (plan §9). */
const REQUIRED_PERMISSIONS = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.ACCESS_WIFI_STATE',
  'android.permission.CHANGE_WIFI_MULTICAST_STATE',
  'android.permission.ACCESS_FINE_LOCATION',
];

function findAapt2() {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  const candidates = [];
  if (sdk) {
    const buildTools = join(sdk, 'build-tools');
    if (existsSync(buildTools)) {
      for (const version of readdirSync(buildTools).sort().reverse()) {
        candidates.push(join(buildTools, version, 'aapt2'));
      }
    }
  }
  for (const dir of (process.env.PATH ?? '').split(':')) {
    candidates.push(join(dir, 'aapt2'));
  }
  const found = candidates.find((path) => existsSync(path) && statSync(path).isFile());
  if (!found) {
    console.error(
      'aapt2 not found. Set ANDROID_HOME to the Android SDK (build-tools/<version>/aapt2).',
    );
    process.exit(2);
  }
  return found;
}

function defaultApks() {
  const dir = join(ROOT, 'android/app/build/outputs/apk/release');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.apk'))
    .map((name) => join(dir, name));
}

const aapt2 = findAapt2();
const apks = process.argv.slice(2).length > 0 ? process.argv.slice(2) : defaultApks();
if (apks.length === 0) {
  console.error('No release APK found. Build one first: (cd android && ./gradlew assembleRelease)');
  process.exit(2);
}

const failures = [];
const see = (apk, args) => execFileSync(aapt2, [...args, apk], { encoding: 'utf8' });

for (const apk of apks) {
  const label = apk.replace(`${ROOT}/`, '');
  const manifest = see(apk, ['dump', 'xmltree', '--file', 'AndroidManifest.xml']);
  const badging = see(apk, ['dump', 'badging']);
  // aapt2 prints `package: name='…' versionCode='…'`, and one
  // `uses-permission: name='…'` line per permission.
  const permissions = [...badging.matchAll(/uses-permission: name='([^']+)'/g)].map(
    (match) => match[1],
  );

  const pkg = /package: name='([^']+)'/.exec(badging)?.[1];
  if (pkg !== expectedPackage) {
    failures.push(`${label}: package is ${pkg}, expected ${expectedPackage}`);
  }

  const versionCode = /versionCode='(\d+)'/.exec(badging)?.[1];
  if (expectedVersionCode !== undefined && Number(versionCode) !== expectedVersionCode) {
    failures.push(`${label}: versionCode is ${versionCode}, expected ${expectedVersionCode}`);
  }

  if (!/allowBackup(?:\(0x[0-9a-f]+\))?=false/.test(manifest)) {
    failures.push(
      `${label}: allowBackup is not false — the app's SQLite data would be uploaded to Google Drive`,
    );
  }

  for (const permission of FORBIDDEN_PERMISSIONS) {
    if (permissions.includes(permission)) {
      failures.push(`${label}: ships ${permission} (dev tooling only, Play review flag)`);
    }
  }

  for (const permission of REQUIRED_PERMISSIONS) {
    if (!permissions.includes(permission)) {
      failures.push(`${label}: missing ${permission}, which a tool needs`);
    }
  }

  if (!/usesCleartextTraffic(?:\(0x[0-9a-f]+\))?=true/.test(manifest)) {
    failures.push(
      `${label}: usesCleartextTraffic is not true — the HTTP diagnostics tool cannot reach http:// targets (ADR-007)`,
    );
  }

  if (/devlauncher|devsupport|devmenu/i.test(manifest)) {
    failures.push(`${label}: a dev-client component is present in the release manifest`);
  }
}

if (failures.length > 0) {
  console.error('Android release manifest checks failed:\n');
  for (const failure of failures) console.error(`  ${failure}`);
  console.error('');
  process.exit(1);
}

console.log(
  `Android release manifest verified in ${apks.length} APK(s): ${expectedPackage} v${expectedVersionCode}, no dev permissions, backup off, required permissions present.`,
);
