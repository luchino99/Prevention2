#!/usr/bin/env node
/**
 * verify-build.mjs
 * ---------------------------------------------------------------------------
 * Post-build CI gate.
 *
 * Why this exists
 * ---------------
 * Vercel will happily deploy a `frontend-dist/` that contains a 0-byte
 * `index.html` and nothing else, because nothing in the pipeline checks the
 * shape of the output. That has happened in this repo before — a stale empty
 * file silently shipped, leaving end users staring at a blank page.
 *
 * This script is the smallest possible structural assertion that ensures the
 * build actually emitted what we expect.  It runs as part of `npm run build`
 * (production) and exits non-zero on any inconsistency so Vercel aborts the
 * deploy.
 *
 * Checks (all must pass):
 *   1. `frontend-dist/index.html` exists and is non-empty.
 *   2. `frontend-dist/pages/login.html` exists and is non-empty.
 *   3. `frontend-dist/pages/dashboard.html` exists and is non-empty.
 *   4. The Supabase placeholders have been substituted in login.html.
 *   5. The shipped HTML files do not contain the literal string
 *      "service_role" (defence in depth — the inject script already refuses
 *      to embed a service-role JWT, this is a belt-and-braces check).
 * ---------------------------------------------------------------------------
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const DIST = join(ROOT, 'frontend-dist');

// NOTE: keep this list small and focused on entry-point regressions.
// The canonical patient detail page is `patient-detail.html` (referenced
// from nav-header.js, dashboard.html, patients.html, alerts.html,
// assessment-new.html, assessment-view.html). The previous entry
// `pages/patient.html` was a stale alias from an older rename and never
// existed in `frontend/pages/`, so it failed every production deploy.
//
// `assets/vendor/supabase-js.esm.js` is the build-time-vendored Supabase
// SDK bundle (see scripts/fetch-supabase-sdk.mjs). If it is missing,
// every page silently fails to load the auth client. We make that a
// hard production gate.
const REQUIRED_FILES = [
  'index.html',
  'pages/login.html',
  'pages/dashboard.html',
  'pages/patient-detail.html',
  'pages/assessment-new.html',
  'assets/js/public-config.js',
  'assets/vendor/supabase-js.esm.js',
];

const FORBIDDEN_SUBSTRINGS = [
  'service_role',           // never embed the service-role key
  '__PUBLIC_SUPABASE_URL__',// placeholder must have been substituted
  '__PUBLIC_SUPABASE_ANON_KEY__',
];

const IS_PROD =
  process.env.VERCEL === '1' ||
  process.env.NODE_ENV === 'production' ||
  process.env.VERCEL_ENV === 'production' ||
  process.env.VERCEL_ENV === 'preview';

function fail(msg) {
  console.error(`[verify-build] FAIL ${msg}`);
  if (IS_PROD) process.exit(2);
}

function ok(msg) {
  console.log(`[verify-build] OK   ${msg}`);
}

function info(msg) {
  console.log(`[verify-build] ${msg}`);
}

let failed = false;

if (!existsSync(DIST)) {
  console.error('[verify-build] FAIL frontend-dist/ does not exist — did the build run?');
  process.exit(2);
}

info(`Verifying ${DIST}`);

for (const rel of REQUIRED_FILES) {
  const full = join(DIST, rel);
  if (!existsSync(full)) {
    fail(`required file missing: ${rel}`);
    failed = true;
    continue;
  }
  const st = statSync(full);
  if (!st.isFile()) {
    fail(`required path is not a file: ${rel}`);
    failed = true;
    continue;
  }
  if (st.size === 0) {
    fail(`required file is empty (0 bytes): ${rel}`);
    failed = true;
    continue;
  }
  // Forbidden-substring scan applies to HTML only.
  if (rel.endsWith('.html')) {
    const html = readFileSync(full, 'utf8');
    for (const needle of FORBIDDEN_SUBSTRINGS) {
      if (html.includes(needle)) {
        fail(`${rel} still contains forbidden substring: "${needle}"`);
        failed = true;
      }
    }
  }
  ok(`${rel} (${st.size} bytes)`);
}

if (failed) {
  if (IS_PROD) {
    console.error('[verify-build] One or more checks failed in production. Aborting.');
    process.exit(2);
  } else {
    console.warn('[verify-build] One or more checks failed. Non-production build — continuing.');
  }
}
ok('verify-build complete');
