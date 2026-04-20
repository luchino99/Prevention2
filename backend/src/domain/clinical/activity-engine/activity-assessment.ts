/**
 * Physical Activity Assessment Engine
 * Assesses physical activity as a clinical risk factor for cardio-metabolic health
 * NOT a fitness program tracker - focuses on cardiovascular benefit
 *
 * WHO Guidelines:
 * - >=150 min/week moderate intensity OR >=75 min/week vigorous intensity = sufficient
 * - 75-149 min/week moderate (or equivalent) = borderline
 * - <75 min/week moderate = insufficient
 * - >300 min/week = active (exceeds guidelines)
 *
 * Zero side effects - pure calculation only
 */

// ============================================================================
// Type Definitions
// ============================================================================

export type ActivityQualitativeBand =
  | 'insufficient'
  | 'borderline'
  | 'sufficient'
  | 'active';

export interface ActivityAssessment {
  minutesPerWeek: number | null;
  qualitativeBand: ActivityQualitativeBand;
  meetsWhoGuidelines: boolean;
  sedentaryRiskLevel: 'low' | 'moderate' | 'high' | 'very_high';
}

export interface ActivityInput {
  minutesPerWeek?: number;
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

// ============================================================================
// Helper Functions (Pure)
// ============================================================================

/**
 * Normalize intensity level to determine if activity counts toward WHO guidelines
 * Moderate = walk/leisurely cycling/light sports
 * Vigorous = running/fast cycling/competitive sports
 * Light = gentle movement
 */
function normalizeIntensity(intensity?: string): 'light' | 'moderate' | 'vigorous' {
  if (!intensity) {
    return 'moderate'; // default assumption
  }

  const norm = intensity.toLowerCase().trim();

  if (norm.includes('vigorous') || norm.includes('high') || norm.includes('intense')) {
    return 'vigorous';
  }
  if (norm.includes('light') || norm.includes('gentle') || norm.includes('easy')) {
    return 'light';
  }

  // default to moderate
  return 'moderate';
}

/**
 * Convert vigorous minutes to moderate equivalent
 * Vigorous activity provides roughly 2x the cardiovascular benefit
 * 1 min vigorous ≈ 2 min moderate
 */
function equivalentModerateMinutes(
  minutesPerWeek: number,
  intensity: 'light' | 'moderate' | 'vigorous',
): number {
  if (intensity === 'vigorous') {
    return minutesPerWeek * 2;
  }
  if (intensity === 'light') {
    // Light activity doesn't count toward WHO guidelines
    return 0;
  }
  // moderate
  return minutesPerWeek;
}

/**
 * Determine if WHO guidelines are met
 */
function checkWhoGuidelines(
  minutesPerWeek: number | null,
  intensity: 'light' | 'moderate' | 'vigorous',
): boolean {
  if (minutesPerWeek === null || minutesPerWeek < 0) {
    return false;
  }

  if (intensity === 'vigorous') {
    return minutesPerWeek >= WHO_VIGOROUS_WEEKLY_MIN;
  }

  if (intensity === 'light') {
    return false; // light activity doesn't meet guidelines
  }

  // moderate
  return minutesPerWeek >= WHO_MODERATE_WEEKLY_MIN;
}

/**
 * Categorize activity into qualitative band
 */
function categorizeBand(
  minutesPerWeek: number | null,
  intensity: 'light' | 'moderate' | 'vigorous',
): ActivityQualitativeBand {
  if (minutesPerWeek === null || minutesPerWeek <= 0) {
    return 'insufficient';
  }

  if (intensity === 'vigorous') {
    if (minutesPerWeek >= ACTIVE_WEEKLY_MIN) {
      return 'active';
    }
    if (minutesPerWeek >= WHO_VIGOROUS_WEEKLY_MIN) {
      return 'sufficient';
    }
    // Convert to moderate equivalent for borderline check
    const equivalent = equivalentModerateMinutes(minutesPerWeek, 'vigorous');
    if (equivalent >= WHO_MODERATE_WEEKLY_MIN * 0.5) {
      return 'borderline';
    }
    return 'insufficient';
  }

  if (intensity === 'light') {
    // Light activity only counts if very high volume
    if (minutesPerWeek >= 300) {
      return 'active';
    }
    if (minutesPerWeek >= 150) {
      return 'borderline';
    }
    return 'insufficient';
  }

  // moderate
  if (minutesPerWeek >= ACTIVE_WEEKLY_MIN) {
    return 'active';
  }
  if (minutesPerWeek >= WHO_MODERATE_WEEKLY_MIN) {
    return 'sufficient';
  }
  if (minutesPerWeek >= 75) {
    return 'borderline';
  }
  return 'insufficient';
}

/**
 * Determine sedentary risk level based on activity
 * Inverse relationship: high activity = low risk
 */
function calculateSedentaryRisk(
  band: ActivityQualitativeBand,
): 'low' | 'moderate' | 'high' | 'very_high' {
  switch (band) {
    case 'active':
      return 'low';
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
 * Assess physical activity as a clinical risk factor
 *
 * Evaluates activity against WHO guidelines (150 min/week moderate or 75 min/week vigorous)
 * and determines sedentary risk level.
 *
 * @param input - ActivityInput with minutesPerWeek, intensityLevel, etc.
 * @returns ActivityAssessment with qualitative band, WHO compliance, and risk level
 *
 * @example
 * const assessment = assessActivity({
 *   minutesPerWeek: 180,
 *   intensityLevel: 'moderate'
 * });
 * // assessment.qualitativeBand = 'sufficient'
 * // assessment.meetsWhoGuidelines = true
 * // assessment.sedentaryRiskLevel = 'low'
 *
 * @example
 * const assessment = assessActivity({
 *   minutesPerWeek: 100
 * });
 * // assessment.qualitativeBand = 'borderline'
 * // assessment.meetsWhoGuidelines = false
 * // assessment.sedentaryRiskLevel = 'moderate'
 */
export function assessActivity(input: ActivityInput): ActivityAssessment {
  const {
    minutesPerWeek: rawMinutes,
    frequency: _frequency, // not used in calculation but accepted
    activityType: _activityType, // not used in calculation but accepted
    intensityLevel: rawIntensity,
  } = input;

  // Normalize inputs
  const minutesPerWeek =
    rawMinutes !== undefined && rawMinutes > 0 ? rawMinutes : null;
  const intensity = normalizeIntensity(rawIntensity);

  // Determine qualitative band
  const qualitativeBand = categorizeBand(minutesPerWeek, intensity);

  // Check WHO guidelines
  const meetsWhoGuidelines = checkWhoGuidelines(minutesPerWeek, intensity);

  // Calculate sedentary risk
  const sedentaryRiskLevel = calculateSedentaryRisk(qualitativeBand);

  return {
    minutesPerWeek,
    qualitativeBand,
    meetsWhoGuidelines,
    sedentaryRiskLevel,
  };
}
