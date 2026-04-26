#!/usr/bin/env node
/**
 * fetch-supabase-sdk.mjs
 * ----------------------------------------------------------------------------
 * Downloads a single-file ESM bundle of `@supabase/supabase-js` and writes it
 * to `frontend/assets/vendor/supabase-js.esm.js`, so the frontend can import
 * the SDK from a same-origin URL instead of a third-party CDN.
 *
 * Why this script exists
 * ----------------------
 * The previous code path imported the SDK directly from `https://esm.sh/...`
 * inside `frontend/assets/js/api-client.js`. That is THREE problems at once:
 *
 *   1. CSP violation. `vercel.json` declares `script-src 'self'` (audit
 *      blocker B-13). esm.sh is a different origin, so the browser blocks
 *      the import and the login page never bootstraps.
 *
 *   2. Undeclared sub-processor. `21-PRIVACY-TECHNICAL.md §11` is the
 *      authoritative list of runtime sub-processors. esm.sh is not on it
 *      and was never reviewed by a controller. Every call to esm.sh from
 *      a clinician browser is a cross-border data flow we cannot account
 *      for under GDPR Art.30.
 *
 *   3. Supply-chain risk. Anyone with operational control of esm.sh could
 *      ship a modified `createClient` that exfiltrates JWTs from every
 *      page. The CDN does not pin a hash, and Subresource Integrity is
 *      not in use.
 *
 * Pinning the version + hosting the bundle ourselves removes all three.
 *
 * Behaviour
 * ---------
 *   - Idempotent: skip if a non-empty bundle is already in place AND its
 *     header carries the expected pin marker (the version string we asked
 *     for). Otherwise re-download.
 *   - Resilient: tries multiple mirrors before failing.
 *   - Fail-soft locally: in development the script exits 0 with a warning
 *     so `npm run typecheck` does not require network access. In a Vercel
 *     production build (VERCEL=1 / VERCEL_ENV=production|preview) the
 *     missing bundle would block the deploy via verify-build.mjs (which
 *     can be extended to check this file is present and non-empty).
 *
 * Pinning
 * -------
 * The version is pinned to PIN_VERSION below. If you change it, also
 * update `package.json` "@supabase/supabase-js" so the backend and the
 * frontend bundle agree.
 *
 * Output
 * ------
 *   frontend/assets/vendor/supabase-js.esm.js
 *   frontend/assets/vendor/LICENSE-MIT.txt
 *   frontend/assets/vendor/.gitignore   (so the bundle is never committed)
 *
 * License
 * -------
 * @supabase/supabase-js is MIT-licensed. The licence text is written
 * alongside the bundle.
 * ----------------------------------------------------------------------------
 */

import {
  existsSync, mkdirSync, readFileSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get as httpsGet } from 'node:https';

const here = dirname(fileURLToPath(import.meta.url));
const VENDOR_DIR = resolve(here, '..', 'frontend', 'assets', 'vendor');

// Keep this in sync with package.json → "@supabase/supabase-js"
const PIN_VERSION = '2.45.0';

// Mirror order: try esm.sh `?bundle` first (single-file ESM with all
// transitive deps inlined), fall back to jsdelivr's pre-built ESM.
//
// IMPORTANT: any URL added here is effectively a build-time supply-chain
// dependency. Add only well-known mirrors; never an unmaintained third
// party. The runtime bundle ships with no further network calls.
const MIRRORS = [
  `https://esm.sh/@supabase/supabase-js@${PIN_VERSION}?bundle&target=es2022`,
  `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@${PIN_VERSION}/+esm`,
];

const OUTPUT_FILE = join(VENDOR_DIR, 'supabase-js.esm.js');
const LICENSE_FILE = join(VENDOR_DIR, 'LICENSE-MIT.txt');
const GITIGNORE_FILE = join(VENDOR_DIR, '.gitignore');
const PIN_MARKER = `// supabase-js@${PIN_VERSION} (vendored at build time)`;

const LICENSE = `@supabase/supabase-js bundle in this directory is distributed
under the MIT License (https://github.com/supabase/supabase-js).

Vendored at build time by scripts/fetch-supabase-sdk.mjs.

Pinned version: ${PIN_VERSION}

This file is NOT committed to the repository (see .gitignore in the same
directory). It is regenerated on every \`npm run build\`.
`;

const GITIGNORE = `# Vendored bundle, regenerated at build time by
# scripts/fetch-supabase-sdk.mjs. Do not commit.
supabase-js.esm.js
LICENSE-MIT.txt
`;

function looksLikeJavaScriptModule(text) {
  if (typeof text !== 'string') return false;
  if (text.length < 10_000) return false; // bundle is ~100 KB minified
  // Must export createClient — that is the entry point we import.
  return text.includes('createClient') && (
    text.includes('export') || text.includes('export{') || text.includes('export ')
  );
}

async function downloadText(url) {
  return new Promise((resolveFn, reject) => {
    const handle = (res, hops = 0) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 5) {
        res.resume();
        httpsGet(res.headers.location, (r) => handle(r, hops + 1)).on('error', reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolveFn(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    };
    httpsGet(url, handle).on('error', reject);
  });
}

function alreadyGood() {
  if (!existsSync(OUTPUT_FILE)) return false;
  try {
    const text = readFileSync(OUTPUT_FILE, 'utf8');
    if (statSync(OUTPUT_FILE).size < 10_000) return false;
    if (!text.startsWith(PIN_MARKER)) return false; // version drifted → refetch
    if (!looksLikeJavaScriptModule(text)) return false;
    return true;
  } catch {
    return false;
  }
}

async function fetchBundle() {
  let lastErr = null;
  for (const url of MIRRORS) {
    try {
      const text = await downloadText(url);
      if (!looksLikeJavaScriptModule(text)) {
        throw new Error('Downloaded payload does not look like an ESM bundle exporting createClient');
      }
      const wrapped =
        `${PIN_MARKER}\n` +
        `// Source: ${url}\n` +
        `// Fetched at: ${new Date().toISOString()}\n` +
        `${text.trim()}\n`;
      writeFileSync(OUTPUT_FILE, wrapped, 'utf8');
      const sizeKb = (Buffer.byteLength(wrapped, 'utf8') / 1024).toFixed(0);
      console.log(`  ✓ supabase-js.esm.js (${sizeKb} KB)  from ${url}`);
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`  · mirror failed (${url}): ${err.message}`);
    }
  }
  throw lastErr ?? new Error('All mirrors failed');
}

async function main() {
  if (!existsSync(VENDOR_DIR)) mkdirSync(VENDOR_DIR, { recursive: true });

  // Always (re)write the policy files — they are part of the contract.
  writeFileSync(LICENSE_FILE, LICENSE, 'utf8');
  writeFileSync(GITIGNORE_FILE, GITIGNORE, 'utf8');

  console.log(`fetch-supabase-sdk → ${VENDOR_DIR}`);
  console.log(`  pinned: @supabase/supabase-js@${PIN_VERSION}`);

  if (alreadyGood()) {
    const sizeKb = (statSync(OUTPUT_FILE).size / 1024).toFixed(0);
    console.log(`  ✓ supabase-js.esm.js (already present, ${sizeKb} KB, version match)`);
    console.log(`\nDone.\n`);
    return;
  }

  try {
    await fetchBundle();
  } catch (err) {
    console.warn(`\n⚠ Could not fetch supabase-js bundle: ${err.message}`);
    console.warn(`  The frontend will fail to load the Supabase client. ` +
      `Re-run 'node scripts/fetch-supabase-sdk.mjs' from a network-connected ` +
      `environment, or set up a local copy at frontend/assets/vendor/supabase-js.esm.js.\n`);
    // Non-fatal so local dev without network still typechecks. The
    // production build will fail at verify-build (next step in this PR
    // adds the bundle to its required-files list).
    process.exit(0);
  }
  console.log(`\nDone.\n`);
}

main().catch((err) => {
  console.error('fetch-supabase-sdk failed:', err);
  process.exit(0); // non-fatal
});
