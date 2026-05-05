/**
 * PDF font loader.
 *
 * Responsibility
 *   Load a Unicode-capable font family (NotoSans Regular / Bold / Italic) into
 *   a pdf-lib document via @pdf-lib/fontkit so clinical text renders without
 *   the destructive WinAnsi `?` substitution used by the legacy renderer.
 *
 * Fallback strategy
 *   If the TTF files cannot be loaded (offline CI, missing binaries) we fall
 *   back to pdf-lib's StandardFonts.Helvetica family. The caller must still
 *   sanitise text in that mode because Helvetica is WinAnsi-only. The return
 *   object exposes a `unicodeCapable` flag so callers can branch cleanly.
 *
 * Memoisation
 *   Font buffers are read from disk once per process. Each serverless cold
 *   start therefore does a single fs.readFile per font. The buffers cannot be
 *   shared across PDFDocument instances — pdf-lib requires per-document
 *   `embedFont` calls, which is what we do in `loadReportFonts`.
 *
 * Fontkit registration
 *   @pdf-lib/fontkit must be registered against the PDFDocument instance
 *   before custom TTFs can be embedded. We do that inside `loadReportFonts`
 *   to keep this module's public API simple (caller only hands us a doc).
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, PDFFont } from 'pdf-lib';

export interface ReportFonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  /**
   * `true`  → full Unicode via NotoSans; callers do not need to sanitise
   * `false` → WinAnsi StandardFonts fallback; callers must still sanitise
   */
  unicodeCapable: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Disk locations
// ─────────────────────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
// backend/src/services/pdf/ → backend/src/assets/fonts/
const FONT_DIR = resolve(here, '..', '..', 'assets', 'fonts');

const FILES = {
  regular: 'NotoSans-Regular.ttf',
  bold:    'NotoSans-Bold.ttf',
  italic:  'NotoSans-Italic.ttf',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Cached buffers (per process, i.e. per serverless cold start)
// ─────────────────────────────────────────────────────────────────────────────

let cachedBuffers: { regular: Uint8Array; bold: Uint8Array; italic: Uint8Array } | null = null;
let attemptedLoad = false;
let unicodeAvailable = false;

async function readFontBuffer(name: string): Promise<Uint8Array | null> {
  try {
    const buf = await readFile(resolve(FONT_DIR, name));
    if (buf.length < 10_000) return null; // too small to be a real TTF
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch {
    return null;
  }
}

async function ensureBuffersLoaded(): Promise<void> {
  if (attemptedLoad) return;
  attemptedLoad = true;
  const [regular, bold, italic] = await Promise.all([
    readFontBuffer(FILES.regular),
    readFontBuffer(FILES.bold),
    readFontBuffer(FILES.italic),
  ]);
  if (regular && bold && italic) {
    cachedBuffers = { regular, bold, italic };
    unicodeAvailable = true;
  } else {
    unicodeAvailable = false;
    // Emit a single diagnostic — subsequent renders stay quiet.
    const missing = [
      regular ? null : FILES.regular,
      bold    ? null : FILES.bold,
      italic  ? null : FILES.italic,
    ].filter(Boolean) as string[];
    // C-02: structured emit. The fallback path is operationally OK
    // (PDF still renders), so this is a `warn` not an `error`.
    const { logStructured } = await import('../../observability/structured-log.js');
    logStructured('warn', 'PDF_FONT_FALLBACK', {
      reason: 'noto_assets_missing',
      missing: missing.join(','),
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load the report font family into a freshly created PDFDocument. The
 * caller must pass a PDFDocument instance; we handle fontkit registration
 * and the fallback path internally.
 */
export async function loadReportFonts(pdf: PDFDocument): Promise<ReportFonts> {
  await ensureBuffersLoaded();

  if (unicodeAvailable && cachedBuffers) {
    // Lazy-import fontkit so the legacy fallback path does not pay for it.
    let fontkit: unknown;
    try {
      const mod = await import('@pdf-lib/fontkit');
      fontkit = (mod as { default?: unknown }).default ?? mod;
    } catch (err) {
      // @pdf-lib/fontkit is a declared dependency; if it is missing we have
      // a deployment integrity issue. Fall through to the StandardFonts path.
      const { logStructured, tagFromError } = await import('../../observability/structured-log.js');
      logStructured('warn', 'PDF_FONT_FALLBACK', {
        reason: 'fontkit_unavailable',
        errorTag: tagFromError(err) ?? 'unknown',
      });
      return loadStandardFonts(pdf);
    }
    try {
      // `registerFontkit` is mandatory before embedding custom TTFs.
      (pdf as unknown as { registerFontkit: (k: unknown) => void }).registerFontkit(fontkit);
      const [regular, bold, italic] = await Promise.all([
        pdf.embedFont(cachedBuffers.regular, { subset: true }),
        pdf.embedFont(cachedBuffers.bold,    { subset: true }),
        pdf.embedFont(cachedBuffers.italic,  { subset: true }),
      ]);
      return { regular, bold, italic, unicodeCapable: true };
    } catch (err) {
      const { logStructured, tagFromError } = await import('../../observability/structured-log.js');
      logStructured('warn', 'PDF_FONT_FALLBACK', {
        reason: 'noto_embed_failed',
        errorTag: tagFromError(err) ?? 'unknown',
      });
      return loadStandardFonts(pdf);
    }
  }

  return loadStandardFonts(pdf);
}

async function loadStandardFonts(pdf: PDFDocument): Promise<ReportFonts> {
  const [regular, bold, italic] = await Promise.all([
    pdf.embedFont(StandardFonts.Helvetica),
    pdf.embedFont(StandardFonts.HelveticaBold),
    pdf.embedFont(StandardFonts.HelveticaOblique),
  ]);
  return { regular, bold, italic, unicodeCapable: false };
}

/**
 * WinAnsi-safe text sanitiser. Replaces characters outside the Latin-1
 * encoding range with a printable approximation. Only needed when the
 * fallback StandardFonts path is active.
 */
export function sanitiseForWinAnsi(text: string): string {
  if (!text) return '';
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u2022/g, '*')
    .replace(/[\u2190-\u21FF]/g, '->') // arrows
    .replace(/[\u2265]/g, '>=')
    .replace(/[\u2264]/g, '<=')
    .replace(/[\u00B1]/g, '+/-')
    .replace(/[^\x00-\x7F\u00A0-\u00FF]/g, '?');
}

/**
 * Text-preparation helper that the primitives layer calls instead of deciding
 * case-by-case. In Unicode mode we pass text through untouched; in fallback
 * we sanitise.
 */
export function prepareText(text: string, fonts: ReportFonts): string {
  if (text == null) return '';
  if (fonts.unicodeCapable) return String(text);
  return sanitiseForWinAnsi(String(text));
}
