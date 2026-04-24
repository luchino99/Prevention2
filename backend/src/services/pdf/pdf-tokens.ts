/**
 * PDF design tokens — single source of truth for the clinical report layout.
 *
 * These values are intentionally kept small, strongly-typed, and mirror the
 * web design tokens in `frontend/assets/css/app.css` where it makes sense, so
 * a clinician sees the same palette whether they read the report on screen
 * or on paper.
 *
 * All values are in PDF points (1 pt = 1/72 inch).
 *
 * Do NOT put anything here that depends on pdf-lib primitives — this file
 * must stay framework-agnostic and cheap to import.
 */
import { rgb } from 'pdf-lib';

// ─────────────────────────────────────────────────────────────────────────────
// Page geometry — ISO A4
// ─────────────────────────────────────────────────────────────────────────────

export const PAGE = Object.freeze({
  width: 595.28,
  height: 841.89,
  marginX: 48,
  marginTop: 60,
  marginBottom: 60,
  gutter: 16,
});

// Inner content width (right - left margin).
export const CONTENT_WIDTH = PAGE.width - 2 * PAGE.marginX;

// ─────────────────────────────────────────────────────────────────────────────
// Type scale — in points
// ─────────────────────────────────────────────────────────────────────────────

export const TYPE = Object.freeze({
  displayTitle:   16,   // document title in header band
  displaySub:     11,   // subtitle line in header band
  sectionTitle:   12,   // section heading
  cardTitle:      10.5, // card / table row title
  body:           10,   // primary body text
  label:           9,   // K/V labels, small captions
  microCaption:    7.5, // legal footer, page numbers
});

// Line-height multipliers applied per style (absolute = size * lh).
export const LINE_HEIGHT = Object.freeze({
  tight:   1.15,
  normal:  1.35,
  loose:   1.55,
});

// ─────────────────────────────────────────────────────────────────────────────
// Spacing — all multiples of the 4-pt grid
// ─────────────────────────────────────────────────────────────────────────────

export const SPACING = Object.freeze({
  xxs:  2,
  xs:   4,
  sm:   8,
  md:  12,
  lg:  16,
  xl:  24,
  xxl: 32,
  section: 20,
});

// Card / box visuals
export const BOX = Object.freeze({
  radius: 4,
  strokeWidth: 0.6,
  paddingX: 10,
  paddingY: 8,
  bandHeight: 4, // decorative top band on domain cards
});

// ─────────────────────────────────────────────────────────────────────────────
// Colour palette
// ─────────────────────────────────────────────────────────────────────────────
//
// All colours below are WCAG-AA compliant on white paper. The *band* values
// are the pale fills used behind cards; the *ink* values are the labels/lines.
// Keep the domain hues aligned with frontend/assets/css/app.css.
// ─────────────────────────────────────────────────────────────────────────────

export const COLOR = Object.freeze({
  // Structural
  brandInk:  rgb(0.13, 0.31, 0.55),   // deep blue
  brandBand: rgb(0.88, 0.93, 0.98),   // very pale brand tint
  text:      rgb(0.13, 0.13, 0.13),
  textSoft:  rgb(0.33, 0.33, 0.33),
  muted:     rgb(0.45, 0.45, 0.45),
  line:      rgb(0.82, 0.85, 0.88),
  lineFaint: rgb(0.90, 0.92, 0.95),
  paper:     rgb(1, 1, 1),
  panelBg:   rgb(0.974, 0.978, 0.984),
  divider:   rgb(0.88, 0.90, 0.93),

  // Severity — fills (for band / pill background) and inks (for text)
  okInk:         rgb(0.11, 0.45, 0.26),
  okBand:        rgb(0.90, 0.96, 0.91),
  warnInk:       rgb(0.67, 0.42, 0.04),
  warnBand:      rgb(0.99, 0.94, 0.82),
  dangerInk:     rgb(0.70, 0.11, 0.11),
  dangerBand:    rgb(0.99, 0.89, 0.87),
  indeterminate: rgb(0.38, 0.38, 0.42),
  indetermBand:  rgb(0.93, 0.93, 0.94),

  // Domain accents (match the WS2 chart palette)
  cardiovascular: rgb(0.098, 0.443, 0.760),  // #1971c2
  metabolic:      rgb(0.439, 0.282, 0.910),  // #7048e8
  renal:          rgb(0.047, 0.655, 0.470),  // #0ca678
  hepatic:        rgb(0.839, 0.200, 0.412),  // #d6336c
  frailty:        rgb(0.396, 0.471, 0.561),  // #65758f
  lifestyle:      rgb(0.184, 0.620, 0.267),  // #2f9e44
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Severity → { ink, band } colour pair. Tolerant of legacy level strings
 * emitted by the engine:
 *   - RiskLevel: 'low' | 'moderate' | 'high' | 'very_high' | 'indeterminate'
 *   - AlertSeverity: 'info' | 'warning' | 'critical'
 *   - Priority: 'routine' | 'moderate' | 'urgent'
 */
export function severityPalette(level: string): { ink: ReturnType<typeof rgb>; band: ReturnType<typeof rgb> } {
  switch ((level ?? '').toLowerCase()) {
    case 'critical':
    case 'very_high':
    case 'high':
    case 'urgent':
      return { ink: COLOR.dangerInk, band: COLOR.dangerBand };
    case 'warning':
    case 'moderate':
      return { ink: COLOR.warnInk, band: COLOR.warnBand };
    case 'info':
    case 'low':
    case 'routine':
      return { ink: COLOR.okInk, band: COLOR.okBand };
    case 'indeterminate':
    default:
      return { ink: COLOR.indeterminate, band: COLOR.indetermBand };
  }
}

/** Domain → accent colour. Falls back to `brandInk` for unknown keys. */
export function domainAccent(key: string): ReturnType<typeof rgb> {
  const k = (key ?? '').toLowerCase();
  if (k === 'cardiovascular') return COLOR.cardiovascular;
  if (k === 'metabolic')      return COLOR.metabolic;
  if (k === 'renal')          return COLOR.renal;
  if (k === 'hepatic')        return COLOR.hepatic;
  if (k === 'frailty')        return COLOR.frailty;
  if (k === 'lifestyle')      return COLOR.lifestyle;
  return COLOR.brandInk;
}
