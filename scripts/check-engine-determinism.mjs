#!/usr/bin/env node
/**
 * check-engine-determinism.mjs
 * ---------------------------------------------------------------------------
 * CI gate that enforces the engine determinism contract documented in
 * `docs/23-CLINICAL-ENGINE.md §4`:
 *
 *   "For a fixed engine_version and a fixed AssessmentInput, the output
 *    ScoreResultEntry[] is bit-for-bit identical across runs, processes,
 *    and machines."
 *
 * The contract is broken whenever a score module reads the wall clock
 * (`new Date()`, `Date.now()`, `performance.now()`) or rolls a random
 * number (`Math.random()`, `crypto.getRandomValues()`). A single line
 * of such code in a hot path silently breaks score reproducibility
 * across deploys — and is undetectable by golden-vector tests because
 * the test fixture pins all inputs.
 *
 * What this script enforces
 * -------------------------
 * The DETERMINISTIC_DIRS array below lists the sub-trees of
 * `backend/src/domain/clinical/` that are "deterministic-locked". Inside
 * those directories, the FORBIDDEN_PATTERNS array of regexes must NOT
 * match any source file (`.ts` or `.js`).
 *
 * The exclusions list documents which adjacent sub-trees are NOT
 * deterministic-locked, with a one-line justification each. This is the
 * authoritative ledger — a new sub-tree under `domain/clinical/` is
 * either added to DETERMINISTIC_DIRS or to EXCLUSIONS with a reason.
 *
 * Behaviour
 * ---------
 *   exit 0  → no forbidden pattern matched in any locked directory
 *   exit 2  → at least one match; lists every offending file:line
 *
 * Wired into
 * ----------
 *   `npm run build:check`
 *   `npm run check:determinism`  (standalone)
 *
 * Maintenance
 * -----------
 * If a legitimate need arises to read time/randomness inside a locked
 * directory (e.g. a future `engine_version` selector that depends on
 * a deploy timestamp), the correct fix is:
 *   1. Refactor so the value is INJECTED at the orchestrator boundary
 *      (parameter, not module-level read).
 *   2. The orchestrator stays outside DETERMINISTIC_DIRS.
 * Do NOT add an exception to FORBIDDEN_PATTERNS — that defeats the gate.
 * ---------------------------------------------------------------------------
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const ENGINE_ROOT = join(REPO_ROOT, 'backend', 'src', 'domain', 'clinical');

/**
 * Sub-trees that MUST stay deterministic. Every score module, every
 * scalar derivation, every formula coefficient lookup lives here.
 */
const DETERMINISTIC_DIRS = [
  'score-engine',          // 10 score modules + orchestrator
  'risk-aggregation',      // composite-risk pure mapping
  'nutrition-engine',      // PREDIMED + BMR/TDEE pure functions
  'derivations',           // BMI helpers etc. (pure derivations)
  'completeness',          // input completeness check (pure read)
  'screening-engine',      // screening rule set (pure rules)
];

/**
 * Sub-trees explicitly NOT locked. Each entry must carry a reason —
 * this is documentation, not a TODO list.
 */
const EXCLUSIONS = {
  'report-engine':
    'PDF generation legitimately stamps the report timestamp — the ' +
    'output is a document, not a score.',
  'alert-engine':
    'Receives `now` as a parameter from the caller (default `new Date()` ' +
    'is convenience for tests). The engine never reads the clock itself.',
  'followup-engine':
    'Same pattern as alert-engine: `now` is a parameter; the default ' +
    '`new Date()` only fires when callers do not supply one.',
  'lifestyle-recommendation-engine':
    'Bounded-suggestion engine; outputs are presentation hints, not ' +
    'persisted score values.',
  'activity-engine':
    'METs derivations are pure but the engine has not been formally ' +
    'locked into the determinism contract yet (low risk, may be added).',
  'guideline-catalog':
    'Static catalog of guideline references — no behaviour to gate.',
};

/**
 * Patterns that must not appear in any source file under a locked dir.
 * Each entry is { regex, label, why }.
 */
const FORBIDDEN_PATTERNS = [
  {
    regex: /\bMath\.random\s*\(/g,
    label: 'Math.random()',
    why: 'Non-deterministic randomness breaks reproducibility.',
  },
  {
    regex: /\bDate\.now\s*\(/g,
    label: 'Date.now()',
    why: 'Wall-clock read makes the output time-dependent.',
  },
  {
    regex: /\bnew\s+Date\s*\(\s*\)/g,
    label: 'new Date()',
    why: 'Default-constructor reads the wall clock.',
  },
  {
    regex: /\bperformance\.now\s*\(/g,
    label: 'performance.now()',
    why: 'Wall-clock read (high-resolution variant).',
  },
  {
    regex: /\bcrypto\.(?:getRandomValues|randomUUID|randomBytes)\s*\(/g,
    label: 'crypto.{getRandomValues,randomUUID,randomBytes}',
    why: 'Randomness source breaks reproducibility.',
  },
];

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.js', '.mjs']);

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else if (st.isFile()) {
      // Skip test files; they are allowed to use timers.
      if (name.endsWith('.test.ts') || name.endsWith('.test.js')) continue;
      const dot = name.lastIndexOf('.');
      if (dot < 0) continue;
      const ext = name.slice(dot);
      if (SOURCE_EXTENSIONS.has(ext)) out.push(full);
    }
  }
  return out;
}

/**
 * Strip line comments (`// …`) and block comments (`/* … *​/`) from
 * a JS/TS source so that prose that mentions a forbidden pattern in
 * a comment does not trigger the gate. Strings are NOT stripped:
 * we want to flag a `'new Date()'` literal too — it might be a
 * disguised dynamic eval.
 */
function stripComments(text) {
  // Block comments
  let out = text.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
  // Line comments — preserve newlines for accurate line numbers
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, (full, p) => p + ' '.repeat(full.length - p.length));
  return out;
}

function findOffenders(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const cleaned = stripComments(text);
  const offenders = [];
  for (const { regex, label, why } of FORBIDDEN_PATTERNS) {
    let m;
    regex.lastIndex = 0; // reset between files
    while ((m = regex.exec(cleaned)) !== null) {
      const lineNumber =
        cleaned.slice(0, m.index).split('\n').length;
      offenders.push({ label, why, lineNumber });
    }
  }
  return offenders;
}

function main() {
  const allOffenders = [];
  for (const subDir of DETERMINISTIC_DIRS) {
    const fullDir = join(ENGINE_ROOT, subDir);
    const files = walk(fullDir);
    for (const f of files) {
      const found = findOffenders(f);
      if (found.length > 0) {
        for (const o of found) {
          allOffenders.push({
            file: relative(REPO_ROOT, f),
            ...o,
          });
        }
      }
    }
  }

  if (allOffenders.length === 0) {
    console.log(
      `[check-engine-determinism] OK — ${DETERMINISTIC_DIRS.length} ` +
      `deterministic-locked directories, no forbidden pattern.`,
    );
    process.exit(0);
  }

  console.error(`[check-engine-determinism] FAIL — ${allOffenders.length} violation(s):\n`);
  for (const o of allOffenders) {
    console.error(`  ${o.file}:${o.lineNumber}  ${o.label}`);
    console.error(`    → ${o.why}`);
  }
  console.error(
    `\nThe engine determinism contract (docs/23-CLINICAL-ENGINE.md §4) ` +
    `requires that score / risk / completeness / nutrition modules be ` +
    `pure functions with no clock or random reads. If your code legitimately ` +
    `needs the wall clock or a UUID, refactor so the value is INJECTED ` +
    `at the orchestrator boundary — see EXCLUSIONS in this script for the ` +
    `pattern used by alert-engine / followup-engine.\n`,
  );
  process.exit(2);
}

main();
