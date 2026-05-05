-- ============================================================
-- MIGRAZIONE 001: SCHEMA FONDAMENTALE B2B CARDIO-NEFRO-METABOLICO
-- ============================================================
-- Questo script crea l'intero schema target da zero.
-- Tabelle: tenants, users, professionals, patients,
--          patient_clinical_profiles, assessments,
--          assessment_measurements, score_results,
--          risk_profiles, nutrition_snapshots, activity_snapshots,
--          followup_plans, alerts, consent_records,
--          audit_events, report_exports, notification_jobs
-- ============================================================

-- Abilita estensioni necessarie
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUM TYPES
-- ============================================================

CREATE TYPE user_role AS ENUM (
  'platform_admin',
  'tenant_admin',
  'clinician',
  'assistant_staff',
  'patient'
);

CREATE TYPE tenant_status AS ENUM ('active', 'suspended', 'trial', 'cancelled');
CREATE TYPE tenant_plan AS ENUM ('starter', 'professional', 'clinic', 'enterprise');
CREATE TYPE patient_sex AS ENUM ('male', 'female');
CREATE TYPE assessment_status AS ENUM ('draft', 'completed', 'reviewed', 'archived');
CREATE TYPE alert_severity AS ENUM ('info', 'warning', 'critical');
CREATE TYPE alert_status AS ENUM ('open', 'acknowledged', 'resolved', 'dismissed');
CREATE TYPE alert_audience AS ENUM ('clinician', 'patient', 'both', 'system');
CREATE TYPE consent_type AS ENUM (
  'health_data_processing',
  'ai_processing',
  'notifications',
  'data_sharing_clinician',
  'marketing'
);
CREATE TYPE export_type AS ENUM ('pdf_clinical', 'pdf_patient', 'csv_data', 'json_export');
CREATE TYPE notification_channel AS ENUM ('email', 'sms', 'push', 'in_app');
CREATE TYPE notification_status AS ENUM ('pending', 'sent', 'failed', 'cancelled');

-- ============================================================
-- 1. TENANTS (Organizzazione / Cliente B2B)
-- ============================================================

CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  -- Tier commerciale (starter = tier di ingresso). Separato da `status`
  -- perché una clinica può essere in `trial` commerciale su qualunque plan.
  plan tenant_plan NOT NULL DEFAULT 'starter',
  -- Stato del ciclo di vita: ogni nuovo tenant nasce in `trial` finché
  -- non viene promosso ad `active` dall'admin di piattaforma.
  status tenant_status NOT NULL DEFAULT 'trial',
  logo_url TEXT,                          -- URL da object storage, mai base64
  settings JSONB DEFAULT '{}',            -- Branding, template PDF, preferenze
  max_professionals INTEGER DEFAULT 5,
  max_patients INTEGER DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. USERS (Profilo utente applicativo, legato a auth.users)
-- ============================================================

CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  role user_role NOT NULL DEFAULT 'clinician',
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,                    -- Solo per display/contatto, MAI come FK
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_tenant ON users(tenant_id);

-- ============================================================
-- 3. PROFESSIONALS (Dati professionista sanitario)
-- ============================================================

CREATE TABLE professionals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  license_number TEXT,
  specialty TEXT,                          -- es. 'cardiologia', 'diabetologia', 'medicina_generale'
  clinic_name TEXT,
  clinic_address TEXT,
  signature_url TEXT,                     -- Firma digitale da object storage
  bio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_professionals_tenant ON professionals(tenant_id);

-- ============================================================
-- 4. PATIENTS (Anagrafica paziente)
-- ============================================================

CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES users(id),    -- Professionista che ha creato il paziente
  external_code TEXT,                     -- Codice identificativo esterno (es. codice fiscale hash, codice interno)
  display_name TEXT NOT NULL,             -- Nome visualizzato (potrebbe essere pseudonimo)
  first_name TEXT,
  last_name TEXT,
  sex patient_sex,
  birth_year INTEGER,                     -- Solo anno per minimizzazione (oppure birth_date se necessario)
  birth_date DATE,                        -- Data completa se richiesta clinicamente
  contact_email TEXT,                     -- Per portale paziente, opzionale
  contact_phone TEXT,
  portal_user_id UUID REFERENCES users(id),  -- Se il paziente ha accesso al portale
  consent_status TEXT DEFAULT 'pending' CHECK (consent_status IN ('pending', 'active', 'revoked')),
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_patients_tenant ON patients(tenant_id);
CREATE INDEX idx_patients_created_by ON patients(created_by);
CREATE INDEX idx_patients_portal_user ON patients(portal_user_id) WHERE portal_user_id IS NOT NULL;
CREATE UNIQUE INDEX idx_patients_external_code_tenant ON patients(tenant_id, external_code) WHERE external_code IS NOT NULL;

-- ============================================================
-- 5. PATIENT_CLINICAL_PROFILES (Dati stabili / storia)
-- ============================================================

CREATE TABLE patient_clinical_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID NOT NULL UNIQUE REFERENCES patients(id) ON DELETE CASCADE,

  -- Abitudini
  smoking_status TEXT CHECK (smoking_status IN ('never', 'former', 'current')),
  alcohol_consumption TEXT,               -- 'none', 'moderate', 'heavy'

  -- Anamnesi
  diagnoses JSONB DEFAULT '[]',           -- Array di diagnosi attive
  has_diabetes BOOLEAN DEFAULT FALSE,
  diabetes_type TEXT CHECK (diabetes_type IN ('type1', 'type2', 'gestational', NULL)),
  age_at_diabetes_diagnosis INTEGER,
  has_hypertension BOOLEAN DEFAULT FALSE,
  has_dyslipidemia BOOLEAN DEFAULT FALSE,
  has_ckd BOOLEAN DEFAULT FALSE,
  family_history_diabetes BOOLEAN DEFAULT FALSE,
  family_history_cvd BOOLEAN DEFAULT FALSE,
  gestational_diabetes BOOLEAN DEFAULT FALSE,

  -- Farmaci
  medications JSONB DEFAULT '[]',         -- [{name, dose, frequency}]

  -- Allergie
  allergies JSONB DEFAULT '[]',

  -- Regione rischio CV (per SCORE2)
  cv_risk_region TEXT DEFAULT 'moderate' CHECK (cv_risk_region IN ('low', 'moderate', 'high', 'very_high')),

  -- Lifestyle fisso
  physical_limitations TEXT,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);

-- ============================================================
-- 6. ASSESSMENTS (Snapshot visita / valutazione)
-- ============================================================

CREATE TABLE assessments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  assessed_by UUID NOT NULL REFERENCES users(id),   -- Professionista
  tenant_id UUID NOT NULL REFERENCES tenants(id),

  assessment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status assessment_status NOT NULL DEFAULT 'draft',
  notes TEXT,

  -- Metadata
  engine_version TEXT NOT NULL DEFAULT '1.0.0',      -- Versione del clinical engine usato

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id)
);

CREATE INDEX idx_assessments_patient ON assessments(patient_id);
CREATE INDEX idx_assessments_tenant ON assessments(tenant_id);
CREATE INDEX idx_assessments_date ON assessments(patient_id, assessment_date DESC);

-- ============================================================
-- 7. ASSESSMENT_MEASUREMENTS (Parametri quantitativi della visita)
-- ============================================================

CREATE TABLE assessment_measurements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  assessment_id UUID NOT NULL UNIQUE REFERENCES assessments(id) ON DELETE CASCADE,

  -- Antropometria
  height_cm NUMERIC(5,1),                 -- Altezza in cm
  weight_kg NUMERIC(5,1),                 -- Peso in kg
  bmi NUMERIC(4,1),                       -- Calcolato server-side
  waist_cm NUMERIC(5,1),                  -- Circonferenza vita in cm

  -- Pressione arteriosa
  sbp INTEGER,                            -- Pressione sistolica mmHg
  dbp INTEGER,                            -- Pressione diastolica mmHg

  -- Profilo lipidico (mg/dL)
  total_chol_mgdl NUMERIC(6,1),
  hdl_mgdl NUMERIC(5,1),
  ldl_mgdl NUMERIC(6,1),
  triglycerides_mgdl NUMERIC(6,1),

  -- Glicemia e diabete
  glucose_mgdl NUMERIC(6,1),             -- Glicemia a digiuno
  hba1c_pct NUMERIC(4,2),                -- HbA1c in %

  -- Funzione renale
  egfr NUMERIC(6,1),                      -- eGFR mL/min/1.73m2
  creatinine_mgdl NUMERIC(5,2),          -- Creatinina sierica mg/dL
  albumin_creatinine_ratio NUMERIC(7,1), -- ACR mg/g (per staging CKD)

  -- Funzione epatica
  ggt NUMERIC(6,1),                       -- Gamma-GT U/L
  ast NUMERIC(6,1),                       -- AST U/L
  alt NUMERIC(6,1),                       -- ALT U/L
  platelets NUMERIC(6,0),                 -- Piastrine 10^9/L

  -- Altri
  heart_rate INTEGER,                     -- FC bpm

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 8. SCORE_RESULTS (Output deterministici dei singoli score)
-- ============================================================

CREATE TABLE score_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  assessment_id UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,

  score_code TEXT NOT NULL,               -- 'score2', 'score2_diabetes', 'ada', 'fli', 'frail', 'bmi', 'metabolic_syndrome', 'fib4', 'predimed', 'egfr'
  value_numeric NUMERIC(10,4),            -- Valore numerico principale
  category TEXT,                          -- 'low', 'moderate', 'high', 'very_high', etc.
  label TEXT,                             -- Label human-readable

  -- Payload completo per audit e riproducibilita
  input_payload JSONB NOT NULL,           -- Input usati per il calcolo
  raw_payload JSONB,                      -- Risultato completo con breakdown

  engine_version TEXT NOT NULL DEFAULT '1.0.0',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_score_results_assessment ON score_results(assessment_id);
CREATE INDEX idx_score_results_code ON score_results(assessment_id, score_code);
CREATE UNIQUE INDEX idx_score_results_unique ON score_results(assessment_id, score_code);

-- ============================================================
-- 9. RISK_PROFILES (Indice integrato cardio-nefro-metabolico)
-- ============================================================

CREATE TABLE risk_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  assessment_id UUID NOT NULL UNIQUE REFERENCES assessments(id) ON DELETE CASCADE,

  composite_risk_level TEXT NOT NULL CHECK (composite_risk_level IN ('low', 'moderate', 'high', 'very_high')),
  composite_score NUMERIC(5,2),           -- Score composito 0-100

  -- Breakdown per dominio
  cardiovascular_risk TEXT,               -- low/moderate/high/very_high
  metabolic_risk TEXT,
  hepatic_risk TEXT,
  renal_risk TEXT,
  frailty_risk TEXT,

  summary_json JSONB,                     -- Sommario strutturato per report
  action_flags JSONB DEFAULT '[]',        -- Red flags e azioni prioritarie

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 10. NUTRITION_SNAPSHOTS (Qualita alimentare per assessment)
-- ============================================================

CREATE TABLE nutrition_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  assessment_id UUID NOT NULL UNIQUE REFERENCES assessments(id) ON DELETE CASCADE,

  predimed_score INTEGER,                 -- 0-14
  predimed_answers JSONB,                 -- {q1: true, q2: false, ...}
  adherence_band TEXT CHECK (adherence_band IN ('low', 'medium', 'high')),

  -- Dati calorici informativi (non prescrittivi)
  bmr_kcal NUMERIC(6,0),
  tdee_kcal NUMERIC(6,0),
  activity_factor NUMERIC(4,3),

  -- Tips AI (se consenso attivo)
  ai_tips_json JSONB,                     -- Array di tips generati
  ai_consent_given BOOLEAN DEFAULT FALSE,
  ai_generated_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 11. ACTIVITY_SNAPSHOTS (Valutazione attivita fisica)
-- ============================================================

CREATE TABLE activity_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  assessment_id UUID NOT NULL UNIQUE REFERENCES assessments(id) ON DELETE CASCADE,

  minutes_per_week INTEGER,               -- Minuti attivita/settimana
  frequency_per_week INTEGER,             -- Frequenza sessioni/settimana
  activity_type TEXT,                     -- 'aerobic', 'strength', 'mixed', 'team_sport', 'other'
  intensity_level TEXT,                   -- 'sedentary', 'light', 'moderate', 'vigorous', 'extreme'
  sedentary_level TEXT CHECK (sedentary_level IN ('low', 'moderate', 'high')),

  -- Classificazione clinica (non programma allenamento)
  qualitative_band TEXT CHECK (qualitative_band IN ('insufficient', 'borderline', 'sufficient', 'active')),
  meets_who_guidelines BOOLEAN,           -- >= 150 min/sett moderata o 75 vigorosa

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 12. FOLLOWUP_PLANS (Prossimi controlli)
-- ============================================================

CREATE TABLE followup_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  assessment_id UUID REFERENCES assessments(id),     -- Assessment che ha generato il piano

  next_review_date DATE,
  review_interval_months INTEGER,         -- Intervallo suggerito

  timeline_json JSONB,                    -- [{action, due_date, priority, completed}]
  recommended_screenings JSONB,           -- [{screening, reason, priority}]

  owner_user_id UUID NOT NULL REFERENCES users(id), -- Professionista responsabile
  notes TEXT,

  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_followup_patient ON followup_plans(patient_id) WHERE is_active = TRUE;
CREATE INDEX idx_followup_next_review ON followup_plans(next_review_date) WHERE is_active = TRUE;

-- ============================================================
-- 13. ALERTS (Alert clinici e operativi)
-- ============================================================

CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  assessment_id UUID REFERENCES assessments(id),

  type TEXT NOT NULL,                     -- 'clinical_risk_up', 'followup_due', 'missing_critical_data', 'red_flag', 'diet_adherence_drop', 'activity_decline', 'consent_expired'
  severity alert_severity NOT NULL DEFAULT 'info',
  status alert_status NOT NULL DEFAULT 'open',
  audience alert_audience NOT NULL DEFAULT 'clinician',

  title TEXT NOT NULL,
  message TEXT,
  metadata JSONB,                         -- Dati contestuali (score prima/dopo, delta, etc.)

  due_at TIMESTAMPTZ,                     -- Per alert con scadenza
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alerts_tenant_status ON alerts(tenant_id, status) WHERE status = 'open';
CREATE INDEX idx_alerts_patient ON alerts(patient_id);
CREATE INDEX idx_alerts_due ON alerts(due_at) WHERE status = 'open';

-- ============================================================
-- 14. CONSENT_RECORDS (Versionamento consensi GDPR)
-- ============================================================

CREATE TABLE consent_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Soggetto del consenso (puo essere paziente o utente)
  subject_type TEXT NOT NULL CHECK (subject_type IN ('patient', 'user')),
  subject_id UUID NOT NULL,              -- patient_id o user_id

  consent_type consent_type NOT NULL,

  -- Stato
  granted BOOLEAN NOT NULL,
  legal_basis TEXT NOT NULL,              -- 'consent', 'legitimate_interest', 'contract', 'legal_obligation'

  -- Versioning
  policy_version TEXT NOT NULL,           -- es. '1.0.0', '2.0.0'
  policy_url TEXT,                        -- Link al documento di policy

  -- Audit
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  ip_hash TEXT,                           -- Hash dell'IP per audit senza tracciamento
  user_agent_hash TEXT,

  -- Metadata
  jurisdiction TEXT DEFAULT 'EU',
  purpose TEXT,                           -- Descrizione finalita specifica

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_consent_subject ON consent_records(subject_type, subject_id);
CREATE INDEX idx_consent_active ON consent_records(subject_type, subject_id, consent_type)
  WHERE granted = TRUE AND revoked_at IS NULL;

-- ============================================================
-- 15. AUDIT_EVENTS (Audit trail completo)
-- ============================================================

CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id),

  actor_user_id UUID REFERENCES users(id),
  actor_role user_role,

  entity_type TEXT NOT NULL,              -- 'patient', 'assessment', 'report', 'consent', 'alert', 'user'
  entity_id UUID,

  action TEXT NOT NULL,                   -- 'create', 'read', 'update', 'delete', 'export', 'login', 'logout', 'consent_grant', 'consent_revoke'

  metadata_json JSONB,                    -- Dettagli specifici (campi modificati, motivo, etc.)
  ip_hash TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partizionamento per performance su grandi volumi
CREATE INDEX idx_audit_tenant_date ON audit_events(tenant_id, created_at DESC);
CREATE INDEX idx_audit_entity ON audit_events(entity_type, entity_id);
CREATE INDEX idx_audit_actor ON audit_events(actor_user_id, created_at DESC);

-- ============================================================
-- 16. REPORT_EXPORTS (Traccia export PDF/report)
-- ============================================================

CREATE TABLE report_exports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  assessment_id UUID REFERENCES assessments(id),

  exported_by UUID NOT NULL REFERENCES users(id),
  export_type export_type NOT NULL DEFAULT 'pdf_clinical',

  -- Storage
  storage_path TEXT,                      -- Path in object storage
  signed_url TEXT,                        -- URL temporaneo (generato on-demand)
  signed_url_expires_at TIMESTAMPTZ,

  -- Metadata
  file_size_bytes INTEGER,
  engine_version TEXT,
  report_version TEXT DEFAULT '1.0.0',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reports_patient ON report_exports(patient_id);
CREATE INDEX idx_reports_assessment ON report_exports(assessment_id);

-- ============================================================
-- 17. NOTIFICATION_JOBS (Invio notifiche)
-- ============================================================

CREATE TABLE notification_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  patient_id UUID REFERENCES patients(id),
  alert_id UUID REFERENCES alerts(id),

  channel notification_channel NOT NULL,
  recipient_user_id UUID REFERENCES users(id),

  payload_json JSONB NOT NULL,

  status notification_status NOT NULL DEFAULT 'pending',
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_status ON notification_jobs(status) WHERE status = 'pending';
CREATE INDEX idx_notifications_scheduled ON notification_jobs(scheduled_at) WHERE status = 'pending';

-- ============================================================
-- FUNZIONI HELPER
-- ============================================================

-- Funzione per ottenere tenant_id dell'utente corrente
CREATE OR REPLACE FUNCTION get_current_tenant_id()
RETURNS UUID AS $$
  SELECT tenant_id FROM users WHERE id = auth.uid()
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Funzione per ottenere il ruolo dell'utente corrente
CREATE OR REPLACE FUNCTION get_current_user_role()
RETURNS user_role AS $$
  SELECT role FROM users WHERE id = auth.uid()
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Trigger per updated_at automatico
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Applica trigger updated_at
CREATE TRIGGER trg_tenants_updated_at BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_professionals_updated_at BEFORE UPDATE ON professionals FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_patients_updated_at BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_clinical_profiles_updated_at BEFORE UPDATE ON patient_clinical_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_followup_updated_at BEFORE UPDATE ON followup_plans FOR EACH ROW EXECUTE FUNCTION update_updated_at();
