#!/usr/bin/env node
/**
 * check-sbom-lockfile-parity.mjs
 * ----------------------------------------------------------------------------
 * Sprint 5 task 5.2 (#53). Lockfile-derived parity gate.
 *
 * Why
 * ---
 * The pre-existing `check-sbom.mjs` runs `npm sbom`, which walks
 * `node_modules` — so its "lockfile-resolved" output depends on which
 * platform's binaries got installed. This new gate is platform-neutral
 * by construction: it parses `package-lock.json` directly and asserts
 * the committed SBOM lists exactly the same set of (name, version) pairs,
 * after stripping the platform-conditional components that are filtered
 * out of the committed SBOM by design.
 *
 * Behaviour
 * ---------
 *   exit 0  → committed SBOM ≡ lockfile-derived inventory (modulo platform filter)
 *   exit 2  → drift detected; prints additions / removals
 *
 * Skip
 * ----
 *   If `package-lock.json` is missing (unlikely — committed to repo),
 *   the script SKIPS rather than fails so a fresh clone before
 *   `npm install` doesn't break the gate.
 *
 * Wired into
 * ----------
 *   `npm run check:sbom-lockfile-parity`
 *   `npm run build:check`
 *
 * Companion to `check-sbom.mjs`. Both gates pass under normal conditions;
 * each catches a different drift class:
 *   - check-sbom              : node_modules drifted from committed SBOM
 *   - check-sbom-lockfile-parity : lockfile drifted from committed SBOM
 *
 * The latter is what an auditor cares about: the lockfile is the source
 * of truth for what `npm ci` will install in production.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSbomFromLockfile } from './sbom-from-lockfile.mjs';
import { isPlatformConditionalComponent } from './sbom-canonicalise.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const TAG = '[check-sbom-lockfile-parity]';

const lockPath = join(REPO_ROOT, 'package-lock.json');
const pkgPath = join(REPO_ROOT, 'package.json');
const committedPath = join(REPO_ROOT, 'sbom.cyclonedx.json');

if (!existsSync(lockPath)) {
  console.log(`${TAG} SKIP package-lock.json is missing`);
  process.exit(0);
}
if (!existsSync(pkgPath)) {
  console.log(`${TAG} SKIP package.json is missing`);
  process.exit(0);
}
if (!existsSync(committedPath)) {
  console.error(`${TAG} FAIL sbom.cyclonedx.json is missing — run \`npm run sbom:refresh\``);
  process.exit(2);
}

const lockJson = JSON.parse(readFileSync(lockPath, 'utf8'));
const pkgJson = JSON.parse(readFileSync(pkgPath, 'utf8'));
const committed = JSON.parse(readFileSync(committedPath, 'utf8'));

const fromLock = buildSbomFromLockfile(lockJson, pkgJson);

/**
 * Build a Set of "name@version" identifiers, ignoring platform-conditional
 * components. The committed SBOM excludes them by canonicaliser design;
 * the lockfile-derived one includes them because the lockfile lists every
 * `optionalDependencies`/native-binary variant. Symmetric filtering keeps
 * the comparison fair.
 *
 * @param {{ components?: Array<Record<string, unknown>> }} sbom
 * @returns {Set<string>}
 */
function inventorySet(sbom) {
  const set = new Set();
  const comps = Array.isArray(sbom.components) ? sbom.components : [];
  for (const c of comps) {
    if (isPlatformConditionalComponent(c)) continue;
    const key = `${c.name}@${c.version}`;
    set.add(key);
  }
  return set;
}

const committedSet = inventorySet(committed);
const lockfileSet = inventorySet(fromLock);

const onlyInCommitted = [...committedSet].filter((k) => !lockfileSet.has(k)).sort();
const onlyInLockfile  = [...lockfileSet].filter((k) => !committedSet.has(k)).sort();

if (onlyInCommitted.length === 0 && onlyInLockfile.length === 0) {
  console.log(
    `${TAG} OK  ${committedSet.size} component(s); committed SBOM ≡ lockfile inventory.`,
  );
  process.exit(0);
}

console.error(`${TAG} FAIL  drift between committed SBOM and lockfile inventory.`);
console.error(`${TAG} (Platform-conditional components excluded from both sides.)`);
if (onlyInCommitted.length > 0) {
  console.error(`${TAG} ${onlyInCommitted.length} in committed but not in lockfile:`);
  for (const k of onlyInCommitted.slice(0, 25)) console.error(`${TAG}   - ${k}`);
  if (onlyInCommitted.length > 25) {
    console.error(`${TAG}   … +${onlyInCommitted.length - 25} more`);
  }
}
if (onlyInLockfile.length > 0) {
  console.error(`${TAG} ${onlyInLockfile.length} in lockfile but not in committed:`);
  for (const k of onlyInLockfile.slice(0, 25)) console.error(`${TAG}   + ${k}`);
  if (onlyInLockfile.length > 25) {
    console.error(`${TAG}   … +${onlyInLockfile.length - 25} more`);
  }
}
console.error(`${TAG} Run \`npm run sbom:refresh\` (then commit) to re-sync.`);
process.exit(2);
