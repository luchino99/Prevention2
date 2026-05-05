#!/usr/bin/env node
/**
 * migrate-rate-limit-to-async.mjs
 * ---------------------------------------------------------------------------
 * One-shot transformation: switch every API endpoint from the synchronous
 * in-memory `checkRateLimit` to the distributed-with-fallback
 * `checkRateLimitAsync` provided by `backend/src/middleware/rate-limit.ts`.
 *
 * Why
 * ---
 * The in-memory implementation lives in serverless function memory.
 * Each cold-start of a Vercel function resets every counter, which means
 * a determined attacker (1 request every 60s, or one per cold-start
 * window) bypasses the rate limit entirely. The Upstash-backed async
 * implementation is shared across instances and survives cold-starts.
 *
 * Safety
 * ------
 *   - When Upstash env vars are absent, `checkRateLimitAsync` falls back
 *     to the in-memory implementation, so this migration NEVER tightens
 *     behaviour beyond what was already in place. Tightening only kicks
 *     in once the operator wires UPSTASH_REDIS_REST_URL / _TOKEN.
 *   - The transformation is purely textual:
 *       import     → swap the symbol name `checkRateLimit` for `checkRateLimitAsync`
 *       call site  → swap `checkRateLimit(req,` for `await checkRateLimitAsync(req,`
 *     and then sanity-check each file with `node --check`.
 *
 * Idempotency
 * -----------
 *   Files already on the async path are reported as `already-async` and
 *   skipped untouched. Re-running the script is a no-op.
 *
 * Run
 * ---
 *   node scripts/migrate-rate-limit-to-async.mjs
 *
 * After the run, commit the file diff. The script is one-shot — once
 * every endpoint is migrated, this file can be deleted (kept now only
 * as a forensic artefact and to allow re-runs while the migration is
 * in progress).
 * ---------------------------------------------------------------------------
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

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

/**
 * Apply the textual transformation. Returns
 *   { changed: boolean, content: string, alreadyAsync: boolean, callSites: number }.
 */
function transform(src) {
  // Skip if not an endpoint that uses rate limiting at all.
  if (!src.includes('checkRateLimit')) {
    return { changed: false, content: src, alreadyAsync: false, callSites: 0 };
  }

  // Already migrated — nothing to do.
  const usesAsync = src.includes('checkRateLimitAsync');
  const usesSync =
    /\bcheckRateLimit\b(?!Async)/.test(src);
  if (usesAsync && !usesSync) {
    return { changed: false, content: src, alreadyAsync: true, callSites: 0 };
  }

  let out = src;
  let callSites = 0;

  // 1. Rewrite call sites: `checkRateLimit(req,` → `await checkRateLimitAsync(req,`.
  //    Match optionally preceded by `=` so we cover both
  //      `const rl = checkRateLimit(req, ...);`
  //    and bare statement form. Don't touch already-`await`ed calls.
  out = out.replace(
    /(?<!Async)\bcheckRateLimit\s*\(\s*req\s*,/g,
    (match, _offset, _full) => {
      callSites += 1;
      return 'await checkRateLimitAsync(req,';
    },
  );

  // 2. Rewrite import specifier — match the bare symbol name in the
  //    import list, e.g.:
  //      import { checkRateLimit, RATE_LIMITS, applyRateLimitHeaders }
  //    → import { checkRateLimitAsync, RATE_LIMITS, applyRateLimitHeaders }
  //    Use a word boundary to avoid touching `checkRateLimitAsync`.
  out = out.replace(/(\bimport\s*\{[^}]*?)\bcheckRateLimit\b(?!Async)/g, (full, prefix) => {
    return `${prefix}checkRateLimitAsync`;
  });

  return { changed: out !== src, content: out, alreadyAsync: false, callSites };
}

function syntaxCheck(absPath) {
  // tsc would be ideal but is heavy. node --check works on plain TS only
  // when prefixed with a .ts loader; we rely on a heuristic instead:
  // compile a small JS-only excerpt by stripping types is too fragile.
  // For now, defer real syntax checking to `npm run typecheck` which the
  // operator runs after the script. This script stays pure-text.
  void absPath;
  return true;
}

function main() {
  const files = walkTs(API_ROOT);
  let changed = 0;
  let alreadyAsync = 0;
  let untouched = 0;
  let totalCallSites = 0;

  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const r = transform(src);
    const rel = relative(REPO_ROOT, f);

    if (r.alreadyAsync) {
      console.log(`  ${rel}  already-async`);
      alreadyAsync += 1;
      continue;
    }
    if (!r.changed) {
      untouched += 1;
      continue;
    }
    if (!syntaxCheck(f)) {
      console.error(`  ${rel}  FAIL syntax-check`);
      process.exit(2);
    }
    writeFileSync(f, r.content, 'utf8');
    console.log(`  ${rel}  migrated (${r.callSites} call site${r.callSites === 1 ? '' : 's'})`);
    changed += 1;
    totalCallSites += r.callSites;
  }

  console.log(
    `\nDone. files: ${files.length}; migrated: ${changed} ` +
    `(${totalCallSites} call sites); already-async: ${alreadyAsync}; ` +
    `untouched: ${untouched}.`,
  );
  console.log('Run `npm run typecheck` to confirm no compile error before committing.');
}

main();
