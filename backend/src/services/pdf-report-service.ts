/**
 * Clinical PDF Report Service — orchestrator.
 *
 * Renders a `ReportPayload` (AssessmentSnapshot + tenant/patient/clinician
 * display metadata produced by `assessment-service.ts::buildReportPayload`)
 * into a professional A4 PDF suitable for clinician archival and patient
 * handover.
 *
 * Runtime: pure TypeScript (pdf-lib + @pdf-lib/fontkit, no native deps),
 * Vercel-serverless-ready.
 *
 * Layout (blueprint §8.4):
 *   1. Brand header band (every page) — tenant name, document type
 *   2. Patient identification block — pseudonymous reference, demographics
 *   3. Assessment metadata block — id, timestamp, clinician, composite risk
 *   4. Composite risk breakdown — per-domain banded cards with reasoning
 *   5. Validated clinical scores — structured rows with category pill
 *   6. Lifestyle summary — PREDIMED, activity, sedentary, smoking
 *   7. Lifestyle recommendations — bounded, source-cited, priority-coloured
 *   8. Completeness warnings — missing-data caveats separated from alerts
 *   9. Active alerts — severity-coloured banded cards
 *  10. Follow-up plan — priority, next review, actions, domain monitoring
 *  11. Required screenings — priority-coloured, interval, source
 *  12. Footer (every page) — tenant, audit id, generation timestamp,
 *      pagination, non-authoritative-AI disclaimer
 *
 * Encoding
 *   The renderer embeds NotoSans via @pdf-lib/fontkit so text containing
 *   Unicode punctuation, accented names and clinical symbols (—, •, ≥, µ,
 *   °, ±, →) is preserved. If the TTF assets are missing at runtime we
 *   gracefully fall back to StandardFonts.Helvetica and run the sanitiser.
 *
 * Protected clinical logic
 *   The renderer performs zero numeric computation. Every value comes from
 *   the deterministic engine via the AssessmentSnapshot. No threshold
 *   re-interpretation, no AI enrichment, no rounding beyond display
 *   formatting.
 *
 * Dependencies (package.json):
 *   - "pdf-lib"            "^1.17.1"
 *   - "@pdf-lib/fontkit"   "^1.1.1"
 */

import { PDFDocument } from 'pdf-lib';
import type { ReportPayload } from './assessment-service.js';
import type {
  AssessmentSnapshot,
  PublicGuidelineRef,
} from '../../../shared/types/clinical.js';
import { collectReferenceFramework } from '../domain/clinical/guideline-catalog/index.js';

import { loadReportFonts } from './pdf/font-loader.js';
import {
  BOX,
  COLOR,
  CONTENT_WIDTH,
  LINE_HEIGHT,
  PAGE,
  SPACING,
  TYPE,
  domainAccent,
  severityPalette,
} from './pdf/pdf-tokens.js';
import {
  RenderCtx,
  beginAtomicBlock,
  beginAtomicSection,
  createCtx,
  drawAllFooters,
  drawBandedCard,
  drawKeyValue,
  drawLine,
  drawPageHeader,
  drawPill,
  drawWrapped,
  ensureSpace,
  hrule,
  measureWrapped,
  pillWidth,
  sectionTitle,
  textWidth,
  verticalGap,
} from './pdf/pdf-primitives.js';

// ───────────────────────────────────────────────────────────────────────────
// Public API
// ───────────────────────────────────────────────────────────────────────────

/**
 * Optional knobs surfaced for testability. Production callers never pass
 * these — production always uses the wall clock. The visual-regression
 * test (M-07) injects a fixed `generatedAt` so PDF byte output is
 * deterministic across runs and snapshot comparisons stay stable.
 */
export interface RenderOptions {
  /** Fixed timestamp used as Info dict CreationDate / ModDate. Default: new Date(). */
  generatedAt?: Date;
}

export async function renderAssessmentReportPdf(
  payload: ReportPayload,
  options: RenderOptions = {},
): Promise<Uint8Array> {
  const { snapshot, patient, tenant, clinician } = payload;
  const stamp = options.generatedAt ?? new Date();

  const pdf = await PDFDocument.create();

  // PDF Info dictionary — ASCII metadata always parseable via pdf-lib's
  // `getTitle / getCreator / getSubject / getKeywords / getAuthor /
  // getCreationDate`. We deliberately push payload identity markers
  // through these fields because the body content is CID-encoded
  // (NotoSans subset) and is NOT searchable as plain ASCII in the raw
  // byte stream.
  //
  // pdf-lib write-once / write-never matrix (v1.17.1):
  //   - Title, Creator, Author, Subject, Keywords  → writable, persist
  //   - CreationDate                               → writable, persists
  //   - ModificationDate                           → REWRITTEN to wall
  //                                                  clock by `.save()`,
  //                                                  no public opt-out
  //                                                  in this version
  //   - Producer                                   → REWRITTEN to lib
  //                                                  boilerplate by save
  //
  // To keep generated PDFs byte-deterministic when the caller pins
  // `generatedAt`, we therefore:
  //   1. Pin every writable timestamp field (CreationDate) to `stamp`.
  //   2. Embed a redundant, library-stable timestamp marker in the
  //      `Keywords` list as `generated-at:<ISO 8601>`. The visual-
  //      regression test asserts against this marker rather than
  //      ModificationDate, since the latter is not controllable.
  //   3. Use `stamp` for the per-page footer "Generated at" line so
  //      the rendered body bytes are identical across runs.
  pdf.setTitle(`Clinical Assessment Report — ${snapshot.assessment.id}`);
  pdf.setCreator('Uelfy Clinical Platform');
  pdf.setAuthor(tenant.name || 'Uelfy Clinical Tenant');
  pdf.setSubject(
    `Cardio-Nephro-Metabolic risk assessment · tenant=${tenant.name || 'unknown'} · `
    + `patient=${resolvePatientReference(patient)} · assessment=${snapshot.assessment.id}`,
  );
  pdf.setKeywords([
    'uelfy-clinical',
    'cardio-nephro-metabolic',
    `assessment-id:${snapshot.assessment.id}`,
    `patient-id:${snapshot.assessment.patientId}`,
    `tenant-id:${snapshot.assessment.tenantId}`,
    // Library-stable, deterministic timestamp marker. Mirrors the
    // intent of `setModificationDate` without relying on pdf-lib
    // honouring the value across `.save()`.
    `generated-at:${stamp.toISOString()}`,
  ]);
  pdf.setCreationDate(stamp);
  // Best-effort: in versions of pdf-lib that DON'T rewrite ModDate
  // this still produces a deterministic value. Where pdf-lib does
  // rewrite (current 1.17.1 behaviour), the redundant
  // `generated-at:<ISO>` keyword above carries the assertion load.
  pdf.setModificationDate(stamp);

  const fonts = await loadReportFonts(pdf);

  const headerOpts = {
    tenantName: tenant.name || 'Clinical Assessment',
    title: 'Cardio-Nephro-Metabolic Risk Assessment',
    subtitle: `Report · ${formatIsoDate(snapshot.assessment.createdAt)}`,
  };

  const ctx = createCtx(pdf, fonts, (c) => drawPageHeader(c, headerOpts));

  // ─── 1. Patient identification ───
  // 5 key-value rows × ~14pt + section title (~28pt) ≈ 100pt floor.
  beginAtomicSection(ctx, { minHeight: 110 });
  sectionTitle(ctx, 'Patient identification');
  drawKeyValue(ctx, 'Reference', resolvePatientReference(patient));
  const hasName = Boolean(patient.firstName || patient.lastName);
  if (hasName) {
    drawKeyValue(
      ctx,
      'Name',
      `${patient.firstName ?? ''} ${patient.lastName ?? ''}`.trim() || '—',
    );
  }
  drawKeyValue(ctx, 'Date of birth', formatIsoDate(patient.birthDate));
  drawKeyValue(
    ctx,
    'Sex',
    patient.sex ?? snapshot.input.demographics.sex ?? '—',
  );
  drawKeyValue(ctx, 'Age', resolvePatientAge(snapshot, patient));

  // ─── 2. Assessment metadata ───
  // 4 key-value rows + composite-risk headline + section title.
  beginAtomicSection(ctx, { minHeight: 160 });
  sectionTitle(ctx, 'Assessment');
  drawKeyValue(ctx, 'Assessment ID', snapshot.assessment.id);
  drawKeyValue(ctx, 'Performed at', formatIsoDateTime(snapshot.assessment.createdAt));
  drawKeyValue(ctx, 'Status', snapshot.assessment.status ?? 'completed');
  drawKeyValue(
    ctx,
    'Clinician',
    clinician?.fullName?.trim() || clinician?.email || '—',
  );

  // Composite risk — headline + pill
  renderCompositeHeadline(ctx, snapshot);

  // ─── 3. Composite risk breakdown ───
  renderDomainBreakdown(ctx, snapshot);

  // ─── 4. Validated scores ───
  renderValidatedScores(ctx, snapshot);

  // ─── 5. Lifestyle summary ───
  renderLifestyleSummary(ctx, snapshot);

  // ─── 6. Lifestyle recommendations (bounded, supportive) ───
  if (snapshot.lifestyleRecommendations?.length > 0) {
    renderLifestyleRecommendations(ctx, snapshot);
  }

  // ─── 7. Completeness warnings ───
  if (snapshot.completenessWarnings?.length > 0) {
    renderCompletenessWarnings(ctx, snapshot);
  }

  // ─── 8. Active alerts ───
  if (snapshot.alerts?.length > 0) {
    renderAlerts(ctx, snapshot);
  }

  // ─── 9. Follow-up plan ───
  renderFollowupPlan(ctx, snapshot);

  // ─── 10. Required screenings ───
  if (snapshot.screenings?.length > 0) {
    renderScreenings(ctx, snapshot);
  }

  // ─── 11. Reference framework (WS6 — source transparency) ───
  // Consolidated list of the guideline citations surfaced across the
  // three rule-engine outputs above. Silent no-op when no catalog-
  // resolved citations are present, so legacy assessments render
  // byte-identically.
  renderReferenceFramework(ctx, snapshot);

  // ─── Footer on every page ───
  // Use the same `stamp` as the Info dictionary so the rendered PDF
  // (footer text included) is fully deterministic when the caller pins
  // `generatedAt`. Without this, the wall-clock `new Date()` would
  // drift the byte stream by 19 characters every render and break the
  // visual-regression suite (M-07).
  drawAllFooters(pdf, fonts, {
    tenantName: tenant.name || 'Uelfy Clinical',
    reportId: snapshot.assessment.id,
    generatedAt: stamp.toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
  });

  // `pdf.save()` accepts only `useObjectStreams / addDefaultPage /
  // objectsPerTick` in pdf-lib 1.17.1 (the version pinned in package.json).
  // It also unconditionally rewrites `/ModDate` to `new Date()` and
  // `/Producer` to the library's own boilerplate during serialisation;
  // there is no public opt-out flag. Determinism for the timestamp is
  // therefore carried by:
  //   - `setCreationDate(stamp)` (pdf-lib does NOT rewrite CreationDate)
  //   - the `generated-at:<ISO>` entry in `setKeywords(...)` above
  // The tests assert against those two channels.
  return await pdf.save();
}

// ───────────────────────────────────────────────────────────────────────────
// Section renderers — each is pure-view over the snapshot
// ───────────────────────────────────────────────────────────────────────────

function renderCompositeHeadline(ctx: RenderCtx, snapshot: AssessmentSnapshot): void {
  verticalGap(ctx, SPACING.xs);
  ensureSpace(ctx, 40);
  const labelY = ctx.cursorY - TYPE.cardTitle;
  ctx.page.drawText('Composite risk', {
    x: PAGE.marginX,
    y: labelY,
    size: TYPE.label,
    font: ctx.fonts.bold,
    color: COLOR.muted,
  });

  const numericText = formatValue(snapshot.compositeRisk.numeric);
  const level = snapshot.compositeRisk.level;
  const { ink, band } = severityPalette(level);

  const valueX = PAGE.marginX + 135;
  const valueSize = TYPE.sectionTitle;
  ctx.page.drawText(numericText, {
    x: valueX,
    y: ctx.cursorY - valueSize,
    size: valueSize,
    font: ctx.fonts.bold,
    color: COLOR.text,
  });
  const valueW = ctx.fonts.bold.widthOfTextAtSize(numericText, valueSize);

  drawPill(ctx, level.replace('_', ' ').toUpperCase(), {
    x: valueX + valueW + SPACING.sm,
    baselineY: ctx.cursorY - valueSize + 2,
    fill: band,
    ink,
    size: TYPE.label,
  });

  ctx.cursorY -= valueSize * 1.5;
}

function renderDomainBreakdown(ctx: RenderCtx, snapshot: AssessmentSnapshot): void {
  // Title + first banded card (~60pt) must stay together.
  beginAtomicSection(ctx, { minHeight: 110 });
  sectionTitle(ctx, 'Composite risk breakdown');
  const DOMAINS: Array<{ key: 'cardiovascular' | 'metabolic' | 'hepatic' | 'renal' | 'frailty'; label: string }> = [
    { key: 'cardiovascular', label: 'Cardiovascular' },
    { key: 'metabolic',      label: 'Metabolic' },
    { key: 'hepatic',        label: 'Hepatic' },
    { key: 'renal',          label: 'Renal' },
    { key: 'frailty',        label: 'Frailty' },
  ];

  for (const { key, label } of DOMAINS) {
    const entry = snapshot.compositeRisk[key];
    if (!entry) continue;
    const { ink, band } = severityPalette(entry.level);
    const accent = domainAccent(key);

    const innerWidth = CONTENT_WIDTH - BOX.paddingX * 2;
    const reasoningH = entry.reasoning
      ? measureWrapped(ctx.fonts, entry.reasoning, innerWidth, { size: TYPE.body })
      : 0;
    const evidenceLine = entry.evidence?.length
      ? `Evidence: ${entry.evidence.join(', ')}`
      : null;
    const evidenceH = evidenceLine
      ? measureWrapped(ctx.fonts, evidenceLine, innerWidth, { size: TYPE.label })
      : 0;
    const estH = TYPE.cardTitle * 2 + SPACING.sm + reasoningH + evidenceH + SPACING.sm;

    drawBandedCard(
      ctx,
      { bandColor: accent, estimatedHeight: estH },
      (iw) => {
        // Title row
        const titleY = ctx.cursorY - TYPE.cardTitle;
        ctx.page.drawText(label, {
          x: PAGE.marginX + BOX.paddingX,
          y: titleY,
          size: TYPE.cardTitle,
          font: ctx.fonts.bold,
          color: COLOR.text,
        });
        // Level pill on the right
        const pillText = entry.level.replace('_', ' ').toUpperCase();
        const pw = pillWidth(ctx.fonts, pillText);
        drawPill(ctx, pillText, {
          x: PAGE.marginX + BOX.paddingX + iw - pw,
          baselineY: titleY,
          fill: band,
          ink,
        });
        ctx.cursorY -= TYPE.cardTitle * 1.2;

        if (entry.reasoning) {
          drawWrapped(ctx, entry.reasoning, iw, {
            size: TYPE.body,
            color: COLOR.textSoft,
            x: PAGE.marginX + BOX.paddingX,
          });
        }
        if (evidenceLine) {
          drawWrapped(ctx, evidenceLine, iw, {
            size: TYPE.label,
            color: COLOR.muted,
            x: PAGE.marginX + BOX.paddingX,
          });
        }
      },
    );
  }
}

function renderValidatedScores(ctx: RenderCtx, snapshot: AssessmentSnapshot): void {
  // Title + first score block stays together. minHeight covers the
  // section title (~28pt), one wrapped 2-line label (~28pt), the value
  // sub-line (~16pt) and a hairline (~8pt) ≈ 80pt; reserve 100pt to
  // leave room for an interpretation/skip-reason line on the first
  // entry.
  beginAtomicSection(ctx, { minHeight: 100 });
  sectionTitle(ctx, 'Validated clinical scores');
  if (!snapshot.scoreResults?.length) {
    drawLine(ctx, 'No scores computed.', { size: TYPE.body, color: COLOR.muted, font: 'italic' });
    return;
  }

  // ─── REFINE-1: vertical score block layout ────────────────────────
  //
  // Previous design rendered every score on a single horizontal line:
  //   [ label ][value @ x=260][pill @ x=330]
  // Long labels such as
  //   "SCORE2-Diabetes Cardiovascular Risk (not computable)"
  //   "Unknown diabetes suspected — hyperglycaemic episode"
  // overflowed into the value column at x=260 and the pill at x=330,
  // producing visible glyph collision in the PDF.
  //
  // New design: each score is a self-contained vertical block:
  //   ┌─ row ────────────────────────────────────────────────────────┐
  //   │ Score Label (bold, may wrap up to 2 lines)            [PILL] │
  //   │ [SCORE2] · 7.4 · CV 10y  (or "—" / "not computable")         │
  //   │ ↳ Optional interpretation / skip reason (italic muted, wrap) │
  //   │ ──── hairline ─────────────────────────────────────────────── │
  //   └──────────────────────────────────────────────────────────────┘
  // The pill is anchored to the right edge of the content area so it
  // never lives at a fixed x that a long label can collide with. The
  // label wrap-width subtracts the pill width + gutter so wrapped
  // glyphs cannot overlap the pill.
  // The whole row is pre-measured and ensureSpace() is called once with
  // the full block height, so a row never splits across pages.

  const PILL_GUTTER = SPACING.sm;
  // Sub-line uses the standard normal line-height; we reserve one
  // SUBLINE_LH worth of vertical space in the measurement for the
  // [code] · value muted line below the label.
  const SUBLINE_LH = TYPE.label * LINE_HEIGHT.normal;
  const ROW_PAD_BOTTOM = SPACING.sm;

  for (const s of snapshot.scoreResults) {
    const { ink, band } = severityPalette(s.category);

    // ── 1. Measure ─────────────────────────────────────────────────
    const pillText = (s.category || '—').toUpperCase().replace(/_/g, ' ');
    const pw = pillWidth(ctx.fonts, pillText);
    const labelMaxW = CONTENT_WIDTH - pw - PILL_GUTTER;

    const labelHeight = measureWrapped(
      ctx.fonts,
      s.label,
      labelMaxW,
      { size: TYPE.body, font: 'bold' },
    );

    const valueText = formatValue(s.valueNumeric);
    const subline = `[${s.scoreCode}] · ${valueText}`;

    // Pull a human-readable interpretation / skip reason from the raw
    // payload when the entry is non-computable or carries a structured
    // explanation. We never invent text — we surface what the score
    // engine itself emitted, falling back to a generic message only
    // when nothing structured is available.
    const interpretation = extractScoreNote(s);
    const interpretationHeight = interpretation
      ? measureWrapped(
          ctx.fonts,
          interpretation,
          CONTENT_WIDTH,
          { size: TYPE.label, font: 'italic' },
        )
      : 0;

    const rowHeight =
      labelHeight +
      SUBLINE_LH +
      interpretationHeight +
      ROW_PAD_BOTTOM +
      // hairline + its top margin
      SPACING.xs + 1;

    // ── 2. Reserve atomic space for the whole block ────────────────
    ensureSpace(ctx, rowHeight);

    // Capture the baseline y of the FIRST label line so we can anchor
    // the pill flush right next to it.
    const firstLineBaselineY = ctx.cursorY - TYPE.body;

    // ── 3. Draw label (wraps automatically) ────────────────────────
    drawWrapped(ctx, s.label, labelMaxW, {
      size: TYPE.body,
      font: 'bold',
      color: COLOR.text,
    });

    // ── 4. Draw the pill flush right at the first label baseline ───
    drawPill(ctx, pillText, {
      x: PAGE.marginX + CONTENT_WIDTH - pw,
      baselineY: firstLineBaselineY,
      fill: band,
      ink,
    });

    // ── 5. Sub-line: code · value (muted) ──────────────────────────
    drawLine(ctx, subline, {
      size: TYPE.label,
      color: COLOR.muted,
    });

    // ── 6. Optional interpretation / skip reason ───────────────────
    if (interpretation) {
      drawWrapped(ctx, interpretation, CONTENT_WIDTH, {
        size: TYPE.label,
        font: 'italic',
        color: COLOR.textSoft,
      });
    }

    // ── 7. Hairline separator ──────────────────────────────────────
    hrule(ctx, { color: COLOR.lineFaint, marginTop: 0, marginBottom: SPACING.xs });
  }
}

/**
 * Extract a human-readable interpretation / skip note from a
 * ScoreResultEntry, preferring structured fields over free text and
 * never inventing content.
 *
 * Order of preference:
 *   1. `rawPayload.interpretation` — set by interpretive scores
 *      (FLI, FIB-4, eGFR staging) for clinician-facing context.
 *   2. `rawPayload.skipReason` — set by SCORE2 / SCORE2-Diabetes
 *      eligibility gates when the score is non-computable, with an
 *      explanation such as "missing total cholesterol, HDL".
 *   3. Implicit "—" when the category is `not_computable` but no
 *      structured reason was provided (defensive fallback so the
 *      reader still sees that something was attempted).
 *
 * Returns null when none of the above apply, so the renderer can skip
 * the interpretation line entirely (no orphan empty paragraph).
 */
function extractScoreNote(s: { rawPayload?: Record<string, unknown>; category?: string }): string | null {
  const raw = s.rawPayload ?? {};
  const interpretation = raw['interpretation'];
  if (typeof interpretation === 'string' && interpretation.trim()) {
    return interpretation.trim();
  }
  const skip = raw['skipReason'];
  if (typeof skip === 'string' && skip.trim()) {
    return `Not computable: ${skip.trim()}`;
  }
  if ((s.category ?? '').toLowerCase() === 'not_computable') {
    return 'Not computable for this assessment.';
  }
  return null;
}

function renderLifestyleSummary(ctx: RenderCtx, snapshot: AssessmentSnapshot): void {
  // 9 key-value rows + section title — full block ≈ 200pt; reserve at
  // least the title + first 3 rows so the section opens cohesively.
  beginAtomicSection(ctx, { minHeight: 110 });
  sectionTitle(ctx, 'Lifestyle');

  const predimed = snapshot.nutritionSummary.predimedScore;
  drawKeyValue(
    ctx,
    'PREDIMED (MEDAS)',
    predimed != null
      ? `${predimed} (${snapshot.nutritionSummary.adherenceBand ?? '—'} adherence)`
      : '—',
  );
  drawKeyValue(
    ctx,
    'BMR',
    `${Math.round(snapshot.nutritionSummary.bmrKcal)} kcal/day`,
  );
  drawKeyValue(
    ctx,
    'TDEE',
    `${Math.round(snapshot.nutritionSummary.tdeeKcal)} kcal/day (activity factor ${snapshot.nutritionSummary.activityFactor.toFixed(2)})`,
  );
  drawKeyValue(ctx, 'Activity level', snapshot.nutritionSummary.activityLevel);

  const minsPerWeek = snapshot.activitySummary.minutesPerWeek;
  drawKeyValue(
    ctx,
    'Physical activity',
    minsPerWeek != null
      ? `${minsPerWeek} min/week — ${snapshot.activitySummary.qualitativeBand}`
      : '—',
  );
  const metMins = snapshot.activitySummary.metMinutesPerWeek;
  drawKeyValue(
    ctx,
    'MET-min/week',
    metMins != null ? String(Math.round(metMins)) : '—',
  );
  drawKeyValue(
    ctx,
    'WHO 2020 guidelines',
    snapshot.activitySummary.meetsWhoGuidelines ? 'Met (≥150 min/wk moderate)' : 'Not met',
  );
  drawKeyValue(
    ctx,
    'Sedentary risk',
    snapshot.activitySummary.sedentaryRiskLevel.replace('_', ' ').toUpperCase(),
  );
  drawKeyValue(ctx, 'Smoking', snapshot.input.clinicalContext.smoking ? 'Yes' : 'No');
}

function renderLifestyleRecommendations(ctx: RenderCtx, snapshot: AssessmentSnapshot): void {
  // Section title + caption + first banded recommendation card need to
  // stay together (≈ 130pt floor).
  beginAtomicSection(ctx, { minHeight: 140 });
  sectionTitle(ctx, 'Lifestyle recommendations');
  drawLine(
    ctx,
    'Supportive counselling nudges, not clinical prescriptions.',
    { size: TYPE.label, color: COLOR.muted, font: 'italic' },
  );

  for (const r of snapshot.lifestyleRecommendations) {
    const { ink, band } = severityPalette(r.priority);
    const innerWidth = CONTENT_WIDTH - BOX.paddingX * 2;
    // ─ REFINE-2 ─ accurate height estimate so drawBandedCard's own
    // ensureSpace check pushes the entire card to the next page when
    // it doesn't fit, instead of letting drawWrapped/drawGuidelineTag
    // split the card mid-rationale or strand the source line alone.
    const rationaleH = measureWrapped(ctx.fonts, r.rationale, innerWidth, { size: TYPE.body });
    const sourceH    = TYPE.label * LINE_HEIGHT.normal;
    const tagH       = measureGuidelineTagHeight(r.guideline);
    const titleH     = TYPE.cardTitle * 1.25;
    const estH       = titleH + rationaleH + sourceH + tagH + SPACING.sm;
    drawBandedCard(
      ctx,
      { bandColor: domainAccent(mapRecommendationDomain(r.domain)), estimatedHeight: estH },
      (iw) => {
        const titleY = ctx.cursorY - TYPE.cardTitle;
        ctx.page.drawText(prepare(ctx, r.title), {
          x: PAGE.marginX + BOX.paddingX,
          y: titleY,
          size: TYPE.cardTitle,
          font: ctx.fonts.bold,
          color: COLOR.text,
        });
        // Priority pill on the right
        const pillText = r.priority.toUpperCase();
        const pw = pillWidth(ctx.fonts, pillText);
        drawPill(ctx, pillText, {
          x: PAGE.marginX + BOX.paddingX + iw - pw,
          baselineY: titleY,
          fill: band,
          ink,
        });
        ctx.cursorY -= TYPE.cardTitle * 1.25;

        drawWrapped(ctx, r.rationale, iw, {
          size: TYPE.body,
          color: COLOR.textSoft,
          x: PAGE.marginX + BOX.paddingX,
        });

        drawLine(ctx, `Source: ${r.guidelineSource}`, {
          size: TYPE.label,
          color: COLOR.muted,
          font: 'italic',
          x: PAGE.marginX + BOX.paddingX,
        });
        drawGuidelineTag(ctx, r.guideline, PAGE.marginX + BOX.paddingX);
      },
    );
  }
}

/**
 * Height (in pt) the guideline tag will consume when rendered, or 0
 * when the tag is null / empty. Used by atomic-block measurements so
 * the per-bullet `beginAtomicBlock` floor accounts for the tag without
 * the caller having to duplicate the formatting logic.
 *
 * Mirrors the layout in `drawGuidelineTag`: a single label-size line
 * at normal line-height, drawn only if `formatGuidelineTag` returns
 * a non-empty string.
 */
function measureGuidelineTagHeight(g: PublicGuidelineRef | null | undefined): number {
  if (!g) return 0;
  const tag = formatGuidelineTag(g);
  if (!tag) return 0;
  return TYPE.label * LINE_HEIGHT.normal;
}

/** Map the finer-grained recommendation domain to the 5 chart domains. */
function mapRecommendationDomain(domain: string): string {
  switch (domain) {
    case 'activity':
    case 'sedentary':
    case 'sleep':
    case 'hydration':
    case 'weight':
    case 'alcohol':
    case 'smoking':
      return 'lifestyle';
    case 'diet':
      return 'lifestyle';
    case 'self_monitoring':
      // Home BP / glucose self-monitoring is a behavioural support nudge,
      // not a clinical prescription. Bucketed under the generic "lifestyle"
      // chart domain for visual consistency with the other behavioural
      // recommendations.
      return 'lifestyle';
    default:
      return 'lifestyle';
  }
}

function renderCompletenessWarnings(ctx: RenderCtx, snapshot: AssessmentSnapshot): void {
  // Title + caption + first warning card need to stay together (~140pt).
  beginAtomicSection(ctx, { minHeight: 150 });
  sectionTitle(ctx, 'Data completeness warnings');
  drawLine(
    ctx,
    'The following scores could not be computed because of missing inputs.',
    { size: TYPE.label, color: COLOR.muted, font: 'italic' },
  );
  for (const w of snapshot.completenessWarnings) {
    const { ink, band } = severityPalette(w.severity);
    const innerWidth = CONTENT_WIDTH - BOX.paddingX * 2;
    const detailH = measureWrapped(ctx.fonts, w.detail, innerWidth, { size: TYPE.body });
    const actionH = measureWrapped(ctx.fonts, w.suggestedAction, innerWidth, { size: TYPE.body });
    const missingH = w.missingFields?.length
      ? measureWrapped(ctx.fonts, `Missing: ${w.missingFields.join(', ')}`, innerWidth, { size: TYPE.label })
      : 0;
    const estH = TYPE.cardTitle * 1.3 + detailH + actionH + missingH + SPACING.sm * 2;

    drawBandedCard(
      ctx,
      { bandColor: band, estimatedHeight: estH },
      (iw) => {
        const titleY = ctx.cursorY - TYPE.cardTitle;
        ctx.page.drawText(prepare(ctx, w.title), {
          x: PAGE.marginX + BOX.paddingX,
          y: titleY,
          size: TYPE.cardTitle,
          font: ctx.fonts.bold,
          color: COLOR.text,
        });
        const pillText = w.severity.toUpperCase();
        const pw = pillWidth(ctx.fonts, pillText);
        drawPill(ctx, pillText, {
          x: PAGE.marginX + BOX.paddingX + iw - pw,
          baselineY: titleY,
          fill: band,
          ink,
        });
        ctx.cursorY -= TYPE.cardTitle * 1.35;

        drawWrapped(ctx, w.detail, iw, {
          size: TYPE.body,
          color: COLOR.textSoft,
          x: PAGE.marginX + BOX.paddingX,
        });
        drawWrapped(ctx, `Action: ${w.suggestedAction}`, iw, {
          size: TYPE.body,
          font: 'italic',
          color: COLOR.text,
          x: PAGE.marginX + BOX.paddingX,
        });
        if (w.missingFields?.length) {
          drawWrapped(ctx, `Missing: ${w.missingFields.join(', ')}`, iw, {
            size: TYPE.label,
            color: COLOR.muted,
            x: PAGE.marginX + BOX.paddingX,
          });
        }
      },
    );
  }
}

function renderAlerts(ctx: RenderCtx, snapshot: AssessmentSnapshot): void {
  // Title + first alert card stay together (~140pt floor).
  beginAtomicSection(ctx, { minHeight: 150 });
  sectionTitle(ctx, `Active clinical alerts (${snapshot.alerts.length})`);
  for (const a of snapshot.alerts) {
    const { ink, band } = severityPalette(a.severity);
    const innerWidth = CONTENT_WIDTH - BOX.paddingX * 2;
    const msgH = measureWrapped(ctx.fonts, a.message, innerWidth, { size: TYPE.body });
    const estH = TYPE.cardTitle * 1.3 + msgH + TYPE.label * 1.5 + SPACING.sm;
    drawBandedCard(
      ctx,
      { bandColor: band, estimatedHeight: estH },
      (iw) => {
        const titleY = ctx.cursorY - TYPE.cardTitle;
        ctx.page.drawText(prepare(ctx, a.title), {
          x: PAGE.marginX + BOX.paddingX,
          y: titleY,
          size: TYPE.cardTitle,
          font: ctx.fonts.bold,
          color: COLOR.text,
        });
        const pillText = a.severity.toUpperCase();
        const pw = pillWidth(ctx.fonts, pillText);
        drawPill(ctx, pillText, {
          x: PAGE.marginX + BOX.paddingX + iw - pw,
          baselineY: titleY,
          fill: band,
          ink,
        });
        ctx.cursorY -= TYPE.cardTitle * 1.35;

        drawWrapped(ctx, a.message, iw, {
          size: TYPE.body,
          color: COLOR.textSoft,
          x: PAGE.marginX + BOX.paddingX,
        });
        drawLine(ctx, `Raised: ${formatIsoDateTime(a.timestamp)} · ${a.type}`, {
          size: TYPE.label,
          color: COLOR.muted,
          font: 'italic',
          x: PAGE.marginX + BOX.paddingX,
        });
      },
    );
  }
}

function renderFollowupPlan(ctx: RenderCtx, snapshot: AssessmentSnapshot): void {
  // Title + priority + next-review key/value rows + 1 follow-up bullet
  // need cohesion (~150pt floor).
  beginAtomicSection(ctx, { minHeight: 160 });
  sectionTitle(ctx, 'Follow-up plan');
  drawKeyValue(ctx, 'Priority', snapshot.followupPlan.priorityLevel.toUpperCase());
  drawKeyValue(
    ctx,
    'Next review',
    `${formatIsoDate(snapshot.followupPlan.nextReviewDate)}  ·  every ${snapshot.followupPlan.intervalMonths} month(s)`,
  );

  if (snapshot.followupPlan.items?.length > 0) {
    verticalGap(ctx, SPACING.xs);
    drawLine(ctx, 'Structured follow-up items', { size: TYPE.cardTitle, font: 'bold' });
    for (const it of snapshot.followupPlan.items) {
      const { ink, band } = severityPalette(it.priority);

      // ─ REFINE-2 ─ pre-measure the ENTIRE bullet block so the title,
      // wrapped rationale, source line and guideline tag never split
      // across pages. Each bullet is now an atomic clinical unit.
      const titleH = TYPE.body * 1.25;
      const rationaleH = measureWrapped(
        ctx.fonts,
        it.rationale,
        CONTENT_WIDTH - SPACING.md,
        { size: TYPE.label },
      );
      const srcLine = [
        `Due in ${it.dueInMonths} month(s)`,
        it.recurrenceMonths ? `recurs every ${it.recurrenceMonths} month(s)` : null,
        it.guidelineSource ? `source: ${it.guidelineSource}` : null,
      ].filter(Boolean).join(' · ');
      const srcH = srcLine ? TYPE.label * LINE_HEIGHT.normal : 0;
      const tagH = measureGuidelineTagHeight(it.guideline);
      const blockH = titleH + rationaleH + srcH + tagH + SPACING.xs;
      beginAtomicBlock(ctx, blockH);

      const baselineY = ctx.cursorY - TYPE.body;
      // Bullet title + priority pill
      ctx.page.drawText(`• ${prepare(ctx, it.title)}`, {
        x: PAGE.marginX + SPACING.xs,
        y: baselineY,
        size: TYPE.body,
        font: ctx.fonts.bold,
        color: COLOR.text,
      });
      const pillText = it.priority.toUpperCase();
      const pw = pillWidth(ctx.fonts, pillText);
      drawPill(ctx, pillText, {
        x: PAGE.width - PAGE.marginX - pw,
        baselineY,
        fill: band,
        ink,
      });
      ctx.cursorY -= titleH;
      drawWrapped(
        ctx,
        it.rationale,
        CONTENT_WIDTH - SPACING.md,
        { size: TYPE.label, color: COLOR.textSoft, x: PAGE.marginX + SPACING.md },
      );
      if (srcLine) {
        drawLine(ctx, srcLine, {
          size: TYPE.label,
          font: 'italic',
          color: COLOR.muted,
          x: PAGE.marginX + SPACING.md,
        });
      }
      drawGuidelineTag(ctx, it.guideline, PAGE.marginX + SPACING.md);
      verticalGap(ctx, SPACING.xs);
    }
  } else if (snapshot.followupPlan.actions?.length > 0) {
    // Legacy projection — render as plain bullets. Each bullet is a
    // single wrapped paragraph; we still pre-measure so a long action
    // does not split mid-paragraph.
    verticalGap(ctx, SPACING.xs);
    drawLine(ctx, 'Actions', { size: TYPE.cardTitle, font: 'bold' });
    for (const action of snapshot.followupPlan.actions) {
      const actionH = measureWrapped(
        ctx.fonts,
        `• ${action}`,
        CONTENT_WIDTH - SPACING.sm,
        { size: TYPE.body },
      );
      beginAtomicBlock(ctx, actionH);
      drawWrapped(ctx, `• ${action}`, CONTENT_WIDTH - SPACING.sm, {
        size: TYPE.body,
        x: PAGE.marginX + SPACING.xs,
      });
    }
  }

  if (snapshot.followupPlan.domainMonitoring?.length > 0) {
    verticalGap(ctx, SPACING.xs);
    drawLine(ctx, 'Domain monitoring', { size: TYPE.cardTitle, font: 'bold' });
    for (const d of snapshot.followupPlan.domainMonitoring) {
      // Single-line bullets — the existing drawLine handles its own
      // ensureSpace, but we still guard against a sub-heading orphan
      // by treating the heading + first bullet as one logical pair via
      // the SPACING.xs gap above.
      drawLine(ctx, `• ${d}`, { size: TYPE.body, x: PAGE.marginX + SPACING.xs });
    }
  }
}

function renderScreenings(ctx: RenderCtx, snapshot: AssessmentSnapshot): void {
  // Title + first screening bullet (3 lines + pill) stay together.
  beginAtomicSection(ctx, { minHeight: 110 });
  sectionTitle(ctx, 'Required screenings');
  for (const s of snapshot.screenings) {
    const { ink, band } = severityPalette(s.priority);

    // ─ REFINE-2 ─ atomic-block guard: pre-measure full bullet height
    // (title + reason + source + guideline tag + bottom gap) so the
    // screening never splits across pages.
    const titleH = TYPE.body * 1.25;
    const reasonH = s.reason
      ? measureWrapped(
          ctx.fonts,
          s.reason,
          CONTENT_WIDTH - SPACING.md,
          { size: TYPE.label },
        )
      : 0;
    const srcH = s.guidelineSource ? TYPE.label * LINE_HEIGHT.normal : 0;
    const tagH = measureGuidelineTagHeight(s.guideline);
    const blockH = titleH + reasonH + srcH + tagH + SPACING.xs;
    beginAtomicBlock(ctx, blockH);

    const baselineY = ctx.cursorY - TYPE.body;
    ctx.page.drawText(`• ${prepare(ctx, s.screening)}`, {
      x: PAGE.marginX + SPACING.xs,
      y: baselineY,
      size: TYPE.body,
      font: ctx.fonts.bold,
      color: COLOR.text,
    });
    const pillText = `${s.priority.toUpperCase()} · ${s.intervalMonths}mo`;
    const pw = pillWidth(ctx.fonts, pillText);
    drawPill(ctx, pillText, {
      x: PAGE.width - PAGE.marginX - pw,
      baselineY,
      fill: band,
      ink,
    });
    ctx.cursorY -= titleH;

    if (s.reason) {
      drawWrapped(ctx, s.reason, CONTENT_WIDTH - SPACING.md, {
        size: TYPE.label,
        color: COLOR.textSoft,
        x: PAGE.marginX + SPACING.md,
      });
    }
    if (s.guidelineSource) {
      drawLine(ctx, `Source: ${s.guidelineSource}`, {
        size: TYPE.label,
        font: 'italic',
        color: COLOR.muted,
        x: PAGE.marginX + SPACING.md,
      });
    }
    drawGuidelineTag(ctx, s.guideline, PAGE.marginX + SPACING.md);
    verticalGap(ctx, SPACING.xs);
  }
}

/**
 * Render the optional per-item structured guideline chip (WS6). When
 * `guideline` is populated by `assessment-service.buildSnapshot`, we
 * surface the family/evidence tag on a second, slightly indented line
 * directly below the legacy `Source: …` text. When `guideline` is null
 * (off-catalog citation or pre-WS6 legacy row), this is a no-op, so the
 * PDF output is byte-identical to the pre-WS6 render for those items.
 *
 * Why a separate helper:
 *   - Keeps the three call-sites (lifestyle recs, follow-up items,
 *     screenings) structurally symmetric.
 *   - Centralises the formatting contract — if the chip gains another
 *     field (translation, supersedence), every call-site picks it up.
 */
function drawGuidelineTag(
  ctx: RenderCtx,
  g: PublicGuidelineRef | null | undefined,
  x: number,
): void {
  if (!g) return;
  const tag = formatGuidelineTag(g);
  if (!tag) return;
  drawLine(ctx, tag, {
    size: TYPE.label,
    color: COLOR.muted,
    font: 'italic',
    x,
  });
}

/**
 * Build the one-line guideline tag shown directly below the legacy
 * `Source: …` string.
 *
 * Shape: `<families> · <evidence-label>` — the URL is intentionally
 * omitted here because it is enumerated in the "Reference framework"
 * section at the end of the document. Duplicating it would crowd each
 * item line and cost vertical space without new information.
 */
function formatGuidelineTag(g: PublicGuidelineRef): string {
  const fams = (g.families ?? []).join(' + ');
  const tokens: string[] = [];
  if (fams) tokens.push(fams);
  const ev = formatEvidenceLabel(g.evidenceLevel);
  if (ev) tokens.push(ev);
  return tokens.join(' · ');
}

/**
 * Map the evidence-level bucket emitted by the catalog to a
 * clinician-readable label.
 */
function formatEvidenceLabel(level: string): string {
  switch (level) {
    case 'A':
    case 'B':
    case 'C':
      return `Evidence ${level}`;
    case 'consensus':
      return 'Consensus';
    case 'policy':
      return 'Internal policy';
    default:
      // Unknown future values: surface them verbatim rather than swallow.
      return level ?? '';
  }
}

/**
 * Render the consolidated "Reference framework" section (WS6).
 *
 * Responsibilities
 *   - Dedupe the guideline citations surfaced across follow-up items,
 *     screenings and lifestyle recommendations.
 *   - Show each reference exactly once with its families, full document
 *     title, evidence level and authoritative URL.
 *   - Silent no-op when the rendered snapshot has no catalog-resolved
 *     citations (legacy assessments with off-catalog `guidelineSource`
 *     strings) — avoids emitting an empty, confusing section.
 *
 * What this section is NOT
 *   - Not a bibliography: it only lists references the clinician saw
 *     above in this very document.
 *   - Not clinical guidance in itself. The PDF's non-authoritative-AI
 *     disclaimer in the footer still applies.
 */
function renderReferenceFramework(
  ctx: RenderCtx,
  snapshot: AssessmentSnapshot,
): void {
  const items: Array<{
    guideline?: PublicGuidelineRef | null;
    guidelineSource?: string | null;
  }> = [
    ...(snapshot.followupPlan?.items ?? []),
    ...(snapshot.screenings ?? []),
    ...(snapshot.lifestyleRecommendations ?? []),
  ];
  const refs = collectReferenceFramework(items);
  if (refs.length === 0) return;

  // Title + caption + first reference entry (~150pt floor).
  beginAtomicSection(ctx, { minHeight: 160 });
  sectionTitle(ctx, 'Reference framework');
  drawLine(
    ctx,
    'Guidelines cited above, listed in order of first appearance.',
    { size: TYPE.label, color: COLOR.muted, font: 'italic' },
  );

  const innerWidth = CONTENT_WIDTH - SPACING.md;
  for (const g of refs) {
    ensureSpace(ctx, TYPE.cardTitle * 3 + SPACING.sm);

    // 1. Header line — short label (bold) + family(ies) on the right.
    const fams = (g.families ?? []).join(' + ');
    const labelText = g.shortLabel || g.id;
    const baselineY = ctx.cursorY - TYPE.cardTitle;
    ctx.page.drawText(prepare(ctx, `• ${labelText}`), {
      x: PAGE.marginX + SPACING.xs,
      y: baselineY,
      size: TYPE.cardTitle,
      font: ctx.fonts.bold,
      color: COLOR.text,
    });
    if (fams) {
      const famWidth = textWidth(ctx.fonts, fams, {
        size: TYPE.label,
        font: 'italic',
      });
      ctx.page.drawText(prepare(ctx, fams), {
        x: PAGE.width - PAGE.marginX - famWidth,
        y: baselineY,
        size: TYPE.label,
        font: ctx.fonts.italic,
        color: COLOR.muted,
      });
    }
    ctx.cursorY -= TYPE.cardTitle * 1.3;

    // 2. Full title (wrapped).
    if (g.title) {
      drawWrapped(ctx, g.title, innerWidth, {
        size: TYPE.body,
        color: COLOR.textSoft,
        x: PAGE.marginX + SPACING.md,
      });
    }

    // 3. Meta line — evidence level · URL (if any).
    const metaTokens: string[] = [];
    const ev = formatEvidenceLabel(g.evidenceLevel);
    if (ev) metaTokens.push(ev);
    if (g.url) metaTokens.push(g.url);
    if (metaTokens.length > 0) {
      drawWrapped(ctx, metaTokens.join(' · '), innerWidth, {
        size: TYPE.label,
        color: COLOR.muted,
        font: 'italic',
        x: PAGE.marginX + SPACING.md,
      });
    }
    verticalGap(ctx, SPACING.xs);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Pure helpers
// ───────────────────────────────────────────────────────────────────────────

function prepare(ctx: RenderCtx, s: string): string {
  // The primitives already prepare their arguments via prepareText; this
  // helper exists so that callers writing inline via page.drawText get the
  // same guarantee.
  return ctx.fonts.unicodeCapable ? String(s ?? '') : (s == null ? '' : sanitiseFallback(String(s)));
}

function sanitiseFallback(s: string): string {
  // Mirrors font-loader.sanitiseForWinAnsi — kept here inlined for hot path.
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u2022/g, '*')
    .replace(/[\u2190-\u21FF]/g, '->')
    .replace(/\u2265/g, '>=')
    .replace(/\u2264/g, '<=')
    .replace(/\u00B1/g, '+/-')
    .replace(/[^\x00-\x7F\u00A0-\u00FF]/g, '?');
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '—';
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
 * Pseudonymous patient reference — data-minimisation (blueprint §3.2).
 * We prefer the stable external code, then the tenant display name, then
 * fall back to a composed name ONLY if the schema captured first+last.
 */
function resolvePatientReference(patient: ReportPayload['patient']): string {
  if (patient.externalCode) return patient.externalCode;
  if (patient.displayName)  return patient.displayName;
  const composed = `${patient.firstName ?? ''} ${patient.lastName ?? ''}`.trim();
  return composed || '—';
}

function resolvePatientAge(
  snapshot: AssessmentSnapshot,
  patient: ReportPayload['patient'],
): string {
  if (typeof snapshot.input.demographics.age === 'number') {
    return `${snapshot.input.demographics.age} years`;
  }
  if (patient.birthYear) {
    const now = new Date().getUTCFullYear();
    return `${now - patient.birthYear} years (derived)`;
  }
  return '—';
}
