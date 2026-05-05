-- Migration 006 — Accept 'indeterminate' as a first-class composite risk level.
--
-- Rationale
-- =========
-- The clinical risk aggregator distinguishes "not enough data to stratify"
-- (`indeterminate`) from "actually low risk" (`low`). The original CHECK
-- constraint on `risk_profiles.composite_risk_level` was written before
-- that semantic split existed and would reject inserts where the patient
-- genuinely could not be classified (e.g. no lipid panel, no eGFR).
--
-- Silently forcing such patients into `low` would be a clinical safety
-- bug: absence of data is not evidence of safety. This migration relaxes
-- the CHECK to allow `indeterminate`, and also documents that the
-- per-domain columns (`cardiovascular_risk`, ...) accept the same label.
--
-- Safety
-- ======
-- - Backwards compatible: every existing row is unchanged and still valid.
-- - No data loss, no index rebuild, no table rewrite.
-- - Idempotent: the migration can be re-applied without error.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Composite risk level — extend the allowed set.
-- ---------------------------------------------------------------------------
ALTER TABLE public.risk_profiles
  DROP CONSTRAINT IF EXISTS risk_profiles_composite_risk_level_check;

ALTER TABLE public.risk_profiles
  ADD CONSTRAINT risk_profiles_composite_risk_level_check
  CHECK (
    composite_risk_level IN ('low', 'moderate', 'high', 'very_high', 'indeterminate')
  );

-- ---------------------------------------------------------------------------
-- 2. Per-domain risk columns — enforce the same vocabulary explicitly.
--    These columns were previously untyped TEXT. We add CHECK constraints
--    now so the DB rejects future drift (e.g. a rogue import writing
--    'unknown' or 'tbd'). NULL remains legal — it means "frailty not
--    assessed" for frailty_risk, and "domain not computed" elsewhere.
-- ---------------------------------------------------------------------------
ALTER TABLE public.risk_profiles
  ADD CONSTRAINT risk_profiles_cardiovascular_risk_check
  CHECK (
    cardiovascular_risk IS NULL
    OR cardiovascular_risk IN ('low', 'moderate', 'high', 'very_high', 'indeterminate')
  );

ALTER TABLE public.risk_profiles
  ADD CONSTRAINT risk_profiles_metabolic_risk_check
  CHECK (
    metabolic_risk IS NULL
    OR metabolic_risk IN ('low', 'moderate', 'high', 'very_high', 'indeterminate')
  );

ALTER TABLE public.risk_profiles
  ADD CONSTRAINT risk_profiles_hepatic_risk_check
  CHECK (
    hepatic_risk IS NULL
    OR hepatic_risk IN ('low', 'moderate', 'high', 'very_high', 'indeterminate')
  );

ALTER TABLE public.risk_profiles
  ADD CONSTRAINT risk_profiles_renal_risk_check
  CHECK (
    renal_risk IS NULL
    OR renal_risk IN ('low', 'moderate', 'high', 'very_high', 'indeterminate')
  );

ALTER TABLE public.risk_profiles
  ADD CONSTRAINT risk_profiles_frailty_risk_check
  CHECK (
    frailty_risk IS NULL
    OR frailty_risk IN ('low', 'moderate', 'high', 'very_high', 'indeterminate')
  );

COMMIT;
