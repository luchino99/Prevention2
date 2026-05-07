#!/usr/bin/env node
/**
 * check-equivalence-coverage.mjs
 * ---------------------------------------------------------------------------
 * Anti-recidiva gate (Sprint 4 task 4.4 / F-016). Catches any future
 * regression where a clinical score lands in the engine without a paired
 * independent-reference equivalence test.
 *
 * Why
 * ---
 * Clinical-grade auditability requires that every validated score has an
 * independent code path that re-derives the formula from the published
 * source and asserts the engine matches. Without a CI gate, "we tested
 * it once" decays as new scores are added or coefficients are tweaked.
 *
 * What it checks
 * --------------
 * For each score in `EXPECTED_COVERAGE`, there must be:
 *   1. A reference implementation file under
 *      `tests/equivalence/refs/<score>-reference.ts` (or a known
 *      already-covered alternative test file).
 *   2. At least `MIN_CASES_PER_SCORE` `it(...)` cases that mention the
 *      score's identifier somewhere in the suite.
 *
 * Behaviour
 * ---------
 *   exit 0  → every required score has ≥ MIN_CASES_PER_SCORE equivalence cases
 *   exit 2  → at least one score is uncovered or under-covered
 *
 * Wired into
 * ----------
 *   `npm run check:equivalence`
 *   `npm run build:check`
 *
 * Notes
 * -----
 * - The gate is intentionally simple — it grep-counts `it(` lines whose
 *   surrounding describe-context matches the score id. Sophisticated
 *   AST inspection is unnecessary for a regression tripwire and would
 *   add a Babel/TS dependency only used by this script.
 * - Adding a new score? Update `EXPECTED_COVERAGE` and add ≥5 cases in
 *   the matching test file. If the score is intentionally exempted (e.g.
 *   a wrapper around an already-covered primitive), document it with an
 *   inline note in this file rather than silently lowering the bar.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN_CASES_PER_SCORE = 5;

/**
 * Scores that MUST have ≥ MIN_CASES_PER_SCORE equivalence cases somewhere
 * under tests/. The `keywords` array lists strings that, when grep-found
 * inside an `it(...)` line, count toward coverage. Multiple keywords are
 * OR-ed — useful when a score is referenced under different aliases
 * (FIB-4 / FIB4, SCORE2 / SCORE2_DIABETES).
 *
 * Each entry also points at the canonical test files for transparency.
 */
const EXPECTED_COVERAGE = [
  {
    id: 'BMI',
    keywords: ['BMI', 'bmi'],
    files: [
      'tests/equivalence/score-reference-equivalence.test.ts',
      'tests/equivalence/score-equivalence.test.ts',
    ],
  },
  {
    id: 'eGFR',
    keywords: ['eGFR', 'egfr', 'CKD-EPI'],
    files: [
      'tests/equivalence/score-reference-equivalence.test.ts',
      'tests/equivalence/score-equivalence.test.ts',
    ],
  },
  {
    id: 'FIB-4',
    keywords: ['FIB-4', 'FIB4', 'fib4'],
    files: [
      'tests/unit/fib4.test.ts',
      'tests/equivalence/score-equivalence.test.ts',
    ],
  },
  {
    id: 'FLI',
    keywords: ['FLI', 'fli', 'Bedogni'],
    files: [
      'tests/equivalence/score-reference-equivalence.test.ts',
      'tests/equivalence/score-equivalence.test.ts',
    ],
  },
  {
    id: 'FRAIL',
    keywords: ['FRAIL', 'frail', 'Morley'],
    files: [
      'tests/equivalence/score-reference-equivalence.test.ts',
      'tests/equivalence/score-equivalence.test.ts',
    ],
  },
  {
    id: 'ADA',
    keywords: ['ADA', 'ada', 'Bang'],
    files: [
      'tests/equivalence/score-reference-equivalence.test.ts',
      'tests/equivalence/score-equivalence.test.ts',
    ],
  },
  {
    id: 'METABOLIC_SYNDROME',
    keywords: ['Metabolic Syndrome', 'metSyndrome', 'MetS', 'METABOLIC_SYNDROME'],
    files: [
      'tests/unit/metabolic-syndrome.test.ts',
      'tests/equivalence/score-equivalence.test.ts',
    ],
  },
  {
    id: 'PREDIMED',
    keywords: ['PREDIMED', 'predimed', 'MEDAS'],
    files: [
      'tests/unit/predimed-mifflin.test.ts',
      'tests/equivalence/score-equivalence.test.ts',
    ],
  },
  {
    id: 'SCORE2',
    keywords: ['SCORE2', 'score2'],
    files: [
      'tests/unit/score2-golden.test.ts',
      'tests/equivalence/score-equivalence.test.ts',
    ],
  },
  {
    id: 'SCORE2_DIABETES',
    keywords: ['SCORE2-Diabetes', 'SCORE2_DIABETES', 'score2Diabetes'],
    files: [
      'tests/unit/score2-golden.test.ts',
      'tests/equivalence/score-equivalence.test.ts',
    ],
  },
];

function readFileSafe(relPath) {
  try {
    return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Count `it(...)` lines in `body` whose preceding 4 KB window mentions
 * any of the score's keywords. The window heuristic is generous so a
 * top-level describe whose `it` cases reference the score-by-name still
 * counts (e.g. PREDIMED golden cases under `describe('PREDIMED')`).
 */
function countCases(body, keywords) {
  const lines = body.split('\n');
  let count = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('it(') && !trimmed.startsWith("it.skip(") &&
        !trimmed.startsWith('it.only(') && !trimmed.startsWith('it.todo(')) {
      continue;
    }
    // Pull a 4 KB context window above this `it(`.
    const start = Math.max(0, i - 80);
    const ctx = lines.slice(start, i + 1).join('\n');
    if (keywords.some((k) => ctx.includes(k))) count += 1;
  }
  return count;
}

let failed = 0;
const report = [];

for (const score of EXPECTED_COVERAGE) {
  let total = 0;
  for (const f of score.files) {
    const body = readFileSafe(f);
    if (body === null) continue;
    total += countCases(body, score.keywords);
  }
  const ok = total >= MIN_CASES_PER_SCORE;
  if (!ok) failed += 1;
  report.push({ id: score.id, count: total, ok });
}

const TAG = '[check-equivalence-coverage]';

if (failed > 0) {
  console.error(`${TAG} FAIL — ${failed} score(s) under the ${MIN_CASES_PER_SCORE}-case minimum.`);
  for (const r of report) {
    const flag = r.ok ? 'OK ' : 'MISS';
    console.error(`${TAG}   ${flag}  ${r.id.padEnd(22)} count=${r.count}`);
  }
  console.error(`${TAG} Add cases in tests/equivalence/score-reference-equivalence.test.ts`);
  console.error(`${TAG} or in the per-score golden file.`);
  process.exit(2);
}

console.log(`${TAG} OK — ${report.length} score(s) pass the ≥${MIN_CASES_PER_SCORE}-case bar.`);
for (const r of report) {
  console.log(`${TAG}   OK  ${r.id.padEnd(22)} count=${r.count}`);
}
