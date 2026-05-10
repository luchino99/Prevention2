#!/usr/bin/env node
/**
 * check-bundle-budget.mjs
 * ----------------------------------------------------------------------------
 * Sprint 5 task 5.4 (closes L-08). Anti-recidiva gate on the size of every
 * static asset shipped to the browser.
 *
 * Why a per-file budget (and not just a total)
 * --------------------------------------------
 * The clinical UI ships a hand-curated set of files — each has a known
 * legitimate ceiling. A single file blowing past its budget is more
 * actionable than a "bundle total grew by 12 KB" alert; the diff points
 * straight at the offending file.
 *
 * Budgets express the AS-OF Sprint 5 baseline plus a small headroom
 * (~30 % over the current size). They are not micro-optimisation
 * targets; they exist so an accidental dependency import or a stray
 * 200 KB SVG fails CI before review.
 *
 * Behaviour
 * ---------
 *   exit 0  → every tracked file is at or below its budget
 *   exit 2  → at least one file exceeds its budget
 *
 * Wired into
 * ----------
 *   `npm run check:bundle-budget`
 *   `npm run build:check`
 *
 * Updating budgets
 * ----------------
 * When a feature legitimately grows a file past its budget, bump the
 * limit in this script and explain why in the PR body. The point is to
 * make growth a CONSCIOUS choice, not silent drift.
 */

import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

/**
 * Per-file budgets, in BYTES. Enforced as `actual <= budget`.
 *
 * Anchored on Sprint 5 measurements (see docs/24-FORMULA-REGISTRY.md
 * §14 sibling note in 11-CHANGELOG Sprint 5 entry):
 *   supabase-js.esm.js → 205 KB live, 250 KB budget (≈22 % headroom)
 *   app.css            →  48 KB live,  80 KB budget (≈66 % headroom for
 *                          future component sets)
 *   patient-detail.js  →  32 KB live,  50 KB budget
 *   assessment-view.js →  27 KB live,  50 KB budget
 *
 * Each entry maps a repo-relative path to its budget. Missing files
 * are skipped (gate is no-op until the build emits them).
 */
const BUDGETS = {
  // Vendored
  'frontend/assets/vendor/supabase-js.esm.js':   250 * 1024,
  // Stylesheets
  'frontend/assets/css/app.css':                  80 * 1024,
  // Pages
  'frontend/pages/patient-detail.js':             50 * 1024,
  'frontend/pages/assessment-view.js':            50 * 1024,
  'frontend/pages/assessment-new.js':             40 * 1024,
  'frontend/pages/mfa-enroll.js':                 40 * 1024,
  'frontend/pages/audit.js':                      30 * 1024,
  'frontend/pages/dashboard.js':                  20 * 1024,
  'frontend/pages/alerts.js':                     20 * 1024,
  'frontend/pages/login.js':                      20 * 1024,
  'frontend/pages/patients.js':                   20 * 1024,
  'frontend/pages/tenant-settings.js':            20 * 1024,
  // Shared components
  'frontend/components/progress-charts.js':       40 * 1024,
  'frontend/components/nav-header.js':            20 * 1024,
  'frontend/components/progress-thresholds.js':   20 * 1024,
};

const TAG = '[check-bundle-budget]';

const offenders = [];
const checked = [];

for (const [rel, budget] of Object.entries(BUDGETS)) {
  const path = join(REPO_ROOT, rel);
  if (!existsSync(path)) continue;
  const size = statSync(path).size;
  checked.push({ rel, size, budget });
  if (size > budget) {
    offenders.push({ rel, size, budget });
  }
}

function fmtKB(n) {
  return `${(n / 1024).toFixed(1)} KB`;
}

if (offenders.length > 0) {
  console.error(`${TAG} FAIL — ${offenders.length} file(s) over budget.`);
  for (const o of offenders) {
    const overBy = o.size - o.budget;
    const pct = ((o.size / o.budget - 1) * 100).toFixed(1);
    console.error(
      `${TAG}   ${o.rel}  ${fmtKB(o.size)} > ${fmtKB(o.budget)} `
        + `(over by ${fmtKB(overBy)}, +${pct}%)`,
    );
  }
  console.error(`${TAG} Either reduce the file or raise the budget in scripts/check-bundle-budget.mjs.`);
  console.error(`${TAG} Bumping a budget should be a conscious decision, documented in the PR body.`);
  process.exit(2);
}

console.log(`${TAG} OK — ${checked.length} file(s) within budget.`);
for (const c of checked) {
  const pct = ((c.size / c.budget) * 100).toFixed(0);
  console.log(`${TAG}   ${c.rel}  ${fmtKB(c.size).padStart(8)} / ${fmtKB(c.budget).padStart(8)}  (${pct.padStart(3)}%)`);
}
