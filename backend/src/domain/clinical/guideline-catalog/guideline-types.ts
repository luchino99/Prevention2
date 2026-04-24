/**
 * Guideline Rule Catalog — shared types (WS5).
 *
 * Objective:
 *   Replace the free-text `guidelineSource: '…'` strings sprinkled across
 *   the clinical engines with a single, typed catalog of `GuidelineReference`
 *   entries. Each entry carries the metadata needed by downstream consumers
 *   (UI, PDF reports, future guideline filters) — family, year, section,
 *   authoritative URL, evidence level and clinical domain — while exposing
 *   a `displayString` that is byte-identical to the previous inline string.
 *
 * Compatibility contract:
 *   - `displayString` MUST equal the legacy free-text value used by the
 *     engine that cites this guideline. Changing it is equivalent to
 *     rewording a clinician-visible label and requires snapshot/fixture
 *     review. The WS5 refactor itself does NOT change any string.
 *   - New fields (`families`, `year`, `section`, `url`, `evidenceLevel`,
 *     `domains`) are strictly additive metadata. Consumers that only care
 *     about `guidelineSource: string` keep working unchanged.
 *
 * Non-goals:
 *   - This module does NOT alter clinical calculation logic.
 *   - This module does NOT make medical or legal claims — it documents the
 *     public references already cited by the clinical engines.
 */

// ============================================================================
// Core enumerations
// ============================================================================

/**
 * Issuing body of a guideline or major reference document.
 *
 * Joint guidelines (ESC + ESH, ESC + EAS) have their own family value so
 * the UI can render them as a single logo/attribution without splitting
 * them into two rows. When a rule cites two separate documents (e.g. ADA
 * + KDIGO for diabetic nephropathy screening), the `families` array on
 * the `GuidelineReference` carries both entries.
 */
export type GuidelineFamily =
  | 'ESC'       // European Society of Cardiology
  | 'EASL'      // European Association for the Study of the Liver
  | 'ADA'       // American Diabetes Association
  | 'KDIGO'     // Kidney Disease: Improving Global Outcomes
  | 'WHO'       // World Health Organization
  | 'NCEP'      // US National Cholesterol Education Program
  | 'FRAIL'     // FRAIL scale consensus (Morley et al. 2012)
  | 'PREDIMED'  // Estruch et al. PREDIMED trial (NEJM 2018)
  | 'ESC_ESH'   // Joint ESC / European Society of Hypertension guidelines
  | 'ESC_EAS'   // Joint ESC / European Atherosclerosis Society guidelines
  | 'INTERNAL'; // Uelfy Clinical internal policy

/**
 * Clinical domain(s) a guideline applies to. Kept aligned with the
 * composite-risk aggregator so the UI can group citations by domain card.
 * `lifestyle` covers counselling-grade material; `composite` is reserved
 * for cross-domain policies (internal cadence, multi-domain protocols).
 */
export type ClinicalDomain =
  | 'cardiovascular'
  | 'renal'
  | 'hepatic'
  | 'metabolic'
  | 'frailty'
  | 'lifestyle'
  | 'composite';

/**
 * Coarse strength-of-evidence bucket.
 *
 *   'A'         — randomized-trial / meta-analytic evidence
 *   'B'         — non-randomized / observational evidence
 *   'C'         — expert consensus published by a guideline body
 *   'consensus' — working-group consensus statement (no numeric grading)
 *   'policy'    — internal operational policy (no clinical evidence grade)
 *
 * The value is intentionally coarse: a rule engine is not the place to
 * replicate the full ESC/ACC grading lattice, and the UI only needs
 * enough granularity to show a badge.
 */
export type EvidenceLevel = 'A' | 'B' | 'C' | 'consensus' | 'policy';

// ============================================================================
// Reference shape
// ============================================================================

/**
 * A single guideline citation. Every field is immutable at the type level
 * so that the `GUIDELINES` registry can be frozen and shared safely across
 * pure rule engines.
 */
export interface GuidelineReference {
  /** Stable catalog key (UPPER_SNAKE_CASE). Used for persistence and dedup. */
  readonly id: string;

  /**
   * Issuing body/bodies. Arrays are used so that joint attributions
   * (e.g. ADA + KDIGO) are first-class. UI consumers can render either
   * `families[0]` or the full list.
   */
  readonly families: readonly GuidelineFamily[];

  /**
   * Short, clinician-facing label — what a human would scan in a table
   * header or badge ("ESC 2021 CVD prevention"). Typically equal to
   * `displayString` minus any section suffix.
   */
  readonly shortLabel: string;

  /** Year of publication; `null` for timeless / internal policies. */
  readonly year: number | null;

  /**
   * Optional section identifier as it appears in the source document
   * (e.g. "§4", "§6 (Glycemic Targets)"). `null` when the citation is
   * the whole document.
   */
  readonly section: string | null;

  /** Full title of the underlying document. */
  readonly title: string;

  /**
   * Authoritative public URL for the document. `null` when the catalog
   * entry is a working-group consensus without a stable DOI/URL or an
   * internal policy. The URL is surfaced by WS6 (source-transparency UI).
   */
  readonly url: string | null;

  /** Evidence-level bucket, see `EvidenceLevel`. */
  readonly evidenceLevel: EvidenceLevel;

  /**
   * Clinical domain(s) this reference supports. Used by the UI to group
   * citations by domain card and by future filters.
   */
  readonly domains: readonly ClinicalDomain[];

  /**
   * Verbatim string preserved for backwards compatibility with existing
   * engine outputs. The rule engines write this value into
   * `FollowUpItem.guidelineSource` / `ScreeningItem.guidelineSource` /
   * `LifestyleRecommendation.guidelineSource`. Changing it is a
   * behavior-visible action and requires snapshot review.
   */
  readonly displayString: string;
}
