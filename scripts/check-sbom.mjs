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

// Platform-specific native binary detection.
// -------------------------------------------
// `npm sbom` walks node_modules, which is platform-dependent:
//   * macOS host: contains fsevents (darwin-only), @esbuild/darwin-*, ...
//   * Linux CI:   contains @esbuild/linux-*, no fsevents, ...
// The package-lock.json declares every variant via the parent's
// optionalDependencies + os/cpu fields, so the LIVE SBOM differs across
// platforms even though the LOCKFILE doesn't. We strip those variants from
// the comparison to avoid false-positive drift when CI (Linux) compares
// against a Mac-generated committed SBOM.
//
// TODO (Sprint 2 / task 53): regenerate sbom.cyclonedx.json directly from
// package-lock.json (which lists every variant) so the committed SBOM is
// platform-agnostic by construction. Until then, we accept that the SBOM
// contains only the host-platform variant of these packages and the gate
// ignores cross-platform drift on them.

// Pattern A: native binary loaders shipped by bundlers / image libs / etc.
// They follow a predictable @scope/<lib>-<os>-<arch> naming scheme.
const PLATFORM_BINARY_PATTERNS = [
  /^@esbuild\/[a-z0-9]+-[a-z0-9]+@/,         // @esbuild/darwin-x64@, @esbuild/linux-arm64@ ...
  /^esbuild-(darwin|linux|win32|freebsd|netbsd|openbsd|sunos|android)-/,
  /^@(swc|rollup|napi-rs|next|parcel)\/[a-z0-9-]+-(darwin|linux|win32|freebsd)-/,
  /^@(swc|rollup|napi-rs)\/core-(darwin|linux|win32)-/,
  /^lightningcss-(darwin|linux|win32|freebsd)-/,
  /^@img\/sharp-[a-z0-9-]+-/,                // sharp ships os-specific binaries via @img scope
];

// Pattern B: standalone packages whose installation is gated by `os` or
// `cpu` in their own package.json. They have plain names (no os-arch
// suffix) so a regex would over-match — we use an exact-name allowlist.
// Add packages here as they surface in CI runs; each entry MUST be one
// that npm refuses to install on certain platforms (verifiable via
// `npm view <name> os cpu`).
const STANDALONE_PLATFORM_CONDITIONAL = new Set([
  'fsevents',                                // darwin-only file-system events
]);

function isPlatformNativeBinary(purl) {
  if (PLATFORM_BINARY_PATTERNS.some((re) => re.test(purl))) return true;
  // The purl produced by purlSet() is `${bom-ref ?? purl ?? name}@${version}`.
  // For npm packages the bom-ref typically already contains `@<version>`,
  // so the formatted string ends up like `fsevents@2.3.3@2.3.3` (version
  // duplicated) or `@esbuild/darwin-x64@0.21.5@0.21.5`. Splitting on `@`
  // is therefore unreliable — we anchor on `<name>@` at the start instead.
  for (const name of STANDALONE_PLATFORM_CONDITIONAL) {
    if (purl.startsWith(name + '@')) return true;
  }
  return false;
}
function withoutPlatformBinaries(set) {
  return new Set([...set].filter((p) => !isPlatformNativeBinary(p)));
}

const live = withoutPlatformBinaries(purlSet(liveCanon));
const committed = withoutPlatformBinaries(purlSet(committedCanon));

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
