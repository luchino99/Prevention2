#!/usr/bin/env node
/**
 * run-rls-tests.mjs
 * ---------------------------------------------------------------------------
 * Runner for the Postgres-side RLS regression tests under
 * `tests/rls/*.sql`. These tests close the gap that the vitest unit
 * suite cannot close: vitest mocks the Supabase client, so RLS is never
 * actually evaluated. Running the assertions through psql against a
 * real Supabase target (staging or local) exercises the policies in
 * the same security context as production.
 *
 * Configuration
 * -------------
 *   DATABASE_URL — Postgres connection string. MUST be a service-role
 *                  / postgres-superuser connection (the test uses
 *                  SET LOCAL ROLE authenticated to switch context for
 *                  the assertions, then RESET ROLE for teardown).
 *
 * Skip behaviour
 * --------------
 *   No DATABASE_URL set        → exit 0 with a SKIP notice. CI Vercel
 *                                 has no DB attached so the build is not
 *                                 blocked. Local dev / staging CI add
 *                                 the env to run for real.
 *
 *   `psql` not on PATH          → exit 0 with a SKIP notice. The test
 *                                 cannot run without the postgres CLI.
 *
 * Failure behaviour
 * -----------------
 *   Any ASSERT inside a .sql test that fails causes psql to exit with
 *   a non-zero status — we propagate that exit code so the surrounding
 *   `npm test:rls` (or future CI step) fails the build.
 *
 * Why a separate script and not vitest
 * ------------------------------------
 *   The .sql files are valuable as standalone artefacts: they can be
 *   pasted into the Supabase SQL editor for ad-hoc debugging, and they
 *   read like a security spec. Wrapping them in TS would obscure that.
 * ---------------------------------------------------------------------------
 */

import { readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const TESTS_DIR = join(REPO_ROOT, 'tests', 'rls');

function info(msg) { console.log(`[run-rls-tests] ${msg}`); }
function ok(msg)   { console.log(`[run-rls-tests] OK   ${msg}`); }
function fail(msg) { console.error(`[run-rls-tests] FAIL ${msg}`); }
function skip(msg) {
  console.log(`[run-rls-tests] SKIP ${msg}`);
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  skip(
    'DATABASE_URL not set — RLS tests skipped. Set DATABASE_URL to a ' +
    'service-role Postgres connection (e.g. Supabase staging) to run.',
  );
}

// Verify psql is reachable.
const which = spawnSync('psql', ['--version'], { encoding: 'utf8' });
if (which.status !== 0) {
  skip(
    `'psql' not found on PATH (install postgresql-client). ` +
    `Skipping — set up psql to run RLS tests.`,
  );
}

if (!existsSync(TESTS_DIR)) {
  fail(`tests directory missing: ${TESTS_DIR}`);
  process.exit(2);
}

const sqlFiles = readdirSync(TESTS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => join(TESTS_DIR, f))
  .filter((p) => statSync(p).isFile())
  .sort();

if (sqlFiles.length === 0) {
  info('No .sql files in tests/rls/ — nothing to run.');
  process.exit(0);
}

info(`Running ${sqlFiles.length} RLS test file(s) against $DATABASE_URL`);

let failed = 0;
for (const f of sqlFiles) {
  const rel = f.replace(REPO_ROOT + '/', '');
  // -v ON_ERROR_STOP=1 makes psql exit non-zero on the FIRST SQL error
  // or RAISE EXCEPTION — exactly what the assertions rely on.
  const r = spawnSync(
    'psql',
    [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', f],
    { stdio: 'inherit' },
  );
  if (r.status === 0) {
    ok(rel);
  } else {
    fail(`${rel} (psql exited ${r.status})`);
    failed += 1;
  }
}

if (failed > 0) {
  fail(`${failed} test file(s) failed`);
  process.exit(2);
}
info('All RLS tests passed.');
