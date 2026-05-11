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
 * Gate posture (Sprint 7 task 7.2)
 * --------------------------------
 *   The original Sprint 1 design was skip-graceful in every absence
 *   scenario so the build is not blocked on a fresh checkout without
 *   psql installed. That was the right call until staging existed.
 *
 *   Sprint 7 task 7.2 elevates the gate to FAIL-CLOSED in CI when a
 *   staging connection IS configured — so that an RLS policy regression
 *   (e.g. a migration that drops a WITH CHECK clause) cannot land on
 *   main silently. Dev / local checkouts retain the skip-graceful
 *   behaviour for ergonomics.
 *
 * Configuration
 * -------------
 *   DATABASE_URL          Postgres connection string. MUST be a service-role
 *                         / postgres-superuser connection (the tests use
 *                         SET LOCAL ROLE authenticated to switch context for
 *                         the assertions, then RESET ROLE for teardown).
 *
 *   DATABASE_URL_STAGING  Alias for DATABASE_URL specifically intended for
 *                         CI. If both are set DATABASE_URL_STAGING takes
 *                         precedence (matches the GitHub Actions secret
 *                         name documented in docs/35-RLS-STAGING-RUNBOOK.md).
 *
 *   RLS_GATE_REQUIRED     When set to "1" / "true", every SKIP path
 *                         becomes a FAIL. CI sets this automatically
 *                         whenever a DATABASE_URL{_STAGING} is non-empty
 *                         (see `.github/workflows/ci.yml`). Locally you
 *                         can opt in for paranoid testing.
 *
 *   CI                    Set automatically to "true" by GitHub Actions.
 *                         Used to decide skip vs fail behaviour when
 *                         RLS_GATE_REQUIRED is not explicitly set:
 *
 *                            CI=true   + DATABASE_URL set  → FAIL on errors,
 *                                                            SKIP if psql
 *                                                            absent (CI
 *                                                            image controls
 *                                                            its own psql).
 *                            CI=true   + no DATABASE_URL    → SKIP with a
 *                                                            visible WARN
 *                                                            so it doesn't
 *                                                            decay silently.
 *                            CI unset  (local)              → SKIP always.
 *
 * Skip behaviour matrix (post-Sprint 7)
 * -------------------------------------
 *   | scenario                                  | exit | message |
 *   |-------------------------------------------|------|---------|
 *   | local dev, no DB                          |  0   | SKIP    |
 *   | local dev, DB set, psql missing           |  0   | SKIP    |
 *   | local dev, DB set, psql OK                |  pass/fail of suite |
 *   | CI, no DB, RLS_GATE_REQUIRED unset        |  0   | SKIP-WARN |
 *   | CI, DB set, psql OK                       |  pass/fail of suite |
 *   | CI, DB set, psql missing                  |  2   | FAIL — CI must have psql |
 *   | RLS_GATE_REQUIRED=1, any skip path        |  2   | FAIL — explicit override |
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

const TAG = '[run-rls-tests]';
function info(msg) { console.log(`${TAG} ${msg}`); }
function ok(msg)   { console.log(`${TAG} OK   ${msg}`); }
function warn(msg) { console.warn(`${TAG} WARN ${msg}`); }
function fail(msg) { console.error(`${TAG} FAIL ${msg}`); }

/** Coerces an env var to boolean. Empty / undefined / "0" / "false" → false. */
function envFlag(name) {
  const v = (process.env[name] ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

const inCi = envFlag('CI');
const explicitRequired = envFlag('RLS_GATE_REQUIRED');

// Pick DB URL. Prefer DATABASE_URL_STAGING (the documented CI secret
// name) over DATABASE_URL when both are set, so CI can read the
// dedicated staging secret without colliding with whatever a developer
// has exported in their shell.
const databaseUrl =
  (process.env.DATABASE_URL_STAGING ?? '').trim() ||
  (process.env.DATABASE_URL ?? '').trim();

/**
 * Decide what a skip means in this run.
 *
 *   - RLS_GATE_REQUIRED=1 → every skip is FAIL (explicit operator opt-in).
 *   - In CI with DB set → psql / test errors are FAIL; absence of
 *                         the *test artefacts themselves* (tests/rls
 *                         missing) is still FAIL (deployment regression).
 *   - In CI without DB → SKIP with WARN — visible in the build log so
 *                         it doesn't fade into background.
 *   - Local dev → SKIP silently as today.
 */
function emitSkip(reason) {
  if (explicitRequired) {
    fail(`RLS_GATE_REQUIRED=1 but skip path hit: ${reason}`);
    process.exit(2);
  }
  if (inCi && databaseUrl) {
    // In CI with a configured DB, ANY skip is suspicious — we got here
    // because something the CI environment was supposed to provide
    // (psql, the SQL test files themselves) is missing. Fail loud.
    fail(`CI with DATABASE_URL set but skip path hit: ${reason}`);
    process.exit(2);
  }
  if (inCi) {
    // CI but no DB: legal during the rollout window where the user has
    // not yet provisioned staging. Visible WARN so it doesn't decay.
    warn(`SKIP — ${reason}`);
    warn('To enforce the RLS gate in CI, set the DATABASE_URL_STAGING secret in this repo.');
    warn('See docs/35-RLS-STAGING-RUNBOOK.md for the ~30-minute provisioning runbook.');
    process.exit(0);
  }
  // Local dev — quiet skip.
  console.log(`${TAG} SKIP ${reason}`);
  process.exit(0);
}

if (!databaseUrl) {
  emitSkip(
    'no DATABASE_URL / DATABASE_URL_STAGING configured. Set either to a ' +
    'service-role Postgres connection (e.g. Supabase staging) to run.',
  );
}

// Verify psql is reachable.
const which = spawnSync('psql', ['--version'], { encoding: 'utf8' });
if (which.status !== 0) {
  emitSkip(
    `'psql' not found on PATH (install postgresql-client). ` +
    `Skipping — set up psql to run RLS tests.`,
  );
}

if (!existsSync(TESTS_DIR)) {
  // This is structural — tests/rls is expected to exist in the repo.
  // No skip path here, regardless of env.
  fail(`tests directory missing: ${TESTS_DIR}`);
  process.exit(2);
}

const sqlFiles = readdirSync(TESTS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => join(TESTS_DIR, f))
  .filter((p) => statSync(p).isFile())
  .sort();

if (sqlFiles.length === 0) {
  // Same rationale — if the .sql files are missing in CI with DB set,
  // someone deleted the security spec.
  if (inCi && databaseUrl) {
    fail('No .sql files in tests/rls/ — RLS spec deleted?');
    process.exit(2);
  }
  info('No .sql files in tests/rls/ — nothing to run.');
  process.exit(0);
}

info(`Running ${sqlFiles.length} RLS test file(s) against staging DB`);
if (inCi) {
  info('Mode: CI fail-closed (errors will fail the build).');
} else if (explicitRequired) {
  info('Mode: RLS_GATE_REQUIRED=1 fail-closed override.');
} else {
  info('Mode: local dev (errors will surface but skip paths are graceful).');
}

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
