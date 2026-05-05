#!/usr/bin/env node
/**
 * fetch-noto-fonts.mjs
 * ----------------------------------------------------------------------------
 * Populates backend/src/assets/fonts/ with the NotoSans TTF files required
 * by the PDF report renderer.
 *
 * Why this script exists:
 *   The PDF renderer uses pdf-lib + @pdf-lib/fontkit to embed a Unicode-aware
 *   font so clinical text (—, •, ≥, accented names, …) renders correctly.
 *   pdf-lib's StandardFonts only cover WinAnsi (Latin-1) and would cause the
 *   previous implementation to replace any character outside WinAnsi with '?'.
 *
 *   We don't ship the TTF binaries in git (they are large Apache-2.0 assets).
 *   Instead, this script fetches them from an allow-listed CDN at install /
 *   build time. It is invoked automatically by `npm run build` and can also
 *   be invoked manually via `npm run fetch:fonts`.
 *
 * Behaviour:
 *   - Idempotent: if the file is already present, non-empty and has a valid
 *     TrueType signature (0x00010000) or OpenType signature ('OTTO'), we skip.
 *   - Resilient: tries multiple mirrors for each file before failing.
 *   - Non-fatal in offline CI: if no mirror is reachable, the script exits 0
 *     with a warning. The renderer will gracefully fall back to WinAnsi-safe
 *     StandardFonts; encoded tests will still pass and PDFs will still render
 *     (just with the legacy `?` replacement for unsupported glyphs).
 *
 * License:
 *   NotoSans is released under the SIL Open Font License 1.1 by Google.
 *   The licence file is written next to the TTFs.
 * ----------------------------------------------------------------------------
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get as httpsGet } from 'node:https';

const here = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = resolve(here, '..', 'backend', 'src', 'assets', 'fonts');

const FONTS = [
  {
    name: 'NotoSans-Regular.ttf',
    mirrors: [
      'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans@latest/latin-400-normal.ttf',
      'https://raw.githubusercontent.com/fontsource/font-files/main/fonts/google/noto-sans/files/noto-sans-latin-400-normal.ttf',
    ],
  },
  {
    name: 'NotoSans-Bold.ttf',
    mirrors: [
      'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans@latest/latin-700-normal.ttf',
      'https://raw.githubusercontent.com/fontsource/font-files/main/fonts/google/noto-sans/files/noto-sans-latin-700-normal.ttf',
    ],
  },
  {
    name: 'NotoSans-Italic.ttf',
    mirrors: [
      'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans@latest/latin-400-italic.ttf',
      'https://raw.githubusercontent.com/fontsource/font-files/main/fonts/google/noto-sans/files/noto-sans-latin-400-italic.ttf',
    ],
  },
];

const LICENSE = `NotoSans font files in this directory are distributed under the
SIL Open Font License, Version 1.1 (OFL-1.1).

Upstream source:
  https://fonts.google.com/noto/specimen/Noto+Sans

Full licence text:
  https://openfontlicense.org

These files are fetched at build time by scripts/fetch-noto-fonts.mjs and
embedded by backend/src/services/pdf/font-loader.ts when rendering clinical
PDF reports. They are not otherwise redistributed.
`;

function looksLikeTrueType(buf) {
  if (buf.length < 16) return false;
  // TrueType: 0x00010000 or 'true'; OpenType: 'OTTO'
  const sig = buf.readUInt32BE(0);
  if (sig === 0x00010000) return true;
  const tag = buf.subarray(0, 4).toString('ascii');
  return tag === 'OTTO' || tag === 'true' || tag === 'typ1';
}

async function download(url, dest) {
  return new Promise((resolveFn, reject) => {
    const handle = (res, hops = 0) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 5) {
        res.resume();
        httpsGet(res.headers.location, (r) => handle(r, hops + 1)).on('error', reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const out = createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => out.close((err) => (err ? reject(err) : resolveFn())));
      out.on('error', reject);
    };
    httpsGet(url, handle).on('error', reject);
  });
}

async function fetchOne(font) {
  const target = join(FONT_DIR, font.name);
  if (existsSync(target)) {
    try {
      const buf = readFileSync(target);
      if (statSync(target).size > 10_000 && looksLikeTrueType(buf)) {
        console.log(`  ✓ ${font.name} (already present, ${(buf.length / 1024).toFixed(0)} KB)`);
        return 'skip';
      }
      console.warn(`  ⚠ ${font.name} present but looks corrupt — re-downloading`);
    } catch {
      /* fall through to re-download */
    }
  }

  let lastErr = null;
  for (const url of font.mirrors) {
    try {
      const tmp = `${target}.download`;
      await download(url, tmp);
      const buf = readFileSync(tmp);
      if (!looksLikeTrueType(buf) || buf.length < 10_000) {
        throw new Error(`Downloaded bytes do not look like a TrueType file`);
      }
      writeFileSync(target, buf);
      try {
        // Best-effort temp cleanup
        const fs = await import('node:fs/promises');
        await fs.unlink(tmp).catch(() => {});
      } catch {
        /* ignore */
      }
      console.log(`  ✓ ${font.name} (${(buf.length / 1024).toFixed(0)} KB)  from ${url}`);
      return 'fetched';
    } catch (err) {
      lastErr = err;
      console.warn(`  · mirror failed (${url}): ${err.message}`);
    }
  }
  throw lastErr ?? new Error('All mirrors failed');
}

async function main() {
  if (!existsSync(FONT_DIR)) mkdirSync(FONT_DIR, { recursive: true });

  // Always (re)write the license note — it is part of the distribution contract.
  writeFileSync(join(FONT_DIR, 'LICENSE-OFL-1.1.txt'), LICENSE, 'utf8');

  console.log(`fetch-noto-fonts → ${FONT_DIR}`);
  let fetched = 0;
  let skipped = 0;
  let failed = 0;
  for (const font of FONTS) {
    try {
      const out = await fetchOne(font);
      if (out === 'fetched') fetched++;
      else skipped++;
    } catch (err) {
      failed++;
      console.warn(`  ✗ ${font.name} — ${err.message}`);
    }
  }

  if (failed > 0) {
    console.warn(
      `\n⚠ ${failed}/${FONTS.length} font file(s) could not be fetched. ` +
      `The PDF renderer will fall back to WinAnsi StandardFonts where needed. ` +
      `Re-run 'npm run fetch:fonts' from a network-connected environment.\n`,
    );
    // Non-fatal — do not break offline CI builds.
    process.exit(0);
  }
  console.log(`\nDone. fetched=${fetched} skipped=${skipped}\n`);
}

main().catch((err) => {
  console.error('fetch-noto-fonts failed:', err);
  process.exit(0); // still non-fatal
});
