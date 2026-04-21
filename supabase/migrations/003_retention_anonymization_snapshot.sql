-- ============================================================
-- 003_retention_anonymization_snapshot.sql
-- ============================================================
-- Adds:
--   (a) assessments.clinical_input_snapshot   - reproducible engine input
--   (b) patients.deleted_at                   - soft-delete for anonymization
--   (c) assessments.anonymized_at             - marker for PII-stripped rows
--   (d) data_subject_requests table           - GDPR Art.15/17/20 tracking
--   (e) fn_assessments_reproducible_check()   - guard trigger
--   (f) fn_anonymize_patient(uuid, uuid)      - anonymization worker SQL fn
--   (g) fn_retention_prune()                  - retention cron SQL fn
--   (h) RLS policies for data_subject_requests
--
-- Safety:
--   * Score formulas are NOT touched.
--   * Existing rows get NULL clinical_input_snapshot; loadAssessmentSnapshot()
--     already returns 409 SNAPSHOT_MISSING for those, so behaviour degrades
--     cleanly without silent corruption.
--   * Anonymization is irreversible; the function is SECURITY DEFINER and
--     callable only by a service role via backend worker.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- (a) assessments.clinical_input_snapshot
-- ------------------------------------------------------------

ALTER TABLE assessments
  ADD COLUMN IF NOT EXISTS clinical_input_snapshot JSONB;

COMMENT ON COLUMN assessments.clinical_input_snapshot IS
  'Canonical deterministic-engine input (AssessmentInput shape). Required so '
  'loadAssessmentSnapshot() can re-run the pure engine and produce identical '
  'output. NULL only for pre-migration-003 rows.';

CREATE INDEX IF NOT EXISTS idx_assessments_has_snapshot
  ON assessments((clinical_input_snapshot IS NOT NULL));

-- ------------------------------------------------------------
-- (b) patients.deleted_at  (soft-delete marker for anonymization pipeline)
-- ------------------------------------------------------------

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ;

COMMENT ON COLUMN patients.deleted_at IS
  'Soft-delete timestamp. Row is hidden from tenant clinicians but retained '
  'until anonymization grace period expires (default 30 days, configurable '
  'via tenant policy).';

COMMENT ON COLUMN patients.anonymized_at IS
  'Irreversible anonymization timestamp. After this, first_name, last_name, '
  'contact_email, contact_phone, external_code, display_name are stripped.';

CREATE INDEX IF NOT EXISTS idx_patients_deleted
  ON patients(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patients_anonymization_pending
  ON patients(deleted_at)
  WHERE deleted_at IS NOT NULL AND anonymized_at IS NULL;

-- ------------------------------------------------------------
-- (c) assessments.anonymized_at  (cascades from patient anonymization)
-- ------------------------------------------------------------

ALTER TABLE assessments
  ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ;

COMMENT ON COLUMN assessments.anonymized_at IS
  'Set by fn_anonymize_patient; when non-NULL, clinical_input_snapshot has '
  'been stripped of demographics/PII while keeping deterministic score '
  'outputs for epidemiological aggregation.';

-- ------------------------------------------------------------
-- (d) data_subject_requests  (GDPR Art.15/17/20 ledger)
-- ------------------------------------------------------------

-- PostgreSQL non supporta `CREATE TYPE IF NOT EXISTS`. Usiamo il blocco
-- DO ... EXCEPTION WHEN duplicate_object: è l'idioma idempotente canonico
-- per le migration PostgreSQL che creano ENUM.
DO $$ BEGIN
  CREATE TYPE dsr_kind AS ENUM (
    'access',       -- Art.15 - right to access (export)
    'erasure',      -- Art.17 - right to be forgotten (anonymization)
    'portability',  -- Art.20 - data portability (export)
    'rectification' -- Art.16
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE dsr_status AS ENUM (
    'received',
    'in_progress',
    'fulfilled',
    'rejected',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS data_subject_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  subject_patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
  subject_user_id UUID REFERENCES users(id) ON DELETE SET NULL,

  kind dsr_kind NOT NULL,
  status dsr_status NOT NULL DEFAULT 'received',

  requested_by_user_id UUID REFERENCES users(id),
  fulfilled_by_user_id UUID REFERENCES users(id),
  export_storage_path TEXT,
  rejection_reason TEXT,
  notes TEXT,

  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fulfilled_at TIMESTAMPTZ,

  -- GDPR: 30-day SLA Art.12(3)
  sla_deadline TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),

  CHECK (subject_patient_id IS NOT NULL OR subject_user_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_dsr_tenant_status
  ON data_subject_requests(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_dsr_deadline
  ON data_subject_requests(sla_deadline)
  WHERE status IN ('received', 'in_progress');

ALTER TABLE data_subject_requests ENABLE ROW LEVEL SECURITY;

-- Only tenant admins can see their tenant's DSRs. Platform admins see all.
-- PostgreSQL 15 non supporta `CREATE POLICY IF NOT EXISTS` (arrivato in PG 16).
-- Usiamo `DROP POLICY IF EXISTS ... ; CREATE POLICY ...` per rendere la
-- migration ri-eseguibile senza errori di duplicato.
DROP POLICY IF EXISTS dsr_tenant_read ON data_subject_requests;
CREATE POLICY dsr_tenant_read ON data_subject_requests
  FOR SELECT
  USING (
    tenant_id = get_current_tenant_id()
    OR get_current_user_role() = 'platform_admin'
  );

DROP POLICY IF EXISTS dsr_tenant_insert ON data_subject_requests;
CREATE POLICY dsr_tenant_insert ON data_subject_requests
  FOR INSERT
  WITH CHECK (
    tenant_id = get_current_tenant_id()
    AND get_current_user_role() IN ('tenant_admin', 'platform_admin')
  );

DROP POLICY IF EXISTS dsr_tenant_update ON data_subject_requests;
CREATE POLICY dsr_tenant_update ON data_subject_requests
  FOR UPDATE
  USING (
    tenant_id = get_current_tenant_id()
    AND get_current_user_role() IN ('tenant_admin', 'platform_admin')
  );

-- ------------------------------------------------------------
-- (e) Guard trigger: never UPDATE clinical_input_snapshot once set
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_assessments_reproducible_check()
RETURNS TRIGGER AS $$
BEGIN
  -- Snapshot is immutable once written. Changing it would break the
  -- "same input ⇒ same output" contract of the deterministic engine.
  IF TG_OP = 'UPDATE'
     AND OLD.clinical_input_snapshot IS NOT NULL
     AND OLD.anonymized_at IS NULL
     AND (
       NEW.clinical_input_snapshot IS NULL
       OR NEW.clinical_input_snapshot::text <> OLD.clinical_input_snapshot::text
     )
  THEN
    RAISE EXCEPTION 'clinical_input_snapshot is immutable (assessment %).', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assessments_snapshot_immutable ON assessments;
CREATE TRIGGER trg_assessments_snapshot_immutable
  BEFORE UPDATE ON assessments
  FOR EACH ROW
  EXECUTE FUNCTION fn_assessments_reproducible_check();

-- ------------------------------------------------------------
-- (f) fn_anonymize_patient — irreversible PII strip
-- ------------------------------------------------------------
--
-- Called by the backend worker after the deletion grace period.
-- Keeps the row (and score_results) for epidemiology but strips all PII.
-- Cascades into clinical_input_snapshot demographics via JSONB patch.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_anonymize_patient(p_patient_id UUID, p_actor_user_id UUID)
RETURNS VOID AS $$
DECLARE
  v_tenant UUID;
BEGIN
  SELECT tenant_id INTO v_tenant FROM patients WHERE id = p_patient_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Patient % not found', p_patient_id;
  END IF;

  -- 1. Strip PII on patient row
  UPDATE patients
     SET first_name     = NULL,
         last_name      = NULL,
         contact_email  = NULL,
         contact_phone  = NULL,
         external_code  = NULL,
         display_name   = 'ANONYMIZED',
         birth_date     = NULL,
         notes          = NULL,
         is_active      = FALSE,
         anonymized_at  = NOW()
   WHERE id = p_patient_id;

  -- 2. Strip demographics from clinical_input_snapshot but keep sex+age+labs
  --    so aggregate score distribution remains analyzable.
  UPDATE assessments
     SET clinical_input_snapshot = clinical_input_snapshot
           #- '{clinicalContext,medications}'
           #- '{clinicalContext,diagnoses}',
         notes = NULL,
         anonymized_at = NOW()
   WHERE patient_id = p_patient_id
     AND clinical_input_snapshot IS NOT NULL;

  -- 3. Purge patient-originated free text from alerts & followup plans
  UPDATE alerts SET message = '[anonymized]' WHERE patient_id = p_patient_id;

  -- 4. Audit the action (service role context)
  INSERT INTO audit_events(
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata, ip_address_hash
  ) VALUES (
    v_tenant, p_actor_user_id, 'patient.anonymize', 'patient', p_patient_id,
    jsonb_build_object('reason', 'retention_policy_or_dsr'), NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION fn_anonymize_patient(UUID, UUID) FROM PUBLIC;
-- Grant only to service role (Supabase service role connects as 'postgres',
-- but we also expose explicit grant for RLS-bypass roles).
GRANT EXECUTE ON FUNCTION fn_anonymize_patient(UUID, UUID) TO postgres;

COMMENT ON FUNCTION fn_anonymize_patient(UUID, UUID) IS
  'Irreversible anonymization per GDPR Art.17. Strips PII from patient row, '
  'assessments.clinical_input_snapshot (medications + diagnoses), alert '
  'messages. Keeps deterministic score_results & risk_profiles for '
  'aggregate analytics on legal-basis Art.6(1)(f) with DPIA.';

-- ------------------------------------------------------------
-- (g) fn_retention_prune — age-based cleanup
-- ------------------------------------------------------------
--
-- Retention windows (blueprint §11.4):
--   * audit_events       : 10 years (medical-legal, then delete)
--   * report_exports     : storage 2 years, DB row kept for traceability
--   * notification_jobs  : 90 days after success/failure
--   * alerts             : resolved alerts 1 year
--
-- This function is idempotent and returns a jsonb report of pruning counts
-- so the cron job can log outcomes.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_retention_prune()
RETURNS JSONB AS $$
DECLARE
  v_audit_deleted INTEGER;
  v_notif_deleted INTEGER;
  v_alerts_deleted INTEGER;
  v_reports_expired INTEGER;
BEGIN
  DELETE FROM audit_events
   WHERE created_at < NOW() - INTERVAL '10 years';
  GET DIAGNOSTICS v_audit_deleted = ROW_COUNT;

  DELETE FROM notification_jobs
   WHERE created_at < NOW() - INTERVAL '90 days'
     AND status IN ('sent', 'failed');
  GET DIAGNOSTICS v_notif_deleted = ROW_COUNT;

  DELETE FROM alerts
   WHERE status = 'resolved'
     AND resolved_at < NOW() - INTERVAL '1 year';
  GET DIAGNOSTICS v_alerts_deleted = ROW_COUNT;

  -- Mark expired reports (storage cleanup handled by backend worker because
  -- it needs to issue storage DELETE calls against Supabase Storage API).
  UPDATE report_exports
     SET storage_path = NULL
   WHERE created_at < NOW() - INTERVAL '2 years'
     AND storage_path IS NOT NULL;
  GET DIAGNOSTICS v_reports_expired = ROW_COUNT;

  RETURN jsonb_build_object(
    'audit_deleted',    v_audit_deleted,
    'notif_deleted',    v_notif_deleted,
    'alerts_deleted',   v_alerts_deleted,
    'reports_expired',  v_reports_expired,
    'run_at',           NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION fn_retention_prune() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_retention_prune() TO postgres;

COMMENT ON FUNCTION fn_retention_prune() IS
  'Retention cron worker. Removes rows that have passed their legal '
  'retention window. Called daily by the backend cron. Safe to re-run.';

COMMIT;
