/**
 * Physical Activity Assessment Engine.
 *
 * Assesses physical activity as a clinical risk factor for cardio-metabolic
 * health. NOT a fitness program tracker — the goal is to characterise
 * cardiovascular benefit and sedentary risk against validated guidelines.
 *
 * WHO 2020 guidelines (adults):
 *   - ≥150 min/week moderate OR ≥75 min/week vigorous aerobic activity
 *     (or an equivalent combination) meets the physical-activity target.
 *   - Prolonged sedentary behaviour is an INDEPENDENT cardiovascular risk
 *     factor (ESC 2021 CVD prevention §3). ≥8 hours/day sitting is the
 *     canonical cut-off used by ESC for elevated risk signalling.
 *
 * WHO/GPAQ MET-minutes methodology (WS5):
 *   - 1 minute of moderate activity ≈ 4 METs
 *   - 1 minute of vigorous activity ≈ 8 METs
 *   - Total MET-minutes/week = moderate × 4 + vigorous × 8
 *   - WHO MVPA target equivalent: ≥600 MET-minutes/week
 *   - High activity equivalent: ≥3000 MET-minutes/week
 *
 * Zero side effects — pure calculation only.
 */

// ============================================================================
// Type Definitions
// ============================================================================

export type ActivityQualitativeBand =
  | 'insufficient'
  | 'borderline'
  | 'sufficient'
  | 'active';

export type SedentaryBand = 'low' | 'moderate' | 'high' | 'very_high';

export interface ActivityAssessment {
  /**
   * Best-available aggregate of weekly activity minutes. When the caller
   * provides the MET split, this is `moderate + vigorous`; otherwise it
   * falls back to the legacy `minutesPerWeek`.
   */
  minutesPerWeek: number | null;
  /** Minutes/week of moderate-intensity activity, when supplied. */
  moderateMinutesPerWeek: number | null;
  /** Minutes/week of vigorous-intensity activity, when supplied. */
  vigorousMinutesPerWeek: number | null;
  /**
   * WHO/GPAQ MET-minutes/week. `null` when neither the MET split nor a
   * legacy aggregate was provided.
   */
  metMinutesPerWeek: number | null;
  qualitativeBand: ActivityQualitativeBand;
  meetsWhoGuidelines: boolean;
  /**
   * Risk signal from sedentary behaviour. Derived primarily from
   * `sedentaryHoursPerDay` when supplied; otherwise inferred from the
   * activity qualitative band for backward compatibility.
   */
  sedentaryRiskLevel: SedentaryBand;
  /** Average daily sedentary hours echoed for downstream consumers. */
  sedentaryHoursPerDay: number | null;
}

export interface ActivityInput {
  /**
   * Legacy aggregate input. When present and the MET split is absent,
   * we still produce a meaningful assessment for backward compatibility.
   */
  minutesPerWeek?: number;
  /** Minutes/week of moderate-intensity activity (WS5). */
  moderateMinutesPerWeek?: number;
  /** Minutes/week of vigorous-intensity activity (WS5). */
  vigorousMinutesPerWeek?: number;
  /** Average daily sedentary hours (WS5). */
  sedentaryHoursPerDay?: number;
  frequency?: number;
  activityType?: string;
  intensityLevel?: string;
}

// ============================================================================
// Constants
// ============================================================================

const WHO_MODERATE_WEEKLY_MIN = 150;
const WHO_VIGOROUS_WEEKLY_MIN = 75;
const ACTIVE_WEEKLY_MIN = 300;

/** WHO/GPAQ nominal MET values (moderate ≈ 4, vigorous ≈ 8). */
const MET_MODERATE = 4;
const MET_VIGOROUS = 8;

/**
 * MVPA WHO target expressed in MET-minutes/week. Derived from the lower
 * bound of the guideline: 150 min × 4 METs = 600.
 */
const MET_MINUTES_WHO_TARGET = 600;

/** "Highly active" threshold — matches 300 min moderate × 4 METs = 1200, but
 * the WHO/IPAQ classification uses 3000 MET-min for the "high" HEPA tier,
 * so we mirror that to stay consistent with published epidemiology. */
const MET_MINUTES_HIGH = 3000;

/** ESC 2021 cut-off: ≥8 h/day sedentary = elevated CV risk. */
const SEDENTARY_HIGH_H = 8;
/** Emerging literature: ≥10 h/day sedentary = very-high CV risk signal. */
const SEDENTARY_VERY_HIGH_H = 10;

// ============================================================================
// Helper Functions (Pure)
// ============================================================================

/**
 * Normalize intensity level to determine if activity counts toward WHO
 * guidelines.
 *   moderate = brisk walking / leisurely cycling / light sports
 *   vigorous = running / fast cycling / competitive sports
 *   light    = gentle movement
 */
function normalizeIntensity(intensity?: string): 'light' | 'moderate' | 'vigorous' {
  if (!intensity) return 'moderate';
  const norm = intensity.toLowerCase().trim();
  if (norm.includes('vigorous') || norm.includes('high') || norm.includes('intense')) {
    return 'vigorous';
  }
  if (norm.includes('light') || norm.includes('gentle') || norm.includes('easy')) {
    return 'light';
  }
  return 'moderate';
}

/**
 * Equivalent moderate-minutes conversion used when the caller supplies
 * only a legacy aggregate (`minutesPerWeek` + `intensityLevel`).
 */
function equivalentModerateMinutes(
  minutesPerWeek: number,
  intensity: 'light' | 'moderate' | 'vigorous',
): number {
  if (intensity === 'vigorous') return minutesPerWeek * 2;
  if (intensity === 'light') return 0;
  return minutesPerWeek;
}

/**
 * MVPA guideline compliance for legacy aggregate inputs.
 */
function checkWhoGuidelinesLegacy(
  minutesPerWeek: number | null,
  intensity: 'light' | 'moderate' | 'vigorous',
): boolean {
  if (minutesPerWeek === null || minutesPerWeek < 0) return false;
  if (intensity === 'vigorous') return minutesPerWeek >= WHO_VIGOROUS_WEEKLY_MIN;
  if (intensity === 'light') return false;
  return minutesPerWeek >= WHO_MODERATE_WEEKLY_MIN;
}

/**
 * Qualitative band derived from the legacy aggregate input.
 */
function categorizeBandLegacy(
  minutesPerWeek: number | null,
  intensity: 'light' | 'moderate' | 'vigorous',
): ActivityQualitativeBand {
  if (minutesPerWeek === null || minutesPerWeek <= 0) return 'insufficient';

  if (intensity === 'vigorous') {
    if (minutesPerWeek >= ACTIVE_WEEKLY_MIN) return 'active';
    if (minutesPerWeek >= WHO_VIGOROUS_WEEKLY_MIN) return 'sufficient';
    const equivalent = equivalentModerateMinutes(minutesPerWeek, 'vigorous');
    if (equivalent >= WHO_MODERATE_WEEKLY_MIN * 0.5) return 'borderline';
    return 'insufficient';
  }

  if (intensity === 'light') {
    if (minutesPerWeek >= 300) return 'active';
    if (minutesPerWeek >= 150) return 'borderline';
    return 'insufficient';
  }

  if (minutesPerWeek >= ACTIVE_WEEKLY_MIN) return 'active';
  if (minutesPerWeek >= WHO_MODERATE_WEEKLY_MIN) return 'sufficient';
  if (minutesPerWeek >= 75) return 'borderline';
  return 'insufficient';
}

/**
 * Qualitative band derived from the MET split. The equivalence rule
 * (1 vigorous min ≈ 2 moderate min) is embedded in the WHO
 * MET-minutes/week target (600).
 */
function categorizeBandFromMet(metMinutesPerWeek: number): ActivityQualitativeBand {
  if (metMinutesPerWeek <= 0) return 'insufficient';
  if (metMinutesPerWeek >= MET_MINUTES_HIGH) return 'active';
  if (metMinutesPerWeek >= MET_MINUTES_WHO_TARGET) return 'sufficient';
  // Half the WHO target = borderline.
  if (metMinutesPerWeek >= MET_MINUTES_WHO_TARGET / 2) return 'borderline';
  return 'insufficient';
}

/**
 * Sedentary risk level. When `sedentaryHoursPerDay` is supplied, it drives
 * the output independently of activity (per ESC 2021 §3). Otherwise we
 * fall back to the inverse of the activity band so the return value is
 * never an arbitrary default.
 */
function calculateSedentaryRisk(
  sedentaryHoursPerDay: number | null,
  band: ActivityQualitativeBand,
): SedentaryBand {
  if (sedentaryHoursPerDay !== null) {
    if (sedentaryHoursPerDay >= SEDENTARY_VERY_HIGH_H) return 'very_high';
    if (sedentaryHoursPerDay >= SEDENTARY_HIGH_H) return 'high';
    if (sedentaryHoursPerDay >= 6) return 'moderate';
    return 'low';
  }
  switch (band) {
    case 'active':
    case 'sufficient':
      return 'low';
    case 'borderline':
      return 'moderate';
    case 'insufficient':
      return 'high';
  }
}

// ============================================================================
// Main Activity Assessment Function (Pure)
// ============================================================================

/**
 * Assess physical activity as a clinical risk factor.
 *
 * Selection logic:
 *   1. If `moderateMinutesPerWeek` and/or `vigorousMinutesPerWeek` are
 *      supplied (WS5 path), compute MET-minutes and use the WHO MET-based
 *      banding. `minutesPerWeek` in the output reflects the aggregate of
 *      moderate + vigorous for consistency with legacy consumers.
 *   2. Otherwise fall back to the legacy `minutesPerWeek` + `intensityLevel`
 *      aggregate. This keeps old snapshots and callers working unchanged.
 *
 * @returns ActivityAssessment — pure function of the input.
 */
export function assessActivity(input: ActivityInput): ActivityAssessment {
  const {
    minutesPerWeek: rawMinutes,
    moderateMinutesPerWeek: rawModerate,
    vigorousMinutesPerWeek: rawVigorous,
    sedentaryHoursPerDay: rawSedentary,
    frequency: _frequency,
    activityType: _activityType,
    intensityLevel: rawIntensity,
  } = input;
  void _frequency;
  void _activityType;

  // Normalize the MET split. We treat any non-finite / negative entry as
  // "not provided" (null) rather than 0 to distinguish missing data from
  // a truthful zero.
  const moderate =
    typeof rawModerate === 'number' && Number.isFinite(rawModerate) && rawModerate >= 0
      ? rawModerate
      : null;
  const vigorous =
    typeof rawVigorous === 'number' && Number.isFinite(rawVigorous) && rawVigorous >= 0
      ? rawVigorous
      : null;
  const sedentary =
    typeof rawSedentary === 'number' && Number.isFinite(rawSedentary) && rawSedentary >= 0
      ? rawSedentary
      : null;

  const hasMetSplit = moderate !== null || vigorous !== null;

  let minutesPerWeek: number | null = null;
  let metMinutesPerWeek: number | null = null;
  let qualitativeBand: ActivityQualitativeBand;
  let meetsWhoGuidelines: boolean;

  if (hasMetSplit) {
    const mod = moderate ?? 0;
    const vig = vigorous ?? 0;
    minutesPerWeek = mod + vig;
    metMinutesPerWeek = mod * MET_MODERATE + vig * MET_VIGOROUS;
    qualitativeBand = categorizeBandFromMet(metMinutesPerWeek);
    meetsWhoGuidelines = metMinutesPerWeek >= MET_MINUTES_WHO_TARGET;
  } else {
    const intensity = normalizeIntensity(rawIntensity);
    minutesPerWeek =
      typeof rawMinutes === 'number' && Number.isFinite(rawMinutes) && rawMinutes > 0
        ? rawMinutes
        : null;
    qualitativeBand = categorizeBandLegacy(minutesPerWeek, intensity);
    meetsWhoGuidelines = checkWhoGuidelinesLegacy(minutesPerWeek, intensity);
    // Best-effort MET estimate so downstream consumers still see a number
    // when only the aggregate is provided.
    if (minutesPerWeek !== null) {
      const met =
        intensity === 'vigorous' ? MET_VIGOROUS :
        intensity === 'light' ? 2 :
        MET_MODERATE;
      metMinutesPerWeek = minutesPerWeek * met;
    }
  }

  const sedentaryRiskLevel = calculateSedentaryRisk(sedentary, qualitativeBand);

  return {
    minutesPerWeek,
    moderateMinutesPerWeek: moderate,
    vigorousMinutesPerWeek: vigorous,
    metMinutesPerWeek,
    qualitativeBand,
    meetsWhoGuidelines,
    sedentaryRiskLevel,
    sedentaryHoursPerDay: sedentary,
  };
}
