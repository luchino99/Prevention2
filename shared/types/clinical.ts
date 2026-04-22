/**
 * Clinical Score Engine - Shared Type Definitions
 * Pure TypeScript interfaces for all clinical assessment modules
 */

// ============================================================================
// SCORE2 / SCORE2-Diabetes Input/Output Types
// ============================================================================

export interface Score2Input {
  age: number;
  sex: 'male' | 'female';
  smoking: boolean;
  sbpMmHg: number;
  totalCholMgDl: number;
  hdlMgDl: number;
  riskRegion: 'low' | 'moderate' | 'high' | 'very_high';
}

export interface Score2Result {
  riskPercent: number;
  category: string;
  calibratedRisk: number;
  uncalibratedRisk: number;
  region: string;
}

export interface Score2DiabetesInput extends Score2Input {
  ageAtDiabetesDiagnosis: number;
  hba1cPercent: number;
  eGFR: number;
}

export interface Score2DiabetesResult extends Score2Result {}

// ============================================================================
// ADA Diabetes Risk Score Input/Output Types
// ============================================================================

export interface AdaInput {
  age: number;
  sex: 'male' | 'female';
  gestationalDiabetes: boolean;
  familyHistoryDiabetes: boolean;
  hypertension: boolean;
  physicallyActive: boolean;
  heightCm: number;
  weightKg: number;
}

export interface AdaResult {
  score: number;
  maxScore: number;
  category: string;
  breakdown: Record<string, number>;
}

// ============================================================================
// Fatty Liver Index (FLI) Input/Output Types
// ============================================================================

export interface FliInput {
  heightCm: number;
  weightKg: number;
  waistCm: number;
  triglyceridesMgDl: number;
  ggtUL: number;
}

export interface FliResult {
  fli: number;
  bmi: number;
  category: string;
  interpretation: string;
}

// ============================================================================
// FRAIL Scale Input/Output Types
// ============================================================================

export interface FrailInput {
  fatigue: boolean;
  resistance: boolean;
  ambulation: boolean;
  illnesses: boolean;
  weightLoss: boolean;
}

export interface FrailResult {
  score: number;
  maxScore: number;
  category: string;
}

// ============================================================================
// BMI Input/Output Types
// ============================================================================

export interface BmiInput {
  heightCm: number;
  weightKg: number;
}

export interface BmiResult {
  bmi: number;
  category: string;
}

// ============================================================================
// Metabolic Syndrome Input/Output Types
// ============================================================================

export interface MetabolicSyndromeInput {
  waistCm: number;
  sex: 'male' | 'female';
  triglyceridesMgDl: number;
  hdlMgDl: number;
  sbpMmHg: number;
  dbpMmHg: number;
  glucoseMgDl: number;
}

export interface MetabolicSyndromeResult {
  present: boolean;
  criteriaCount: number;
  totalCriteria: number;
  criteriaDetails: {
    name: string;
    met: boolean;
    value: string;
    threshold: string;
  }[];
}

// ============================================================================
// FIB-4 Index (Liver Fibrosis) Input/Output Types
// ============================================================================

export interface Fib4Input {
  age: number;
  astUL: number;
  altUL: number;
  plateletsGigaL: number;
}

export interface Fib4Result {
  fib4: number;
  category: string;
}

// ============================================================================
// eGFR (Kidney Function) Input/Output Types
// ============================================================================

export interface EgfrInput {
  creatinineMgDl: number;
  age: number;
  sex: 'male' | 'female';
}

export interface EgfrResult {
  egfr: number;
  stage: string;
  category: string;
}

// ============================================================================
// PREDIMED Score Input/Output Types
// ============================================================================

export interface PredimedInput {
  answers: boolean[]; // 14 items
}

export interface PredimedResult {
  score: number;
  maxScore: number;
  adherenceBand: 'low' | 'medium' | 'high';
}

// ============================================================================
// Comprehensive Assessment Orchestrator Types
// ============================================================================

export interface AssessmentInput {
  demographics: {
    age: number;
    sex: 'male' | 'female';
  };

  vitals: {
    heightCm: number;
    weightKg: number;
    waistCm: number;
    sbpMmHg: number;
    dbpMmHg: number;
  };

  labs: {
    totalCholMgDl?: number;
    hdlMgDl?: number;
    ldlMgDl?: number;
    triglyceridesMgDl?: number;
    glucoseMgDl?: number;
    hba1cPct?: number;
    eGFR?: number;
    creatinineMgDl?: number;
    ggtUL?: number;
    astUL?: number;
    altUL?: number;
    plateletsGigaL?: number;
    /**
     * Albumin-Creatinine Ratio (mg/g). If not provided directly, the service
     * derives it from `urineAlbuminMgL` / `urineCreatinineMgDl` when both are
     * present. Used for KDIGO albuminuria staging (A1/A2/A3).
     */
    albuminCreatinineRatio?: number;
    /** Urine albumin (mg/L), used to derive ACR when explicit ACR is absent. */
    urineAlbuminMgL?: number;
    /** Urine creatinine (mg/dL), used to derive ACR when explicit ACR is absent. */
    urineCreatinineMgDl?: number;
  };

  clinicalContext: {
    smoking: boolean;
    hasDiabetes: boolean;
    ageAtDiabetesDiagnosis?: number;
    hypertension: boolean;
    familyHistoryDiabetes: boolean;
    familyHistoryCvd: boolean;
    gestationalDiabetes: boolean;
    cvRiskRegion: 'low' | 'moderate' | 'high' | 'very_high';
    medications: string[];
    diagnoses: string[];
  };

  lifestyle: {
    predimedAnswers?: boolean[];
    weeklyActivityMinutes?: number;
    activityFrequency?: number;
    activityType?: string;
    intensityLevel?: string;
    sedentaryLevel?: string;
  };

  frailty?: {
    fatigue: boolean;
    resistance: boolean;
    ambulation: boolean;
    illnesses: boolean;
    weightLoss: boolean;
  };

  /**
   * Assessment-level metadata. Captures operator intent so the engine can
   * distinguish "SCORE2 missing because out of scope" from "SCORE2 missing
   * because data not yet collected". Never used as input to score formulas.
   */
  meta?: {
    /**
     * When true, the clinician has explicitly declared that CV risk
     * stratification is in scope for this assessment. Used by the
     * completeness checker to decide whether missing lipid/BP data should
     * surface as an actionable warning or stay silent.
     */
    cvAssessmentFocus?: boolean;
  };
}

export interface ScoreResultEntry {
  scoreCode: string;
  valueNumeric: number | null;
  category: string;
  label: string;
  inputPayload: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
}

// ============================================================================
// Risk Semantics
// ============================================================================

/**
 * Canonical risk level used by the composite risk aggregator and every
 * downstream consumer (persistence, UI, reports).
 *
 * 'indeterminate' is explicitly NOT a synonym for 'low'. It signals that
 * the aggregator had insufficient data to stratify the domain and therefore
 * cannot claim the patient is safe. Consumers MUST render it distinctly
 * (e.g. as "Not assessed") and MUST NOT fold it into the low-risk bucket.
 */
export type RiskLevel =
  | 'low'
  | 'moderate'
  | 'high'
  | 'very_high'
  | 'indeterminate';

/**
 * Domain-level risk output. `evidence` lists the score codes (or derived
 * inputs) that supported the stratification so the UI can show provenance.
 */
export interface DomainRiskEntry {
  level: RiskLevel;
  reasoning: string;
  evidence?: string[];
}

// ============================================================================
// Completeness Warnings — separated from clinical alerts
// ============================================================================

/**
 * Structured warning emitted when a clinically important score could not be
 * computed because of missing inputs.
 *
 * Completeness warnings are NEVER persisted in the `alerts` table and NEVER
 * mixed with task-based follow-up alerts. They describe a data-collection
 * gap, not a clinical event that a clinician must act on in time-bound
 * fashion. Keeping the two concepts separate is critical for the alerts
 * inbox to remain a trustworthy action list.
 */
export type CompletenessCode =
  | 'SCORE2_INCOMPLETE'
  | 'SCORE2_DIABETES_INCOMPLETE'
  | 'EGFR_INCOMPLETE'
  | 'ACR_INCOMPLETE'
  | 'FIB4_INCOMPLETE'
  | 'FLI_INCOMPLETE'
  | 'METABOLIC_SYNDROME_INCOMPLETE'
  | 'PREDIMED_INCOMPLETE'
  | 'FRAILTY_NOT_ASSESSED';

export interface CompletenessWarning {
  /** Stable, machine-readable code used by the UI, tests and i18n layer. */
  code: CompletenessCode;
  /** Human-readable title ("SCORE2 cannot be computed"). */
  title: string;
  /** One-line rationale describing why the score is not available. */
  detail: string;
  /** List of missing assessment-input field paths (e.g. "labs.hdlMgDl"). */
  missingFields: string[];
  /** Suggested clinician action (e.g. "Obtain fasting lipid panel"). */
  suggestedAction: string;
  /**
   * Severity is intentionally restricted to info|warning.
   * Completeness is never "critical" — a critical clinical finding is an
   * alert, not a completeness gap.
   */
  severity: 'info' | 'warning';
}

// ============================================================================
// Phase B scaffolding — structured follow-up items, screenings, and findings
// ============================================================================

/** Deterministic clinical finding asserted by the rule engine. */
export interface ClinicalFinding {
  code: string;
  domain: 'cardiovascular' | 'metabolic' | 'hepatic' | 'renal' | 'frailty' | 'lifestyle';
  severity: 'info' | 'warning' | 'critical';
  statement: string;
  source?: string;
}

/** Rule-driven follow-up action with a due date and provenance. */
export interface FollowUpItem {
  code: string;
  title: string;
  rationale: string;
  dueInMonths: number;
  priority: 'routine' | 'moderate' | 'urgent';
  recurrenceMonths?: number;
  guidelineSource?: string;
}

/** Rule-driven recommended screening with interval and provenance. */
export interface ScreeningItem {
  screening: string;
  reason: string;
  priority: 'routine' | 'moderate' | 'urgent';
  intervalMonths: number;
  guidelineSource?: string;
}

export interface AssessmentSnapshot {
  /**
   * Persistence metadata. Present when the snapshot is returned from the
   * service layer after (or during rehydration of) a persisted assessment.
   */
  assessment: {
    id: string;
    patientId: string;
    tenantId: string;
    createdAt: string;
    createdByUserId: string | null;
    status?: string;
    notes?: string | null;
  };

  /** Canonical input snapshot used to compute this assessment. */
  input: AssessmentInput;

  scoreResults: ScoreResultEntry[];

  compositeRisk: {
    level: RiskLevel;
    numeric: number;
    cardiovascular: DomainRiskEntry;
    metabolic: DomainRiskEntry;
    hepatic: DomainRiskEntry;
    renal: DomainRiskEntry;
    frailty: DomainRiskEntry | null;
  };

  /**
   * Warnings about missing data that prevented a score from being computed.
   * Kept OUT of the `alerts` array on purpose — see CompletenessWarning.
   */
  completenessWarnings: CompletenessWarning[];

  screenings: ScreeningItem[];

  followupPlan: {
    intervalMonths: number;
    nextReviewDate: string;
    priorityLevel: 'routine' | 'moderate' | 'urgent';
    actions: string[];
    domainMonitoring: string[];
    /**
     * Structured, guideline-sourced follow-up items. Source of truth for
     * rule-based consumers (alert engine, future follow-up inbox).
     * `actions` above is a rendered projection kept for legacy UI/PDF.
     */
    items: FollowUpItem[];
  };

  nutritionSummary: {
    predimedScore: number | null;
    adherenceBand: 'low' | 'medium' | 'high' | null;
    bmrKcal: number;
    tdeeKcal: number;
    activityFactor: number;
    activityLevel: string;
  };

  activitySummary: {
    minutesPerWeek: number | null;
    qualitativeBand: 'insufficient' | 'borderline' | 'sufficient' | 'active';
    meetsWhoGuidelines: boolean;
    sedentaryRiskLevel: 'low' | 'moderate' | 'high' | 'very_high';
  };

  alerts: {
    type: string;
    severity: 'info' | 'warning' | 'critical';
    title: string;
    message: string;
    timestamp: string;
  }[];
}
