/**
 * Guideline Rule Catalog — registry (WS5).
 *
 * Single source of truth for every guideline/reference cited by the
 * clinical rule engines (followup, screening, lifestyle) and the
 * score-engine orchestrator. Each entry carries:
 *
 *   - a `displayString` preserved VERBATIM from the legacy inline
 *     `guidelineSource: '…'` string, so the WS5 refactor introduces
 *     zero changes to engine output;
 *   - structured metadata (families, year, section, URL, evidence level,
 *     clinical domain) used by WS6 for the source-transparency UI and
 *     the PDF "Reference framework" section.
 *
 * How to add a new citation:
 *   1. Pick a stable UPPER_SNAKE_CASE id.
 *   2. Fill every field — `displayString` MUST be the exact string a
 *      clinician will see in the report. Prefer terseness ("ESC 2021
 *      CVD prevention §4" over the full 200-character paper title).
 *   3. If the citation combines two bodies, set `families: ['ADA','KDIGO']`
 *      and reflect that in the `displayString`.
 *   4. Export the entry via the `GUIDELINES` object below.
 *
 * DO NOT:
 *   - Change `displayString` of an existing entry without reviewing every
 *     snapshot / fixture / PDF report that depends on it.
 *   - Inline new `guidelineSource: '…'` strings in engine code. Add a
 *     catalog entry and reference it via `GUIDELINES.<id>.displayString`.
 */

import type {
  EvidenceLevel,
  GuidelineFamily,
  GuidelineReference,
} from './guideline-types.js';

// ============================================================================
// Catalog
// ============================================================================

/**
 * Internal helper: typed builder that preserves literal types through the
 * `GUIDELINES` const object. Kept local because we want the registry to
 * be the only producer of `GuidelineReference` instances.
 */
function ref<Id extends string>(entry: GuidelineReference & { id: Id }): GuidelineReference & { id: Id } {
  return entry;
}

/**
 * Canonical catalog. Keys are stable identifiers that engines import by
 * name. Values are immutable `GuidelineReference` objects.
 *
 * Ordering is alphabetical by id to make merge diffs easy to review.
 */
export const GUIDELINES = {
  // --------------------------------------------------------------------------
  // American Diabetes Association — Standards of Care in Diabetes 2024
  // --------------------------------------------------------------------------
  ADA_SOC: ref({
    id: 'ADA_SOC',
    families: ['ADA'],
    shortLabel: 'ADA Standards of Care',
    year: null,
    section: null,
    title: 'ADA Standards of Care in Diabetes (living guidance)',
    url: 'https://diabetesjournals.org/care/issue/47/Supplement_1',
    evidenceLevel: 'A',
    domains: ['metabolic'],
    displayString: 'ADA Standards of Care',
  }),
  ADA_SOC_2024_S2: ref({
    id: 'ADA_SOC_2024_S2',
    families: ['ADA'],
    shortLabel: 'ADA Standards of Care 2024',
    year: 2024,
    section: '§2',
    title: 'ADA Standards of Care 2024 — §2 Classification and Diagnosis of Diabetes',
    url: 'https://diabetesjournals.org/care/article/47/Supplement_1/S20/153954',
    evidenceLevel: 'A',
    domains: ['metabolic'],
    displayString: 'ADA Standards of Care 2024 §2',
  }),
  ADA_SOC_2024_S2_CLASSIFICATION: ref({
    id: 'ADA_SOC_2024_S2_CLASSIFICATION',
    families: ['ADA'],
    shortLabel: 'ADA Standards of Care 2024',
    year: 2024,
    section: '§2 (Classification & Diagnosis)',
    title: 'ADA Standards of Care 2024 — §2 Classification and Diagnosis of Diabetes',
    url: 'https://diabetesjournals.org/care/article/47/Supplement_1/S20/153954',
    evidenceLevel: 'A',
    domains: ['metabolic'],
    displayString: 'ADA Standards of Care 2024 §2 (Classification & Diagnosis)',
  }),
  ADA_SOC_2024_S5: ref({
    id: 'ADA_SOC_2024_S5',
    families: ['ADA'],
    shortLabel: 'ADA Standards of Care 2024',
    year: 2024,
    section: '§5',
    title: 'ADA Standards of Care 2024 — §5 Facilitating Positive Health Behaviors and Well-being',
    url: 'https://diabetesjournals.org/care/article/47/Supplement_1/S77/153952',
    evidenceLevel: 'A',
    domains: ['metabolic', 'lifestyle'],
    displayString: 'ADA Standards of Care 2024 §5',
  }),
  ADA_SOC_2024_S6: ref({
    id: 'ADA_SOC_2024_S6',
    families: ['ADA'],
    shortLabel: 'ADA Standards of Care 2024',
    year: 2024,
    section: '§6',
    title: 'ADA Standards of Care 2024 — §6 Glycemic Goals and Hypoglycemia',
    url: 'https://diabetesjournals.org/care/article/47/Supplement_1/S111/153951',
    evidenceLevel: 'A',
    domains: ['metabolic'],
    displayString: 'ADA Standards of Care 2024 §6',
  }),
  ADA_SOC_2024_S6_GLYCEMIC: ref({
    id: 'ADA_SOC_2024_S6_GLYCEMIC',
    families: ['ADA'],
    shortLabel: 'ADA Standards of Care 2024',
    year: 2024,
    section: '§6 (Glycemic Targets)',
    title: 'ADA Standards of Care 2024 — §6 Glycemic Goals and Hypoglycemia',
    url: 'https://diabetesjournals.org/care/article/47/Supplement_1/S111/153951',
    evidenceLevel: 'A',
    domains: ['metabolic'],
    displayString: 'ADA Standards of Care 2024 §6 (Glycemic Targets)',
  }),
  ADA_SOC_2024_S11_KDIGO: ref({
    id: 'ADA_SOC_2024_S11_KDIGO',
    families: ['ADA', 'KDIGO'],
    shortLabel: 'ADA Standards of Care 2024 + KDIGO 2024',
    year: 2024,
    section: '§11',
    title: 'ADA Standards of Care 2024 — §11 Chronic Kidney Disease and Risk Management + KDIGO 2024 CKD',
    url: 'https://diabetesjournals.org/care/article/47/Supplement_1/S219/153942',
    evidenceLevel: 'A',
    domains: ['metabolic', 'renal'],
    displayString: 'ADA Standards of Care 2024 §11 + KDIGO 2024',
  }),
  ADA_SOC_2024_S12: ref({
    id: 'ADA_SOC_2024_S12',
    families: ['ADA'],
    shortLabel: 'ADA Standards of Care 2024',
    year: 2024,
    section: '§12',
    title: 'ADA Standards of Care 2024 — §12 Retinopathy, Neuropathy, and Foot Care',
    url: 'https://diabetesjournals.org/care/article/47/Supplement_1/S231/153949',
    evidenceLevel: 'A',
    domains: ['metabolic'],
    displayString: 'ADA Standards of Care 2024 §12',
  }),

  // --------------------------------------------------------------------------
  // EASL — European Association for the Study of the Liver
  // --------------------------------------------------------------------------
  EASL_2024_MASLD: ref({
    id: 'EASL_2024_MASLD',
    families: ['EASL'],
    shortLabel: 'EASL 2024 MASLD',
    year: 2024,
    section: null,
    title: 'EASL–EASD–EASO Clinical Practice Guidelines on Metabolic Dysfunction-Associated Steatotic Liver Disease (MASLD) 2024',
    url: 'https://doi.org/10.1016/j.jhep.2024.04.031',
    evidenceLevel: 'A',
    domains: ['hepatic'],
    displayString: 'EASL 2024 MASLD',
  }),

  // --------------------------------------------------------------------------
  // European Society of Cardiology — prevention & vertical guidelines
  // --------------------------------------------------------------------------
  ESC_2021_PREVENTION: ref({
    id: 'ESC_2021_PREVENTION',
    families: ['ESC'],
    shortLabel: 'ESC 2021 CVD prevention',
    year: 2021,
    section: null,
    title: '2021 ESC Guidelines on cardiovascular disease prevention in clinical practice',
    url: 'https://doi.org/10.1093/eurheartj/ehab484',
    evidenceLevel: 'A',
    domains: ['cardiovascular'],
    displayString: 'ESC 2021 CVD prevention',
  }),
  ESC_2021_PREVENTION_S3: ref({
    id: 'ESC_2021_PREVENTION_S3',
    families: ['ESC'],
    shortLabel: 'ESC 2021 CVD prevention',
    year: 2021,
    section: '§3',
    title: '2021 ESC Guidelines on cardiovascular disease prevention in clinical practice — §3 Lifestyle and environmental factors',
    url: 'https://doi.org/10.1093/eurheartj/ehab484',
    evidenceLevel: 'A',
    domains: ['cardiovascular', 'lifestyle'],
    displayString: 'ESC 2021 CVD prevention §3',
  }),
  ESC_2021_PREVENTION_S4: ref({
    id: 'ESC_2021_PREVENTION_S4',
    families: ['ESC'],
    shortLabel: 'ESC 2021 CVD prevention',
    year: 2021,
    section: '§4',
    title: '2021 ESC Guidelines on cardiovascular disease prevention in clinical practice — §4 Risk-factor specific interventions',
    url: 'https://doi.org/10.1093/eurheartj/ehab484',
    evidenceLevel: 'A',
    domains: ['cardiovascular', 'lifestyle'],
    displayString: 'ESC 2021 CVD prevention §4',
  }),
  ESC_2021_NCEP: ref({
    id: 'ESC_2021_NCEP',
    families: ['ESC', 'NCEP'],
    shortLabel: 'ESC 2021 + NCEP ATP III',
    year: 2021,
    section: null,
    title: 'Combined reference: ESC 2021 CVD prevention + NCEP ATP III metabolic-syndrome criteria',
    url: 'https://doi.org/10.1093/eurheartj/ehab484',
    evidenceLevel: 'A',
    domains: ['cardiovascular', 'metabolic', 'lifestyle'],
    displayString: 'ESC 2021 + NCEP ATP III',
  }),
  ESC_2024_PAD: ref({
    id: 'ESC_2024_PAD',
    families: ['ESC'],
    shortLabel: 'ESC 2024 PAD',
    year: 2024,
    section: null,
    title: '2024 ESC Guidelines for the management of peripheral arterial and aortic diseases',
    url: 'https://doi.org/10.1093/eurheartj/ehae179',
    evidenceLevel: 'A',
    domains: ['cardiovascular'],
    displayString: 'ESC 2024 PAD',
  }),

  // --------------------------------------------------------------------------
  // Joint ESC guidelines
  // --------------------------------------------------------------------------
  ESC_ESH_2023_HTN: ref({
    id: 'ESC_ESH_2023_HTN',
    families: ['ESC_ESH'],
    shortLabel: 'ESC/ESH 2023 Hypertension',
    year: 2023,
    section: null,
    title: '2023 ESH Guidelines for the management of arterial hypertension (ESC/ESH endorsed)',
    url: 'https://doi.org/10.1097/HJH.0000000000003480',
    evidenceLevel: 'A',
    domains: ['cardiovascular', 'renal'],
    displayString: 'ESC/ESH 2023 Hypertension',
  }),
  ESC_EAS_2019_LIPIDS: ref({
    id: 'ESC_EAS_2019_LIPIDS',
    families: ['ESC_EAS'],
    shortLabel: 'ESC/EAS 2019 Dyslipidaemia',
    year: 2019,
    section: null,
    title: '2019 ESC/EAS Guidelines for the management of dyslipidaemias',
    url: 'https://doi.org/10.1093/eurheartj/ehz455',
    evidenceLevel: 'A',
    domains: ['cardiovascular'],
    displayString: 'ESC/EAS 2019 Dyslipidaemia',
  }),

  // --------------------------------------------------------------------------
  // FRAIL scale consensus (Morley et al.)
  // --------------------------------------------------------------------------
  FRAIL_SCALE_CONSENSUS: ref({
    id: 'FRAIL_SCALE_CONSENSUS',
    families: ['FRAIL'],
    shortLabel: 'FRAIL scale consensus',
    year: 2012,
    section: null,
    title: 'Morley JE et al. — A simple frailty questionnaire (FRAIL) predicts outcomes in middle-aged African Americans (J Nutr Health Aging, 2012)',
    url: 'https://doi.org/10.1007/s12603-012-0084-2',
    evidenceLevel: 'consensus',
    domains: ['frailty'],
    displayString: 'FRAIL scale consensus',
  }),

  // --------------------------------------------------------------------------
  // Internal Uelfy Clinical cadence policy
  // --------------------------------------------------------------------------
  INTERNAL_CADENCE: ref({
    id: 'INTERNAL_CADENCE',
    families: ['INTERNAL'],
    shortLabel: 'Internal cadence policy',
    year: null,
    section: null,
    title: 'Uelfy Clinical — internal follow-up cadence policy',
    url: null,
    evidenceLevel: 'policy',
    domains: ['composite'],
    displayString: 'Internal cadence policy',
  }),

  // --------------------------------------------------------------------------
  // KDIGO — CKD guidelines 2024
  // --------------------------------------------------------------------------
  KDIGO_2024_CKD: ref({
    id: 'KDIGO_2024_CKD',
    families: ['KDIGO'],
    shortLabel: 'KDIGO 2024 CKD',
    year: 2024,
    section: null,
    title: 'KDIGO 2024 Clinical Practice Guideline for the Evaluation and Management of Chronic Kidney Disease',
    url: 'https://kdigo.org/guidelines/ckd-evaluation-and-management/',
    evidenceLevel: 'A',
    domains: ['renal'],
    displayString: 'KDIGO 2024 CKD',
  }),

  // --------------------------------------------------------------------------
  // NCEP — US National Cholesterol Education Program
  // --------------------------------------------------------------------------
  NCEP_ATP_III: ref({
    id: 'NCEP_ATP_III',
    families: ['NCEP'],
    shortLabel: 'NCEP ATP III',
    year: 2001,
    section: null,
    title: 'NCEP Expert Panel on Detection, Evaluation, and Treatment of High Blood Cholesterol in Adults — Adult Treatment Panel III (ATP III, updated 2004)',
    url: 'https://www.nhlbi.nih.gov/files/docs/guidelines/atglance.pdf',
    evidenceLevel: 'A',
    domains: ['metabolic', 'cardiovascular'],
    displayString: 'NCEP ATP III',
  }),

  // --------------------------------------------------------------------------
  // PREDIMED — Mediterranean diet trial
  // --------------------------------------------------------------------------
  PREDIMED_ESC_2021: ref({
    id: 'PREDIMED_ESC_2021',
    families: ['PREDIMED', 'ESC'],
    shortLabel: 'PREDIMED (NEJM 2018) + ESC 2021',
    year: 2018,
    section: null,
    title: 'Estruch R et al. — Primary prevention of CVD with a Mediterranean diet supplemented with extra-virgin olive oil or nuts (NEJM 2018) + ESC 2021 CVD prevention',
    url: 'https://doi.org/10.1056/NEJMoa1800389',
    evidenceLevel: 'A',
    domains: ['cardiovascular', 'lifestyle'],
    displayString: 'Estruch et al. PREDIMED (NEJM 2018) + ESC 2021',
  }),

  // --------------------------------------------------------------------------
  // WHO — Physical activity
  // --------------------------------------------------------------------------
  WHO_2020_ACTIVITY: ref({
    id: 'WHO_2020_ACTIVITY',
    families: ['WHO'],
    shortLabel: 'WHO 2020 Physical Activity',
    year: 2020,
    section: null,
    title: 'WHO 2020 Guidelines on Physical Activity and Sedentary Behaviour',
    url: 'https://www.who.int/publications/i/item/9789240015128',
    evidenceLevel: 'A',
    domains: ['lifestyle', 'cardiovascular'],
    displayString: 'WHO 2020 Physical Activity',
  }),
} as const satisfies Record<string, GuidelineReference>;

// ============================================================================
// Derived types & helpers
// ============================================================================

/** Union of catalog keys — used by engines to reference an entry by id. */
export type GuidelineId = keyof typeof GUIDELINES;

/**
 * Return the legacy `guidelineSource` string for a catalog entry. Engines
 * call this instead of writing the free-text string inline, so the
 * citation stays in sync with the registry.
 */
export function guidelineSource(id: GuidelineId): string {
  return GUIDELINES[id].displayString;
}

/** Look up the full structured reference by id. */
export function getGuideline(id: GuidelineId): GuidelineReference {
  return GUIDELINES[id];
}

/**
 * Reverse index: legacy `displayString` → catalog entry. Built lazily on
 * first access so unit tests that import only the registry don't pay the
 * cost when they don't need the lookup.
 *
 * Used by WS6 to resolve the `guidelineSource` string already persisted
 * on `FollowUpItem` / `ScreeningItem` / `LifestyleRecommendation` rows
 * into the structured reference for rendering.
 */
let _byDisplayString: Map<string, GuidelineReference> | null = null;
function displayStringIndex(): Map<string, GuidelineReference> {
  if (_byDisplayString) return _byDisplayString;
  const idx = new Map<string, GuidelineReference>();
  for (const ref of Object.values(GUIDELINES) as GuidelineReference[]) {
    idx.set(ref.displayString, ref);
  }
  _byDisplayString = idx;
  return idx;
}

/**
 * Resolve a legacy free-text guideline source (e.g. "ESC 2021 CVD prevention")
 * to its structured catalog entry. Returns `null` when the string is not
 * registered — callers should fall back to rendering the raw string.
 */
export function findGuidelineByDisplayString(s: string): GuidelineReference | null {
  return displayStringIndex().get(s) ?? null;
}

/**
 * Return every catalog entry that matches one of the given families,
 * preserving iteration order of the registry. Useful for the WS6
 * "Reference framework" section of the PDF.
 */
export function listGuidelinesByFamily(
  families: readonly GuidelineFamily[],
): GuidelineReference[] {
  const needle = new Set(families);
  return (Object.values(GUIDELINES) as GuidelineReference[])
    .filter((ref) => ref.families.some((f) => needle.has(f)));
}

/** Convenience: evidence-level bucket of a catalog entry. */
export function evidenceLevelOf(id: GuidelineId): EvidenceLevel {
  return GUIDELINES[id].evidenceLevel;
}
