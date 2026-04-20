-- ============================================================
-- MIGRAZIONE 002: ROW LEVEL SECURITY POLICIES
-- ============================================================
-- Isolamento tenant + role-based access
-- Principio: nessun accesso cross-tenant, minimo privilegio per ruolo
-- ============================================================

-- ============================================================
-- ABILITA RLS SU TUTTE LE TABELLE
-- ============================================================

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE professionals ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_clinical_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE score_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE nutrition_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE followup_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_jobs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TENANTS: solo il proprio tenant visibile
-- ============================================================

CREATE POLICY tenants_select ON tenants FOR SELECT
  USING (id = get_current_tenant_id());

CREATE POLICY tenants_update ON tenants FOR UPDATE
  USING (id = get_current_tenant_id() AND get_current_user_role() IN ('tenant_admin', 'platform_admin'));

-- ============================================================
-- USERS: visibili solo nel proprio tenant
-- ============================================================

CREATE POLICY users_select ON users FOR SELECT
  USING (tenant_id = get_current_tenant_id());

CREATE POLICY users_insert ON users FOR INSERT
  WITH CHECK (tenant_id = get_current_tenant_id() AND get_current_user_role() IN ('tenant_admin', 'platform_admin'));

CREATE POLICY users_update ON users FOR UPDATE
  USING (
    tenant_id = get_current_tenant_id()
    AND (
      id = auth.uid()  -- Puo aggiornare se stesso
      OR get_current_user_role() IN ('tenant_admin', 'platform_admin')
    )
  );

-- ============================================================
-- PROFESSIONALS: visibili solo nel proprio tenant
-- ============================================================

CREATE POLICY professionals_select ON professionals FOR SELECT
  USING (tenant_id = get_current_tenant_id());

CREATE POLICY professionals_manage ON professionals FOR ALL
  USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

-- ============================================================
-- PATIENTS: isolamento tenant + ruolo
-- ============================================================

-- Clinician e tenant_admin vedono tutti i pazienti del tenant
CREATE POLICY patients_select_clinician ON patients FOR SELECT
  USING (
    tenant_id = get_current_tenant_id()
    AND get_current_user_role() IN ('clinician', 'tenant_admin', 'platform_admin', 'assistant_staff')
  );

-- Il paziente vede solo se stesso (via portal_user_id)
CREATE POLICY patients_select_self ON patients FOR SELECT
  USING (
    portal_user_id = auth.uid()
    AND get_current_user_role() = 'patient'
  );

-- Solo clinician e admin possono creare pazienti
CREATE POLICY patients_insert ON patients FOR INSERT
  WITH CHECK (
    tenant_id = get_current_tenant_id()
    AND get_current_user_role() IN ('clinician', 'tenant_admin')
  );

-- Solo clinician e admin possono aggiornare
CREATE POLICY patients_update ON patients FOR UPDATE
  USING (
    tenant_id = get_current_tenant_id()
    AND get_current_user_role() IN ('clinician', 'tenant_admin')
  );

-- Nessun DELETE diretto (soft delete tramite is_active)
-- CREATE POLICY patients_delete: NON CREATA INTENZIONALMENTE

-- ============================================================
-- PATIENT_CLINICAL_PROFILES: segue patient
-- ============================================================

CREATE POLICY clinical_profiles_select ON patient_clinical_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM patients p
      WHERE p.id = patient_clinical_profiles.patient_id
      AND (
        (p.tenant_id = get_current_tenant_id() AND get_current_user_role() IN ('clinician', 'tenant_admin'))
        OR (p.portal_user_id = auth.uid() AND get_current_user_role() = 'patient')
      )
    )
  );

CREATE POLICY clinical_profiles_manage ON patient_clinical_profiles FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM patients p
      WHERE p.id = patient_clinical_profiles.patient_id
      AND p.tenant_id = get_current_tenant_id()
      AND get_current_user_role() IN ('clinician', 'tenant_admin')
    )
  );

-- ============================================================
-- ASSESSMENTS: tenant isolation + role check
-- ============================================================

CREATE POLICY assessments_select_clinician ON assessments FOR SELECT
  USING (
    tenant_id = get_current_tenant_id()
    AND get_current_user_role() IN ('clinician', 'tenant_admin', 'assistant_staff')
  );

CREATE POLICY assessments_select_patient ON assessments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM patients p
      WHERE p.id = assessments.patient_id
      AND p.portal_user_id = auth.uid()
    )
    AND get_current_user_role() = 'patient'
  );

CREATE POLICY assessments_insert ON assessments FOR INSERT
  WITH CHECK (
    tenant_id = get_current_tenant_id()
    AND get_current_user_role() IN ('clinician', 'tenant_admin')
  );

CREATE POLICY assessments_update ON assessments FOR UPDATE
  USING (
    tenant_id = get_current_tenant_id()
    AND get_current_user_role() IN ('clinician', 'tenant_admin')
  );

-- ============================================================
-- ASSESSMENT_MEASUREMENTS, SCORE_RESULTS, RISK_PROFILES,
-- NUTRITION_SNAPSHOTS, ACTIVITY_SNAPSHOTS:
-- Tutti seguono l'assessment parent
-- ============================================================

-- Macro per tabelle figlie di assessment
-- (ripetuto per chiarezza e manutenibilita)

-- ASSESSMENT_MEASUREMENTS
CREATE POLICY measurements_select ON assessment_measurements FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM assessments a
      WHERE a.id = assessment_measurements.assessment_id
      AND (
        (a.tenant_id = get_current_tenant_id() AND get_current_user_role() IN ('clinician', 'tenant_admin', 'assistant_staff'))
        OR (EXISTS (SELECT 1 FROM patients p WHERE p.id = a.patient_id AND p.portal_user_id = auth.uid()))
      )
    )
  );

CREATE POLICY measurements_manage ON assessment_measurements FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM assessments a
      WHERE a.id = assessment_measurements.assessment_id
      AND a.tenant_id = get_current_tenant_id()
      AND get_current_user_role() IN ('clinician', 'tenant_admin')
    )
  );

-- SCORE_RESULTS
CREATE POLICY score_results_select ON score_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM assessments a
      WHERE a.id = score_results.assessment_id
      AND (
        (a.tenant_id = get_current_tenant_id() AND get_current_user_role() IN ('clinician', 'tenant_admin', 'assistant_staff'))
        OR (EXISTS (SELECT 1 FROM patients p WHERE p.id = a.patient_id AND p.portal_user_id = auth.uid()))
      )
    )
  );

CREATE POLICY score_results_insert ON score_results FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM assessments a
      WHERE a.id = score_results.assessment_id
      AND a.tenant_id = get_current_tenant_id()
    )
  );

-- RISK_PROFILES
CREATE POLICY risk_profiles_select ON risk_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM assessments a
      WHERE a.id = risk_profiles.assessment_id
      AND (
        (a.tenant_id = get_current_tenant_id() AND get_current_user_role() IN ('clinician', 'tenant_admin', 'assistant_staff'))
        OR (EXISTS (SELECT 1 FROM patients p WHERE p.id = a.patient_id AND p.portal_user_id = auth.uid()))
      )
    )
  );

CREATE POLICY risk_profiles_manage ON risk_profiles FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM assessments a
      WHERE a.id = risk_profiles.assessment_id
      AND a.tenant_id = get_current_tenant_id()
    )
  );

-- NUTRITION_SNAPSHOTS
CREATE POLICY nutrition_select ON nutrition_snapshots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM assessments a
      WHERE a.id = nutrition_snapshots.assessment_id
      AND (
        (a.tenant_id = get_current_tenant_id() AND get_current_user_role() IN ('clinician', 'tenant_admin'))
        OR (EXISTS (SELECT 1 FROM patients p WHERE p.id = a.patient_id AND p.portal_user_id = auth.uid()))
      )
    )
  );

CREATE POLICY nutrition_manage ON nutrition_snapshots FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM assessments a
      WHERE a.id = nutrition_snapshots.assessment_id
      AND a.tenant_id = get_current_tenant_id()
    )
  );

-- ACTIVITY_SNAPSHOTS
CREATE POLICY activity_select ON activity_snapshots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM assessments a
      WHERE a.id = activity_snapshots.assessment_id
      AND (
        (a.tenant_id = get_current_tenant_id() AND get_current_user_role() IN ('clinician', 'tenant_admin'))
        OR (EXISTS (SELECT 1 FROM patients p WHERE p.id = a.patient_id AND p.portal_user_id = auth.uid()))
      )
    )
  );

CREATE POLICY activity_manage ON activity_snapshots FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM assessments a
      WHERE a.id = activity_snapshots.assessment_id
      AND a.tenant_id = get_current_tenant_id()
    )
  );

-- ============================================================
-- FOLLOWUP_PLANS
-- ============================================================

CREATE POLICY followup_select ON followup_plans FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM patients p
      WHERE p.id = followup_plans.patient_id
      AND (
        (p.tenant_id = get_current_tenant_id() AND get_current_user_role() IN ('clinician', 'tenant_admin'))
        OR (p.portal_user_id = auth.uid() AND get_current_user_role() = 'patient')
      )
    )
  );

CREATE POLICY followup_manage ON followup_plans FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM patients p
      WHERE p.id = followup_plans.patient_id
      AND p.tenant_id = get_current_tenant_id()
      AND get_current_user_role() IN ('clinician', 'tenant_admin')
    )
  );

-- ============================================================
-- ALERTS
-- ============================================================

CREATE POLICY alerts_select_clinician ON alerts FOR SELECT
  USING (
    tenant_id = get_current_tenant_id()
    AND get_current_user_role() IN ('clinician', 'tenant_admin')
  );

CREATE POLICY alerts_select_patient ON alerts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM patients p
      WHERE p.id = alerts.patient_id
      AND p.portal_user_id = auth.uid()
    )
    AND audience IN ('patient', 'both')
    AND get_current_user_role() = 'patient'
  );

CREATE POLICY alerts_manage ON alerts FOR ALL
  USING (
    tenant_id = get_current_tenant_id()
    AND get_current_user_role() IN ('clinician', 'tenant_admin')
  );

-- ============================================================
-- CONSENT_RECORDS
-- ============================================================

-- Chiunque puo vedere i propri consensi
CREATE POLICY consent_select_own ON consent_records FOR SELECT
  USING (
    (subject_type = 'user' AND subject_id = auth.uid())
    OR (
      subject_type = 'patient'
      AND EXISTS (
        SELECT 1 FROM patients p
        WHERE p.id = consent_records.subject_id
        AND (
          p.portal_user_id = auth.uid()
          OR (p.tenant_id = get_current_tenant_id() AND get_current_user_role() IN ('clinician', 'tenant_admin'))
        )
      )
    )
  );

-- Insert: chiunque autenticato puo registrare consenso
CREATE POLICY consent_insert ON consent_records FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Nessun UPDATE/DELETE: i consensi sono immutabili (revoca = nuovo record)

-- ============================================================
-- AUDIT_EVENTS
-- ============================================================

-- Solo admin possono leggere audit
CREATE POLICY audit_select ON audit_events FOR SELECT
  USING (
    tenant_id = get_current_tenant_id()
    AND get_current_user_role() IN ('tenant_admin', 'platform_admin')
  );

-- Insert: il backend usa service_role, non serve policy per utenti
-- Ma per sicurezza, consentiamo insert a tutti gli autenticati
CREATE POLICY audit_insert ON audit_events FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================================
-- REPORT_EXPORTS
-- ============================================================

CREATE POLICY reports_select ON report_exports FOR SELECT
  USING (
    tenant_id = get_current_tenant_id()
    AND get_current_user_role() IN ('clinician', 'tenant_admin')
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
    AND get_current_user_role() IN ('clinician', 'tenant_admin')
  );

-- ============================================================
-- NOTIFICATION_JOBS
-- ============================================================

CREATE POLICY notifications_manage ON notification_jobs FOR ALL
  USING (
    tenant_id = get_current_tenant_id()
    AND get_current_user_role() IN ('clinician', 'tenant_admin')
  );
