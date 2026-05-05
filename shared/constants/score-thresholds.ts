/**
 * Clinical score thresholds used across the platform.
 * These are the SINGLE SOURCE OF TRUTH for all score categorization.
 */

export const SCORE2_THRESHOLDS = {
  LOW: 5,        // <5% = low risk
  MODERATE: 10,  // 5-10% = moderate
  HIGH: 15,      // 10-15% = high
  // >=15% = very_high
} as const;

export const ADA_THRESHOLDS = {
  LOW: 2,        // 0-2 = low
  MODERATE: 4,   // 3-4 = moderate
  // >=5 = high
} as const;

export const FLI_THRESHOLDS = {
  EXCLUDED: 30,      // <30 = steatosis excluded
  INDETERMINATE: 60, // 30-59 = indeterminate
  // >=60 = steatosis probable
} as const;

export const FIB4_THRESHOLDS = {
  LOW: 1.45,
  HIGH: 3.25,
} as const;

export const BMI_THRESHOLDS = {
  UNDERWEIGHT: 18.5,
  NORMAL: 25,
  OVERWEIGHT: 30,
  OBESE_I: 35,
  OBESE_II: 40,
} as const;

export const EGFR_STAGES = {
  G1: 90,
  G2: 60,
  G3A: 45,
  G3B: 30,
  G4: 15,
  // <15 = G5
} as const;

export const PREDIMED_THRESHOLDS = {
  LOW: 6,       // <6 = low adherence
  HIGH: 10,     // >=10 = high adherence
  // 6-9 = medium
} as const;

export const FRAIL_THRESHOLDS = {
  ROBUST: 0,
  PRE_FRAIL: 2,
  // >=3 = frail
} as const;

export const METABOLIC_SYNDROME = {
  CRITERIA_THRESHOLD: 3,  // >=3 of 5 = present
  WAIST_MALE: 102,
  WAIST_FEMALE: 88,
  TRIGLYCERIDES: 150,
  HDL_MALE: 40,
  HDL_FEMALE: 50,
  SBP: 130,
  DBP: 85,
  GLUCOSE: 100,
} as const;

export const ACTIVITY_THRESHOLDS = {
  INSUFFICIENT: 75,
  BORDERLINE: 150,
  ACTIVE: 300,
} as const;

// Composite risk levels
export const RISK_LEVELS = ['low', 'moderate', 'high', 'very_high'] as const;
export type RiskLevel = typeof RISK_LEVELS[number];
