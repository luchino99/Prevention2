-- ============================================================
-- Migration 004 — audit_events extensions
-- ============================================================
-- Purpose:
--   Extend the canonical `audit_events` table (migration 001) with
--   three columns required by the application layer:
--     - outcome         : success/failure marker for each audited action
--     - failure_reason  : human-readable reason surfaced on failed attempts
--     - user_agent      : truncated UA string (never the raw IP)
--
-- These columns are referenced by:
--   - backend/src/audit/audit-logger.ts  (recordAudit / recordFailedLogin)
--   - api/v1/admin/audit.ts              (admin audit browse)
--   - api/v1/internal/retention.ts       (retention audit row)
--   - api/v1/internal/anonymize.ts       (anonymize audit row)
--
-- GDPR alignment:
--   * `outcome` + `failure_reason` enable Art. 32/33/34 incident detection
--     (brute-force login, permission denials, failed exports).
--   * `user_agent` is stored truncated (max 512 chars enforced at app layer),
--     with no raw IP (we keep the existing `ip_hash`).
--
-- Idempotence:
--   Uses `ADD COLUMN IF NOT EXISTS` so repeated application is safe.
--   A `CHECK` constraint is attached to `outcome` and added defensively.
-- ============================================================

BEGIN;

-- 1) Columns
ALTER TABLE public.audit_events
  ADD COLUMN IF NOT EXISTS outcome        TEXT NOT NULL DEFAULT 'success',
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS user_agent     TEXT;

-- 2) CHECK constraint on outcome (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'audit_events_outcome_check'
       AND conrelid = 'public.audit_events'::regclass
  ) THEN
    ALTER TABLE public.audit_events
      ADD CONSTRAINT audit_events_outcome_check
      CHECK (outcome IN ('success', 'failure'));
  END IF;
END
$$;

-- 3) Defensive truncation on user_agent (prevents payload abuse / log spam)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'audit_events_user_agent_len_check'
       AND conrelid = 'public.audit_events'::regclass
  ) THEN
    ALTER TABLE public.audit_events
      ADD CONSTRAINT audit_events_user_agent_len_check
      CHECK (user_agent IS NULL OR length(user_agent) <= 512);
  END IF;
END
$$;

-- 4) Secondary index to speed up "failed attempts in last 24h" dashboards
CREATE INDEX IF NOT EXISTS idx_audit_outcome_created
  ON public.audit_events (outcome, created_at DESC)
  WHERE outcome = 'failure';

COMMIT;

-- ============================================================
-- Post-migration sanity (read-only; safe to run in SQL Editor):
--
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name   = 'audit_events'
--      AND column_name IN ('outcome','failure_reason','user_agent')
--    ORDER BY column_name;
-- ============================================================
