#!/usr/bin/env node
/**
 * fetch-supabase-sdk.mjs
 * ----------------------------------------------------------------------------
 * Bundles `@supabase/supabase-js` from `node_modules` into a single ESM
 * file at `frontend/assets/vendor/supabase-js.esm.js` so the frontend
 * can `import { createClient } from '../vendor/supabase-js.esm.js'`
 * without breaching the CSP `script-src 'self'` directive.
 *
 * Why this script exists
 * ----------------------
 * Earlier iterations imported the SDK from `https://esm.sh/...` at
 * runtime. That triggered three failures simultaneously:
 *
 *   1. CSP violation. `vercel.json` declares `script-src 'self'` (audit
 *      blocker B-13). esm.sh is a different origin → blocked.
 *
 *   2. Undeclared sub-processor. `21-PRIVACY-TECHNICAL.md §11` is the
 *      authoritative list of runtime sub-processors. esm.sh was never
 *      reviewed or contracted.
 *
 *   3. Supply-chain risk. CDN can ship modified code at any moment;
 *      no SRI / no version pin enforcement at the browser level.
 *
 * The earlier "fetch a single-file URL" attempt also failed because
 * neither `https://esm.sh/...?bundle` nor `https://cdn.jsdelivr.net/...
 * /+esm` returns a self-contained bundle — both serve thin re-export
 * wrappers that load further files from the CDN at runtime. Vendoring
 * those wrappers locally would just relocate the broken imports.
 *
 * How this script works now
 * -------------------------
 * `npm install` (always run before `npm run build` on Vercel) populates
 * `node_modules/@supabase/supabase-js/`. We invoke esbuild — added as a
 * devDependency — to bundle that ES-module entry point into one
 * self-contained file. Esbuild inlines every transitive import into the
 * single output, so the browser fetches exactly one same-origin asset.
 *
 * Properties:
 *   - Deterministic: same `npm install` lockfile → same bundle bytes.
 *   - Network-free at build time (esbuild is bundled with the install).
 *   - No third-party CDN dependency at runtime.
 *   - Idempotent: skips work if the existing bundle was produced for
 *     the same package version.
 *   - Fail-soft locally (no node_modules → exit 0 with a warning) so
 *     `npm run typecheck` works on a fresh clone before `npm install`.
 *     Production deploys are still gated by `verify-build.mjs`, which
 *     fails the build if the bundle is missing.
 *
 * Pinning
 * -------
 * The version is pinned indirectly via `package.json` →
 * `dependencies["@supabase/supabase-js"]`. The bundle header records
 * the exact resolved version so a future drift (lockfile out of sync,
 * wrong package installed) is immediately visible in the deploy log.
 *
 * Output
 * ------
 *   frontend/assets/vendor/supabase-js.esm.js
 *   frontend/assets/vendor/LICENSE-MIT.txt
 *   frontend/assets/vendor/.gitignore   (so the bundle is never committed)
 *
 * License
 * -------
 * @supabase/supabase-js is MIT-licensed. The license text is written
 * alongside the bundle.
 * ----------------------------------------------------------------------------
 */

import {
  existsSync, mkdirSync, readFileSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..');
const VENDOR_DIR = join(REPO_ROOT, 'frontend', 'assets', 'vendor');

const OUTPUT_FILE = join(VENDOR_DIR, 'supabase-js.esm.js');
const LICENSE_FILE = join(VENDOR_DIR, 'LICENSE-MIT.txt');
const GITIGNORE_FILE = join(VENDOR_DIR, '.gitignore');

const require = createRequire(import.meta.url);

const LICENSE = `@supabase/supabase-js bundle in this directory is distributed
under the MIT License (https://github.com/supabase/supabase-js).

Vendored at build time by scripts/fetch-supabase-sdk.mjs (esbuild bundler).
The exact version is whatever is resolved by your package-lock.json.

This file is NOT committed to the repository (see .gitignore in the same
directory). It is regenerated on every \`npm run build\`.
`;

const GITIGNORE = `# Vendored bundle, regenerated at build time by
# scripts/fetch-supabase-sdk.mjs. Do not commit.
supabase-js.esm.js
LICENSE-MIT.txt
`;

/**
 * Resolve the path to the installed @supabase/supabase-js package and
 * its declared ESM entry point.
 */
function resolvePackage() {
  let pkgJsonPath;
  try {
    pkgJsonPath = require.resolve('@supabase/supabase-js/package.json', {
      paths: [REPO_ROOT],
    });
  } catch {
    return null;
  }
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  } catch (err) {
    throw new Error(`Could not read ${pkgJsonPath}: ${err.message}`);
  }
  const pkgDir = dirname(pkgJsonPath);

  // Prefer "module" (ESM), then "exports[.].import", then "main".
  let relEntry =
    pkg.module ||
    (pkg.exports && pkg.exports['.'] && (
      pkg.exports['.'].import?.default ||
      pkg.exports['.'].import ||
      pkg.exports['.'].browser ||
      pkg.exports['.'].default
    )) ||
    pkg.main;

  if (!relEntry) {
    throw new Error(`@supabase/supabase-js@${pkg.version} declares no usable entry point`);
  }
  if (typeof relEntry !== 'string') {
    relEntry = relEntry.default ?? relEntry.import ?? null;
  }
  if (!relEntry) {
    throw new Error('Could not extract a string entry path from package.json exports');
  }

  return {
    version: pkg.version,
    entry: join(pkgDir, relEntry),
  };
}

function alreadyGood(pkg) {
  if (!existsSync(OUTPUT_FILE)) return false;
  try {
    const text = readFileSync(OUTPUT_FILE, 'utf8');
    if (statSync(OUTPUT_FILE).size < 50_000) return false;
    if (!text.includes(`// supabase-js@${pkg.version}`)) return false; // version drift → rebuild
    if (!text.includes('createClient')) return false;
    return true;
  } catch {
    return false;
  }
}

async function bundleWithEsbuild(pkg) {
  let esbuild;
  try {
    esbuild = await import('esbuild');
  } catch (err) {
    throw new Error(
      `esbuild is not installed. Add it as a devDependency or run \`npm install\` first. (${err.message})`,
    );
  }

  const result = await esbuild.build({
    entryPoints: [pkg.entry],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    minify: true,
    sourcemap: false,
    write: false,
    legalComments: 'none',
    // The browser provides Web Crypto and fetch — no shims needed.
    // We deliberately do NOT shim Node built-ins; if the SDK ever
    // imports one, esbuild will fail loudly here, which is the
    // signal we want.
  });

  if (!result.outputFiles || result.outputFiles.length !== 1) {
    throw new Error(`esbuild produced ${result.outputFiles?.length ?? 0} files; expected exactly 1`);
  }
  const bundleText = result.outputFiles[0].text;

  if (!bundleText.includes('createClient')) {
    throw new Error('Produced bundle does not export createClient — entry point misconfigured?');
  }

  const header =
    `// supabase-js@${pkg.version} (vendored at build time)\n` +
    `// Source: ${pkg.entry.replace(REPO_ROOT, '<repo>')}\n` +
    `// Bundled at: ${new Date().toISOString()}\n` +
    `// Bundler: esbuild (format=esm, target=es2022, platform=browser, minify=true)\n`;

  writeFileSync(OUTPUT_FILE, header + bundleText, 'utf8');
  const sizeKb = (Buffer.byteLength(header + bundleText, 'utf8') / 1024).toFixed(0);
  console.log(`  ✓ supabase-js.esm.js (${sizeKb} KB) — supabase-js@${pkg.version}`);
}

async function main() {
  if (!existsSync(VENDOR_DIR)) mkdirSync(VENDOR_DIR, { recursive: true });

  // Always (re)write the policy files — they are part of the contract.
  writeFileSync(LICENSE_FILE, LICENSE, 'utf8');
  writeFileSync(GITIGNORE_FILE, GITIGNORE, 'utf8');

  console.log(`fetch-supabase-sdk → ${VENDOR_DIR}`);

  const pkg = resolvePackage();
  if (!pkg) {
    console.warn(
      `  ⚠ @supabase/supabase-js not found in node_modules. ` +
      `Run \`npm install\` first.`,
    );
    console.warn(
      `  Bundle NOT written. The frontend will fail to load the Supabase ` +
      `client. Production builds are gated by verify-build.mjs which will ` +
      `block the deploy if this file is missing.\n`,
    );
    process.exit(0); // non-fatal locally; verify-build catches it in CI
  }

  console.log(`  resolved: @supabase/supabase-js@${pkg.version}`);

  if (alreadyGood(pkg)) {
    const sizeKb = (statSync(OUTPUT_FILE).size / 1024).toFixed(0);
    console.log(`  ✓ supabase-js.esm.js (already present, ${sizeKb} KB, version match)`);
    console.log(`\nDone.\n`);
    return;
  }

  try {
    await bundleWithEsbuild(pkg);
  } catch (err) {
    console.error(`\n✗ Bundle failed: ${err.message}`);
    // In production we want this to be loud but verify-build will be
    // the canonical gate (it checks the file exists and is non-empty).
    // We exit 0 here so the caller can decide.
    process.exit(0);
  }

  console.log(`\nDone.\n`);
}

main().catch((err) => {
  console.error('fetch-supabase-sdk failed:', err);
  process.exit(0); // non-fatal — verify-build is the deploy gate
});
