-- ============================================================
-- MIGRAZIONE 005: PROFESSIONAL ↔ PATIENT LINKAGE
-- ============================================================
-- Scopo:
--   Introduce la tabella `professional_patient_links` richiesta dai flussi
--   clinici già implementati nel codice (assessment-service, patient export,
--   future endpoint di assegnazione). Completa il modello di controllo
--   accessi B2B definito dalla blueprint:
--
--   - un tenant_admin vede TUTTI i pazienti del tenant (via RLS tenant_id);
--   - un clinician vede solo i pazienti a cui è esplicitamente LINKATO;
--   - assistant_staff ha già visibilità ristretta (policy esistenti);
--   - patient vede solo se stesso (portal_user_id).
--
--   Il codice applicativo già interroga questa tabella con le chiavi:
--     .eq('professional_user_id', auth.userId)
--     .eq('patient_id', patientId)
--     .eq('is_active', true)
--
--   Le colonne devono quindi rispettare quei nomi per evitare drift.
--
-- Sicurezza / GDPR:
--   - RLS abilitata, stesso principio tenant_id.
--   - Nessun dato clinico in questa tabella (solo relazione).
--   - `is_active` permette revoca logica (mantiene audit trail).
--   - `revoked_reason` opzionale per accountability GDPR Art.30.
--
-- Idempotenza:
--   Uso di `CREATE TABLE IF NOT EXISTS` e `CREATE POLICY IF NOT EXISTS` via
--   DO blocks per poter ri-eseguire la migrazione in ambienti già parziali.
-- ============================================================

-- ============================================================
-- 1. TABELLA professional_patient_links
-- ============================================================

CREATE TABLE IF NOT EXISTS professional_patient_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,

  -- Nome colonna intenzionale: `professional_user_id` (FK a users.id).
  -- Mantiene coerenza con il codice esistente in:
  --   backend/src/services/assessment-service.ts
  --   api/v1/patients/[id]/export.ts
  professional_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,

  -- Tipo di relazione (estendibile in futuro senza breaking change)
  relationship_type TEXT NOT NULL DEFAULT 'primary'
    CHECK (relationship_type IN ('primary', 'consulting', 'covering', 'observer')),

  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  -- Audit e accountability
  assigned_by UUID REFERENCES users(id),   -- Chi ha creato il link (tenant_admin o il clinician stesso)
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES users(id),
  revoked_reason TEXT,

  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Coerenza cross-tenant: non permettere link tra professionista e
  -- paziente di tenant differenti (verificato in trigger sotto).
  CONSTRAINT ppl_unique_active UNIQUE NULLS NOT DISTINCT
    (professional_user_id, patient_id, is_active)
);

-- Indici principali (i path di query del codice esistente)
CREATE INDEX IF NOT EXISTS idx_ppl_professional_active
  ON professional_patient_links (professional_user_id, patient_id)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_ppl_patient_active
  ON professional_patient_links (patient_id)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_ppl_tenant
  ON professional_patient_links (tenant_id);

-- Trigger updated_at automatico (usa la funzione già creata in 001)
DROP TRIGGER IF EXISTS trg_ppl_updated_at ON professional_patient_links;
CREATE TRIGGER trg_ppl_updated_at
  BEFORE UPDATE ON professional_patient_links
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 2. TRIGGER DI COERENZA CROSS-TENANT
-- ============================================================
-- Impedisce che un link punti a un utente o paziente di un tenant diverso
-- da quello della riga stessa. Questo è un invariante di sicurezza critico.

CREATE OR REPLACE FUNCTION ppl_enforce_same_tenant()
RETURNS TRIGGER AS $$
DECLARE
  user_tenant_id UUID;
  patient_tenant_id UUID;
BEGIN
  SELECT tenant_id INTO user_tenant_id
    FROM users WHERE id = NEW.professional_user_id;

  SELECT tenant_id INTO patient_tenant_id
    FROM patients WHERE id = NEW.patient_id;

  IF user_tenant_id IS NULL OR patient_tenant_id IS NULL THEN
    RAISE EXCEPTION 'PPL cross-reference failed: user or patient not found';
  END IF;

  IF NEW.tenant_id <> user_tenant_id THEN
    RAISE EXCEPTION 'PPL tenant_id (%) != user tenant (%)',
      NEW.tenant_id, user_tenant_id;
  END IF;

  IF NEW.tenant_id <> patient_tenant_id THEN
    RAISE EXCEPTION 'PPL tenant_id (%) != patient tenant (%)',
      NEW.tenant_id, patient_tenant_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ppl_enforce_same_tenant ON professional_patient_links;
CREATE TRIGGER trg_ppl_enforce_same_tenant
  BEFORE INSERT OR UPDATE ON professional_patient_links
  FOR EACH ROW EXECUTE FUNCTION ppl_enforce_same_tenant();

-- ============================================================
-- 3. ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE professional_patient_links ENABLE ROW LEVEL SECURITY;

-- SELECT:
--  - platform_admin vede tutto
--  - tenant_admin vede tutti i link del tenant
--  - clinician vede solo i link in cui è il professionista
--  - assistant_staff vede i link del tenant (lettura operativa)
DROP POLICY IF EXISTS ppl_select ON professional_patient_links;
CREATE POLICY ppl_select ON professional_patient_links FOR SELECT
  USING (
    tenant_id = get_current_tenant_id()
    AND (
      get_current_user_role() IN ('tenant_admin', 'platform_admin', 'assistant_staff')
      OR professional_user_id = auth.uid()
    )
  );

-- INSERT: solo tenant_admin o clinician (per auto-assegnarsi un nuovo paziente)
DROP POLICY IF EXISTS ppl_insert ON professional_patient_links;
CREATE POLICY ppl_insert ON professional_patient_links FOR INSERT
  WITH CHECK (
    tenant_id = get_current_tenant_id()
    AND get_current_user_role() IN ('tenant_admin', 'platform_admin', 'clinician')
  );

-- UPDATE: solo tenant_admin (o il clinician stesso che revoca il proprio link)
DROP POLICY IF EXISTS ppl_update ON professional_patient_links;
CREATE POLICY ppl_update ON professional_patient_links FOR UPDATE
  USING (
    tenant_id = get_current_tenant_id()
    AND (
      get_current_user_role() IN ('tenant_admin', 'platform_admin')
      OR (get_current_user_role() = 'clinician' AND professional_user_id = auth.uid())
    )
  );

-- DELETE: mai. La revoca è logica (is_active = FALSE) per preservare audit.
-- Nessuna policy DELETE → nessuno può cancellare righe.

-- ============================================================
-- 4. HELPER FUNCTION: is_linked_to_patient(patient_uuid)
-- ============================================================
-- Usata opzionalmente da policy su altre tabelle (assessments,
-- measurements, score_results) se si vuole stringere RLS ai soli pazienti
-- del clinician, non a tutto il tenant.

CREATE OR REPLACE FUNCTION is_linked_to_patient(patient_uuid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM professional_patient_links
    WHERE patient_id = patient_uuid
      AND professional_user_id = auth.uid()
      AND is_active = TRUE
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

COMMENT ON TABLE professional_patient_links IS
  'Relazione N:M tra professionisti (users.role=clinician) e pazienti. '
  'Usata per restringere la visibilità clinica ai soli pazienti esplicitamente '
  'assegnati. Tenant_admin e platform_admin bypassano il check.';

COMMENT ON COLUMN professional_patient_links.professional_user_id IS
  'FK a users(id) - nome intenzionale per coerenza col codice TS esistente.';

COMMENT ON COLUMN professional_patient_links.is_active IS
  'Revoca logica. DELETE non permesso; impostare FALSE + revoked_at + revoked_by.';
