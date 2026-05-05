#!/usr/bin/env node
/**
 * migrate-prose-logs-to-structured.mjs
 * ---------------------------------------------------------------------------
 * One-shot transformation: every remaining `console.error('[xxx] ...', { … })`
 * / `console.warn('[xxx] ...', { … })` in `api/v1/**` becomes a structured
 * `logStructured('<level>', '<EVENT>', { … })` call, parseable by Datadog
 * via `@event:<EVENT>`.
 *
 * Mapping (deliberately small + explicit — adding new mappings requires a
 * matching entry in `docs/27-INCIDENT-RESPONSE.md`):
 *
 *   audit best-effort failed     → AUDIT_BEST_EFFORT_FAILED  (warn)
 *   audit write failed           → AUDIT_BEST_EFFORT_FAILED  (warn)
 *   audit guarantee failed       → (skip — emitter already emits AUDIT_WRITE_FAILED)
 *   signed-url failed            → STORAGE_OPERATION_FAILED  (warn)
 *   export row insert failed     → REPORT_EXPORT_INSERT_FAILED (error)
 *   auto-link PPL failed         → PPL_AUTOLINK_FAILED       (warn)
 *   worker failed                → DSR_WORKER_FAILED         (error)
 *   post-worker update failed    → DSR_POSTWORKER_UPDATE_FAILED (error)
 *   unexpected error             → ENDPOINT_UNEXPECTED_ERROR (error)
 *
 * The script:
 *   1. Adds the `logStructured` import if not already present
 *   2. Replaces matching console calls with the equivalent structured emit,
 *      preserving the original fields object verbatim and adding a `context`
 *      field with the prefix tag for human readability.
 *
 * Run:
 *   node scripts/migrate-prose-logs-to-structured.mjs
 *
 * Idempotent: a file already migrated reports `already-migrated`.
 * ---------------------------------------------------------------------------
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const API_ROOT = join(REPO_ROOT, 'api', 'v1');

const MAPPINGS = [
  { match: /audit best-effort failed/i, event: 'AUDIT_BEST_EFFORT_FAILED', level: 'warn' },
  { match: /audit guarantee failed/i,    event: null,                     level: null  }, // skip
  { match: /audit write failed/i,        event: 'AUDIT_BEST_EFFORT_FAILED', level: 'warn' },
  { match: /signed-url failed/i,         event: 'STORAGE_OPERATION_FAILED', level: 'warn' },
  { match: /export row insert failed/i,  event: 'REPORT_EXPORT_INSERT_FAILED', level: 'error' },
  { match: /auto-link PPL failed/i,      event: 'PPL_AUTOLINK_FAILED',     level: 'warn' },
  { match: /post-worker update failed/i, event: 'DSR_POSTWORKER_UPDATE_FAILED', level: 'error' },
  { match: /worker failed/i,             event: 'DSR_WORKER_FAILED',       level: 'error' },
  { match: /unexpected error/i,          event: 'ENDPOINT_UNEXPECTED_ERROR', level: 'error' },
];

function pickEvent(message) {
  for (const m of MAPPINGS) {
    if (m.match.test(message)) return m;
  }
  return null;
}

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
 * Compute the relative path from a source TS file to
 * `backend/src/observability/structured-log.js` so the import resolves
 * uniformly regardless of nesting depth.
 */
function importPathFor(sourceFile) {
  const target = join(REPO_ROOT, 'backend', 'src', 'observability', 'structured-log.js');
  let rel = relative(dirname(sourceFile), target).replace(/\\/g, '/');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

function ensureImport(src, importLine) {
  if (src.includes('observability/structured-log')) return src;
  // Insert just before the first `import type` or `import` block — keep the
  // existing block style.
  const importBlock = src.match(/(^import[^\n]*\n)+/m);
  if (!importBlock) {
    // No imports at all — prepend.
    return importLine + '\n' + src;
  }
  const idx = importBlock.index + importBlock[0].length;
  return src.slice(0, idx) + importLine + '\n' + src.slice(idx);
}

/**
 * Match: `console.error('[<prefix>] <message>', <fields_expression>);`
 * Captures: prefix, message, fields. The fields expression may span
 * multiple lines and contain nested braces.
 *
 * We use a state-machine over the source rather than a single regex
 * because TS object literals can contain newlines + nested objects.
 */
function findCalls(src) {
  const out = [];
  // Match the OPENING of the console call:
  const re = /console\.(error|warn)\(\s*'\[([^\]]+)\]\s+([^']*)'\s*,\s*/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const startIdx = m.index;
    const level = m[1];
    const prefix = m[2];
    const message = m[3];
    const argStart = re.lastIndex;
    // Find the matching closing paren — scan forward, balance braces +
    // brackets, treat strings as opaque.
    let i = argStart;
    let depth = 0;
    let inString = null;
    while (i < src.length) {
      const c = src[i];
      if (inString) {
        if (c === '\\') { i += 2; continue; }
        if (c === inString) inString = null;
        i++; continue;
      }
      if (c === "'" || c === '"' || c === '`') { inString = c; i++; continue; }
      if (c === '{' || c === '[' || c === '(') depth++;
      else if (c === '}' || c === ']' || c === ')') {
        if (depth === 0 && c === ')') {
          // End of console.X(...).
          const argEnd = i;
          // Allow optional trailing ; / whitespace
          let end = i + 1;
          while (end < src.length && /\s/.test(src[end])) end++;
          if (src[end] === ';') end++;
          out.push({
            level,
            prefix,
            message,
            fieldsExpr: src.slice(argStart, argEnd),
            startIdx,
            endIdx: end,
          });
          break;
        }
        depth--;
      }
      i++;
    }
  }
  return out;
}

function transform(src, sourceFile) {
  const calls = findCalls(src);
  if (calls.length === 0) {
    return { changed: false, content: src, count: 0, skipped: 0 };
  }

  let changed = 0;
  let skipped = 0;
  let out = '';
  let cursor = 0;
  for (const c of calls) {
    out += src.slice(cursor, c.startIdx);
    const mapping = pickEvent(c.message);
    if (!mapping || !mapping.event) {
      // skip — leave the original call alone
      out += src.slice(c.startIdx, c.endIdx);
      cursor = c.endIdx;
      skipped++;
      continue;
    }
    const event = mapping.event;
    const level = mapping.level;
    const fields = c.fieldsExpr.trim().replace(/,\s*$/, '');
    const replacement =
      `logStructured('${level}', '${event}', { context: '${c.prefix} ${c.message}', extra: ${fields} });`;
    out += replacement;
    cursor = c.endIdx;
    changed++;
  }
  out += src.slice(cursor);

  if (changed > 0) {
    out = ensureImport(out, `import { logStructured } from '${importPathFor(sourceFile)}';`);
  }
  return { changed: true, content: out, count: changed, skipped };
}

function main() {
  const files = walkTs(API_ROOT);
  let totalCalls = 0;
  let totalSkipped = 0;
  let touched = 0;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const r = transform(src, f);
    const rel = relative(REPO_ROOT, f);
    if (!r.changed || r.count === 0) {
      if (r.skipped > 0) {
        console.log(`  ${rel}  ${r.skipped} call(s) skipped (mapping=null)`);
      }
      continue;
    }
    writeFileSync(f, r.content, 'utf8');
    console.log(`  ${rel}  migrated ${r.count} call(s)${r.skipped ? `, skipped ${r.skipped}` : ''}`);
    touched += 1;
    totalCalls += r.count;
    totalSkipped += r.skipped;
  }
  console.log(`\nDone. files touched: ${touched}; calls migrated: ${totalCalls}; calls skipped: ${totalSkipped}.`);
  console.log('Run `npm run typecheck` to confirm no compile error before committing.');
}

main();
