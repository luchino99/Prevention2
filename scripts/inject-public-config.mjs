#!/usr/bin/env node
/**
 * inject-public-config.mjs
 * ---------------------------------------------------------------------------
 * Build-time placeholder substitution for the public Supabase configuration.
 *
 * Why this exists
 * ---------------
 * The frontend HTML pages (login.html, dashboard.html, mfa-enroll.html, ...)
 * initialise `window.__UELFY_CONFIG__` with two placeholders:
 *
 *     supabaseUrl:     '__PUBLIC_SUPABASE_URL__'
 *     supabaseAnonKey: '__PUBLIC_SUPABASE_ANON_KEY__'
 *
 * Those placeholders MUST be replaced at build time with the real values that
 * live in Vercel project env vars. Without this substitution, the browser
 * receives the literal placeholder string as the Supabase URL, and the
 * Supabase SDK throws:
 *
 *     Error: Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL.
 *
 * Design choices
 * --------------
 *   1) Non-destructive: we never mutate sources. The script copies
 *      `frontend/` into `frontend-dist/` (Vercel outputDirectory) and
 *      performs the substitution only on the copy. This prevents the real
 *      keys from ever being committed to git.
 *
 *   2) Single source of truth: reads `SUPABASE_URL` and `SUPABASE_ANON_KEY`,
 *      the same names already used by `backend/src/config/env.ts` and
 *      `api/consent.js`. No duplicate env vars on Vercel.
 *
 *   3) Fail fast in production: if required vars are missing or malformed
 *      when running on Vercel (VERCEL=1) or NODE_ENV=production, the script
 *      exits non-zero so the deploy aborts instead of shipping a broken app.
 *      In local dev the script still warns and copies files (leaving the
 *      placeholders) so `npm run typecheck` remains usable without secrets.
 *
 *   4) Public values only: the anon key + project URL are PUBLIC by design
 *      in Supabase. The service-role key is never read here. A defensive
 *      check rejects any value that looks like a service-role JWT.
 *
 *   5) Idempotent: safe to run multiple times. Rebuilds the dist folder
 *      from scratch every invocation.
 * ---------------------------------------------------------------------------
 */

import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const SOURCE_DIR = join(ROOT, 'frontend');
const OUTPUT_DIR = join(ROOT, 'frontend-dist');

const PLACEHOLDERS = {
  __PUBLIC_SUPABASE_URL__: 'SUPABASE_URL',
  __PUBLIC_SUPABASE_ANON_KEY__: 'SUPABASE_ANON_KEY',
};

const IS_PROD =
  process.env.VERCEL === '1' ||
  process.env.NODE_ENV === 'production' ||
  process.env.VERCEL_ENV === 'production' ||
  process.env.VERCEL_ENV === 'preview';

/* --------------------------- logging helpers --------------------------- */

function info(msg)  { console.log(`[inject-public-config] ${msg}`); }
function warn(msg)  { console.warn(`[inject-public-config] WARN  ${msg}`); }
function error(msg) { console.error(`[inject-public-config] ERROR ${msg}`); }

/* --------------------------- validation -------------------------------- */

function isValidHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function looksLikeJwt(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split('.');
  return parts.length === 3 && parts.every(p => p.length > 0);
}

/**
 * Decode a JWT payload without verifying signature. Returns null on failure.
 * Used purely to detect whether the caller accidentally pasted the
 * service-role key in place of the anon key.
 */
function decodeJwtPayload(jwt) {
  try {
    const [, payload] = jwt.split('.');
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function validateInputs(values) {
  const problems = [];
  const url = values.SUPABASE_URL;
  const anon = values.SUPABASE_ANON_KEY;

  if (!url) {
    problems.push('SUPABASE_URL is missing.');
  } else if (!isValidHttpUrl(url)) {
    problems.push(`SUPABASE_URL is not a valid http(s) URL (received "${url}").`);
  }

  if (!anon) {
    problems.push('SUPABASE_ANON_KEY is missing.');
  } else if (!looksLikeJwt(anon)) {
    problems.push('SUPABASE_ANON_KEY does not look like a JWT (expected three dot-separated segments).');
  } else {
    const payload = decodeJwtPayload(anon);
    if (payload && payload.role && payload.role !== 'anon') {
      problems.push(
        `SUPABASE_ANON_KEY has role="${payload.role}". ` +
        'Refusing to embed a non-anon key in the public bundle. ' +
        'The service-role key must NEVER be exposed to the browser.',
      );
    }
  }

  return problems;
}

/* --------------------------- substitution ------------------------------ */

function walkHtmlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkHtmlFiles(full));
    } else if (st.isFile() && entry.toLowerCase().endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

function injectInto(file, values) {
  const original = readFileSync(file, 'utf8');
  let patched = original;
  let replacements = 0;
  for (const [placeholder, envName] of Object.entries(PLACEHOLDERS)) {
    const value = values[envName];
    if (!value) continue;
    // Match the placeholder exactly (as a string literal, not regex).
    const parts = patched.split(placeholder);
    if (parts.length > 1) {
      replacements += parts.length - 1;
      patched = parts.join(value);
    }
  }
  if (replacements > 0) {
    writeFileSync(file, patched, 'utf8');
  }
  return replacements;
}

/* ------------------------------ main ----------------------------------- */

function main() {
  info(`Source: ${SOURCE_DIR}`);
  info(`Output: ${OUTPUT_DIR}`);
  info(`Mode:   ${IS_PROD ? 'production (fail-fast on missing env)' : 'development (lenient)'}`);

  if (!existsSync(SOURCE_DIR)) {
    error(`Source directory does not exist: ${SOURCE_DIR}`);
    process.exit(1);
  }

  const values = {
    SUPABASE_URL: process.env.SUPABASE_URL?.trim(),
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY?.trim(),
  };

  const problems = validateInputs(values);
  if (problems.length > 0) {
    if (IS_PROD) {
      error('Public configuration is invalid or missing. Aborting build.');
      for (const p of problems) error(`  - ${p}`);
      error('Set SUPABASE_URL and SUPABASE_ANON_KEY in your Vercel project env vars.');
      process.exit(2);
    } else {
      warn('Public configuration is incomplete (non-production build, continuing):');
      for (const p of problems) warn(`  - ${p}`);
      warn('Placeholders will remain in the output. The login page will NOT work until env vars are set.');
    }
  }

  // Fresh output directory
  if (existsSync(OUTPUT_DIR)) {
    rmSync(OUTPUT_DIR, { recursive: true, force: true });
  }
  cpSync(SOURCE_DIR, OUTPUT_DIR, { recursive: true });
  info(`Copied ${SOURCE_DIR} -> ${OUTPUT_DIR}`);

  // Substitute in every HTML file under the output directory
  const htmlFiles = walkHtmlFiles(OUTPUT_DIR);
  let totalReplacements = 0;
  let touchedFiles = 0;
  for (const file of htmlFiles) {
    const n = injectInto(file, values);
    if (n > 0) {
      touchedFiles += 1;
      totalReplacements += n;
      info(`  patched ${n} placeholder(s) in ${file.replace(OUTPUT_DIR, 'frontend-dist')}`);
    }
  }

  info(`Done. ${totalReplacements} substitution(s) across ${touchedFiles} file(s).`);

  if (IS_PROD && totalReplacements === 0) {
    error('Production build produced zero substitutions — placeholders are unchanged. Refusing to deploy a broken bundle.');
    process.exit(3);
  }
}

main();
