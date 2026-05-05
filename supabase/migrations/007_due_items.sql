-- ============================================================
-- MIGRATION 007 — PATIENT DUE-ITEMS (TIMELINE / COUNTDOWN)
-- ============================================================
-- Scope (WS7)
-- -----------
-- Persist the structured follow-up/screening items emitted by the
-- deterministic follow-up and screening engines so the patient detail
-- page can render a countdown timeline of upcoming clinical actions.
--
-- The source of truth REMAINS the deterministic engines (same input →
-- same items). This table is a projection/materialisation with:
--   - a stable due_at date,
--   - an acknowledgement/complete lifecycle column,
--   - explicit recurrence handling via `recurrence_months`,
--   - full audit fields (created_by, acknowledged_by, completed_by).
--
-- Design notes
-- ------------
-- 1. `source_engine` lets us distinguish items produced by the follow-up
--    engine (`followup`) from those produced by the screening engine
--    (`screening`). Separate origins => separate code namespaces.
--    `manual` is reserved for future clinician-authored reminders.
-- 2. `status` follows a strict state machine: open → acknowledged →
--    completed | dismissed. The CHECK constraint enforces the vocabulary.
-- 3. (`patient_id`, `item_code`, `source_engine`) uniqueness prevents
--    duplicate open items across assessments; upserts keyed on this
--    tuple keep the engine idempotent.
-- 4. RLS mirrors the assessments / alerts pattern: tenant scope +
--    clinician must be linked via professional_patient_links.
-- 5. No PHI leaves this table beyond what the item code already implies
--    (e.g. "dm_retinopathy_screening" reveals diabetic status implicitly,
--    exactly like the assessments row does).
--
-- Idempotent
-- ----------
-- CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS + DROP TRIGGER IF
-- EXISTS keep the migration safely re-runnable.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. TABLE public.due_items
-- ============================================================

CREATE TABLE IF NOT EXISTS public.due_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Scope / ownership
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,

  -- Provenance — which assessment materialised this item
  assessment_id UUID REFERENCES assessments(id) ON DELETE SET NULL,
  source_engine TEXT NOT NULL
    CHECK (source_engine IN ('followup', 'screening', 'manual')),

  -- Stable identifier from the engine (e.g. 'cv_lipid_intensive',
  -- 'dm_retinopathy_screening', 'metabolic_undiagnosed_dm_confirmation').
  item_code TEXT NOT NULL,

  title TEXT NOT NULL,
  rationale TEXT,
  guideline_source TEXT,

  -- Priority mirrors FollowUpItem / ScreeningItem priority vocabulary
  priority TEXT NOT NULL
    CHECK (priority IN ('routine', 'moderate', 'urgent')),

  -- Clinical domain (optional — useful for UI grouping)
  domain TEXT
    CHECK (
      domain IS NULL OR domain IN (
        'cardiovascular', 'metabolic', 'renal', 'hepatic',
        'frailty', 'diabetic_complications', 'core_review', 'other'
      )
    ),

  -- Scheduling
  due_at DATE NOT NULL,
  recurrence_months INTEGER
    CHECK (recurrence_months IS NULL OR recurrence_months > 0),

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'completed', 'dismissed')),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES users(id),
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id),
  dismissed_at TIMESTAMPTZ,
  dismissed_by UUID REFERENCES users(id),
  dismissed_reason TEXT,

  -- Audit
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevent duplicates across assessments: one "open" item per
  -- (patient, source, code). Completed/dismissed rows are allowed to
  -- accumulate for audit — we filter them in the partial unique index.
  CONSTRAINT due_items_patient_code_nonnull
    CHECK (length(item_code) > 0 AND length(title) > 0)
);

-- Partial unique index: only ONE active row per (patient, code, source).
CREATE UNIQUE INDEX IF NOT EXISTS idx_due_items_open_unique
  ON public.due_items (patient_id, source_engine, item_code)
  WHERE status IN ('open', 'acknowledged');

-- Hot query paths
CREATE INDEX IF NOT EXISTS idx_due_items_patient_due
  ON public.due_items (patient_id, due_at)
  WHERE status IN ('open', 'acknowledged');

CREATE INDEX IF NOT EXISTS idx_due_items_tenant_due
  ON public.due_items (tenant_id, due_at)
  WHERE status IN ('open', 'acknowledged');

CREATE INDEX IF NOT EXISTS idx_due_items_assessment
  ON public.due_items (assessment_id);

-- updated_at trigger (reuses the shared util from migration 001)
DROP TRIGGER IF EXISTS trg_due_items_updated_at ON public.due_items;
CREATE TRIGGER trg_due_items_updated_at
  BEFORE UPDATE ON public.due_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 2. CROSS-TENANT CONSISTENCY TRIGGER
-- ============================================================
-- Block inserts that would bind an item to a patient from a different
-- tenant than the row itself. Same principle as
-- professional_patient_links (migration 005).

CREATE OR REPLACE FUNCTION due_items_enforce_same_tenant()
RETURNS TRIGGER AS $$
DECLARE
  patient_tenant UUID;
BEGIN
  SELECT tenant_id INTO patient_tenant
    FROM patients WHERE id = NEW.patient_id;

  IF patient_tenant IS NULL THEN
    RAISE EXCEPTION 'due_items cross-reference failed: patient not found';
  END IF;

  IF NEW.tenant_id <> patient_tenant THEN
    RAISE EXCEPTION 'due_items tenant_id (%) != patient tenant (%)',
      NEW.tenant_id, patient_tenant;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_due_items_enforce_same_tenant ON public.due_items;
CREATE TRIGGER trg_due_items_enforce_same_tenant
  BEFORE INSERT OR UPDATE ON public.due_items
  FOR EACH ROW EXECUTE FUNCTION due_items_enforce_same_tenant();

-- ============================================================
-- 3. ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.due_items ENABLE ROW LEVEL SECURITY;

-- SELECT:
--   - platform_admin: all
--   - tenant_admin / assistant_staff: everything in their tenant
--   - clinician: only patients they are linked to
DROP POLICY IF EXISTS due_items_select ON public.due_items;
CREATE POLICY due_items_select ON public.due_items FOR SELECT
  USING (
    tenant_id = get_current_tenant_id()
    AND (
      get_current_user_role() IN ('tenant_admin', 'platform_admin', 'assistant_staff')
      OR is_linked_to_patient(patient_id)
    )
  );

-- INSERT: clinicians on linked patients, plus tenant_admin/platform_admin.
-- Service-role writes bypass RLS as usual.
DROP POLICY IF EXISTS due_items_insert ON public.due_items;
CREATE POLICY due_items_insert ON public.due_items FOR INSERT
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

-- UPDATE: same eligibility as INSERT (acknowledge / complete / dismiss).
DROP POLICY IF EXISTS due_items_update ON public.due_items;
CREATE POLICY due_items_update ON public.due_items FOR UPDATE
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

-- DELETE: forbidden. Dismissal is logical (status = 'dismissed') so the
-- audit trail is preserved.
-- No DELETE policy created → nobody can delete via authenticated session.

-- ============================================================
-- 4. DOCUMENTATION
-- ============================================================
COMMENT ON TABLE public.due_items IS
  'Materialised follow-up/screening items for patient countdown UIs. '
  'Source of truth is the deterministic follow-up & screening engines; '
  'rows are upserted keyed on (patient_id, source_engine, item_code).';

COMMENT ON COLUMN public.due_items.source_engine IS
  'followup | screening | manual — which engine produced this row.';

COMMENT ON COLUMN public.due_items.recurrence_months IS
  'NULL for one-shot items. Integer months for recurring screenings '
  '(e.g. annual retinopathy exam = 12).';

COMMENT ON COLUMN public.due_items.status IS
  'State machine: open → acknowledged → completed | dismissed. DELETE '
  'is blocked at the RLS layer — dismissal is logical for audit.';

COMMIT;
