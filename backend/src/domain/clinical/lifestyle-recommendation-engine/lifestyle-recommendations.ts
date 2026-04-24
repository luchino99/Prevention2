/**
 * Bounded Lifestyle Recommendation Engine (WS6).
 *
 * Emits a deterministic, guideline-sourced list of lifestyle
 * recommendations from the patient's already-computed clinical context.
 * Scope is intentionally BOUNDED:
 *
 *   - The engine does NOT prescribe training plans, diet plans, or
 *     detailed workout programs. It stays within the "lifestyle
 *     counselling" perimeter explicitly permitted by the project
 *     blueprint (cardio-nephro-metabolic vertical, B2B clinical tool —
 *     NOT consumer fitness coaching).
 *   - Each recommendation is a short, evidence-backed nudge mapped to a
 *     specific guideline source.
 *   - The engine is a pure function: same input → same output, zero I/O,
 *     zero side effects.
 *   - It never overrides deterministic clinical scores, never replaces
 *     clinician judgement, and carries `authority: 'supportive'` on every
 *     entry to make that contract explicit to the UI/PDF consumers.
 *
 * The engine reads from three low-surface input shapes:
 *   1. `ActivityAssessment` from the activity-engine (WS5-aware).
 *   2. `NutritionSummary` from the nutrition-engine (PREDIMED-aware).
 *   3. A narrow `ClinicalSnapshot` projection of the assessment labs and
 *      context. We do NOT accept the full `AssessmentInput` here so that
 *      the engine remains independent of the shared schema and can be
 *      unit-tested without fixture sprawl.
 */

import type { ActivityAssessment } from '../activity-engine/activity-assessment.js';
import { GUIDELINES } from '../guideline-catalog/index.js';
import type { NutritionSummary } from '../nutrition-engine/predimed.js';

// ============================================================================
// Type Definitions
// ============================================================================

export type RecommendationDomain =
  | 'activity'
  | 'sedentary'
  | 'diet'
  | 'smoking'
  | 'alcohol'
  | 'weight'
  | 'sleep'
  | 'hydration';

export type RecommendationPriority = 'routine' | 'moderate' | 'urgent';

export interface LifestyleRecommendation {
  /** Stable identifier for persistence and UI dedup. */
  code: string;
  /** Clinical domain the nudge belongs to. */
  domain: RecommendationDomain;
  /** Short imperative title (clinician-facing). */
  title: string;
  /** Rationale grounded in the patient's own data. */
  rationale: string;
  /** Relative urgency. */
  priority: RecommendationPriority;
  /**
   * Authority stance: the engine is always supportive — NOT authoritative.
   * Kept as a literal field so the UI cannot accidentally label a
   * recommendation as a prescription.
   */
  authority: 'supportive';
  /** Guideline citation (string, not a free-form note). */
  guidelineSource: string;
}

/**
 * Narrow projection of the fields the engine needs. Building this shape
 * in the caller keeps the engine decoupled from the assessment pipeline
 * and keeps the unit-test surface small.
 */
export interface ClinicalSnapshot {
  /** Current smoker flag. */
  smoking: boolean;
  /** Existing diabetes diagnosis. */
  hasDiabetes: boolean;
  /** Existing hypertension diagnosis. */
  hypertension: boolean;
  /** Body-mass index (kg/m²), when derivable. */
  bmi?: number;
  /** Waist circumference (cm), when supplied. */
  waistCm?: number;
  /** Patient biological sex — used for waist thresholds. */
  sex?: 'male' | 'female';
  /** Systolic blood pressure (mmHg). */
  sbpMmHg?: number;
  /** LDL cholesterol (mg/dL). */
  ldlMgDl?: number;
  /** HbA1c (%) — used for dietary carbohydrate signal in diabetics. */
  hba1cPct?: number;
  /** Fasting glucose (mg/dL). */
  glucoseMgDl?: number;
}

export interface LifestyleRecommendationInput {
  snapshot: ClinicalSnapshot;
  activity?: ActivityAssessment | null;
  nutrition?: NutritionSummary | null;
}

// ============================================================================
// Individual rules
// ============================================================================

/**
 * Smoking cessation — ESC 2021 class I, level A.
 * Intentionally conservative: no electronic-cigarette advice, no specific
 * pharmacotherapy — the clinician owns that decision.
 */
function smokingRule(snapshot: ClinicalSnapshot): LifestyleRecommendation | null {
  if (!snapshot.smoking) return null;
  return {
    code: 'ls_smoking_cessation',
    domain: 'smoking',
    title: 'Smoking cessation counselling',
    rationale:
      'Current smoker — cessation reduces 10-year CVD risk by ~35% at 1 year.',
    priority: 'urgent',
    authority: 'supportive',
    guidelineSource: GUIDELINES.ESC_2021_PREVENTION_S4.displayString,
  };
}

/**
 * MVPA target — rely on the activity assessor for the banding decision.
 * Supplies the WHO quantitative target in the rationale so the clinician
 * can anchor the conversation on numbers.
 */
function mvpaRule(activity: ActivityAssessment | null | undefined): LifestyleRecommendation | null {
  if (!activity) return null;
  if (activity.qualitativeBand === 'sufficient' || activity.qualitativeBand === 'active') {
    return null;
  }
  const metMin = activity.metMinutesPerWeek;
  return {
    code: 'ls_increase_mvpa',
    domain: 'activity',
    title: 'Increase moderate-to-vigorous physical activity',
    rationale:
      metMin !== null
        ? `Currently ${Math.round(metMin)} MET-min/week (WHO target ≥600).`
        : 'Current activity below the WHO MVPA target of 150 min/week moderate or 75 min/week vigorous.',
    priority: activity.qualitativeBand === 'insufficient' ? 'moderate' : 'routine',
    authority: 'supportive',
    guidelineSource: GUIDELINES.WHO_2020_ACTIVITY.displayString,
  };
}

/**
 * Sedentary behaviour nudge — triggered independently of MVPA status
 * because long sedentary time is an INDEPENDENT CV risk factor
 * (ESC 2021 §3).
 */
function sedentaryRule(activity: ActivityAssessment | null | undefined): LifestyleRecommendation | null {
  if (!activity) return null;
  if (activity.sedentaryRiskLevel === 'low') return null;
  const hours = activity.sedentaryHoursPerDay;
  return {
    code: 'ls_reduce_sedentary',
    domain: 'sedentary',
    title: 'Reduce daily sedentary time',
    rationale:
      hours !== null
        ? `Self-reported ~${hours.toFixed(1)} h/day sedentary (≥8 h is an independent CV risk signal).`
        : 'Sedentary risk band above low — introduce light activity breaks every 30–60 min.',
    priority:
      activity.sedentaryRiskLevel === 'very_high' ? 'moderate' :
      activity.sedentaryRiskLevel === 'high' ? 'moderate' :
      'routine',
    authority: 'supportive',
    guidelineSource: GUIDELINES.ESC_2021_PREVENTION_S3.displayString,
  };
}

/**
 * Mediterranean-diet adherence — supportive nudge tied to PREDIMED band.
 * Deliberately does NOT provide a meal plan.
 */
function mediterraneanDietRule(
  nutrition: NutritionSummary | null | undefined,
): LifestyleRecommendation | null {
  if (!nutrition || nutrition.predimedScore === null) return null;
  if (nutrition.adherenceBand === 'high') return null;
  const score = nutrition.predimedScore;
  return {
    code: 'ls_mediterranean_diet',
    domain: 'diet',
    title: 'Improve Mediterranean diet adherence',
    rationale:
      `PREDIMED MEDAS = ${score}/14 (band = ${nutrition.adherenceBand ?? 'unknown'}). `
        + 'Target ≥10/14 — emphasise olive oil, vegetables, legumes, fish; reduce red/processed meat and pastries.',
    priority: nutrition.adherenceBand === 'low' ? 'moderate' : 'routine',
    authority: 'supportive',
    guidelineSource: GUIDELINES.PREDIMED_ESC_2021.displayString,
  };
}

/**
 * Weight / waist-circumference nudge — fires on either elevated BMI or
 * sex-specific waist threshold (ATP III / ESC 2021).
 */
function weightRule(snapshot: ClinicalSnapshot): LifestyleRecommendation | null {
  const bmi = typeof snapshot.bmi === 'number' ? snapshot.bmi : null;
  const waist = typeof snapshot.waistCm === 'number' ? snapshot.waistCm : null;
  const waistCutoff =
    snapshot.sex === 'female' ? 88 :
    snapshot.sex === 'male' ? 102 :
    null;

  const bmiElevated = bmi !== null && bmi >= 25;
  const waistElevated =
    waist !== null && waistCutoff !== null && waist >= waistCutoff;

  if (!bmiElevated && !waistElevated) return null;

  const parts: string[] = [];
  if (bmi !== null) parts.push(`BMI ${bmi.toFixed(1)} kg/m²`);
  if (waist !== null) parts.push(`waist ${waist.toFixed(0)} cm`);
  const priority: RecommendationPriority =
    (bmi !== null && bmi >= 30) ? 'moderate' : 'routine';

  return {
    code: 'ls_weight_reduction',
    domain: 'weight',
    title: 'Structured weight reduction counselling',
    rationale:
      parts.join(', ')
        + ' — a 5–10% weight loss improves glycaemia, lipid profile and BP.',
    priority,
    authority: 'supportive',
    guidelineSource: GUIDELINES.ESC_2021_NCEP.displayString,
  };
}

/**
 * Sodium reduction nudge — gated on elevated SBP or documented hypertension.
 * Avoids diagnosing hypertension from a single reading.
 */
function saltRule(snapshot: ClinicalSnapshot): LifestyleRecommendation | null {
  const sbpHigh = typeof snapshot.sbpMmHg === 'number' && snapshot.sbpMmHg >= 140;
  if (!sbpHigh && !snapshot.hypertension) return null;
  return {
    code: 'ls_sodium_reduction',
    domain: 'diet',
    title: 'Dietary sodium reduction',
    rationale:
      (snapshot.hypertension ? 'Known hypertension. ' : '')
        + (sbpHigh ? `Measured SBP ${snapshot.sbpMmHg} mmHg. ` : '')
        + 'Target <5 g/day sodium — reduce processed foods and added salt.',
    priority: 'moderate',
    authority: 'supportive',
    guidelineSource: GUIDELINES.ESC_ESH_2023_HTN.displayString,
  };
}

/**
 * Saturated-fat reduction nudge — gated on elevated LDL.
 * Kept generic; no specific food plan.
 */
function saturatedFatRule(snapshot: ClinicalSnapshot): LifestyleRecommendation | null {
  const ldl = typeof snapshot.ldlMgDl === 'number' ? snapshot.ldlMgDl : null;
  if (ldl === null || ldl < 130) return null;
  return {
    code: 'ls_saturated_fat_reduction',
    domain: 'diet',
    title: 'Reduce saturated-fat intake',
    rationale:
      `LDL-C ${ldl.toFixed(0)} mg/dL — shift to mono/polyunsaturated fats, limit tropical oils and fatty red meat.`,
    priority: ldl >= 190 ? 'moderate' : 'routine',
    authority: 'supportive',
    guidelineSource: GUIDELINES.ESC_EAS_2019_LIPIDS.displayString,
  };
}

/**
 * Carbohydrate-quality nudge — fires only for diabetic or pre-diabetic
 * patients with elevated HbA1c or glucose. The recommendation is
 * "quality of carbs", NOT a prescriptive diet plan.
 */
function carbQualityRule(snapshot: ClinicalSnapshot): LifestyleRecommendation | null {
  const hba1c = typeof snapshot.hba1cPct === 'number' ? snapshot.hba1cPct : null;
  const glucose = typeof snapshot.glucoseMgDl === 'number' ? snapshot.glucoseMgDl : null;
  const trigger =
    (snapshot.hasDiabetes && hba1c !== null && hba1c > 7) ||
    (hba1c !== null && hba1c >= 5.7 && hba1c < 6.5) ||
    (glucose !== null && glucose >= 100 && glucose < 126);
  if (!trigger) return null;
  return {
    code: 'ls_carb_quality',
    domain: 'diet',
    title: 'Improve carbohydrate quality',
    rationale:
      (hba1c !== null ? `HbA1c ${hba1c.toFixed(1)}%. ` : '')
        + (glucose !== null ? `Fasting glucose ${glucose.toFixed(0)} mg/dL. ` : '')
        + 'Favour whole grains, legumes, vegetables; limit refined sugars and white flour.',
    priority: snapshot.hasDiabetes ? 'moderate' : 'routine',
    authority: 'supportive',
    guidelineSource: GUIDELINES.ADA_SOC_2024_S5.displayString,
  };
}

// ============================================================================
// Main entry
// ============================================================================

/**
 * Derive the full bounded list of lifestyle recommendations.
 *
 * Pure function — all date/random sources are excluded. The order of
 * emission is stable (defined by the rule invocation order below) so
 * persisted snapshots remain byte-equivalent across rehydrations.
 */
export function deriveLifestyleRecommendations(
  input: LifestyleRecommendationInput,
): LifestyleRecommendation[] {
  const { snapshot, activity = null, nutrition = null } = input;

  const items: Array<LifestyleRecommendation | null> = [
    smokingRule(snapshot),
    mvpaRule(activity),
    sedentaryRule(activity),
    mediterraneanDietRule(nutrition),
    weightRule(snapshot),
    saltRule(snapshot),
    saturatedFatRule(snapshot),
    carbQualityRule(snapshot),
  ];

  return items.filter((x): x is LifestyleRecommendation => x !== null);
}
