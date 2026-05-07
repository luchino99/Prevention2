/**
 * consent-gate.ts — runtime enforcement of GDPR Art.7 granular consent.
 *
 * Sprint 3 task 3.2 — purpose-based consent verification.
 *
 * When to use this middleware
 * ---------------------------
 * Call `assertConsentFor(patientId, consentType)` BEFORE any operation
 * whose legal basis is Art.6(1)(a) consent (rather than Art.6(1)(c)
 * legal obligation or Art.9(2)(h) healthcare provision). The legal-basis
 * decision matrix lives in `docs/41-CONSENT-ENFORCEMENT.md` §2.
 *
 * Concretely, the four enforceable consent types are:
 *
 *   * `ai_processing`            — feeding PHI to an AI model
 *   * `notifications`            — email/SMS/push to patient
 *   * `data_sharing_clinician`   — sending PHI to external clinician
 *   * `marketing`                — commercial communications
 *
 * `health_data_processing` is INTENTIONALLY excluded — its legal basis
 * is Art.6(1)(c) + Art.9(2)(h), not consent. Gating clinical operations
 * on it would incorrectly block lawful care.
 *
 * Semantics
 * ---------
 *   * Latest-wins: queries the most recent `consent_records` row for
 *     the (patient, consent_type) pair.
 *   * Fail-closed: any query error denies (never grants by default).
 *   * Structured logging: every denial emits a CONSENT_DENIED event
 *     with reason ∈ {no_record, not_granted, revoked}.
 *   * Throws `ConsentDeniedError` (caller maps to 403 with a generic
 *     "consent required" body — never echoes the raw reason to the
 *     subject's frontend, to avoid info disclosure).
 */

import { supabaseAdmin } from '../config/supabase.js';
import { logStructured } from '../observability/structured-log.js';

/**
 * The subset of `consent_type` enum that requires runtime enforcement.
 * Mirrors the Art.6(1)(a) consent-based purposes — anything else is
 * justified by a different legal basis and must NOT be gated here.
 */
export const ENFORCEABLE_CONSENT_TYPES = [
  'ai_processing',
  'notifications',
  'data_sharing_clinician',
  'marketing',
] as const;

export type EnforceableConsentType = (typeof ENFORCEABLE_CONSENT_TYPES)[number];

export type ConsentDenialReason = 'no_record' | 'not_granted' | 'revoked';

export class ConsentDeniedError extends Error {
  public readonly status = 403;
  public readonly code = 'CONSENT_REQUIRED';

  constructor(
    public readonly patientId: string,
    public readonly consentType: EnforceableConsentType,
    public readonly reason: ConsentDenialReason,
  ) {
    super(
      `Consent denied for patient ${patientId} (purpose=${consentType}, reason=${reason})`,
    );
    this.name = 'ConsentDeniedError';
  }
}

interface AssertConsentContext {
  /** User who triggered the call — for audit log correlation. */
  actorUserId?: string | null;
  /** Route for the structured log (e.g. 'POST /api/v1/notifications'). */
  route?: string | null;
}

/**
 * Verify that `patientId` has granted (and not revoked) consent for
 * `consentType`. Throws `ConsentDeniedError` on any denial path.
 *
 * @throws ConsentDeniedError when consent is missing, not granted, revoked,
 *                            or when the underlying query fails (fail-closed).
 */
export async function assertConsentFor(
  patientId: string,
  consentType: EnforceableConsentType,
  context: AssertConsentContext = {},
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('consent_records')
    .select('granted, revoked_at, policy_version')
    .eq('subject_type', 'patient')
    .eq('subject_id', patientId)
    .eq('consent_type', consentType)
    .order('granted_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // Fail-closed: any query failure is treated as denial. The
    // alternative (fail-open) would be a privacy regression.
    logStructured('error', 'CONSENT_QUERY_FAILED', {
      patientId,
      consentType,
      dbErrorMessage: error.message,
      dbErrorCode: (error as { code?: string }).code ?? null,
      actorUserId: context.actorUserId ?? null,
      route: context.route ?? null,
    });
    throw new ConsentDeniedError(patientId, consentType, 'not_granted');
  }

  if (!data) {
    logStructured('warn', 'CONSENT_DENIED', {
      patientId,
      consentType,
      reason: 'no_record',
      actorUserId: context.actorUserId ?? null,
      route: context.route ?? null,
    });
    throw new ConsentDeniedError(patientId, consentType, 'no_record');
  }

  if (!data.granted) {
    logStructured('warn', 'CONSENT_DENIED', {
      patientId,
      consentType,
      reason: 'not_granted',
      policyVersion: data.policy_version ?? null,
      actorUserId: context.actorUserId ?? null,
      route: context.route ?? null,
    });
    throw new ConsentDeniedError(patientId, consentType, 'not_granted');
  }

  if (data.revoked_at) {
    logStructured('warn', 'CONSENT_DENIED', {
      patientId,
      consentType,
      reason: 'revoked',
      policyVersion: data.policy_version ?? null,
      revokedAt: data.revoked_at,
      actorUserId: context.actorUserId ?? null,
      route: context.route ?? null,
    });
    throw new ConsentDeniedError(patientId, consentType, 'revoked');
  }

  // Granted, not revoked, query succeeded — proceed.
}

/**
 * Best-effort variant: returns `true` if granted, `false` for any denial
 * path, never throws. Useful when the caller wants to branch on consent
 * state (e.g. include vs omit a field) rather than gate the whole
 * operation. Logging behaviour is identical to assertConsentFor.
 */
export async function hasConsentFor(
  patientId: string,
  consentType: EnforceableConsentType,
  context: AssertConsentContext = {},
): Promise<boolean> {
  try {
    await assertConsentFor(patientId, consentType, context);
    return true;
  } catch (e) {
    if (e instanceof ConsentDeniedError) return false;
    // Unexpected error — re-throw so it surfaces to the caller / observability.
    throw e;
  }
}
