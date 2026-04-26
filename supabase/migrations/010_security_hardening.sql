-- ============================================================
-- MIGRAZIONE 010: SECURITY HARDENING (B-01 / B-02 / B-15)
-- ============================================================
--
-- Audit findings addressed
-- ------------------------
-- B-01  RLS LEAKS PHI ACROSS CLINICIANS WITHIN THE SAME TENANT
--       Today, `patients_select_clinician`, `assessments_select_clinician`,
--       `alerts_select_clinician`, `followup_select`, `followup_manage` and
--       `reports_select` only check tenant_id + role. Any clinician of the
--       tenant can read/modify PHI for any patient of that tenant — even
--       patients they have no professional relationship with. The
--       application layer enforces the
--       `professional_patient_links` (PPL) gate, but RLS does not, so any
--       direct DB access (anon-key client, future portal, mis-issued
--       token) bypasses the per-clinician scoping required by GDPR
--       Art.5 §1(c) (data minimisation) and Art.32 §1(b) (least
--       privilege). This migration narrows RLS to:
--
--         clinician → only their PPL-linked patients
--         tenant_admin / platform_admin → unchanged (full tenant view)
--         assistant_staff → unchanged where it had access; removed where
--                           it did not appear in original policies
--         patient → unchanged (portal_user_id path)
--
-- B-02  CONSENT_RECORDS / AUDIT_EVENTS INSERT POLICIES ARE TOO PERMISSIVE
--       Existing policies allow ANY authenticated user to insert ANY row,
--       which means a compromised low-priv account can forge audit
--       evidence or fabricate consent rows for arbitrary subjects /
--       tenants. This migration scopes the WITH CHECK to require:
--
--         consent_records:
--           - subject_type='user'    → subject_id = auth.uid()
--           - subject_type='patient' → patient must belong to current tenant
--                                       AND inserter must be tenant_admin
--                                       OR clinician PPL-linked to that patient
--                                       OR platform_admin
--         audit_events:
--           - tenant_id = caller's tenant (or platform_admin)
--           - actor_user_id = auth.uid() OR NULL (system)
--
-- B-15  CLINICAL-REPORTS STORAGE BUCKET LACKS EXPLICIT POLICY
--       The bucket `clinical-reports` is private (signed-URL only), but
--       there is no row-level policy on `storage.objects` to enforce that
--       even authenticated reads MUST go through the API and that direct
--       PostgREST access is denied. This migration declares the bucket
--       row + four explicit policies (SELECT / INSERT / UPDATE / DELETE)
--       that together permit operations only from the service role —
--       i.e. through the Vercel handlers — and deny everything else.
--
-- Defence-in-depth principle
-- --------------------------
-- The Vercel API handlers run with the Supabase service-role key, which
-- bypasses RLS by design. So tightening RLS does NOT change the behaviour
-- of the API layer at all. It hardens the database against:
--   * an anon-key supabase-js client erroneously gaining a JWT
--   * a future patient portal that connects directly with a user JWT
--   * a leaked/mis-scoped JWT being replayed
--   * developer mistakes that accidentally use the user-key client
--
-- Idempotency
-- -----------
-- Every CREATE POLICY is preceded by DROP POLICY IF EXISTS so the file
-- is safe to re-run on staging without manual cleanup. The storage
-- bucket row uses ON CONFLICT DO NOTHING.
--
-- Compatibility
-- -------------
-- This migration is additive — it only TIGHTENS access. Existing
-- service-role flows are untouched. The patient-portal `select_self` /
-- `select_patient` paths are preserved verbatim. Tenant_admin scope is
-- unchanged. The only behavioural change is that a clinician using a
-- direct user-JWT client will now see only their PPL patients.
--
-- Rollback
-- --------
-- Re-applying 002_rls_policies.sql (or its relevant section) restores
-- the previous, permissive policies. The PPL helper
-- `is_linked_to_patient` from 005 remains in place either way.
--
-- ============================================================

BEGIN;

-- ============================================================
-- 1. PATIENTS — narrow clinician SELECT to PPL-linked patients
-- ============================================================
-- assistant_staff retains tenant-wide read because triage / scheduling
-- workflows need it; tenant_admin and platform_admin are unchanged.

DROP POLICY IF EXISTS patients_select_clinician   ON patients;
DROP POLICY IF EXISTS patients_select_admin       ON patients;
DROP POLICY IF EXISTS patients_select_assistant   ON patients;

CREATE POLICY patients_select_admin ON patients FOR SELECT
  USING (
    tenant_id = get_current_tenant_id()
    AND get_current_user_role() IN ('tenant_admin', 'platform_admin')
  );

CREATE POLICY patients_select_assistant ON patients FOR SELECT
  USING (
    tenant_id = get_current_tenant_id()
    AND get_current_user_role() = 'assistant_staff'
  );

-- Clinician sees only patients they are actively linked to.
-- `is_linked_to_patient` is SECURITY DEFINER so it can read the PPL
-- table even when the calling role's RLS would not allow it directly.
CREATE POLICY patients_select_clinician ON patients FOR SELECT
  USING (
    tenant_id = get_current_tenant_id()
    AND get_current_user_role() = 'clinician'
    AND is_linked_to_patient(id)
  );

-- INSERT/UPDATE: keep current behaviour (clinician + tenant_admin only,
-- tenant-scoped). We do NOT block clinicians from creating new patients
-- because the PPL link is created by the application immediately after
-- the patient row is inserted (assessment-service flow).

-- ============================================================
-- 2. PATIENT_CLINICAL_PROFILES — reuse patient gating
-- ============================================================
-- Already EXISTS via parent patient row, but the parent patient SELECT
-- has now been tightened, so this implicitly inherits PPL scoping.
-- We additionally add an explicit clinician-PPL gate on UPDATE/DELETE
-- so a clinician without a link cannot mutate a profile via direct
-- access even if they somehow learn the patient_id.

DROP POLICY IF EXISTS clinical_profiles_manage ON patient_clinical_profiles;
CREATE POLICY clinical_profiles_manage ON patient_clinical_profiles FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM patients p
      WHERE p.id = patient_clinical_profiles.patient_id
        AND p.tenant_id = get_current_tenant_id()
        AND (
          get_current_user_role() IN ('tenant_admin', 'platform_admin')
          OR (
            get_current_user_role() = 'clinician'
            AND is_linked_to_patient(p.id)
          )
        )
    )
  );

-- ============================================================
-- 3. ASSESSMENTS — clinician must be PPL-linked
-- ============================================================

DROP POLICY IF EXISTS assessments_select_clinician ON assessments;
DROP POLICY IF EXISTS assessments_select_admin     ON assessments;
DROP POLICY IF EXISTS assessments_select_assistant ON assessments;
DROP POLICY IF EXISTS assessments_insert           ON assessments;
DROP POLICY IF EXISTS assessments_update           ON assessments;

CREATE POLICY assessments_select_admin ON assessments FOR SELECT
  USING (
    tenant_id = get_current_tenant_id()
    AND get_current_user_role() IN ('tenant_admin', 'platform_admin')
  );

CREATE POLICY assessments_select_assistant ON assessments FOR SELECT
  USING (
    tenant_id = get_current_tenant_id()
    AND get_current_user_role() = 'assistant_staff'
  );

CREATE POLICY assessments_select_clinician ON assessments FOR SELECT
  USING (
    tenant_id = get_current_tenant_id()
    AND get_current_user_role() = 'clinician'
    AND is_linked_to_patient(patient_id)
  );

-- INSERT/UPDATE: clinician must be linked, OR tenant_admin / platform_admin
CREATE POLICY assessments_insert ON assessments FOR INSERT
  WITH CHECK (
    tenant_id = get_current_tenant_id()
    AND (
      get_current_user_role() IN ('tenant_admin', 'platform_admin')
      OR (
        get_current_user_role() = 'clinician'
        AND is_linked_to_patient(patient_id)
      )
    )
  );

CREATE POLICY assessments_update ON assessments FOR UPDATE
  USING (
    tenant_id = get_current_tenant_id()
    AND (
      get_current_user_role() IN ('tenant_admin', 'platform_admin')
      OR (
        get_current_user_role() = 'clinician'
        AND is_linked_to_patient(patient_id)
      )
    )
  );

-- ============================================================
-- 4. ALERTS — clinician must be PPL-linked to the patient
-- ============================================================

DROP POLICY IF EXISTS alerts_select_clinician ON alerts;
DROP POLICY IF EXISTS alerts_select_admin     ON alerts;
DROP POLICY IF EXISTS alerts_manage           ON alerts;

CREATE POLICY alerts_select_admin ON alerts FOR SELECT
  USING (
    tenant_id = get_current_tenant_id()
    AND get_current_user_role() IN ('tenant_admin', 'platform_admin')
  );

CREATE POLICY alerts_select_clinician ON alerts FOR SELECT
  USING (
    tenant_id = get_current_tenant_id()
    AND get_current_user_role() = 'clinician'
    AND is_linked_to_patient(patient_id)
  );

CREATE POLICY alerts_manage ON alerts FOR ALL
  USING (
    tenant_id = get_current_tenant_id()
    AND (
      get_current_user_role() IN ('tenant_admin', 'platform_admin')
      OR (
        get_current_user_role() = 'clinician'
        AND is_linked_to_patient(patient_id)
      )
    )
  );

-- ============================================================
-- 5. FOLLOWUP_PLANS — clinician must be PPL-linked
-- ============================================================

DROP POLICY IF EXISTS followup_select  ON followup_plans;
DROP POLICY IF EXISTS followup_manage  ON followup_plans;
DROP POLICY IF EXISTS followup_select_admin ON followup_plans;

CREATE POLICY followup_select_admin ON followup_plans FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM patients p
      WHERE p.id = followup_plans.patient_id
        AND p.tenant_id = get_current_tenant_id()
        AND get_current_user_role() IN ('tenant_admin', 'platform_admin')
    )
  );

CREATE POLICY followup_select ON followup_plans FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM patients p
      WHERE p.id = followup_plans.patient_id
        AND (
          (p.tenant_id = get_current_tenant_id()
            AND get_current_user_role() = 'clinician'
            AND is_linked_to_patient(p.id))
          OR (p.portal_user_id = auth.uid()
            AND get_current_user_role() = 'patient')
        )
    )
  );

CREATE POLICY followup_manage ON followup_plans FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM patients p
      WHERE p.id = followup_plans.patient_id
        AND p.tenant_id = get_current_tenant_id()
        AND (
          get_current_user_role() IN ('tenant_admin', 'platform_admin')
          OR (
            get_current_user_role() = 'clinician'
            AND is_linked_to_patient(p.id)
          )
        )
    )
  );

-- ============================================================
-- 6. REPORT_EXPORTS — clinician must be PPL-linked
-- ============================================================

DROP POLICY IF EXISTS reports_select         ON report_exports;
DROP POLICY IF EXISTS reports_select_admin   ON report_exports;
DROP POLICY IF EXISTS reports_select_patient ON report_exports;
DROP POLICY IF EXISTS reports_insert         ON report_exports;

CREATE POLICY reports_select_admin ON report_exports FOR SELECT
  USING (
    tenant_id = get_current_tenant_id()
    AND get_current_user_role() IN ('tenant_admin', 'platform_admin')
  );

CREATE POLICY reports_select ON report_exports FOR SELECT
  USING (
    tenant_id = get_current_tenant_id()
    AND get_current_user_role() = 'clinician'
    AND is_linked_to_patient(patient_id)
  );

CREATE POLICY reports_select_patient ON report_exports FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM patients p
      WHERE p.id = report_exports.patient_id
        AND p.portal_user_id = auth.uid()
    )
    AND get_current_user_role() = 'patient'
  );

CREATE POLICY reports_insert ON report_exports FOR INSERT
  WITH CHECK (
    tenant_id = get_current_tenant_id()
    AND (
      get_current_user_role() IN ('tenant_admin', 'platform_admin')
      OR (
        get_current_user_role() = 'clinician'
        AND is_linked_to_patient(patient_id)
      )
    )
  );

-- ============================================================
-- 7. CONSENT_RECORDS — scope INSERT to legitimate subjects (B-02)
-- ============================================================

DROP POLICY IF EXISTS consent_insert ON consent_records;

CREATE POLICY consent_insert ON consent_records FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      -- Self-consent (user record): can only insert your own user row
      (subject_type = 'user' AND subject_id = auth.uid())
      OR (
        -- Patient consent: must be tenant_admin / platform_admin
        -- OR clinician PPL-linked to the patient. Patient must
        -- belong to caller's tenant.
        subject_type = 'patient'
        AND EXISTS (
          SELECT 1 FROM patients p
          WHERE p.id = consent_records.subject_id
            AND p.tenant_id = get_current_tenant_id()
            AND (
              get_current_user_role() IN ('tenant_admin', 'platform_admin')
              OR (
                get_current_user_role() = 'clinician'
                AND is_linked_to_patient(p.id)
              )
              -- The patient themselves can also self-record consent via
              -- the portal (e.g. accepting privacy policy on first login).
              OR (
                get_current_user_role() = 'patient'
                AND p.portal_user_id = auth.uid()
              )
            )
        )
      )
    )
  );

-- ============================================================
-- 8. AUDIT_EVENTS — scope INSERT to caller's tenant (B-02)
-- ============================================================

DROP POLICY IF EXISTS audit_insert ON audit_events;

CREATE POLICY audit_insert ON audit_events FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      -- platform_admin can write into any tenant (system-wide audit)
      get_current_user_role() = 'platform_admin'
      -- everyone else must scope to their own tenant
      OR (
        tenant_id = get_current_tenant_id()
        -- actor_user_id must match the JWT subject OR be NULL (system path)
        AND (actor_user_id IS NULL OR actor_user_id = auth.uid())
      )
    )
  );

-- Note: audit_select policy (002 line 368) is unchanged. Reads remain
-- restricted to tenant_admin / platform_admin within their tenant.

-- ============================================================
-- 9. STORAGE BUCKET — `clinical-reports` (B-15)
-- ============================================================
--
-- Make the bucket explicitly private and lock down access to the
-- service role only. Signed URLs minted by the API are unaffected
-- because they are presigned references that bypass policy checks.
-- This is safety net against:
--   * accidental `public = true` on the bucket via the dashboard
--   * a future code path that uses an anon-key supabase-js client
--   * direct PostgREST hits to /storage/v1/object/...

INSERT INTO storage.buckets (id, name, public)
VALUES ('clinical-reports', 'clinical-reports', false)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public;

-- Drop any pre-existing policies on storage.objects for this bucket so
-- we are starting from a known baseline. The conditional names below
-- are the ones we declare here; if the dashboard created different
-- ones they remain (ops cleanup task), but ours are authoritative for
-- service-role-only access.
DROP POLICY IF EXISTS clinical_reports_object_select ON storage.objects;
DROP POLICY IF EXISTS clinical_reports_object_insert ON storage.objects;
DROP POLICY IF EXISTS clinical_reports_object_update ON storage.objects;
DROP POLICY IF EXISTS clinical_reports_object_delete ON storage.objects;

-- service_role bypasses RLS implicitly, so these policies define what
-- the *user / anon* roles can do = nothing. Authenticated users get
-- access to PDFs strictly via signed URLs minted by the API.

CREATE POLICY clinical_reports_object_select ON storage.objects FOR SELECT
  USING (
    bucket_id = 'clinical-reports'
    AND auth.role() = 'service_role'
  );

CREATE POLICY clinical_reports_object_insert ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'clinical-reports'
    AND auth.role() = 'service_role'
  );

CREATE POLICY clinical_reports_object_update ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'clinical-reports'
    AND auth.role() = 'service_role'
  )
  WITH CHECK (
    bucket_id = 'clinical-reports'
    AND auth.role() = 'service_role'
  );

CREATE POLICY clinical_reports_object_delete ON storage.objects FOR DELETE
  USING (
    bucket_id = 'clinical-reports'
    AND auth.role() = 'service_role'
  );

-- ============================================================
-- 10. AUDIT — record the migration
-- ============================================================

-- NOTE: audit_events.entity_id is typed UUID (see 001_schema_foundation.sql).
-- Migration version labels ('010', '011', …) are not real entity UUIDs, so
-- they go into metadata_json as a textual field; entity_id is left NULL.
INSERT INTO audit_events (
  tenant_id,
  actor_user_id,
  action,
  entity_type,
  entity_id,
  metadata_json,
  ip_hash
) VALUES (
  NULL,
  NULL,
  'system.migration.applied',
  'migration',
  NULL,
  jsonb_build_object(
    'name', '010_security_hardening',
    'migration_version', '010',
    'audit_findings', ARRAY['B-01', 'B-02', 'B-15'],
    'applied_at', NOW()
  ),
  NULL
);

COMMIT;

-- ============================================================
-- POST-DEPLOY VERIFICATION (manual, run as service role)
-- ============================================================
--
-- 1. Confirm a clinician without a PPL link cannot SELECT a tenant-
--    sibling patient via a user-JWT client:
--
--      set role authenticated;
--      set request.jwt.claims = '{"sub": "<clinician_user_id>"}';
--      select id from patients where id = '<unlinked_patient_id>';
--      -- expected: 0 rows
--
-- 2. Confirm tenant_admin still sees all patients:
--
--      set request.jwt.claims = '{"sub": "<tenant_admin_user_id>"}';
--      select count(*) from patients where tenant_id = '<tenant>';
--      -- expected: full count
--
-- 3. Confirm consent_records cannot be inserted for arbitrary patient:
--
--      set request.jwt.claims = '{"sub": "<other_clinician_user_id>"}';
--      insert into consent_records (...);
--      -- expected: ERROR: new row violates row-level security policy
--
-- 4. Confirm storage.objects in clinical-reports refuse anon SELECT:
--
--      set role anon;
--      select count(*) from storage.objects where bucket_id = 'clinical-reports';
--      -- expected: 0 rows OR error
--
-- ============================================================
