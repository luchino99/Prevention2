/**
 * PDF Report Service.
 *
 * Renders a `ReportPayload` (AssessmentSnapshot + tenant/patient/clinician
 * display metadata produced by `assessment-service.ts::buildReportPayload`)
 * into a professional A4 PDF suitable for clinician archival and patient
 * handover.
 *
 * Runtime: pure TypeScript (pdf-lib, no native deps), Vercel-serverless-ready.
 *
 * Layout (blueprint §8.4):
 *   1. Header            — tenant name, report type
 *   2. Patient block     — pseudonymous reference, demographics, external code
 *   3. Assessment meta   — assessment id, created at, clinician, composite risk
 *   4. Composite risk    — per-domain breakdown with reasoning
 *   5. Validated scores  — every computed score with category + value
 *   6. Lifestyle         — PREDIMED, activity, smoking
 *   7. Alerts (if any)   — severity-coloured
 *   8. Follow-up plan    — next review, actions, domain monitoring
 *   9. Required screenings
 *  10. Footer            — generation timestamp, pagination, disclaimer
 *
 * The PDF is byte-stable for a given canonical input (modulo the footer
 * timestamp) because all substance comes from the deterministic engine.
 *
 * Dependency: `pdf-lib` (package.json: "pdf-lib": "^1.17.1")
 */

import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from 'pdf-lib';
import type { ReportPayload } from './assessment-service';
import type { AssessmentSnapshot } from '../../../shared/types/clinical';

// ---------------------------------------------------------------------------
// Page geometry
// ---------------------------------------------------------------------------

const PAGE_WIDTH = 595.28; // A4 width in points
const PAGE_HEIGHT = 841.89; // A4 height in points
const MARGIN_X = 50;
const MARGIN_TOP = 60;
const MARGIN_BOTTOM = 60;
const LINE_HEIGHT = 14;
const SECTION_GAP = 18;

// ---------------------------------------------------------------------------
// Palette (WCAG-AA contrast against white)
// ---------------------------------------------------------------------------

const COLOR_PRIMARY = rgb(0.13, 0.31, 0.55); // deep blue
const COLOR_TEXT = rgb(0.13, 0.13, 0.13);
const COLOR_MUTED = rgb(0.45, 0.45, 0.45);
const COLOR_DANGER = rgb(0.78, 0.16, 0.16);
const COLOR_WARNING = rgb(0.83, 0.55, 0.10);
const COLOR_OK = rgb(0.16, 0.55, 0.30);

// ---------------------------------------------------------------------------
// Rendering context
// ---------------------------------------------------------------------------

interface RenderCtx {
  pdf: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  fontBold: PDFFont;
  cursorY: number;
}

function ensureSpace(ctx: RenderCtx, needed: number): void {
  if (ctx.cursorY - needed < MARGIN_BOTTOM) {
    ctx.page = ctx.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    ctx.cursorY = PAGE_HEIGHT - MARGIN_TOP;
  }
}

function drawText(
  ctx: RenderCtx,
  text: string,
  opts: { bold?: boolean; size?: number; color?: ReturnType<typeof rgb>; x?: number } = {},
): void {
  const size = opts.size ?? 10;
  const font = opts.bold ? ctx.fontBold : ctx.font;
  const color = opts.color ?? COLOR_TEXT;
  const x = opts.x ?? MARGIN_X;
  ensureSpace(ctx, size + 2);
  ctx.page.drawText(sanitize(text), {
    x,
    y: ctx.cursorY,
    size,
    font,
    color,
  });
  ctx.cursorY -= size + 4;
}

function drawHeading(ctx: RenderCtx, text: string): void {
  ctx.cursorY -= SECTION_GAP / 2;
  drawText(ctx, text, { bold: true, size: 13, color: COLOR_PRIMARY });
  drawHr(ctx);
  ctx.cursorY -= 4;
}

function drawHr(ctx: RenderCtx): void {
  ctx.page.drawLine({
    start: { x: MARGIN_X, y: ctx.cursorY + 2 },
    end: { x: PAGE_WIDTH - MARGIN_X, y: ctx.cursorY + 2 },
    thickness: 0.6,
    color: COLOR_PRIMARY,
  });
  ctx.cursorY -= 6;
}

function drawKv(ctx: RenderCtx, label: string, value: string): void {
  ensureSpace(ctx, LINE_HEIGHT);
  ctx.page.drawText(sanitize(label) + ':', {
    x: MARGIN_X,
    y: ctx.cursorY,
    size: 9,
    font: ctx.fontBold,
    color: COLOR_MUTED,
  });
  ctx.page.drawText(sanitize(value), {
    x: MARGIN_X + 140,
    y: ctx.cursorY,
    size: 10,
    font: ctx.font,
    color: COLOR_TEXT,
  });
  ctx.cursorY -= LINE_HEIGHT;
}

/**
 * Colour mapping that is tolerant of any legacy level string. The engine
 * currently emits 'low' | 'moderate' | 'high' | 'very_high' for risk levels
 * and 'info' | 'warning' | 'critical' for alert severities.
 */
function severityColor(level: string): ReturnType<typeof rgb> {
  switch (level.toLowerCase()) {
    case 'critical':
    case 'very_high':
    case 'high':
      return COLOR_DANGER;
    case 'warning':
    case 'moderate':
      return COLOR_WARNING;
    case 'info':
    case 'low':
    default:
      return COLOR_OK;
  }
}

/**
 * Strip characters that the StandardFonts (WinAnsi) cannot encode. pdf-lib
 * throws on unsupported glyphs (some Unicode). Clinical notes may contain
 * smart-quotes, em-dashes, etc.
 */
function sanitize(text: string): string {
  if (!text) return '';
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[^\x00-\x7F\u00A0-\u00FF]/g, '?');
}

function drawWrapped(
  ctx: RenderCtx,
  text: string,
  maxWidth: number,
  size = 10,
  color: ReturnType<typeof rgb> = COLOR_TEXT,
): void {
  const words = sanitize(text).split(/\s+/);
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    const w = ctx.font.widthOfTextAtSize(candidate, size);
    if (w > maxWidth && line) {
      drawText(ctx, line, { size, color });
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) drawText(ctx, line, { size, color });
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') {
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }
  return String(v);
}

function formatIsoDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

function formatIsoDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  } catch {
    return iso;
  }
}

/**
 * Resolve a patient display string that NEVER leaks personal data beyond what
 * the caller already stored. We prefer the pseudonymous `externalCode`, then
 * the tenant-provided `displayName`, then a composed name only if the schema
 * explicitly captured first+last (blueprint §3.2: data minimization).
 */
function resolvePatientReference(patient: ReportPayload['patient']): string {
  if (patient.externalCode) return patient.externalCode;
  if (patient.displayName) return patient.displayName;
  const composed = `${patient.firstName ?? ''} ${patient.lastName ?? ''}`.trim();
  return composed || '—';
}

function resolvePatientAge(snapshot: AssessmentSnapshot, patient: ReportPayload['patient']): string {
  if (typeof snapshot.input.demographics.age === 'number') {
    return `${snapshot.input.demographics.age} years`;
  }
  if (patient.birthYear) {
    const now = new Date().getUTCFullYear();
    return `${now - patient.birthYear} years (derived)`;
  }
  return '—';
}

// ---------------------------------------------------------------------------
// Public renderer
// ---------------------------------------------------------------------------

export async function renderAssessmentReportPdf(
  payload: ReportPayload,
): Promise<Uint8Array> {
  const { snapshot, patient, tenant, clinician } = payload;

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Clinical Assessment Report — ${snapshot.assessment.id}`);
  pdf.setCreator('Uelfy Clinical Platform');
  pdf.setProducer('Uelfy / pdf-lib');
  pdf.setCreationDate(new Date());
  pdf.setModificationDate(new Date());

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const ctx: RenderCtx = {
    pdf,
    page,
    font,
    fontBold,
    cursorY: PAGE_HEIGHT - MARGIN_TOP,
  };

  // ─── 1. Header ───
  drawText(ctx, tenant.name ?? 'Clinical Assessment Report', {
    bold: true,
    size: 16,
    color: COLOR_PRIMARY,
  });
  drawText(ctx, 'Cardio-Nephro-Metabolic Risk Assessment', {
    size: 11,
    color: COLOR_MUTED,
  });
  drawHr(ctx);

  // ─── 2. Patient block ───
  drawHeading(ctx, 'Patient');
  drawKv(ctx, 'Reference', resolvePatientReference(patient));
  if (patient.firstName || patient.lastName) {
    drawKv(
      ctx,
      'Name',
      `${patient.firstName ?? ''} ${patient.lastName ?? ''}`.trim() || '—',
    );
  }
  drawKv(ctx, 'Date of birth', formatIsoDate(patient.birthDate));
  drawKv(ctx, 'Sex', patient.sex ?? snapshot.input.demographics.sex ?? '—');
  drawKv(ctx, 'Age', resolvePatientAge(snapshot, patient));

  // ─── 3. Assessment metadata ───
  drawHeading(ctx, 'Assessment');
  drawKv(ctx, 'Assessment ID', snapshot.assessment.id);
  drawKv(ctx, 'Performed at', formatIsoDateTime(snapshot.assessment.createdAt));
  drawKv(ctx, 'Status', snapshot.assessment.status ?? 'completed');
  drawKv(
    ctx,
    'Clinician',
    clinician?.fullName?.trim() || clinician?.email || '—',
  );
  drawKv(
    ctx,
    'Composite risk',
    `${formatValue(snapshot.compositeRisk.numeric)} (${snapshot.compositeRisk.level})`,
  );

  // ─── 4. Composite risk breakdown ───
  drawHeading(ctx, 'Composite risk breakdown');
  const domains: Array<{ key: string; label: string }> = [
    { key: 'cardiovascular', label: 'Cardiovascular' },
    { key: 'metabolic', label: 'Metabolic' },
    { key: 'hepatic', label: 'Hepatic' },
    { key: 'renal', label: 'Renal' },
    { key: 'frailty', label: 'Frailty' },
  ];
  for (const { key, label } of domains) {
    const domain = (snapshot.compositeRisk as Record<string, unknown>)[key] as
      | { level: string; reasoning: string }
      | null
      | undefined;
    if (!domain) continue;
    ensureSpace(ctx, LINE_HEIGHT * 2);
    drawText(ctx, `${label}: ${domain.level.toUpperCase()}`, {
      bold: true,
      size: 11,
      color: severityColor(domain.level),
    });
    if (domain.reasoning) {
      drawWrapped(ctx, domain.reasoning, PAGE_WIDTH - 2 * MARGIN_X, 10, COLOR_MUTED);
    }
    ctx.cursorY -= 2;
  }

  // ─── 5. Validated scores ───
  drawHeading(ctx, 'Validated clinical scores');
  if (snapshot.scoreResults.length === 0) {
    drawText(ctx, 'No scores computed.', { size: 10, color: COLOR_MUTED });
  }
  for (const score of snapshot.scoreResults) {
    ensureSpace(ctx, LINE_HEIGHT * 2);
    drawText(ctx, `${score.label} [${score.scoreCode}]`, { bold: true, size: 11 });
    drawText(ctx, `Value: ${formatValue(score.valueNumeric)}`, { size: 10 });
    if (score.category) {
      drawText(ctx, `Category: ${score.category}`, { size: 10, color: COLOR_MUTED });
    }
    ctx.cursorY -= 4;
  }

  // ─── 6. Lifestyle ───
  drawHeading(ctx, 'Lifestyle');
  drawKv(
    ctx,
    'PREDIMED',
    snapshot.nutritionSummary.predimedScore != null
      ? `${snapshot.nutritionSummary.predimedScore} (${snapshot.nutritionSummary.adherenceBand ?? '—'})`
      : '—',
  );
  drawKv(ctx, 'BMR', `${Math.round(snapshot.nutritionSummary.bmrKcal)} kcal/day`);
  drawKv(ctx, 'TDEE', `${Math.round(snapshot.nutritionSummary.tdeeKcal)} kcal/day`);
  drawKv(ctx, 'Activity level', snapshot.nutritionSummary.activityLevel);
  drawKv(
    ctx,
    'Physical activity',
    snapshot.activitySummary.minutesPerWeek != null
      ? `${snapshot.activitySummary.minutesPerWeek} min/week (${snapshot.activitySummary.qualitativeBand})`
      : '—',
  );
  drawKv(
    ctx,
    'WHO guidelines',
    snapshot.activitySummary.meetsWhoGuidelines ? 'Met' : 'Not met',
  );
  drawKv(
    ctx,
    'Sedentary risk',
    snapshot.activitySummary.sedentaryRiskLevel.toUpperCase(),
  );
  drawKv(ctx, 'Smoking', snapshot.input.clinicalContext.smoking ? 'Yes' : 'No');

  // ─── 7. Alerts ───
  if (snapshot.alerts.length > 0) {
    drawHeading(ctx, `Active alerts (${snapshot.alerts.length})`);
    for (const alert of snapshot.alerts) {
      ensureSpace(ctx, LINE_HEIGHT * 2);
      drawText(ctx, `[${alert.severity.toUpperCase()}] ${alert.title}`, {
        bold: true,
        size: 11,
        color: severityColor(alert.severity),
      });
      drawWrapped(ctx, alert.message, PAGE_WIDTH - 2 * MARGIN_X, 10);
      if (alert.timestamp) {
        drawText(ctx, `Raised: ${formatIsoDateTime(alert.timestamp)}`, {
          size: 8,
          color: COLOR_MUTED,
        });
      }
      ctx.cursorY -= 4;
    }
  }

  // ─── 8. Follow-up plan ───
  drawHeading(ctx, 'Follow-up plan');
  drawKv(ctx, 'Priority', snapshot.followupPlan.priorityLevel.toUpperCase());
  drawKv(
    ctx,
    'Next review',
    `${formatIsoDate(snapshot.followupPlan.nextReviewDate)} (${snapshot.followupPlan.intervalMonths} months)`,
  );
  if (snapshot.followupPlan.actions.length > 0) {
    drawText(ctx, 'Actions:', { bold: true, size: 10 });
    for (const action of snapshot.followupPlan.actions) {
      drawWrapped(
        ctx,
        `• ${action}`,
        PAGE_WIDTH - 2 * MARGIN_X - 12,
        10,
      );
    }
  }
  if (snapshot.followupPlan.domainMonitoring.length > 0) {
    ctx.cursorY -= 2;
    drawText(ctx, 'Domain monitoring:', { bold: true, size: 10 });
    for (const domain of snapshot.followupPlan.domainMonitoring) {
      drawText(ctx, `• ${domain}`, { size: 10 });
    }
  }

  // ─── 9. Required screenings ───
  if (snapshot.screenings.length > 0) {
    drawHeading(ctx, 'Required screenings');
    for (const s of snapshot.screenings) {
      ensureSpace(ctx, LINE_HEIGHT * 2);
      drawText(
        ctx,
        `• ${s.screening}  [${s.priority.toUpperCase()}${s.intervalMonths ? `, every ${s.intervalMonths} mo` : ''}]`,
        { size: 10, bold: true },
      );
      if (s.reason) {
        drawWrapped(
          ctx,
          `   ${s.reason}`,
          PAGE_WIDTH - 2 * MARGIN_X - 12,
          9,
          COLOR_MUTED,
        );
      }
    }
  }

  // ─── 10. Footer (every page) ───
  const totalPages = pdf.getPageCount();
  const generatedAt = new Date().toISOString();
  for (let i = 0; i < totalPages; i++) {
    const p = pdf.getPage(i);
    p.drawText(
      sanitize(
        `Generated ${generatedAt}  •  Page ${i + 1} / ${totalPages}  •  Confidential clinical document`,
      ),
      {
        x: MARGIN_X,
        y: 30,
        size: 8,
        font,
        color: COLOR_MUTED,
      },
    );
    p.drawText(
      sanitize(
        'Contains validated deterministic scores. Any AI-generated commentary is supportive and non-authoritative.',
      ),
      {
        x: MARGIN_X,
        y: 18,
        size: 7,
        font,
        color: COLOR_MUTED,
      },
    );
  }

  return await pdf.save();
}
