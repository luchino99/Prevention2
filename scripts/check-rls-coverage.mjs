#!/usr/bin/env node
/**
 * check-rls-coverage.mjs
 * ----------------------------------------------------------------------------
 * Anti-recidiva regression gate for RLS coverage on PHI tables.
 *
 * Sprint 2 / Task 2.1 — Sprint 2 audit confirmed every PHI table has
 * `RLS ENABLE` (migrations 002 / 003 / 005 / 007) plus
 * `FORCE ROW LEVEL SECURITY` (migration 012). This script asserts that
 * state continues to hold against a live database.
 *
 * Why this exists
 * ---------------
 * Migration 012 lists the canonical 20 PHI tables in a `phi_tables[]`
 * array. A future migration that adds a new PHI table without
 * extending that array would create a coverage hole — the new table
 * would be RLS-protected but NOT FORCE-protected, opening a
 * defence-in-depth gap that no static check would catch. This script
 * lifts the canonical list to a constant in JavaScript, queries
 * pg_class for the actual on-disk state, and fails the build if any
 * PHI table is missing FORCE.
 *
 * It also catches:
 *   * Accidental `ALTER TABLE … DISABLE ROW LEVEL SECURITY` in a
 *     future migration
 *   * `ALTER TABLE … NO FORCE ROW LEVEL SECURITY`
 *   * A new PHI table created without ever appearing in 002 / 012
 *     (won't be in PHI_TABLES here either — operator must add it
 *     manually, which is the intended forcing function)
 *
 * Configuration
 * -------------
 *   DATABASE_URL — Postgres connection string. Same env var as
 *                  run-rls-tests.mjs. If unset, the gate skips
 *                  gracefully (Vercel build has no DB attached).
 *
 * Skip behaviour
 * --------------
 *   No DATABASE_URL set      → exit 0 with SKIP notice
 *   `psql` not on PATH       → exit 0 with SKIP notice
 *
 * Failure behaviour
 * -----------------
 *   exit 0  → all 20 PHI tables: rls_enabled=t AND force_enabled=t
 *   exit 2  → at least one PHI table is missing or has wrong state
 *
 * Wired into
 * ----------
 *   `npm run check:rls-coverage`
 *   `npm run build:check`
 * ----------------------------------------------------------------------------
 */

import { spawnSync } from 'node:child_process';

// Mirrors the canonical phi_tables[] in supabase/migrations/012_force_row_level_security.sql.
// Keep these two lists synchronised — when a new PHI table is added, the
// migration must be extended AND this constant must be extended in the same PR.
const PHI_TABLES = [
  // Tenant + identity
  'tenants',
  'users',
  'professionals',
  // Patient + clinical context
  'patients',
  'patient_clinical_profiles',
  // Per-assessment data
  'assessments',
  'assessment_measurements',
  'score_results',
  'risk_profiles',
  'nutrition_snapshots',
  'activity_snapshots',
  // Care planning + alerts
  'followup_plans',
  'alerts',
  // Consent + audit
  'consent_records',
  'audit_events',
  // Reports + notifications
  'report_exports',
  'notification_jobs',
  // Added by later migrations
  'professional_patient_links',  // migration 005
  'due_items',                   // migration 007
  'data_subject_requests',       // migration 003
];

function info(msg) { console.log(`[check-rls-coverage] ${msg}`); }
function ok(msg)   { console.log(`[check-rls-coverage] OK   ${msg}`); }
function fail(msg) { console.error(`[check-rls-coverage] FAIL ${msg}`); }
function skip(msg) {
  console.log(`[check-rls-coverage] SKIP ${msg}`);
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  skip(
    'DATABASE_URL not set — RLS coverage check skipped. Set DATABASE_URL to ' +
    'a service-role Postgres connection (e.g. Supabase staging) to run.',
  );
}

// Verify psql is reachable.
const which = spawnSync('psql', ['--version'], { encoding: 'utf8' });
if (which.status !== 0) {
  skip(
    `'psql' not found on PATH (install postgresql-client). ` +
    `Skipping — set up psql to run RLS coverage check.`,
  );
}

// Build the SQL query. Use string_to_array to avoid SQL injection from
// the JS array contents — although the contents are constants here, the
// pattern keeps the query safe for future maintenance.
const tableListSql = PHI_TABLES.join(',');
const sql = `
SELECT c.relname,
       c.relrowsecurity::text     AS rls_enabled,
       c.relforcerowsecurity::text AS force_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname  = 'public'
  AND c.relkind  = 'r'
  AND c.relname  = ANY (string_to_array('${tableListSql}', ',')::text[])
ORDER BY c.relname;
`;

info(`Querying RLS state for ${PHI_TABLES.length} PHI tables…`);

// -t       tuples only (no header / footer)
// -A       unaligned output (no padding)
// -F '\t'  tab-separated columns
// -c       run inline SQL
const r = spawnSync(
  'psql',
  [databaseUrl, '-t', '-A', '-F', '\t', '-c', sql],
  { encoding: 'utf8' },
);

if (r.status !== 0) {
  fail(`psql exited ${r.status}. stderr:\n${r.stderr || '(empty)'}`);
  process.exit(2);
}

// Parse output: each non-empty line is `relname\trls_enabled\tforce_enabled`.
const observed = new Map();
for (const line of (r.stdout || '').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  const parts = trimmed.split('\t');
  if (parts.length !== 3) {
    fail(`Unexpected psql output line: "${trimmed}"`);
    process.exit(2);
  }
  const [name, rls, force] = parts;
  observed.set(name, { rls: rls === 't', force: force === 't' });
}

// Verify each canonical PHI table is present, RLS-enabled, and FORCE-enabled.
const issues = [];
for (const t of PHI_TABLES) {
  const state = observed.get(t);
  if (!state) {
    issues.push(`MISSING — public.${t} not found in pg_class (table does not exist on this DB)`);
    continue;
  }
  if (!state.rls) {
    issues.push(`RLS DISABLED — public.${t} has relrowsecurity=false (run migration 002 family)`);
  }
  if (!state.force) {
    issues.push(`FORCE MISSING — public.${t} has relforcerowsecurity=false (run migration 012)`);
  }
}

if (issues.length > 0) {
  fail(`${issues.length} PHI table(s) failed coverage check:`);
  for (const i of issues) console.error(`  ✖ ${i}`);
  console.error('');
  console.error('Fix path:');
  console.error('  1. Verify the affected table is intended to be PHI.');
  console.error('  2. If yes, ensure 002_rls_policies.sql (ENABLE) and 012_force_row_level_security.sql (FORCE) cover it.');
  console.error('  3. Re-apply migrations on the target database.');
  console.error('  4. If a new PHI table was added recently, ALSO update PHI_TABLES in this script.');
  process.exit(2);
}

ok(`${PHI_TABLES.length}/${PHI_TABLES.length} PHI tables: RLS ENABLED + FORCE ENABLED`);
process.exit(0);
