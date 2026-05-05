/**
 * Zod validation schemas for patient creation and update.
 * Validates patient demographic and contact information.
 */

import { z } from 'zod';

/**
 * Patient demographics schema - for creating/updating patient records
 */
const PatientDemographicsSchema = z.object({
  firstName: z
    .string()
    .min(1, 'First name is required')
    .max(100, 'First name must not exceed 100 characters')
    .trim(),
  lastName: z
    .string()
    .min(1, 'Last name is required')
    .max(100, 'Last name must not exceed 100 characters')
    .trim(),
  dateOfBirth: z
    .string()
    .datetime('Date of birth must be a valid ISO 8601 datetime')
    .or(z.date())
    .transform((val: string | Date) => (typeof val === 'string' ? new Date(val) : val))
    .refine(
      (date: Date) => {
        const age = new Date().getFullYear() - date.getFullYear();
        return age >= 18 && age <= 120;
      },
      'Patient must be between 18 and 120 years old'
    ),
  sex: z.enum(['male', 'female'], {
    errorMap: () => ({ message: 'Sex must be either "male" or "female"' }),
  }),
  externalCode: z
    .string()
    .min(1, 'External patient code is required')
    .max(50, 'External code must not exceed 50 characters')
    .describe('External patient identifier (MRN, ID, etc)'),
}).strict();

/**
 * Contact information schema
 */
const ContactInformationSchema = z.object({
  email: z
    .string()
    .email('Invalid email address')
    .optional()
    .nullable(),
  phoneNumber: z
    .string()
    .regex(/^[\d\s\-+()]+$/, 'Invalid phone number format')
    .min(7, 'Phone number must be at least 7 characters')
    .max(20, 'Phone number must not exceed 20 characters')
    .optional()
    .nullable(),
  address: z.object({
    street: z
      .string()
      .max(150, 'Street must not exceed 150 characters')
      .optional()
      .nullable(),
    city: z
      .string()
      .max(100, 'City must not exceed 100 characters')
      .optional()
      .nullable(),
    state: z
      .string()
      .max(50, 'State must not exceed 50 characters')
      .optional()
      .nullable(),
    postalCode: z
      .string()
      .max(20, 'Postal code must not exceed 20 characters')
      .optional()
      .nullable(),
    country: z
      .string()
      .max(100, 'Country must not exceed 100 characters')
      .optional()
      .nullable(),
  }).optional().nullable(),
}).strict().optional();

/**
 * Emergency contact schema
 */
const EmergencyContactSchema = z.object({
  name: z
    .string()
    .min(1, 'Emergency contact name is required')
    .max(100, 'Name must not exceed 100 characters')
    .optional()
    .nullable(),
  relationship: z
    .string()
    .max(50, 'Relationship must not exceed 50 characters')
    .optional()
    .nullable(),
  phoneNumber: z
    .string()
    .regex(/^[\d\s\-+()]+$/, 'Invalid phone number format')
    .min(7, 'Phone number must be at least 7 characters')
    .max(20, 'Phone number must not exceed 20 characters')
    .optional()
    .nullable(),
}).strict().optional();

/**
 * Medical history metadata schema
 */
const MedicalHistorySchema = z.object({
  allergies: z
    .array(z.string().min(1).max(100))
    .optional()
    .default([])
    .describe('List of known allergies'),
  medicationIntolerances: z
    .array(z.string().min(1).max(100))
    .optional()
    .default([])
    .describe('List of medication intolerances'),
  chronicDiseases: z
    .array(z.string().min(1).max(100))
    .optional()
    .default([])
    .describe('List of chronic diseases or conditions'),
  surgicalHistory: z
    .array(z.string().min(1).max(200))
    .optional()
    .default([])
    .describe('List of previous surgeries'),
}).strict().optional();

/**
 * Insurance information schema
 */
const InsuranceSchema = z.object({
  provider: z
    .string()
    .max(100, 'Provider name must not exceed 100 characters')
    .optional()
    .nullable(),
  policyNumber: z
    .string()
    .max(50, 'Policy number must not exceed 50 characters')
    .optional()
    .nullable(),
  groupNumber: z
    .string()
    .max(50, 'Group number must not exceed 50 characters')
    .optional()
    .nullable(),
  effectiveDate: z
    .string()
    .datetime()
    .optional()
    .nullable(),
}).strict().optional();

/**
 * Complete patient creation schema
 */
export const PatientCreateSchema = z.object({
  demographics: PatientDemographicsSchema,
  contact: ContactInformationSchema,
  emergencyContact: EmergencyContactSchema,
  medicalHistory: MedicalHistorySchema,
  insurance: InsuranceSchema,
  notes: z
    .string()
    .max(2000, 'Notes must not exceed 2000 characters')
    .optional()
    .nullable(),
  consentGiven: z
    .boolean()
    .default(false)
    .describe('Patient has consented to be in the system'),
}).strict();

/**
 * Patient update schema - all fields optional except demographics
 */
export const PatientUpdateSchema = z.object({
  demographics: PatientDemographicsSchema.partial().optional(),
  contact: ContactInformationSchema,
  emergencyContact: EmergencyContactSchema,
  medicalHistory: MedicalHistorySchema,
  insurance: InsuranceSchema,
  notes: z
    .string()
    .max(2000, 'Notes must not exceed 2000 characters')
    .optional()
    .nullable(),
  consentGiven: z.boolean().optional(),
}).strict();

/**
 * Inferred TypeScript types from schemas
 */
export type PatientCreate = z.infer<typeof PatientCreateSchema>;
export type PatientUpdate = z.infer<typeof PatientUpdateSchema>;

/**
 * Camel-case aliases used by the HTTP route layer (`api/v1/patients/*`).
 * Identical to the PascalCase exports above — kept for naming-convention
 * compatibility without duplicating validation logic.
 */
export const createPatientSchema = PatientCreateSchema;
export const updatePatientSchema = PatientUpdateSchema;

/**
 * Helper functions for validation
 */
export function validatePatientCreate(data: unknown) {
  return PatientCreateSchema.safeParse(data);
}

export function validatePatientUpdate(data: unknown) {
  return PatientUpdateSchema.safeParse(data);
}

/**
 * Helper to get patient display name from demographics
 */
export function getPatientDisplayName(demographics: z.infer<typeof PatientDemographicsSchema>): string {
  return `${demographics.firstName} ${demographics.lastName}`;
}
