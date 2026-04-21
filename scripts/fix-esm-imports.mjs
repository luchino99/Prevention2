#!/usr/bin/env node
/**
 * fix-esm-imports.mjs
 * ---------------------------------------------------------------------------
 * Adds explicit .js extensions to RELATIVE imports in TypeScript source files
 * under `api/` and `backend/src/`. Required for the compiled output to be
 * loadable under Node.js ESM runtime (e.g. Vercel serverless functions with
 * `"type": "module"` in package.json).
 *
 * Why
 * ---
 * Vercel compiles each `.ts` API route to `.js` at deploy time but does NOT
 * rewrite import specifiers. Node ESM loader in strict mode requires explicit
 * extensions for relative imports. Without this, deploys fail at runtime with:
 *   ERR_MODULE_NOT_FOUND: Cannot find module '.../auth-middleware'
 *
 * The canonical TypeScript+ESM pattern is to author imports with `.js` even
 * though the file on disk is `.ts`. TypeScript resolves this correctly and
 * `"moduleResolution": "Bundler"` (or `"NodeNext"`) keeps typecheck green.
 *
 * Transforms (idempotent, safe)
 * -----------------------------
 *   from './foo'                -> from './foo.js'                (if ./foo.ts exists)
 *   from './foo'                -> from './foo/index.js'          (if ./foo/index.ts exists)
 *   from './foo.ts'             -> from './foo.js'                (normalise any stray .ts)
 *   from './foo.js'             -> unchanged (already correct)
 *   from '@supabase/...'        -> unchanged (bare module)
 *   from './foo.json' / .css    -> unchanged (non-JS asset)
 *   dynamic import('./foo')     -> import('./foo.js')
 *   export * from './foo'       -> export * from './foo.js'
 *
 * Warnings
 * --------
 * If a relative import cannot be resolved on disk (neither `<path>.ts` nor
 * `<path>/index.ts` exists), the import is left untouched and a WARN is
 * printed. These usually indicate dead code or mis-paths that need manual
 * inspection — this script refuses to guess.
 *
 * Usage
 * -----
 *   node scripts/fix-esm-imports.mjs --dry-run    # preview only
 *   node scripts/fix-esm-imports.mjs              # apply in place
 * ---------------------------------------------------------------------------
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const TARGETS = [
  join(ROOT, 'api'),
  join(ROOT, 'backend', 'src'),
];

const EXCLUDE_DIRS = new Set([
  'node_modules',
  '.build',
  '_legacy_archive',
  'tests',
  'dist',
  'frontend-dist',
]);

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];

const DRY_RUN = process.argv.includes('--dry-run');

/* ------------------------------ logging ------------------------------- */

function info(m) { console.log(`[fix-esm-imports] ${m}`); }
function warn(m) { console.warn(`[fix-esm-imports] WARN  ${m}`); }

/* ------------------------------ fs walk ------------------------------- */

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (EXCLUDE_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else if (st.isFile() && SOURCE_EXTENSIONS.includes(extname(full))) {
      out.push(full);
    }
  }
  return out;
}

/* --------------------------- resolution ------------------------------- */

function fileExists(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Decide the new specifier for a relative import, or null to skip.
 * Returns:
 *   { kind: 'ok',   newSpec }   — rewrite to newSpec
 *   { kind: 'skip' }             — leave untouched (already correct / non-JS asset)
 *   { kind: 'warn' }             — could not resolve; caller logs warning
 */
function decide(sourceFile, spec) {
  // Only relative imports are relevant
  if (!spec.startsWith('./') && !spec.startsWith('../')) return { kind: 'skip' };

  // Already has a JS-compatible extension? Leave it alone.
  if (/\.(m?js|c?js)$/i.test(spec)) return { kind: 'skip' };

  // Non-JS asset imports — leave alone (json/css/svg/html/png/wasm)
  if (/\.(json|css|svg|html|png|jpg|jpeg|gif|wasm|txt|md)$/i.test(spec)) return { kind: 'skip' };

  const baseDir = dirname(sourceFile);
  const absBase = resolve(baseDir, spec);

  // Normalise stray .ts / .tsx in the specifier → .js
  if (/\.tsx?$/i.test(spec)) {
    const stripped = absBase.replace(/\.tsx?$/i, '');
    if (fileExists(stripped + '.ts') || fileExists(stripped + '.tsx')) {
      return { kind: 'ok', newSpec: spec.replace(/\.tsx?$/i, '.js') };
    }
  }

  // Case 1: <path>.ts exists -> append .js
  for (const ext of SOURCE_EXTENSIONS) {
    if (fileExists(absBase + ext)) {
      return { kind: 'ok', newSpec: spec + '.js' };
    }
  }

  // Case 2: <path>/index.ts exists -> append /index.js
  for (const ext of SOURCE_EXTENSIONS) {
    if (fileExists(join(absBase, 'index' + ext))) {
      const suffix = spec.endsWith('/') ? 'index.js' : '/index.js';
      return { kind: 'ok', newSpec: spec + suffix };
    }
  }

  return { kind: 'warn' };
}

/* ----------------------------- rewrite -------------------------------- */

/**
 * Matches:
 *   from '...'
 *   import '...'          (side-effect import)
 *   import(...)           (dynamic import)
 *   export ... from '...'
 *
 * Multi-line imports work because the `from '...'` suffix is on one line.
 * Side-effect `import '...'` is matched by requiring `import` followed by
 * whitespace and a string literal (no identifier).
 */
const IMPORT_REGEX = /(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+(?=['"]))(['"])([^'"\n]+)\2/g;

function processFile(file) {
  const original = readFileSync(file, 'utf8');
  const changes = [];

  const patched = original.replace(IMPORT_REGEX, (match, prefix, quote, spec) => {
    const verdict = decide(file, spec);
    if (verdict.kind === 'skip') return match;
    if (verdict.kind === 'warn') {
      changes.push({ type: 'warn', from: spec });
      return match;
    }
    changes.push({ type: 'ok', from: spec, to: verdict.newSpec });
    return `${prefix}${quote}${verdict.newSpec}${quote}`;
  });

  return { original, patched, changes };
}

/* ------------------------------- main --------------------------------- */

function main() {
  info(`Mode: ${DRY_RUN ? 'DRY RUN (no files will be written)' : 'APPLY'}`);
  info(`Root: ${ROOT}`);

  let totalFiles = 0;
  let totalRewrites = 0;
  let totalWarns = 0;
  const warnings = [];

  for (const root of TARGETS) {
    const files = walk(root);
    for (const file of files) {
      const { original, patched, changes } = processFile(file);
      const rewrites = changes.filter(c => c.type === 'ok').length;
      const warns = changes.filter(c => c.type === 'warn');
      if (rewrites === 0 && warns.length === 0) continue;

      totalFiles += 1;
      totalRewrites += rewrites;
      totalWarns += warns.length;
      info(`${file.replace(ROOT, '.')}  +${rewrites} rewrites, ${warns.length} warns`);
      for (const c of changes) {
        if (c.type === 'ok') {
          info(`    '${c.from}' -> '${c.to}'`);
        } else {
          warnings.push({ file, path: c.from });
        }
      }
      if (!DRY_RUN && patched !== original) {
        writeFileSync(file, patched, 'utf8');
      }
    }
  }

  info('---');
  info(`Files touched:    ${totalFiles}`);
  info(`Rewrites ${DRY_RUN ? 'planned' : 'applied'}: ${totalRewrites}`);
  info(`Warnings:         ${totalWarns}`);

  if (warnings.length > 0) {
    warn('Could not resolve these relative imports on disk; left as-is:');
    for (const w of warnings) {
      warn(`  ${w.file.replace(ROOT, '.')}  ->  '${w.path}'`);
    }
    warn('Review manually — may indicate dead code or missing files.');
  }

  if (totalWarns > 0 && !DRY_RUN) {
    process.exitCode = 2;
  }
}

main();
