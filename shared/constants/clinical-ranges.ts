/**
 * Valid ranges for clinical measurements used in input validation.
 * These define the acceptable bounds for all clinical parameters.
 */

export const CLINICAL_RANGES = {
  age: { min: 18, max: 120 },
  heightCm: { min: 100, max: 250 },
  weightKg: { min: 20, max: 300 },
  waistCm: { min: 40, max: 200 },
  sbpMmHg: { min: 60, max: 260 },
  dbpMmHg: { min: 30, max: 160 },
  totalCholMgDl: { min: 50, max: 500 },
  hdlMgDl: { min: 10, max: 150 },
  ldlMgDl: { min: 20, max: 400 },
  triglyceridesMgDl: { min: 20, max: 1000 },
  glucoseMgDl: { min: 30, max: 600 },
  hba1cPct: { min: 3.0, max: 20.0 },
  eGFR: { min: 2, max: 200 },
  creatinineMgDl: { min: 0.1, max: 30.0 },
  ggtUL: { min: 1, max: 2000 },
  astUL: { min: 1, max: 2000 },
  altUL: { min: 1, max: 2000 },
  plateletsGigaL: { min: 10, max: 1000 },
  albuminCreatinineRatio: { min: 0, max: 10000 },
  // Raw urinary values used to derive ACR (mg/g) at the service boundary
  // when an explicit ACR is not provided by the clinician.
  urineAlbuminMgL: { min: 0, max: 5000 },
  urineCreatinineMgDl: { min: 1, max: 500 },
} as const;
