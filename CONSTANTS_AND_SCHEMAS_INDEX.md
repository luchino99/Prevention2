# Clinical Platform - Constants & Schemas Index

## Quick Reference

### Where to Find What

#### Clinical Score Thresholds
**File**: `shared/constants/score-thresholds.ts`
```typescript
import { SCORE2_THRESHOLDS, ADA_THRESHOLDS, FLI_THRESHOLDS } from '@/shared/constants/score-thresholds';
import type { RiskLevel } from '@/shared/constants/score-thresholds';
```

#### Input Validation Ranges
**File**: `shared/constants/clinical-ranges.ts`
```typescript
import { CLINICAL_RANGES } from '@/shared/constants/clinical-ranges';
// Access: CLINICAL_RANGES.age.min, CLINICAL_RANGES.sbpMmHg.max, etc.
```

#### Assessment Input Validation
**File**: `shared/schemas/assessment-input.ts`
```typescript
import { 
  AssessmentInputSchema, 
  validateAssessmentInput,
  type AssessmentInput 
} from '@/shared/schemas/assessment-input';
```

#### Patient Management Validation
**File**: `shared/schemas/patient-input.ts`
```typescript
import { 
  PatientCreateSchema, 
  PatientUpdateSchema,
  validatePatientCreate,
  validatePatientUpdate,
  getPatientDisplayName,
  type PatientCreate, 
  type PatientUpdate 
} from '@/shared/schemas/patient-input';
```

#### PDF Report Generation
**File**: `backend/src/domain/clinical/report-engine/report-payload.ts`
```typescript
import { 
  buildClinicalReportPayload, 
  getCriticalAlerts,
  isFollowupOverdue,
  type ClinicalReportPayload,
  type BuildReportPayloadInput 
} from '@/domain/clinical/report-engine/report-payload';
```

---

## Threshold Values Reference

### SCORE2 (Cardiovascular Risk)
| Category | Range | Interpretation |
|----------|-------|-----------------|
| Low | < 5% | Low cardiovascular risk |
| Moderate | 5-10% | Moderate risk |
| High | 10-15% | High risk |
| Very High | ≥ 15% | Very high risk |

### ADA Diabetes Risk
| Category | Range | Interpretation |
|----------|-------|-----------------|
| Low | 0-2 points | Low risk |
| Moderate | 3-4 points | Moderate risk |
| High | ≥ 5 points | High risk |

### FLI (Fatty Liver)
| Category | Range | Interpretation |
|----------|-------|-----------------|
| Steatosis Excluded | < 30 | No fatty liver |
| Indeterminate | 30-59 | Inconclusive |
| Steatosis Probable | ≥ 60 | Likely fatty liver |

### FIB-4 (Liver Fibrosis)
| Category | Range | Interpretation |
|----------|-------|-----------------|
| Low Risk | < 1.45 | Advanced fibrosis unlikely |
| High Risk | > 3.25 | Advanced fibrosis possible |

### BMI Categories
| Category | Range | kg/m² |
|----------|-------|-------|
| Underweight | < 18.5 | < 18.5 |
| Normal Weight | 18.5-25 | 18.5-24.9 |
| Overweight | 25-30 | 25.0-29.9 |
| Obese Class I | 30-35 | 30.0-34.9 |
| Obese Class II | ≥ 40 | ≥ 40 |

### eGFR Kidney Function
| Stage | Range | Interpretation |
|-------|-------|-----------------|
| G1 | ≥ 90 | Normal kidney function |
| G2 | 60-89 | Mildly decreased function |
| G3a | 45-59 | Mildly to moderately decreased |
| G3b | 30-44 | Moderately to severely decreased |
| G4 | 15-29 | Severely decreased |
| G5 | < 15 | Kidney failure |

### PREDIMED (Mediterranean Diet)
| Category | Range | Adherence |
|----------|-------|-----------|
| Low | < 6 points | Low adherence |
| Medium | 6-9 points | Medium adherence |
| High | ≥ 10 points | High adherence |

### FRAIL (Frailty)
| Category | Criteria | Interpretation |
|----------|----------|-----------------|
| Robust | 0 items | Not frail |
| Pre-frail | 1-2 items | At risk |
| Frail | ≥ 3 items | Frail |

### Metabolic Syndrome
- **Diagnosis**: ≥ 3 of 5 criteria met
- **Criteria**:
  - Waist circumference: > 102 cm (M), > 88 cm (F)
  - Triglycerides: ≥ 150 mg/dL
  - HDL: < 40 mg/dL (M), < 50 mg/dL (F)
  - Blood pressure: SBP ≥ 130 or DBP ≥ 85 mmHg
  - Glucose: ≥ 100 mg/dL

### Physical Activity
| Category | Minutes/Week | Status |
|----------|--------------|--------|
| Insufficient | < 75 | Below guidelines |
| Borderline | 75-149 | Approaching guidelines |
| Active | ≥ 300 | Meets WHO guidelines |

---

## Input Validation Ranges

### Demographics
| Parameter | Min | Max | Unit |
|-----------|-----|-----|------|
| Age | 18 | 120 | years |

### Anthropometry
| Parameter | Min | Max | Unit |
|-----------|-----|-----|------|
| Height | 100 | 250 | cm |
| Weight | 20 | 300 | kg |
| Waist Circumference | 40 | 200 | cm |

### Vitals
| Parameter | Min | Max | Unit |
|-----------|-----|-----|------|
| SBP | 60 | 260 | mmHg |
| DBP | 30 | 160 | mmHg |

### Lipids
| Parameter | Min | Max | Unit |
|-----------|-----|-----|------|
| Total Cholesterol | 50 | 500 | mg/dL |
| HDL | 10 | 150 | mg/dL |
| LDL | 20 | 400 | mg/dL |
| Triglycerides | 20 | 1000 | mg/dL |

### Glucose Metabolism
| Parameter | Min | Max | Unit |
|-----------|-----|-----|------|
| Glucose | 30 | 600 | mg/dL |
| HbA1c | 3.0 | 20.0 | % |

### Renal Function
| Parameter | Min | Max | Unit |
|-----------|-----|-----|------|
| eGFR | 2 | 200 | mL/min/1.73m² |
| Creatinine | 0.1 | 30.0 | mg/dL |
| ACR | 0 | 10000 | mg/g |

### Hepatic Function
| Parameter | Min | Max | Unit |
|-----------|-----|-----|------|
| GGT | 1 | 2000 | U/L |
| AST | 1 | 2000 | U/L |
| ALT | 1 | 2000 | U/L |
| Platelets | 10 | 1000 | G/L |

---

## Schema Validation Examples

### Basic Assessment Validation
```typescript
const result = validateAssessmentInput({
  demographics: { age: 45, sex: 'male' },
  vitals: {
    heightCm: 180,
    weightKg: 85,
    waistCm: 95,
    sbpMmHg: 140,
    dbpMmHg: 90
  },
  labs: {
    totalCholMgDl: 220,
    hdlMgDl: 35,
    triglyceridesMgDl: 200,
    glucoseMgDl: 115,
    eGFR: 75
  },
  clinicalContext: {
    smoking: true,
    hasDiabetes: false,
    hypertension: true,
    familyHistoryDiabetes: true,
    familyHistoryCvd: false,
    gestationalDiabetes: false,
    cvRiskRegion: 'high',
    medications: ['Lisinopril 10mg daily'],
    diagnoses: ['Hypertension', 'Dyslipidemia']
  },
  frailty: null
});

if (result.success) {
  console.log('Valid assessment:', result.data);
} else {
  console.log('Validation errors:', result.error);
}
```

### Patient Creation Validation
```typescript
const result = validatePatientCreate({
  demographics: {
    firstName: 'John',
    lastName: 'Smith',
    dateOfBirth: '1979-03-15T00:00:00Z',
    sex: 'male',
    externalCode: 'MRN-2024-001234'
  },
  contact: {
    email: 'john.smith@example.com',
    phoneNumber: '+1-555-0123',
    address: {
      street: '123 Main St',
      city: 'Boston',
      state: 'MA',
      postalCode: '02115',
      country: 'USA'
    }
  },
  medicalHistory: {
    allergies: ['Penicillin', 'Shellfish'],
    medicationIntolerances: ['Statins'],
    chronicDiseases: ['Type 2 Diabetes', 'Hypertension'],
    surgicalHistory: ['Appendectomy 2010']
  },
  consentGiven: true
});

if (result.success) {
  const displayName = getPatientDisplayName(result.data.demographics);
  console.log('Create patient:', displayName);
}
```

### Report Generation
```typescript
const payload = buildClinicalReportPayload({
  patient: {
    displayName: 'John Smith',
    sex: 'male',
    birthYear: 1979,
    externalCode: 'MRN-2024-001234'
  },
  professional: {
    fullName: 'Dr. Jane Doe',
    licenseNumber: 'MD-789456',
    specialty: 'Cardiology',
    clinicName: 'Boston Heart Clinic'
  },
  tenant: {
    name: 'HealthAI Systems',
    logoUrl: 'https://cdn.example.com/logo.png'
  },
  assessmentDate: '2024-04-19',
  scoreResults: assessmentSnapshot.scoreResults,
  compositeRisk: assessmentSnapshot.compositeRisk,
  screenings: assessmentSnapshot.screenings,
  followupPlan: assessmentSnapshot.followupPlan,
  nutritionSummary: assessmentSnapshot.nutritionSummary,
  activitySummary: assessmentSnapshot.activitySummary,
  alerts: assessmentSnapshot.alerts
});

// Generate PDF with payload
const pdf = await pdfRenderer.generate(payload);
```

---

## Error Handling Pattern

All validation schemas use Zod's `safeParse()` method:

```typescript
const result = validateAssessmentInput(data);

if (result.success) {
  // result.data is typed and safe
  const assessment: AssessmentInput = result.data;
} else {
  // result.error has structured validation errors
  const flattened = result.error.flatten();
  // {
  //   fieldErrors: { field: ['error message'] },
  //   formErrors: ['general errors']
  // }
  return { errors: flattened };
}
```

---

## Integration Checklist

- [ ] Import `CLINICAL_RANGES` for any new input validation
- [ ] Import score thresholds in risk aggregation logic
- [ ] Use `validateAssessmentInput()` in assessment API endpoint
- [ ] Use `validatePatientCreate()`/`validatePatientUpdate()` in patient APIs
- [ ] Use `buildClinicalReportPayload()` in report generation service
- [ ] Add `zod` to package.json: `"zod": "^3.23.0"`
- [ ] Set up TypeScript path aliases for easier imports
- [ ] Add validation middleware to API routes
- [ ] Configure Zod error message localization if needed

---

## Testing Fixtures

### Valid Assessment Data
```typescript
const validAssessment = {
  demographics: { age: 55, sex: 'female' },
  vitals: {
    heightCm: 165,
    weightKg: 72,
    waistCm: 88,
    sbpMmHg: 135,
    dbpMmHg: 85
  },
  labs: {
    totalCholMgDl: 240,
    hdlMgDl: 45,
    ldlMgDl: 160,
    triglyceridesMgDl: 180,
    glucoseMgDl: 105,
    hba1cPct: 5.8,
    eGFR: 68,
    creatinineMgDl: 1.1
  },
  clinicalContext: {
    smoking: false,
    hasDiabetes: false,
    hypertension: true,
    familyHistoryDiabetes: true,
    familyHistoryCvd: true,
    gestationalDiabetes: false,
    cvRiskRegion: 'moderate',
    medications: ['Metoprolol 50mg daily'],
    diagnoses: ['Hypertension', 'Dyslipidemia']
  },
  lifestyle: {
    predimedAnswers: [true, true, false, true, true, true, false, true, true, true, false, true, true, false],
    weeklyActivityMinutes: 150,
    activityFrequency: 5,
    activityType: 'aerobic',
    intensityLevel: 'moderate'
  },
  frailty: {
    fatigue: false,
    resistance: false,
    ambulation: false,
    illnesses: false,
    weightLoss: false
  }
};
```

---

## Related Files

- Score computation engines: `backend/src/domain/clinical/score-engine/`
- Risk aggregation logic: `backend/src/domain/clinical/risk-aggregation/`
- Screening engine: `backend/src/domain/clinical/screening-engine/`
- Alert system: `backend/src/domain/clinical/alert-engine/`
- Activity engine: `backend/src/domain/clinical/activity-engine/`
- Nutrition engine: `backend/src/domain/clinical/nutrition-engine/`
- Followup planner: `backend/src/domain/clinical/followup-engine/`

---

## Support & Maintenance

**Adding New Score Thresholds**:
1. Add constants to `score-thresholds.ts`
2. Update `SCORE_METADATA` in `report-payload.ts`
3. Add tests for threshold logic

**Updating Validation Ranges**:
1. Modify `CLINICAL_RANGES` in `clinical-ranges.ts`
2. No schema changes needed (uses constants)
3. Update this documentation

**Extending Assessment Input**:
1. Add field to `AssessmentInputSchema` in `assessment-input.ts`
2. Update `CLINICAL_RANGES` if applicable
3. Update `AssessmentInput` type (auto-inferred from schema)

**Modifying Report Structure**:
1. Update interfaces in `report-payload.ts`
2. Update `buildClinicalReportPayload()` logic
3. Update PDF renderer templates

---

Last Updated: 2024-04-19
Platform Version: 1.0.0
