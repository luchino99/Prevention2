/**
 * Low-level drawing primitives for the clinical PDF renderer.
 *
 * The primitives are intentionally *stateful* around a `RenderCtx.cursorY`:
 * higher-level sections call them sequentially and let the layout flow down
 * the page, with `ensureSpace` auto-paginating when needed.
 *
 * Every primitive:
 *   - Sanitises / prepares text via `prepareText` so the WinAnsi fallback
 *     path never throws on unexpected glyphs.
 *   - Is page-break safe: callers do not have to manually add a page.
 *   - Never mutates the document metadata.
 *
 * NOTE: We deliberately do NOT implement rounded corners. pdf-lib's
 * `drawRectangle` supports `borderRadius` only on recent versions; we stick to
 * straight edges for the broadest compatibility.
 */

import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from 'pdf-lib';
import type { RGB } from 'pdf-lib';
import { BOX, COLOR, CONTENT_WIDTH, LINE_HEIGHT, PAGE, SPACING, TYPE } from './pdf-tokens.js';
import type { ReportFonts } from './font-loader.js';
import { prepareText } from './font-loader.js';

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

export interface RenderCtx {
  pdf: PDFDocument;
  page: PDFPage;
  pageIndex: number;
  fonts: ReportFonts;
  cursorY: number;
  /**
   * Optional callback invoked every time a new page is pushed. Used by the
   * document orchestrator to redraw persistent elements (page header band).
   */
  onNewPage?: (ctx: RenderCtx) => void;
}

export function createCtx(
  pdf: PDFDocument,
  fonts: ReportFonts,
  onNewPage?: (ctx: RenderCtx) => void,
): RenderCtx {
  const page = pdf.addPage([PAGE.width, PAGE.height]);
  const ctx: RenderCtx = {
    pdf,
    page,
    pageIndex: 0,
    fonts,
    cursorY: PAGE.height - PAGE.marginTop,
    onNewPage,
  };
  if (onNewPage) onNewPage(ctx);
  return ctx;
}

export function newPage(ctx: RenderCtx): void {
  ctx.page = ctx.pdf.addPage([PAGE.width, PAGE.height]);
  ctx.pageIndex += 1;
  ctx.cursorY = PAGE.height - PAGE.marginTop;
  if (ctx.onNewPage) ctx.onNewPage(ctx);
}

export function ensureSpace(ctx: RenderCtx, needed: number): void {
  if (ctx.cursorY - needed < PAGE.marginBottom) newPage(ctx);
}

/**
 * Atomic-section guard.
 *
 * Forces a page break BEFORE the section is rendered if the remaining
 * vertical space on the current page is below `minHeight`. This solves
 * the "orphan section title" failure mode where a `sectionTitle()`
 * draws near the bottom of a page, then the section's first card
 * triggers `newPage()` from inside `drawBandedCard`, leaving the title
 * stranded alone above a page break.
 *
 * Sizing rule of thumb (pass as `minHeight`):
 *   - the height of the section title block (~ 28pt with the rule),
 *   - PLUS a generous reservation for the section's first
 *     "indivisible unit" (one banded card, one paragraph, one
 *     key-value triplet, etc).
 *
 * Intentional non-goals:
 *   - This primitive does NOT keep the entire section on one page.
 *     For long sections (e.g. recommendations, screenings) doing so
 *     would force unnecessary page breaks. Individual cards remain
 *     responsible for their own page-break safety via the
 *     `estimatedHeight` they hand to `drawBandedCard`.
 *   - This primitive does NOT undo drawing — pdf-lib has no rollback.
 *     The caller MUST invoke this BEFORE drawing anything for the
 *     section.
 *
 * Pure side-effect on `ctx`: either no-op, or a single `newPage`.
 */
export function beginAtomicSection(
  ctx: RenderCtx,
  opts: { minHeight?: number } = {},
): void {
  const min = opts.minHeight ?? 140;
  if (ctx.cursorY - PAGE.marginBottom < min) {
    newPage(ctx);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Text primitives
// ─────────────────────────────────────────────────────────────────────────────

export interface TextStyle {
  size?: number;
  font?: 'regular' | 'bold' | 'italic';
  color?: RGB;
  lineHeight?: number; // multiplier applied to size
}

function pickFont(fonts: ReportFonts, which: TextStyle['font']): PDFFont {
  switch (which) {
    case 'bold':   return fonts.bold;
    case 'italic': return fonts.italic;
    default:       return fonts.regular;
  }
}

export function textWidth(fonts: ReportFonts, text: string, style: TextStyle = {}): number {
  const size = style.size ?? TYPE.body;
  const font = pickFont(fonts, style.font);
  return font.widthOfTextAtSize(prepareText(text, fonts), size);
}

/**
 * Draw a single line at `x, cursorY`. Does NOT wrap. Advances the cursor.
 */
export function drawLine(
  ctx: RenderCtx,
  text: string,
  opts: TextStyle & { x?: number } = {},
): void {
  const size = opts.size ?? TYPE.body;
  const lh = (opts.lineHeight ?? LINE_HEIGHT.normal) * size;
  ensureSpace(ctx, lh);
  const font = pickFont(ctx.fonts, opts.font);
  ctx.page.drawText(prepareText(text, ctx.fonts), {
    x: opts.x ?? PAGE.marginX,
    y: ctx.cursorY - size,
    size,
    font,
    color: opts.color ?? COLOR.text,
  });
  ctx.cursorY -= lh;
}

/**
 * Greedy word-wrap. Splits on whitespace, measures each candidate line with
 * the active font, and emits lines via `drawLine`. Returns the total height
 * consumed so callers can pre-reserve space.
 */
export function drawWrapped(
  ctx: RenderCtx,
  text: string,
  maxWidth: number,
  opts: TextStyle & { x?: number } = {},
): number {
  const size = opts.size ?? TYPE.body;
  const font = pickFont(ctx.fonts, opts.font);
  const startY = ctx.cursorY;
  const prepared = prepareText(text, ctx.fonts);
  const words = prepared.split(/\s+/).filter(Boolean);
  let line = '';
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    const width = font.widthOfTextAtSize(candidate, size);
    if (width > maxWidth && line) {
      drawLine(ctx, line, opts);
      line = w;
    } else {
      line = candidate;
    }
  }
  if (line) drawLine(ctx, line, opts);
  return startY - ctx.cursorY;
}

/**
 * Estimate the height a piece of text will consume if rendered via drawWrapped.
 * Does not mutate the cursor — useful for "does this fit" checks before
 * committing to a card render.
 */
export function measureWrapped(
  fonts: ReportFonts,
  text: string,
  maxWidth: number,
  opts: TextStyle = {},
): number {
  const size = opts.size ?? TYPE.body;
  const lh = (opts.lineHeight ?? LINE_HEIGHT.normal) * size;
  const font = pickFont(fonts, opts.font);
  const prepared = prepareText(text, fonts);
  const words = prepared.split(/\s+/).filter(Boolean);
  let line = '';
  let lines = 0;
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      lines += 1;
      line = w;
    } else {
      line = candidate;
    }
  }
  if (line) lines += 1;
  return lines * lh;
}

// ─────────────────────────────────────────────────────────────────────────────
// Graphic primitives
// ─────────────────────────────────────────────────────────────────────────────

export function hrule(
  ctx: RenderCtx,
  opts: { color?: RGB; thickness?: number; marginTop?: number; marginBottom?: number } = {},
): void {
  const mt = opts.marginTop ?? SPACING.xs;
  const mb = opts.marginBottom ?? SPACING.xs;
  ensureSpace(ctx, mt + mb + 1);
  ctx.cursorY -= mt;
  ctx.page.drawLine({
    start: { x: PAGE.marginX, y: ctx.cursorY },
    end:   { x: PAGE.width - PAGE.marginX, y: ctx.cursorY },
    thickness: opts.thickness ?? 0.5,
    color: opts.color ?? COLOR.divider,
  });
  ctx.cursorY -= mb;
}

export function verticalGap(ctx: RenderCtx, amount: number): void {
  ctx.cursorY -= amount;
}

export function drawRect(
  ctx: RenderCtx,
  opts: { x: number; y: number; w: number; h: number; fill?: RGB; stroke?: RGB; strokeWidth?: number },
): void {
  ctx.page.drawRectangle({
    x: opts.x,
    y: opts.y,
    width: opts.w,
    height: opts.h,
    color: opts.fill,
    borderColor: opts.stroke,
    borderWidth: opts.strokeWidth ?? (opts.stroke ? BOX.strokeWidth : 0),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Composite primitives (pill / badge / key-value row / labelled card)
// ─────────────────────────────────────────────────────────────────────────────

export function pillWidth(
  fonts: ReportFonts,
  text: string,
  opts: { size?: number; padX?: number } = {},
): number {
  const size = opts.size ?? TYPE.label;
  const padX = opts.padX ?? 5;
  return fonts.bold.widthOfTextAtSize(prepareText(text, fonts), size) + padX * 2;
}

/**
 * Draw a solid-fill pill at (x, baselineY). Returns the right-edge x of the
 * pill so callers can chain multiple pills inline. Does NOT advance the cursor.
 */
export function drawPill(
  ctx: RenderCtx,
  text: string,
  opts: { x: number; baselineY: number; fill: RGB; ink: RGB; size?: number; padX?: number; padY?: number },
): number {
  const size = opts.size ?? TYPE.label;
  const padX = opts.padX ?? 5;
  const padY = opts.padY ?? 2;
  const prepared = prepareText(text, ctx.fonts);
  const w = ctx.fonts.bold.widthOfTextAtSize(prepared, size) + padX * 2;
  const h = size + padY * 2;
  ctx.page.drawRectangle({
    x: opts.x,
    y: opts.baselineY - padY,
    width: w,
    height: h,
    color: opts.fill,
  });
  ctx.page.drawText(prepared, {
    x: opts.x + padX,
    y: opts.baselineY,
    size,
    font: ctx.fonts.bold,
    color: opts.ink,
  });
  return opts.x + w;
}

/**
 * Single key/value row aligned to a shared label column.
 */
export function drawKeyValue(
  ctx: RenderCtx,
  label: string,
  value: string,
  opts: { labelColWidth?: number; valueFont?: TextStyle['font']; valueColor?: RGB; size?: number } = {},
): void {
  const size = opts.size ?? TYPE.body;
  const lh = LINE_HEIGHT.normal * size;
  const labelW = opts.labelColWidth ?? 135;
  ensureSpace(ctx, lh);
  ctx.page.drawText(prepareText(label, ctx.fonts), {
    x: PAGE.marginX,
    y: ctx.cursorY - size,
    size: TYPE.label,
    font: ctx.fonts.bold,
    color: COLOR.muted,
  });
  ctx.page.drawText(prepareText(value || '—', ctx.fonts), {
    x: PAGE.marginX + labelW,
    y: ctx.cursorY - size,
    size,
    font: pickFont(ctx.fonts, opts.valueFont),
    color: opts.valueColor ?? COLOR.text,
  });
  ctx.cursorY -= lh;
}

// ─────────────────────────────────────────────────────────────────────────────
// Header / footer (called by the orchestrator on every new page)
// ─────────────────────────────────────────────────────────────────────────────

export interface PageHeaderOpts {
  tenantName: string;
  title: string;
  subtitle?: string;
}

/**
 * Draw the top-of-page brand band. Called by the orchestrator on every new
 * page so pagination preserves the clinical identity.
 */
export function drawPageHeader(ctx: RenderCtx, opts: PageHeaderOpts): void {
  const bandH = 48;
  const y = PAGE.height - bandH;
  // Brand band fill
  ctx.page.drawRectangle({
    x: 0,
    y,
    width: PAGE.width,
    height: bandH,
    color: COLOR.brandBand,
  });
  // Brand left accent
  ctx.page.drawRectangle({
    x: 0,
    y,
    width: 4,
    height: bandH,
    color: COLOR.brandInk,
  });
  // Tenant name
  ctx.page.drawText(prepareText(opts.tenantName, ctx.fonts), {
    x: PAGE.marginX,
    y: y + bandH - 18,
    size: TYPE.displayTitle,
    font: ctx.fonts.bold,
    color: COLOR.brandInk,
  });
  // Document title (right aligned)
  const titleText = prepareText(opts.title, ctx.fonts);
  const titleW = ctx.fonts.regular.widthOfTextAtSize(titleText, TYPE.displaySub);
  ctx.page.drawText(titleText, {
    x: PAGE.width - PAGE.marginX - titleW,
    y: y + bandH - 18,
    size: TYPE.displaySub,
    font: ctx.fonts.regular,
    color: COLOR.text,
  });
  if (opts.subtitle) {
    const subText = prepareText(opts.subtitle, ctx.fonts);
    const subW = ctx.fonts.regular.widthOfTextAtSize(subText, TYPE.label);
    ctx.page.drawText(subText, {
      x: PAGE.width - PAGE.marginX - subW,
      y: y + bandH - 34,
      size: TYPE.label,
      font: ctx.fonts.regular,
      color: COLOR.muted,
    });
  }
  // Push cursor below the band + a small gap.
  ctx.cursorY = Math.min(ctx.cursorY, y - SPACING.md);
}

export interface PageFooterOpts {
  tenantName: string;
  reportId: string;
  generatedAt: string;
  pageIndex: number;
  totalPages: number;
}

/**
 * Called ONCE at the end of rendering, iterating every page, to stamp the
 * page number + audit line. Drawing footers per page during the main flow
 * is harder because we do not yet know the total page count.
 */
export function drawAllFooters(pdf: PDFDocument, fonts: ReportFonts, opts: Omit<PageFooterOpts, 'pageIndex' | 'totalPages'>): void {
  const total = pdf.getPageCount();
  for (let i = 0; i < total; i++) {
    const page = pdf.getPage(i);
    const line1 =
      `${opts.tenantName} · Confidential clinical document · Report ${opts.reportId}`;
    const line2 =
      `Generated ${opts.generatedAt}  ·  Page ${i + 1} / ${total}  ·  ` +
      `Contains validated deterministic scores. Any AI commentary is supportive and non-authoritative.`;
    const prepared1 = prepareText(line1, fonts);
    const prepared2 = prepareText(line2, fonts);
    // Hairline above the footer
    page.drawLine({
      start: { x: PAGE.marginX, y: 44 },
      end:   { x: PAGE.width - PAGE.marginX, y: 44 },
      thickness: 0.4,
      color: COLOR.divider,
    });
    page.drawText(prepared1, {
      x: PAGE.marginX,
      y: 32,
      size: TYPE.microCaption,
      font: fonts.bold,
      color: COLOR.muted,
    });
    page.drawText(prepared2, {
      x: PAGE.marginX,
      y: 22,
      size: TYPE.microCaption,
      font: fonts.regular,
      color: COLOR.muted,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Section & card helpers
// ─────────────────────────────────────────────────────────────────────────────

export function sectionTitle(ctx: RenderCtx, text: string): void {
  ensureSpace(ctx, TYPE.sectionTitle * 2);
  ctx.cursorY -= SPACING.sm;
  ctx.page.drawText(prepareText(text, ctx.fonts), {
    x: PAGE.marginX,
    y: ctx.cursorY - TYPE.sectionTitle,
    size: TYPE.sectionTitle,
    font: ctx.fonts.bold,
    color: COLOR.brandInk,
  });
  ctx.cursorY -= TYPE.sectionTitle + SPACING.xs;
  // Accent rule beneath the title
  ctx.page.drawLine({
    start: { x: PAGE.marginX, y: ctx.cursorY },
    end:   { x: PAGE.marginX + 32, y: ctx.cursorY },
    thickness: 1.4,
    color: COLOR.brandInk,
  });
  ctx.page.drawLine({
    start: { x: PAGE.marginX + 34, y: ctx.cursorY },
    end:   { x: PAGE.width - PAGE.marginX, y: ctx.cursorY },
    thickness: 0.4,
    color: COLOR.divider,
  });
  ctx.cursorY -= SPACING.sm;
}

/**
 * A box with a coloured top band, used for domain risk cards and alert cards.
 * `content` is executed with the cursor temporarily positioned inside the
 * padded interior; when it returns we close the box at the new cursorY.
 *
 * The box auto-paginates if the estimated content does not fit; callers are
 * expected to pre-measure for tight layouts by calling `measureWrapped`.
 */
export function drawBandedCard(
  ctx: RenderCtx,
  opts: { bandColor: RGB; stroke?: RGB; estimatedHeight?: number },
  content: (innerWidth: number) => void,
): void {
  const estH = opts.estimatedHeight ?? 60;
  ensureSpace(ctx, estH + BOX.bandHeight + BOX.paddingY * 2);
  const topY = ctx.cursorY;
  const x = PAGE.marginX;
  const w = CONTENT_WIDTH;

  // Top colour band (drawn over placeholder; we'll resize the outer border
  // below once content is rendered).
  ctx.page.drawRectangle({ x, y: topY - BOX.bandHeight, width: w, height: BOX.bandHeight, color: opts.bandColor });

  // Content starts below the band + padding
  ctx.cursorY = topY - BOX.bandHeight - BOX.paddingY;
  content(w - BOX.paddingX * 2);

  const bottomY = ctx.cursorY - BOX.paddingY;
  // Outer border
  ctx.page.drawRectangle({
    x,
    y: bottomY,
    width: w,
    height: topY - bottomY,
    borderColor: opts.stroke ?? COLOR.line,
    borderWidth: BOX.strokeWidth,
  });
  ctx.cursorY = bottomY - SPACING.md;
}

// Re-export `rgb` for callers wanting ad-hoc colours — spares them a second
// import line.
export { rgb, StandardFonts };
