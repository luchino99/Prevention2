/**
 * Uelfy Clinical — published clinical reference bands for longitudinal charts.
 * ---------------------------------------------------------------------------
 * **Display-only**. These bands are NEVER consumed by the deterministic score
 * engine; they are solely a visual aid so a clinician can see, at a glance,
 * whether a longitudinal data point sits in a published threshold tier.
 *
 * Contract for each series:
 *   tiers: ordered lowest-to-highest cutoff, each with:
 *     - max:   exclusive upper bound of this tier, or `null` for the
 *              open top tier. A value equal to `max` falls into the
 *              NEXT tier (i.e. `[prev, max)`).
 *     - label: human-readable tier label (kept concise — legend pill)
 *     - band:  'ok' | 'warning' | 'danger' → mapped to CSS band colour
 *   direction: 'higher-is-worse' | 'lower-is-worse'
 *              — used only for delta favourability colouring in the card
 *              header; NEVER used to re-compute bands.
 *   source:    guideline citation string (short form, kept auditable).
 *   note:      optional caveat displayed in small muted text below the
 *              legend (e.g. when the cutoffs apply only within an age range).
 *
 * To preserve the "protected clinical logic" discipline established in
 * the project instructions, any change to this file must:
 *   (a) cite a published guideline,
 *   (b) be strictly display-only,
 *   (c) not propagate into the score engine.
 * -------------------------------------------------------------------------
 */

export const THRESHOLDS = Object.freeze({
  // ───────── Cardiovascular ─────────
  // SCORE2 and SCORE2-Diabetes have age-dependent cutoffs (ESC 2021 §4.2):
  // • age <50:     low <2.5, moderate <7.5, high ≥7.5
  // • age 50–69:   low <5,   moderate <10,  high ≥10
  // • age ≥70:     low <7.5, moderate <15,  high ≥15
  // We display the mid-bracket (50–69) which is also the engine's current
  // operating range, and carry the caveat in `note`.
  score2: {
    tiers: [
      { max: 5,    label: 'Low',               band: 'ok' },
      { max: 10,   label: 'Moderate',          band: 'warning' },
      { max: null, label: 'High / Very high',  band: 'danger' },
    ],
    direction: 'higher-is-worse',
    source: 'ESC 2021 · SCORE2 (age 50–69)',
    note: 'Cutoffs shown for age 50–69. Different bands apply to <50 (2.5/7.5%) and ≥70 (7.5/15%).',
  },
  score2Diabetes: {
    tiers: [
      { max: 5,    label: 'Low',               band: 'ok' },
      { max: 10,   label: 'Moderate',          band: 'warning' },
      { max: null, label: 'High / Very high',  band: 'danger' },
    ],
    direction: 'higher-is-worse',
    source: 'ESC 2021 · SCORE2-Diabetes (age 50–69)',
    note: 'Same age-dependent brackets as SCORE2.',
  },

  // ───────── Metabolic ─────────
  // ADA Standards of Care 2024 — Classification & Diagnosis.
  hba1c: {
    tiers: [
      { max: 5.7,  label: 'Normal',        band: 'ok' },
      { max: 6.5,  label: 'Prediabetes',   band: 'warning' },
      { max: null, label: 'Diabetes',      band: 'danger' },
    ],
    direction: 'higher-is-worse',
    source: 'ADA 2024 · Standards of Care §2',
  },
  glucose: {
    tiers: [
      { max: 100,  label: 'Normal',         band: 'ok' },
      { max: 126,  label: 'IFG',            band: 'warning' },
      { max: null, label: 'Diabetes range', band: 'danger' },
    ],
    direction: 'higher-is-worse',
    source: 'ADA 2024 · Fasting plasma glucose',
  },
  // NCEP ATP III — metabolic syndrome = ≥3 of 5 criteria.
  metabolicSyndrome: {
    tiers: [
      { max: 3,    label: 'Sub-clinical',          band: 'ok' },
      { max: null, label: 'MetS (ATP III ≥3)',     band: 'warning' },
    ],
    direction: 'higher-is-worse',
    source: 'NCEP ATP III (≥3 of 5 criteria)',
  },

  // ───────── Renal ─────────
  // KDIGO 2012 — CKD staging (eGFR and ACR).
  egfr: {
    tiers: [
      { max: 15,   label: 'G5 (failure)',      band: 'danger' },
      { max: 30,   label: 'G4',                band: 'danger' },
      { max: 60,   label: 'G3 (a/b)',          band: 'warning' },
      { max: 90,   label: 'G2',                band: 'ok' },
      { max: null, label: 'G1 (normal)',       band: 'ok' },
    ],
    direction: 'lower-is-worse',
    source: 'KDIGO 2012 · CKD GFR category',
  },
  acr: {
    tiers: [
      { max: 30,   label: 'A1 (normal)',       band: 'ok' },
      { max: 300,  label: 'A2 (moderate)',     band: 'warning' },
      { max: null, label: 'A3 (severe)',       band: 'danger' },
    ],
    direction: 'higher-is-worse',
    source: 'KDIGO 2012 · Albuminuria category',
  },

  // ───────── Hepatic ─────────
  // FIB-4 cutoffs differ above age 65 (low <2.0 instead of <1.3). We
  // display the <65 cutoffs because they are the most commonly quoted
  // and carry the age caveat in `note`.
  fib4: {
    tiers: [
      { max: 1.3,  label: 'Rule-out advanced fibrosis', band: 'ok' },
      { max: 2.67, label: 'Indeterminate',              band: 'warning' },
      { max: null, label: 'Advanced fibrosis likely',   band: 'danger' },
    ],
    direction: 'higher-is-worse',
    source: 'EASL-EASD-EASO 2024 · FIB-4',
    note: 'Cutoffs shown for age <65. For age ≥65 the rule-out cutoff shifts to 2.0.',
  },
  fli: {
    tiers: [
      { max: 30,   label: 'Rule-out steatosis', band: 'ok' },
      { max: 60,   label: 'Indeterminate',      band: 'warning' },
      { max: null, label: 'Rule-in steatosis',  band: 'danger' },
    ],
    direction: 'higher-is-worse',
    source: 'Bedogni 2006 · Fatty Liver Index',
  },

  // ───────── Lifestyle ─────────
  // PREDIMED MEDAS — Estruch et al. PREDIMED trial (NEJM 2013 / 2018).
  predimed: {
    tiers: [
      { max: 6,    label: 'Low adherence',      band: 'danger' },
      { max: 10,   label: 'Moderate',           band: 'warning' },
      { max: null, label: 'Good adherence',     band: 'ok' },
    ],
    direction: 'lower-is-worse',
    source: 'PREDIMED MEDAS · Estruch 2013',
  },
  // WHO 2020 Global Physical Activity Guidelines — ≥600 MET-min/week
  // is equivalent to 150 min/wk moderate or 75 min/wk vigorous.
  metMinutesPerWeek: {
    tiers: [
      { max: 600,  label: 'Below WHO target',   band: 'warning' },
      { max: null, label: 'Meets WHO ≥600',     band: 'ok' },
    ],
    direction: 'lower-is-worse',
    source: 'WHO 2020 · Physical Activity Guidelines',
  },
});

/**
 * Convenience accessor with null-safe fallback. Returns `null` when no
 * reference band is defined for the key (e.g. composite score).
 */
export function getThreshold(key) {
  if (!key) return null;
  return THRESHOLDS[key] ?? null;
}
