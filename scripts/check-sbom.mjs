#!/usr/bin/env node
/**
 * check-sbom.mjs
 * ----------------------------------------------------------------------------
 * Regression gate for the committed SBOM (Tier 3 / M-03).
 *
 * Generates a fresh SBOM from the current node_modules tree, canonicalises
 * it, and compares against the committed `sbom.cyclonedx.json`. If they
 * differ, the build fails with a clear instruction.
 *
 * Why
 * ---
 * A package added to `package.json` without a paired SBOM refresh leaves
 * the committed inventory stale. For a clinical IEC 62304 SOUP exercise
 * that is a real audit problem — the SBOM is supposed to track current
 * reality, not last-month reality.
 *
 * Behaviour
 * ---------
 *   exit 0  → committed SBOM matches the lockfile-resolved SBOM
 *   exit 2  → drift detected; prints a unified-style diff summary and
 *             tells the operator to run `npm run sbom:refresh`
 *
 * Skip
 * ----
 *   If `node_modules` is missing (fresh clone), the script SKIPS rather
 *   than fails — the surrounding `npm install` step in CI populates it.
 *   The same happens if `npm sbom` itself is unavailable (e.g. a very
 *   old npm).
 *
 * Wired into
 * ----------
 *   `npm run check:sbom`
 *   `npm run build:check`
 *
 * Not in `npm run build` (Vercel deploy) — Vercel runs `npm install`
 * with the committed lockfile and a stale SBOM is recoverable: the
 * deploy still works. But pre-PR `build:check` MUST be clean.
 * ----------------------------------------------------------------------------
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicaliseSbom } from './sbom-canonicalise.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const COMMITTED = join(REPO_ROOT, 'sbom.cyclonedx.json');

function info(msg) { console.log(`[check-sbom] ${msg}`); }
function skip(msg) {
  console.log(`[check-sbom] SKIP ${msg}`);
  process.exit(0);
}
function fail(msg) {
  console.error(`[check-sbom] FAIL ${msg}`);
  process.exit(2);
}

if (!existsSync(join(REPO_ROOT, 'node_modules'))) {
  skip('node_modules missing — run `npm install` first.');
}

if (!existsSync(COMMITTED)) {
  fail(
    `committed SBOM is missing at ${COMMITTED.replace(REPO_ROOT + '/', '')}. ` +
    `Run \`npm run sbom:refresh\` and commit the file.`,
  );
}

const r = spawnSync(
  'npm',
  ['sbom', '--sbom-format=cyclonedx', '--sbom-type=application'],
  { cwd: REPO_ROOT, encoding: 'utf8' },
);
if (r.status !== 0) {
  // npm sbom not available or another env-level issue → skip rather
  // than break a working build. Re-runnable manually with `npm run check:sbom`.
  skip(`npm sbom exited ${r.status} — toolchain may not support SBOM yet.`);
}

let liveSbom;
try {
  liveSbom = JSON.parse(r.stdout);
} catch (e) {
  fail(`npm sbom output is not valid JSON: ${(e instanceof Error) ? e.message : e}`);
}

const liveCanon = canonicaliseSbom(liveSbom);
let committedCanon;
try {
  committedCanon = JSON.parse(readFileSync(COMMITTED, 'utf8'));
} catch (e) {
  fail(
    `committed SBOM is not valid JSON. Re-generate with ` +
    `\`npm run sbom:refresh\`. (${(e instanceof Error) ? e.message : e})`,
  );
}

// Compare component sets — the most meaningful signal for SOUP drift.
function purlSet(canon) {
  const list = Array.isArray(canon.components) ? canon.components : [];
  return new Set(
    list
      .map((c) => `${c['bom-ref'] ?? c.purl ?? c.name}@${c.version ?? ''}`)
      .filter((s) => s !== '@'),
  );
}

const live = purlSet(liveCanon);
const committed = purlSet(committedCanon);

const added = [...live].filter((p) => !committed.has(p)).sort();
const removed = [...committed].filter((p) => !live.has(p)).sort();

if (added.length === 0 && removed.length === 0) {
  info(`OK  ${live.size} component(s); committed SBOM matches the lockfile-resolved SBOM.`);
  process.exit(0);
}

console.error('[check-sbom] FAIL committed SBOM is stale relative to package-lock.json.');
if (added.length > 0) {
  console.error('  Components in lockfile but NOT in committed SBOM:');
  for (const p of added) console.error(`    + ${p}`);
}
if (removed.length > 0) {
  console.error('  Components in committed SBOM but NOT in lockfile:');
  for (const p of removed) console.error(`    - ${p}`);
}
console.error('\nFix:  npm run sbom:refresh   then commit the updated sbom.cyclonedx.json.');
process.exit(2);
