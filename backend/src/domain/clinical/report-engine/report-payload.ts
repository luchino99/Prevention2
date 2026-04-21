/**
 * Clinical Report Payload Builder
 * Structures assessment data for PDF report generation
 *
 * This module builds a normalized JSON payload from clinical assessment
 * snapshots, making it easy for PDF renderers to consume without needing
 * to understand complex domain logic.
 */

import { ScoreResultEntry } from '../../../../../shared/types/clinical.js';

/**
 * Individual score entry in the report
 */
export interface ReportScoreEntry {
  scoreCode: string;
  label: string;
  valueNumeric: number | null;
  category: string;
  unit?: string;
  interpretation?: string;
}

/**
 * Composite risk breakdown
 */
export interface ReportCompositeRisk {
  overallLevel: string;
  cardiovascularRisk: string;
  metabolicRisk: string;
  hepaticRisk: string;
  renalRisk: string;
  frailtyRisk: string | null;
}

/**
 * Screening recommendation
 */
export interface ReportScreening {
  screening: string;
  reason: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  testCode?: string;
}

/**
 * Followup action
 */
export interface ReportFollowupAction {
  action: string;
  timeframe?: string;
  responsible?: string;
}

/**
 * Nutrition assessment section
 */
export interface ReportNutritionSummary {
  predimedScore: number | null;
  adherenceBand: 'low' | 'medium' | 'high' | null;
  basalMetabolicRateKcal: number | null;
  totalDailyEnergyExpenditureKcal: number | null;
  dietaryRecommendations?: string[];
}

/**
 * Activity assessment section
 */
export interface ReportActivitySummary {
  minutesPerWeekModerate: number | null;
  activityQualitativeBand: string | null;
  meetsWHOGuidelines: boolean | null;
  activityRecommendations?: string[];
}

/**
 * Clinical alert for report
 */
export interface ReportAlert {
  type: 'critical' | 'warning' | 'info';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message: string;
  actionRequired?: string;
}

/**
 * Report header with patient and professional information
 */
export interface ReportHeader {
  patient: {
    displayName: string;
    sex: 'male' | 'female';
    birthYear: number;
    externalCode: string;
    age?: number;
  };
  professional: {
    fullName: string;
    licenseNumber: string;
    specialty: string;
    clinicName: string;
  };
  tenant: {
    name: string;
    logoUrl?: string;
  };
  assessmentDate: string;
  reportGeneratedAt?: string;
}

/**
 * Complete clinical report payload
 * Designed for easy consumption by PDF rendering engines
 */
export interface ClinicalReportPayload {
  header: ReportHeader;
  scores: ReportScoreEntry[];
  compositeRisk: ReportCompositeRisk;
  screenings: ReportScreening[];
  followupPlan: {
    intervalMonths: number;
    nextFollowupDate?: string;
    actions: ReportFollowupAction[];
  };
  nutritionSummary: ReportNutritionSummary;
  activitySummary: ReportActivitySummary;
  alerts: ReportAlert[];
  disclaimers?: string[];
  metadata: {
    reportVersion: string;
    platformVersion?: string;
    timeGeneratedMs?: number;
  };
}

/**
 * Input parameters for building the report payload
 */
export interface BuildReportPayloadInput {
  patient: {
    displayName: string;
    sex: 'male' | 'female';
    birthYear: number;
    externalCode: string;
  };
  professional: {
    fullName: string;
    licenseNumber: string;
    specialty: string;
    clinicName: string;
  };
  tenant: {
    name: string;
    logoUrl?: string;
  };
  assessmentDate: string;
  scoreResults: ScoreResultEntry[];
  compositeRisk: {
    level: string;
    cardiovascular: string;
    metabolic: string;
    hepatic: string;
    renal: string;
    frailty: string | null;
  };
  screenings: Array<{
    screening: string;
    reason: string;
    priority: string;
    testCode?: string;
  }>;
  followupPlan: {
    intervalMonths: number;
    actions: string[];
  };
  nutritionSummary: {
    predimedScore: number | null;
    adherenceBand: string | null;
    bmrKcal: number | null;
    tdeeKcal: number | null;
    recommendations?: string[];
  };
  activitySummary: {
    minutesPerWeek: number | null;
    qualitativeBand: string | null;
    meetsWhoGuidelines: boolean | null;
    recommendations?: string[];
  };
  alerts: Array<{
    type: string;
    severity: string;
    title: string;
    message: string;
    actionRequired?: string;
  }>;
}

/**
 * Maps score codes to more readable labels and units
 */
const SCORE_METADATA: Record<string, { label: string; unit?: string }> = {
  'score2': { label: 'SCORE2 Cardiovascular Risk', unit: '%' },
  'score2-diabetes': { label: 'SCORE2-Diabetes CVD Risk', unit: '%' },
  'ada': { label: 'ADA Diabetes Risk', unit: 'points' },
  'fli': { label: 'Fatty Liver Index', unit: 'score' },
  'fib4': { label: 'FIB-4 Liver Fibrosis Index', unit: 'score' },
  'bmi': { label: 'Body Mass Index', unit: 'kg/m²' },
  'egfr': { label: 'eGFR (Kidney Function)', unit: 'mL/min/1.73m²' },
  'frail': { label: 'FRAIL Frailty Score', unit: 'points' },
  'metabolic-syndrome': { label: 'Metabolic Syndrome', unit: 'criteria' },
  'predimed': { label: 'PREDIMED Diet Adherence', unit: 'points' },
};

/**
 * Map alert types and severities to appropriate report categories
 */
function mapAlertSeverity(severity: string): 'low' | 'medium' | 'high' | 'critical' {
  const severityMap: Record<string, 'low' | 'medium' | 'high' | 'critical'> = {
    'low': 'low',
    'medium': 'medium',
    'warning': 'medium',
    'high': 'high',
    'critical': 'critical',
    'error': 'critical',
  };
  return severityMap[severity.toLowerCase()] || 'medium';
}

/**
 * Map alert types
 */
function mapAlertType(type: string): 'critical' | 'warning' | 'info' {
  const typeMap: Record<string, 'critical' | 'warning' | 'info'> = {
    'critical': 'critical',
    'warning': 'warning',
    'error': 'critical',
    'info': 'info',
    'note': 'info',
  };
  return typeMap[type.toLowerCase()] || 'info';
}

/**
 * Normalize priority strings to standard categories
 */
function normalizePriority(priority: string): 'low' | 'medium' | 'high' | 'critical' {
  const priorityMap: Record<string, 'low' | 'medium' | 'high' | 'critical'> = {
    'low': 'low',
    'medium': 'medium',
    'moderate': 'medium',
    'high': 'high',
    'critical': 'critical',
    'urgent': 'critical',
  };
  return priorityMap[priority.toLowerCase()] || 'medium';
}

/**
 * Builds a complete clinical report payload from assessment snapshot data
 *
 * This function structures clinical assessment results into a format
 * optimized for PDF rendering. It normalizes and enrich data from
 * multiple sources into a cohesive report structure.
 *
 * @param input - Structured assessment data including scores, risk, recommendations
 * @returns ClinicalReportPayload ready for PDF generation
 */
export function buildClinicalReportPayload(input: BuildReportPayloadInput): ClinicalReportPayload {
  // Calculate patient age at assessment time
  const assessmentDate = new Date(input.assessmentDate);
  const age = assessmentDate.getFullYear() - input.patient.birthYear;

  // Transform score results into report format
  const reportScores: ReportScoreEntry[] = input.scoreResults.map(score => {
    const metadata: { label?: string; unit?: string } =
      SCORE_METADATA[score.scoreCode] ?? {};
    const rawPayload = score.rawPayload as Record<string, unknown> | undefined;
    const interpretationRaw = rawPayload?.['interpretation'];
    return {
      scoreCode: score.scoreCode,
      label: metadata.label ?? score.label,
      valueNumeric: score.valueNumeric,
      category: score.category,
      unit: metadata.unit,
      interpretation:
        typeof interpretationRaw === 'string'
          ? interpretationRaw
          : interpretationRaw != null
          ? String(interpretationRaw)
          : undefined,
    };
  });

  // Build report composite risk section
  const compositeRisk: ReportCompositeRisk = {
    overallLevel: input.compositeRisk.level,
    cardiovascularRisk: input.compositeRisk.cardiovascular,
    metabolicRisk: input.compositeRisk.metabolic,
    hepaticRisk: input.compositeRisk.hepatic,
    renalRisk: input.compositeRisk.renal,
    frailtyRisk: input.compositeRisk.frailty,
  };

  // Transform screening recommendations
  const screenings: ReportScreening[] = input.screenings.map(screening => ({
    screening: screening.screening,
    reason: screening.reason,
    priority: normalizePriority(screening.priority),
    testCode: screening.testCode,
  }));

  // Build followup plan with next date calculation
  const nextFollowupDate = new Date(input.assessmentDate);
  nextFollowupDate.setMonth(
    nextFollowupDate.getMonth() + input.followupPlan.intervalMonths
  );

  const followupPlan = {
    intervalMonths: input.followupPlan.intervalMonths,
    nextFollowupDate: nextFollowupDate.toISOString().split('T')[0],
    actions: input.followupPlan.actions.map(action => ({
      action,
      timeframe: `In ${input.followupPlan.intervalMonths} months`,
    })),
  };

  // Build nutrition summary
  const nutritionSummary: ReportNutritionSummary = {
    predimedScore: input.nutritionSummary.predimedScore,
    adherenceBand: (input.nutritionSummary.adherenceBand || null) as 'low' | 'medium' | 'high' | null,
    basalMetabolicRateKcal: input.nutritionSummary.bmrKcal,
    totalDailyEnergyExpenditureKcal: input.nutritionSummary.tdeeKcal,
    dietaryRecommendations: input.nutritionSummary.recommendations,
  };

  // Build activity summary
  const activitySummary: ReportActivitySummary = {
    minutesPerWeekModerate: input.activitySummary.minutesPerWeek,
    activityQualitativeBand: input.activitySummary.qualitativeBand,
    meetsWHOGuidelines: input.activitySummary.meetsWhoGuidelines,
    activityRecommendations: input.activitySummary.recommendations,
  };

  // Transform alerts with normalized severity
  const alerts: ReportAlert[] = input.alerts.map(alert => ({
    type: mapAlertType(alert.type),
    severity: mapAlertSeverity(alert.severity),
    title: alert.title,
    message: alert.message,
    actionRequired: alert.actionRequired,
  }));

  // Standard medical disclaimers
  const disclaimers = [
    'This report is based on clinical data and evidence-based risk assessment models.',
    'It is intended to support clinical decision-making and should not be used as the sole basis for diagnosis or treatment.',
    'A qualified healthcare professional should review and interpret these findings in the context of the complete clinical picture.',
    'Regular monitoring and follow-up as recommended are essential for appropriate patient management.',
    'Patient privacy and data security have been maintained in accordance with applicable regulations.',
  ];

  // Build final payload
  const payload: ClinicalReportPayload = {
    header: {
      patient: {
        displayName: input.patient.displayName,
        sex: input.patient.sex,
        birthYear: input.patient.birthYear,
        externalCode: input.patient.externalCode,
        age,
      },
      professional: {
        fullName: input.professional.fullName,
        licenseNumber: input.professional.licenseNumber,
        specialty: input.professional.specialty,
        clinicName: input.professional.clinicName,
      },
      tenant: {
        name: input.tenant.name,
        logoUrl: input.tenant.logoUrl,
      },
      assessmentDate: input.assessmentDate,
      reportGeneratedAt: new Date().toISOString(),
    },
    scores: reportScores,
    compositeRisk,
    screenings,
    followupPlan,
    nutritionSummary,
    activitySummary,
    alerts,
    disclaimers,
    metadata: {
      reportVersion: '1.0.0',
      timeGeneratedMs: Date.now(),
    },
  };

  return payload;
}

/**
 * Helper function to extract critical alerts from a report payload
 * Useful for determining what needs immediate attention
 */
export function getCriticalAlerts(payload: ClinicalReportPayload): ReportAlert[] {
  return payload.alerts.filter(alert => alert.severity === 'critical');
}

/**
 * Helper function to check if followup is overdue based on assessment date and interval
 */
export function isFollowupOverdue(
  lastAssessmentDate: string,
  intervalMonths: number,
  checkDate: Date = new Date()
): boolean {
  const lastDate = new Date(lastAssessmentDate);
  const dueDate = new Date(lastDate);
  dueDate.setMonth(dueDate.getMonth() + intervalMonths);
  return checkDate > dueDate;
}
