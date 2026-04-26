#!/usr/bin/env node
/**
 * extract-inline-scripts.mjs
 * ---------------------------------------------------------------------------
 * One-shot transformation: replace inline <script> blocks in
 * `frontend/pages/*.html` with external <script src="…"> references so
 * the strict CSP (`script-src 'self'`) in vercel.json no longer blocks
 * page bootstrap.
 *
 * For each page X.html:
 *   1. The first inline <script> block (Supabase config initialiser) is
 *      replaced with:
 *          <script src="../assets/js/public-config.js"></script>
 *      The shared file at that path carries the SAME placeholders and
 *      is patched at build time by inject-public-config.mjs.
 *
 *   2. The second inline <script type="module"> block (page logic) is
 *      written verbatim to `frontend/pages/X.js`, and the inline tag
 *      is replaced with:
 *          <script type="module" src="./X.js"></script>
 *
 * The script is idempotent: if a page is already in the post-extraction
 * state (no inline script blocks), it is skipped untouched and reported.
 *
 * Run once, commit the output, then this file can be removed from the
 * repo (or kept as a one-off migration script for the changelog).
 * ---------------------------------------------------------------------------
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PAGES_DIR = resolve(__dirname, '..', 'frontend', 'pages');

// Regex: open of an inline script (no `src=` attribute).
//   - Group 1: optional ` type="module"` attribute (or empty for classic).
//   - Group 2: body of the block (anything up to the closing </script>).
// The `s` flag is needed so `.` matches newlines.
const INLINE_SCRIPT_RE =
  /<script(\s+type="module")?\s*>(\s*[\s\S]*?\s*)<\/script>/g;

const CONFIG_SIGNATURE = 'window.__UELFY_CONFIG__';

const EXTERNAL_CONFIG_TAG =
  '<script src="../assets/js/public-config.js"></script>';

function processPage(absHtmlPath) {
  const baseName = basename(absHtmlPath, '.html');
  const html = readFileSync(absHtmlPath, 'utf8');
  const matches = [...html.matchAll(INLINE_SCRIPT_RE)];

  if (matches.length === 0) {
    return { baseName, status: 'already-clean' };
  }

  let configReplaced = false;
  let moduleExtracted = false;
  let moduleBody = null;

  // Build the replacement string by walking the matches in order.
  let cursor = 0;
  const out = [];

  for (const m of matches) {
    const [fullMatch, typeAttr, body] = m;
    const isModule = Boolean(typeAttr && typeAttr.includes('module'));
    out.push(html.slice(cursor, m.index));

    if (!isModule && body.includes(CONFIG_SIGNATURE)) {
      // First-block: config initialiser.
      out.push(EXTERNAL_CONFIG_TAG);
      configReplaced = true;
    } else if (isModule) {
      // Module logic block — write to external .js, leave a src ref.
      moduleBody = body;
      out.push(
        `<script type="module" src="./${baseName}.js"></script>`,
      );
      moduleExtracted = true;
    } else {
      // Unknown classic inline script we don't recognise. Refuse to
      // silently lose code: leave it in place and flag it.
      out.push(fullMatch);
    }
    cursor = m.index + fullMatch.length;
  }
  out.push(html.slice(cursor));

  const newHtml = out.join('');

  if (moduleExtracted) {
    const jsPath = join(dirname(absHtmlPath), `${baseName}.js`);
    if (existsSync(jsPath)) {
      // Refuse to clobber a pre-existing extracted file silently.
      throw new Error(
        `extract-inline-scripts: ${jsPath} already exists; refusing to overwrite. ` +
        `Resolve manually before re-running.`,
      );
    }
    // Strip the leading newline + indentation from the inline body so
    // the output file reads naturally; preserve interior indentation.
    const trimmed = stripCommonLeadingIndent(moduleBody);
    const header =
      `/**\n` +
      ` * ${baseName}.js — page logic for ${baseName}.html\n` +
      ` *\n` +
      ` * Extracted from the inline <script type="module"> block by\n` +
      ` * scripts/extract-inline-scripts.mjs to satisfy the strict CSP\n` +
      ` * (script-src 'self') declared in vercel.json. Loaded by the page\n` +
      ` * via <script type="module" src="./${baseName}.js"></script>.\n` +
      ` *\n` +
      ` * Depends on window.__UELFY_CONFIG__ being populated by\n` +
      ` * assets/js/public-config.js, which the page MUST include with a\n` +
      ` * non-module <script> tag BEFORE this module.\n` +
      ` */\n\n`;
    writeFileSync(jsPath, header + trimmed + '\n', 'utf8');
  }

  if (configReplaced || moduleExtracted) {
    writeFileSync(absHtmlPath, newHtml, 'utf8');
  }

  return {
    baseName,
    status: 'extracted',
    configReplaced,
    moduleExtracted,
  };
}

/**
 * Determine the common leading indentation across non-empty lines and
 * remove it. Keeps the relative indentation of nested code intact.
 */
function stripCommonLeadingIndent(body) {
  const lines = body.split('\n');
  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const m = line.match(/^( +)/);
    const indent = m ? m[1].length : 0;
    if (indent < minIndent) minIndent = indent;
  }
  if (!isFinite(minIndent) || minIndent === 0) return body.trim();
  return lines
    .map((l) => (l.length >= minIndent ? l.slice(minIndent) : l))
    .join('\n')
    .trim();
}

function main() {
  if (!existsSync(PAGES_DIR)) {
    console.error(`extract-inline-scripts: pages dir not found: ${PAGES_DIR}`);
    process.exit(1);
  }
  const htmlFiles = readdirSync(PAGES_DIR)
    .filter((f) => f.toLowerCase().endsWith('.html'))
    .map((f) => join(PAGES_DIR, f))
    .sort();

  let touched = 0;
  for (const f of htmlFiles) {
    try {
      const r = processPage(f);
      if (r.status === 'extracted') {
        touched += 1;
        console.log(
          `  ${r.baseName.padEnd(20)}  config=${r.configReplaced ? '✓' : '·'}  module=${r.moduleExtracted ? '✓' : '·'}`,
        );
      } else {
        console.log(`  ${basename(f).padEnd(20)}  already-clean`);
      }
    } catch (err) {
      console.error(`  ${basename(f).padEnd(20)}  ERROR: ${err.message}`);
      process.exitCode = 2;
    }
  }
  console.log(`\nDone. Pages touched: ${touched}/${htmlFiles.length}`);
}

main();
