-- ============================================================
-- MIGRATION 008 — ACTIVITY SNAPSHOT MET-BASED PERSISTENCE
-- ============================================================
-- Scope
-- -----
-- WS5 introduced MET-based activity analytics (moderate/vigorous split,
-- MET-min/week, sedentary hours/day). The pure-function engine already
-- emits these fields, but the `activity_snapshots` table predates WS5
-- and only persists the legacy aggregate `minutes_per_week` +
-- `qualitative_band`. This migration extends the table so the write
-- path in assessment-service.ts can persist the full MET projection.
--
-- Downstream consumers affected:
--   * Longitudinal trend charts on the patient page need MET-min/week
--     and sedentary hours as domain-specific time series.
--   * PDF reports should eventually surface the MET split.
--
-- Related fix:
--   Issue 1 (due items pipeline) is corrected in
--   `backend/src/services/assessment-service.ts` by switching from
--   `upsert(..., { onConflict })` — which PostgREST cannot dispatch
--   against the partial unique index from migration 007 — to an explicit
--   DELETE-open + INSERT cycle. No schema change is required for that
--   fix; the migration exists purely for the additive MET columns.
--
-- Idempotent
-- ----------
-- ALTER TABLE ... ADD COLUMN IF NOT EXISTS keeps the migration safe to
-- re-run on production databases that may already have been manually
-- patched.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Extend activity_snapshots with MET-based columns
-- ------------------------------------------------------------
ALTER TABLE public.activity_snapshots
  ADD COLUMN IF NOT EXISTS moderate_minutes_per_week INTEGER,
  ADD COLUMN IF NOT EXISTS vigorous_minutes_per_week INTEGER,
  ADD COLUMN IF NOT EXISTS met_minutes_per_week NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS sedentary_hours_per_day NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS sedentary_risk_level TEXT;

-- Tighten the sedentary_risk_level vocabulary to the WS5 enum
-- (`low | moderate | high | very_high`). The legacy `sedentary_level`
-- column stays for backward compatibility with older rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'activity_snapshots_sedentary_risk_level_check'
  ) THEN
    ALTER TABLE public.activity_snapshots
      ADD CONSTRAINT activity_snapshots_sedentary_risk_level_check
      CHECK (
        sedentary_risk_level IS NULL OR sedentary_risk_level IN (
          'low', 'moderate', 'high', 'very_high'
        )
      );
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. Documentation
-- ------------------------------------------------------------
COMMENT ON COLUMN public.activity_snapshots.moderate_minutes_per_week IS
  'WHO/GPAQ moderate-intensity minutes per week. NULL when only an '
  'aggregate was reported.';

COMMENT ON COLUMN public.activity_snapshots.vigorous_minutes_per_week IS
  'WHO/GPAQ vigorous-intensity minutes per week. NULL when only an '
  'aggregate was reported.';

COMMENT ON COLUMN public.activity_snapshots.met_minutes_per_week IS
  'Derived MET-min/week = moderate*4 + vigorous*8. WHO target >=600. '
  'Population of this column is what powers the MVPA trend chart.';

COMMENT ON COLUMN public.activity_snapshots.sedentary_hours_per_day IS
  'Self-reported sedentary hours per day. ESC 2021 §3 flags >=8h as an '
  'independent CV risk signal.';

COMMENT ON COLUMN public.activity_snapshots.sedentary_risk_level IS
  'WS5 four-band sedentary risk (low/moderate/high/very_high). The '
  'legacy three-band `sedentary_level` column is preserved for '
  'backward compatibility with pre-WS5 assessments.';

-- ------------------------------------------------------------
-- 3. Index: MET time-series queries
-- ------------------------------------------------------------
-- The trends endpoint joins activity_snapshots → assessments and orders
-- by assessment.created_at. The composite index speeds up per-patient
-- longitudinal reads without bloating the hot write path.
CREATE INDEX IF NOT EXISTS idx_activity_snapshots_assessment_trends
  ON public.activity_snapshots (assessment_id)
  WHERE met_minutes_per_week IS NOT NULL
     OR sedentary_hours_per_day IS NOT NULL;

COMMIT;
