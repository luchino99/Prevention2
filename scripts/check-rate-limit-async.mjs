#!/usr/bin/env node
/**
 * check-rate-limit-async.mjs
 * ---------------------------------------------------------------------------
 * Regression gate (Tier 2, M-01 follow-up). After the migration that
 * converted every endpoint from `checkRateLimit` to `checkRateLimitAsync`,
 * this script catches any future PR that re-introduces the synchronous
 * in-memory variant in `api/v1/**`.
 *
 * Why
 * ---
 * The sync variant works only inside a single serverless instance. A
 * cold-start fan-out resets every counter, which means a determined
 * attacker effectively bypasses the limit. The async variant routes
 * through Upstash when configured (production) or falls back to in-memory
 * (dev), so it strictly subsumes the sync variant. There is no
 * production reason to call the sync variant from an endpoint.
 *
 * Behaviour
 * ---------
 *   exit 0  → every `api/v1/**` file uses ONLY checkRateLimitAsync
 *             (sync calls are forbidden under api/, not under backend/
 *             since the sync function is still legitimately exported as
 *             the in-memory fallback consumed by the async wrapper)
 *   exit 2  → at least one offending sync call site found
 *
 * Wired into
 * ----------
 *   `npm run check:rate-limit`
 *   `npm run build:check`
 *
 * Not in `npm run build` because a regression here is recoverable (the
 * sync variant still rate-limits, just not distributed) — it is a hygiene
 * gate, not a security blocker.
 * ---------------------------------------------------------------------------
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const API_ROOT = join(REPO_ROOT, 'api', 'v1');

function walkTs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkTs(full));
    else if (st.isFile() && name.endsWith('.ts')) out.push(full);
  }
  return out;
}

function findSyncOffenders(text) {
  // We forbid bare `checkRateLimit(` (excluding `Async`) in any context.
  // The regex is anchored on word boundary so `checkRateLimitAsync` is
  // not flagged.
  const re = /\bcheckRateLimit\b(?!Async)/g;
  const offenders = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const lineNumber = text.slice(0, m.index).split('\n').length;
    offenders.push(lineNumber);
  }
  return offenders;
}

function main() {
  const files = walkTs(API_ROOT);
  let total = 0;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const lines = findSyncOffenders(src);
    if (lines.length === 0) continue;
    const rel = relative(REPO_ROOT, f);
    for (const ln of lines) {
      console.error(`[check-rate-limit-async] FAIL ${rel}:${ln}  uses sync checkRateLimit (use checkRateLimitAsync)`);
      total += 1;
    }
  }

  if (total === 0) {
    console.log(
      `[check-rate-limit-async] OK — ${files.length} api/v1 file(s) scanned, ` +
      `no sync checkRateLimit() use in any endpoint.`,
    );
    process.exit(0);
  }
  console.error(`\n${total} violation(s) — replace with checkRateLimitAsync (await + import update). See backend/src/middleware/rate-limit.ts.`);
  process.exit(2);
}

main();
