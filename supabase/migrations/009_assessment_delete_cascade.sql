-- ============================================================
-- MIGRATION 009 — ASSESSMENT DELETE CASCADE
-- ============================================================
-- Scope
-- -----
-- Enable safe, atomic deletion of a single assessment row. Before this
-- migration, deleting an assessment would either fail (FK from `alerts`,
-- `followup_plans`, `report_exports` lacked an ON DELETE rule) or, worse,
-- leave dangling child rows that referenced a row that no longer existed
-- (NO ACTION in PostgreSQL raises an error on DELETE rather than orphaning,
-- but the surrounding code assumed cascade semantics).
--
-- This migration normalises the FK policy for child tables that are
-- semantically owned by a single assessment:
--
--   alerts.assessment_id            → CASCADE
--   followup_plans.assessment_id    → CASCADE
--   report_exports.assessment_id    → CASCADE
--
-- Tables whose assessment_id is ALREADY CASCADE (from 001):
--   assessment_measurements, score_results, risk_profiles,
--   nutrition_snapshots, activity_snapshots
--
-- Tables intentionally NOT cascaded (design decisions kept):
--   due_items.assessment_id         → SET NULL (from 007 — the row is a
--                                     materialised projection; the service
--                                     layer deletes the specific sibling
--                                     due_items explicitly via the admin
--                                     client when the owning assessment is
--                                     removed, so no orphan survives in
--                                     practice).
--
-- Idempotency
-- -----------
-- Drop-then-add the FK inside a transaction. Each DROP uses IF EXISTS and
-- each ADD supplies the same constraint name so reruns converge.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. alerts.assessment_id  →  ON DELETE CASCADE
-- ============================================================
ALTER TABLE public.alerts
  DROP CONSTRAINT IF EXISTS alerts_assessment_id_fkey;

ALTER TABLE public.alerts
  ADD CONSTRAINT alerts_assessment_id_fkey
  FOREIGN KEY (assessment_id)
  REFERENCES public.assessments(id)
  ON DELETE CASCADE;

-- ============================================================
-- 2. followup_plans.assessment_id  →  ON DELETE CASCADE
-- ============================================================
ALTER TABLE public.followup_plans
  DROP CONSTRAINT IF EXISTS followup_plans_assessment_id_fkey;

ALTER TABLE public.followup_plans
  ADD CONSTRAINT followup_plans_assessment_id_fkey
  FOREIGN KEY (assessment_id)
  REFERENCES public.assessments(id)
  ON DELETE CASCADE;

-- ============================================================
-- 3. report_exports.assessment_id  →  ON DELETE CASCADE
-- ============================================================
ALTER TABLE public.report_exports
  DROP CONSTRAINT IF EXISTS report_exports_assessment_id_fkey;

ALTER TABLE public.report_exports
  ADD CONSTRAINT report_exports_assessment_id_fkey
  FOREIGN KEY (assessment_id)
  REFERENCES public.assessments(id)
  ON DELETE CASCADE;

-- ============================================================
-- 4. DOCUMENTATION
-- ============================================================
COMMENT ON CONSTRAINT alerts_assessment_id_fkey ON public.alerts IS
  'Cascade delete: an alert is tied to a specific assessment and cannot '
  'survive its source. See migration 009.';

COMMENT ON CONSTRAINT followup_plans_assessment_id_fkey ON public.followup_plans IS
  'Cascade delete: a follow-up plan is derived from one assessment and is '
  're-generated on every new one. See migration 009.';

COMMENT ON CONSTRAINT report_exports_assessment_id_fkey ON public.report_exports IS
  'Cascade delete: PDF export metadata follows the assessment lifecycle. '
  'Storage object removal is handled by the service layer before DELETE. '
  'See migration 009.';

COMMIT;
