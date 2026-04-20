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
    albuminCreatinineRatio?: number;
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
}

export interface ScoreResultEntry {
  scoreCode: string;
  valueNumeric: number | null;
  category: string;
  label: string;
  inputPayload: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
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
    level: string;
    numeric: number;
    cardiovascular: { level: string; reasoning: string };
    metabolic: { level: string; reasoning: string };
    hepatic: { level: string; reasoning: string };
    renal: { level: string; reasoning: string };
    frailty: { level: string; reasoning: string } | null;
  };

  screenings: {
    screening: string;
    reason: string;
    priority: 'routine' | 'moderate' | 'urgent';
    intervalMonths: number;
  }[];

  followupPlan: {
    intervalMonths: number;
    nextReviewDate: string;
    priorityLevel: 'routine' | 'moderate' | 'urgent';
    actions: string[];
    domainMonitoring: string[];
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
