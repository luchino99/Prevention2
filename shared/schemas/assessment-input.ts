/**
 * Zod validation schemas for clinical assessment input.
 * Validates all assessment data before processing by the score engines.
 */

import { z } from 'zod';
// NB: Node 20 ESM does NOT perform extension resolution on relative
// specifiers. The `.js` suffix on TypeScript source imports is required
// so the compiled output (and Vercel's /var/task/... runtime) can
// resolve the module. Without it we get ERR_MODULE_NOT_FOUND on import.
import { CLINICAL_RANGES } from '../constants/clinical-ranges.js';
import type { AssessmentInput } from '../types/clinical.js';

/**
 * Demographics section - required information about the patient
 */
const DemographicsSchema = z.object({
  age: z
    .number()
    .int('Age must be an integer')
    .min(CLINICAL_RANGES.age.min, `Age must be at least ${CLINICAL_RANGES.age.min}`)
    .max(CLINICAL_RANGES.age.max, `Age must not exceed ${CLINICAL_RANGES.age.max}`),
  sex: z.enum(['male', 'female'], {
    errorMap: () => ({ message: 'Sex must be either "male" or "female"' }),
  }),
});

/**
 * Vitals section - required measurements
 */
const VitalsSchema = z.object({
  heightCm: z
    .number()
    .positive('Height must be positive')
    .min(CLINICAL_RANGES.heightCm.min, `Height must be at least ${CLINICAL_RANGES.heightCm.min} cm`)
    .max(CLINICAL_RANGES.heightCm.max, `Height must not exceed ${CLINICAL_RANGES.heightCm.max} cm`),
  weightKg: z
    .number()
    .positive('Weight must be positive')
    .min(CLINICAL_RANGES.weightKg.min, `Weight must be at least ${CLINICAL_RANGES.weightKg.min} kg`)
    .max(CLINICAL_RANGES.weightKg.max, `Weight must not exceed ${CLINICAL_RANGES.weightKg.max} kg`),
  waistCm: z
    .number()
    .positive('Waist circumference must be positive')
    .min(CLINICAL_RANGES.waistCm.min, `Waist must be at least ${CLINICAL_RANGES.waistCm.min} cm`)
    .max(CLINICAL_RANGES.waistCm.max, `Waist must not exceed ${CLINICAL_RANGES.waistCm.max} cm`),
  sbpMmHg: z
    .number()
    .int('Systolic BP must be an integer')
    .min(CLINICAL_RANGES.sbpMmHg.min, `SBP must be at least ${CLINICAL_RANGES.sbpMmHg.min} mmHg`)
    .max(CLINICAL_RANGES.sbpMmHg.max, `SBP must not exceed ${CLINICAL_RANGES.sbpMmHg.max} mmHg`),
  dbpMmHg: z
    .number()
    .int('Diastolic BP must be an integer')
    .min(CLINICAL_RANGES.dbpMmHg.min, `DBP must be at least ${CLINICAL_RANGES.dbpMmHg.min} mmHg`)
    .max(CLINICAL_RANGES.dbpMmHg.max, `DBP must not exceed ${CLINICAL_RANGES.dbpMmHg.max} mmHg`),
});

/**
 * Labs section - optional laboratory measurements
 * Patients may not have all lab results available
 */
const LabsSchema = z.object({
  totalCholMgDl: z
    .number()
    .positive('Total cholesterol must be positive')
    .min(CLINICAL_RANGES.totalCholMgDl.min, `Total cholesterol must be at least ${CLINICAL_RANGES.totalCholMgDl.min} mg/dL`)
    .max(CLINICAL_RANGES.totalCholMgDl.max, `Total cholesterol must not exceed ${CLINICAL_RANGES.totalCholMgDl.max} mg/dL`)
    .optional()
    .nullable(),
  hdlMgDl: z
    .number()
    .positive('HDL must be positive')
    .min(CLINICAL_RANGES.hdlMgDl.min, `HDL must be at least ${CLINICAL_RANGES.hdlMgDl.min} mg/dL`)
    .max(CLINICAL_RANGES.hdlMgDl.max, `HDL must not exceed ${CLINICAL_RANGES.hdlMgDl.max} mg/dL`)
    .optional()
    .nullable(),
  ldlMgDl: z
    .number()
    .positive('LDL must be positive')
    .min(CLINICAL_RANGES.ldlMgDl.min, `LDL must be at least ${CLINICAL_RANGES.ldlMgDl.min} mg/dL`)
    .max(CLINICAL_RANGES.ldlMgDl.max, `LDL must not exceed ${CLINICAL_RANGES.ldlMgDl.max} mg/dL`)
    .optional()
    .nullable(),
  triglyceridesMgDl: z
    .number()
    .positive('Triglycerides must be positive')
    .min(CLINICAL_RANGES.triglyceridesMgDl.min, `Triglycerides must be at least ${CLINICAL_RANGES.triglyceridesMgDl.min} mg/dL`)
    .max(CLINICAL_RANGES.triglyceridesMgDl.max, `Triglycerides must not exceed ${CLINICAL_RANGES.triglyceridesMgDl.max} mg/dL`)
    .optional()
    .nullable(),
  glucoseMgDl: z
    .number()
    .positive('Glucose must be positive')
    .min(CLINICAL_RANGES.glucoseMgDl.min, `Glucose must be at least ${CLINICAL_RANGES.glucoseMgDl.min} mg/dL`)
    .max(CLINICAL_RANGES.glucoseMgDl.max, `Glucose must not exceed ${CLINICAL_RANGES.glucoseMgDl.max} mg/dL`)
    .optional()
    .nullable(),
  hba1cPct: z
    .number()
    .positive('HbA1c must be positive')
    .min(CLINICAL_RANGES.hba1cPct.min, `HbA1c must be at least ${CLINICAL_RANGES.hba1cPct.min}%`)
    .max(CLINICAL_RANGES.hba1cPct.max, `HbA1c must not exceed ${CLINICAL_RANGES.hba1cPct.max}%`)
    .optional()
    .nullable(),
  eGFR: z
    .number()
    .positive('eGFR must be positive')
    .min(CLINICAL_RANGES.eGFR.min, `eGFR must be at least ${CLINICAL_RANGES.eGFR.min}`)
    .max(CLINICAL_RANGES.eGFR.max, `eGFR must not exceed ${CLINICAL_RANGES.eGFR.max}`)
    .optional()
    .nullable(),
  creatinineMgDl: z
    .number()
    .positive('Creatinine must be positive')
    .min(CLINICAL_RANGES.creatinineMgDl.min, `Creatinine must be at least ${CLINICAL_RANGES.creatinineMgDl.min} mg/dL`)
    .max(CLINICAL_RANGES.creatinineMgDl.max, `Creatinine must not exceed ${CLINICAL_RANGES.creatinineMgDl.max} mg/dL`)
    .optional()
    .nullable(),
  ggtUL: z
    .number()
    .positive('GGT must be positive')
    .min(CLINICAL_RANGES.ggtUL.min, `GGT must be at least ${CLINICAL_RANGES.ggtUL.min} U/L`)
    .max(CLINICAL_RANGES.ggtUL.max, `GGT must not exceed ${CLINICAL_RANGES.ggtUL.max} U/L`)
    .optional()
    .nullable(),
  astUL: z
    .number()
    .positive('AST must be positive')
    .min(CLINICAL_RANGES.astUL.min, `AST must be at least ${CLINICAL_RANGES.astUL.min} U/L`)
    .max(CLINICAL_RANGES.astUL.max, `AST must not exceed ${CLINICAL_RANGES.astUL.max} U/L`)
    .optional()
    .nullable(),
  altUL: z
    .number()
    .positive('ALT must be positive')
    .min(CLINICAL_RANGES.altUL.min, `ALT must be at least ${CLINICAL_RANGES.altUL.min} U/L`)
    .max(CLINICAL_RANGES.altUL.max, `ALT must not exceed ${CLINICAL_RANGES.altUL.max} U/L`)
    .optional()
    .nullable(),
  plateletsGigaL: z
    .number()
    .positive('Platelets must be positive')
    .min(CLINICAL_RANGES.plateletsGigaL.min, `Platelets must be at least ${CLINICAL_RANGES.plateletsGigaL.min} G/L`)
    .max(CLINICAL_RANGES.plateletsGigaL.max, `Platelets must not exceed ${CLINICAL_RANGES.plateletsGigaL.max} G/L`)
    .optional()
    .nullable(),
  albuminCreatinineRatio: z
    .number()
    .nonnegative('Albumin-creatinine ratio must be non-negative')
    .min(CLINICAL_RANGES.albuminCreatinineRatio.min)
    .max(CLINICAL_RANGES.albuminCreatinineRatio.max, `ACR must not exceed ${CLINICAL_RANGES.albuminCreatinineRatio.max}`)
    .optional()
    .nullable(),
}).strict();

/**
 * Clinical context - medical history and risk factors
 */
const ClinicalContextSchema = z.object({
  smoking: z.boolean({ coerce: true }).describe('Current smoker'),
  hasDiabetes: z.boolean({ coerce: true }).describe('Has diabetes diagnosis'),
  ageAtDiabetesDiagnosis: z
    .number()
    .int()
    .positive()
    .optional()
    .nullable()
    .describe('Age when diabetes was diagnosed'),
  hypertension: z.boolean({ coerce: true }).describe('Has hypertension'),
  familyHistoryDiabetes: z.boolean({ coerce: true }).describe('Family history of diabetes'),
  familyHistoryCvd: z.boolean({ coerce: true }).describe('Family history of cardiovascular disease'),
  gestationalDiabetes: z.boolean({ coerce: true }).describe('History of gestational diabetes'),
  cvRiskRegion: z.enum(['low', 'moderate', 'high', 'very_high'], {
    errorMap: () => ({ message: 'CV risk region must be one of: low, moderate, high, very_high' }),
  }).describe('Cardiovascular risk region'),
  medications: z.array(z.string()).default([]).describe('Current medications'),
  diagnoses: z.array(z.string()).default([]).describe('Current diagnoses'),
}).strict();

/**
 * Lifestyle and activity data
 */
const LifestyleSchema = z.object({
  predimedAnswers: z
    .array(z.boolean())
    .length(14, 'PREDIMED must have exactly 14 answers')
    .optional()
    .nullable()
    .describe('14 PREDIMED questionnaire boolean answers'),
  weeklyActivityMinutes: z
    .number()
    .nonnegative('Activity minutes must be non-negative')
    .optional()
    .nullable()
    .describe('Minutes of physical activity per week'),
  activityFrequency: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .nullable()
    .describe('Days per week of activity'),
  activityType: z
    .enum(['aerobic', 'resistance', 'flexibility', 'mixed'])
    .optional()
    .nullable(),
  intensityLevel: z
    .enum(['light', 'moderate', 'vigorous', 'mixed'])
    .optional()
    .nullable(),
  sedentaryLevel: z
    .enum(['low', 'moderate', 'high'])
    .optional()
    .nullable(),
}).strict();

/**
 * Frailty assessment (FRAIL scale)
 */
const FrailtySchema = z.object({
  fatigue: z.boolean().describe('Feels tired most of the time'),
  resistance: z.boolean().describe('Unable to climb stairs or walk up a hill'),
  ambulation: z.boolean().describe('Unable to walk one block'),
  illnesses: z.boolean().describe('5 or more illnesses'),
  weightLoss: z.boolean().describe('Lost >5% weight in past year'),
}).strict().optional().nullable();

/**
 * Complete assessment input schema.
 *
 * The strict() modifier rejects unknown keys so callers can't smuggle
 * additional attributes through the validator and into persistence.
 */
const RawAssessmentInputSchema = z.object({
  demographics: DemographicsSchema,
  vitals: VitalsSchema,
  labs: LabsSchema,
  clinicalContext: ClinicalContextSchema,
  lifestyle: LifestyleSchema.optional().default({}),
  frailty: FrailtySchema,
}).strict();

/**
 * Clinical-engine boundary normalisation.
 *
 * The JSON wire format accepts `null` for optional fields (many form UIs
 * send explicit null for "unset"), but the canonical `AssessmentInput`
 * type in `shared/types/clinical.ts` uses only `T | undefined`. The
 * transform below strips `null` → `undefined` for every optional leaf so
 * the validated value is byte-safe for direct hand-off to
 * `computeAllScores()` / `createAssessment()`. Non-optional fields are
 * passed through untouched.
 *
 * No clinical math is affected — this only reshapes the envelope.
 */
export const AssessmentInputSchema = RawAssessmentInputSchema.transform(
  (v): AssessmentInput => ({
    demographics: v.demographics,
    vitals: v.vitals,
    labs: {
      totalCholMgDl: v.labs.totalCholMgDl ?? undefined,
      hdlMgDl: v.labs.hdlMgDl ?? undefined,
      ldlMgDl: v.labs.ldlMgDl ?? undefined,
      triglyceridesMgDl: v.labs.triglyceridesMgDl ?? undefined,
      glucoseMgDl: v.labs.glucoseMgDl ?? undefined,
      hba1cPct: v.labs.hba1cPct ?? undefined,
      eGFR: v.labs.eGFR ?? undefined,
      creatinineMgDl: v.labs.creatinineMgDl ?? undefined,
      ggtUL: v.labs.ggtUL ?? undefined,
      astUL: v.labs.astUL ?? undefined,
      altUL: v.labs.altUL ?? undefined,
      plateletsGigaL: v.labs.plateletsGigaL ?? undefined,
      albuminCreatinineRatio: v.labs.albuminCreatinineRatio ?? undefined,
    },
    clinicalContext: {
      smoking: v.clinicalContext.smoking,
      hasDiabetes: v.clinicalContext.hasDiabetes,
      ageAtDiabetesDiagnosis: v.clinicalContext.ageAtDiabetesDiagnosis ?? undefined,
      hypertension: v.clinicalContext.hypertension,
      familyHistoryDiabetes: v.clinicalContext.familyHistoryDiabetes,
      familyHistoryCvd: v.clinicalContext.familyHistoryCvd,
      gestationalDiabetes: v.clinicalContext.gestationalDiabetes,
      cvRiskRegion: v.clinicalContext.cvRiskRegion,
      medications: v.clinicalContext.medications,
      diagnoses: v.clinicalContext.diagnoses,
    },
    lifestyle: {
      predimedAnswers: v.lifestyle.predimedAnswers ?? undefined,
      weeklyActivityMinutes: v.lifestyle.weeklyActivityMinutes ?? undefined,
      activityFrequency: v.lifestyle.activityFrequency ?? undefined,
      activityType: v.lifestyle.activityType ?? undefined,
      intensityLevel: v.lifestyle.intensityLevel ?? undefined,
      sedentaryLevel: v.lifestyle.sedentaryLevel ?? undefined,
    },
    frailty: v.frailty ?? undefined,
  }),
);

/**
 * camelCase alias — kept for routes that import the schema with the
 * (more conventional) camelCase identifier.
 */
export const assessmentInputSchema = AssessmentInputSchema;

/**
 * Inferred TypeScript type from the schema. Exposed as
 * `ValidatedAssessmentInput` to avoid colliding with the canonical
 * `AssessmentInput` interface in shared/types/clinical.ts. At the service
 * boundary the validated value is safely assignable to `AssessmentInput`.
 */
export type ValidatedAssessmentInput = z.infer<typeof AssessmentInputSchema>;

/**
 * Helper function to validate assessment input
 */
export function validateAssessmentInput(data: unknown) {
  return AssessmentInputSchema.safeParse(data);
}
