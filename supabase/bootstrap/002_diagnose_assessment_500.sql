-- ============================================================
-- DIAGNOSTICO: 500 on POST /api/v1/patients/{id}/assessments
-- ============================================================
-- Esegui questo intero file nello SQL editor di Supabase.
--
-- IMPORTANTE: è UNA SOLA query (UNION ALL) perché il SQL editor
-- di Supabase mostra solo il result-set dell'ultima statement.
-- Così ottieni tutti gli 11 check in un unica tabella.
--
-- Ogni riga riporta:
--   seq        — ordine di esecuzione
--   check_name — check eseguito
--   result     — YES / NO → <azione> / SKIPPED
--
-- Il primo `result` che inizia con `NO` è la causa del 500.
--
-- Sicurezza:
--   - Nessuna scrittura, solo SELECT.
--   - Nessun dato clinico esposto, solo metadati schema/RLS/ruoli.
-- ============================================================

WITH
-- ────────────────────────────────────────────────────────────
-- CHECK 1 — Migrazione 001: tabella `assessments` esiste?
-- ────────────────────────────────────────────────────────────
c1 AS (
  SELECT 1 AS seq,
         'CHECK 1 — assessments table exists' AS check_name,
         CASE WHEN to_regclass('public.assessments') IS NOT NULL
              THEN 'YES'
              ELSE 'NO  → Run 001_schema_foundation.sql'
         END AS result
),

-- ────────────────────────────────────────────────────────────
-- CHECK 2 — Migrazione 003: colonna `clinical_input_snapshot`?
--           (causa più probabile del 500 attuale)
-- ────────────────────────────────────────────────────────────
c2 AS (
  SELECT 2 AS seq,
         'CHECK 2 — assessments.clinical_input_snapshot exists' AS check_name,
         CASE WHEN EXISTS (
                 SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public'
                    AND table_name   = 'assessments'
                    AND column_name  = 'clinical_input_snapshot'
              )
              THEN 'YES'
              ELSE 'NO  → Run 003_retention_anonymization_snapshot.sql'
         END AS result
),

-- ────────────────────────────────────────────────────────────
-- CHECK 3 — Migrazione 003: trigger immutabilità snapshot?
-- ────────────────────────────────────────────────────────────
c3 AS (
  SELECT 3 AS seq,
         'CHECK 3 — trg_assessments_snapshot_immutable installed' AS check_name,
         CASE WHEN EXISTS (
                 SELECT 1 FROM pg_trigger
                  WHERE tgname = 'trg_assessments_snapshot_immutable'
              )
              THEN 'YES'
              ELSE 'NO  → Run 003_retention_anonymization_snapshot.sql'
         END AS result
),

-- ────────────────────────────────────────────────────────────
-- CHECK 4 — Migrazione 005: tabella `professional_patient_links`?
-- ────────────────────────────────────────────────────────────
c4 AS (
  SELECT 4 AS seq,
         'CHECK 4 — professional_patient_links table exists' AS check_name,
         CASE WHEN to_regclass('public.professional_patient_links') IS NOT NULL
              THEN 'YES'
              ELSE 'NO  → Run 005_professional_patient_links.sql'
         END AS result
),

-- ────────────────────────────────────────────────────────────
-- CHECK 5 — Migrazione 005: policies RLS presenti?
-- ────────────────────────────────────────────────────────────
c5 AS (
  SELECT 5 AS seq,
         'CHECK 5 — PPL RLS policies present' AS check_name,
         CASE WHEN (
                 SELECT COUNT(*) FROM pg_policies
                  WHERE tablename = 'professional_patient_links'
              ) >= 3
              THEN 'YES (>=3 policies)'
              ELSE 'NO  → Re-run 005_professional_patient_links.sql'
         END AS result
),

-- ────────────────────────────────────────────────────────────
-- CHECK 6 — Bucket `clinical-reports` (non causa il 500
--           sugli assessments, serve solo alla PDF).
--           Skip automatico se il ruolo non ha SELECT su
--           storage.buckets (alcuni progetti Supabase).
-- ────────────────────────────────────────────────────────────
c6 AS (
  SELECT 6 AS seq,
         'CHECK 6 — storage bucket clinical-reports exists' AS check_name,
         CASE
           WHEN to_regclass('storage.buckets') IS NULL
             THEN 'SKIPPED (storage.buckets not visible — check in Dashboard → Storage)'
           WHEN NOT has_table_privilege(current_user, 'storage.buckets', 'SELECT')
             THEN 'SKIPPED (current role lacks SELECT on storage.buckets — check in Dashboard → Storage)'
           WHEN EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'clinical-reports')
             THEN 'YES'
           ELSE 'NO  → Dashboard → Storage → create private bucket "clinical-reports"'
         END AS result
),

-- ────────────────────────────────────────────────────────────
-- CHECK 7 — Colonne chiave su `patients` (anti-drift).
-- ────────────────────────────────────────────────────────────
c7 AS (
  SELECT 7 AS seq,
         'CHECK 7 — patients has expected columns' AS check_name,
         CASE WHEN (
                 SELECT COUNT(*) FROM information_schema.columns
                  WHERE table_schema = 'public'
                    AND table_name   = 'patients'
                    AND column_name IN
                      ('tenant_id','external_code','display_name','first_name',
                       'last_name','birth_date','birth_year','sex',
                       'contact_email','contact_phone','is_active','deleted_at','consent_status')
              ) = 13
              THEN 'YES (all 13 expected columns)'
              ELSE 'NO  → Schema drift on patients. Re-run 001_schema_foundation.sql.'
         END AS result
),

-- ────────────────────────────────────────────────────────────
-- CHECK 8 — Enum assessment_status contiene 'completed'?
-- ────────────────────────────────────────────────────────────
c8 AS (
  SELECT 8 AS seq,
         'CHECK 8 — assessment_status enum has "completed"' AS check_name,
         CASE WHEN EXISTS (
                 SELECT 1 FROM pg_type t
                   JOIN pg_enum e ON e.enumtypid = t.oid
                  WHERE t.typname  = 'assessment_status'
                    AND e.enumlabel = 'completed'
              )
              THEN 'YES'
              ELSE 'NO  → Enum mismatch. Re-run 001_schema_foundation.sql.'
         END AS result
),

-- ────────────────────────────────────────────────────────────
-- CHECK 9 — Tabella `users` esiste con colonna `role`?
--           (chiave per capire il ruolo del tuo account)
-- ────────────────────────────────────────────────────────────
c9 AS (
  SELECT 9 AS seq,
         'CHECK 9 — public.users has role column' AS check_name,
         CASE WHEN EXISTS (
                 SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public'
                    AND table_name   = 'users'
                    AND column_name  = 'role'
              )
              THEN 'YES'
              ELSE 'NO  → Schema drift on users. Re-run 001_schema_foundation.sql.'
         END AS result
),

-- ────────────────────────────────────────────────────────────
-- CHECK 10 — Helper `is_linked_to_patient` installato?
-- ────────────────────────────────────────────────────────────
c10 AS (
  SELECT 10 AS seq,
         'CHECK 10 — is_linked_to_patient() function installed' AS check_name,
         CASE WHEN EXISTS (
                 SELECT 1 FROM pg_proc
                  WHERE proname = 'is_linked_to_patient'
              )
              THEN 'YES'
              ELSE 'NO  → Re-run 005_professional_patient_links.sql'
         END AS result
),

-- ────────────────────────────────────────────────────────────
-- CHECK 11 — RLS attiva su `assessments`?
-- ────────────────────────────────────────────────────────────
c11 AS (
  SELECT 11 AS seq,
         'CHECK 11 — RLS enabled on assessments' AS check_name,
         CASE WHEN EXISTS (
                 SELECT 1 FROM pg_class
                  WHERE relname        = 'assessments'
                    AND relrowsecurity = TRUE
              )
              THEN 'YES'
              ELSE 'NO  → Re-run 002_rls_policies.sql'
         END AS result
)

SELECT * FROM c1
UNION ALL SELECT * FROM c2
UNION ALL SELECT * FROM c3
UNION ALL SELECT * FROM c4
UNION ALL SELECT * FROM c5
UNION ALL SELECT * FROM c6
UNION ALL SELECT * FROM c7
UNION ALL SELECT * FROM c8
UNION ALL SELECT * FROM c9
UNION ALL SELECT * FROM c10
UNION ALL SELECT * FROM c11
ORDER BY seq;

-- ============================================================
-- RIEPILOGO OPERATIVO
-- ============================================================
-- Se CHECK 2 = NO → è quasi certamente la causa del 500 attuale.
--   Rimedio: SQL editor → incollare 003_retention_anonymization_snapshot.sql.
-- Se CHECK 4/5/10 = NO → applicare 005_professional_patient_links.sql.
-- Se CHECK 2/4 = YES e il 500 persiste → aprire la response nella Network
--   tab del browser. Dal deploy 0.2.1-hotfix-assessment500 il backend
--   restituisce `error.details.pgCode` e `error.details.pgMessage` con il
--   codice Postgres esatto.
--
-- Controllo manuale per ruolo/link (in query separate, se serve):
--   SELECT id, role, tenant_id FROM public.users
--    WHERE email = 'lucaimperio49@gmail.com';
--
--   SELECT * FROM public.professional_patient_links
--    WHERE patient_id = 'a998c46b-2365-4dd2-972c-a59c6bf3f7de'
--      AND is_active = TRUE;
-- ============================================================
