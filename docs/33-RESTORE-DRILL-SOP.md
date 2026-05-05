# Uelfy Clinical — Backup & Restore Drill SOP

> **Scope.** Operational procedure to demonstrate that a Uelfy
> deployment can be restored to a known-good state from backup. Required
> by GDPR Art.32(1)(d) ("the ability to restore the availability and
> access to personal data in a timely manner in the event of a physical
> or technical incident") and by ISO 27001 / SOC 2 baselines.
>
> **Cadence.** **Annual** at minimum. Re-run after any of:
>   - Major Supabase platform upgrade (PG version bump)
>   - First production deploy
>   - Backup configuration change (PITR window, retention)
>   - A real incident that exercised restore (replace the next drill
>     with a post-mortem-driven re-run)
>
> **Owner.** Engineering on-call + DPO. The drill output is signed by
> both before being filed.
>
> **Audience.** On-call engineer running the drill; auditors reviewing
> the artefact log post-hoc.
>
> **Companion docs.** `docs/27-INCIDENT-RESPONSE.md` (real-incident
> playbook), `docs/22-GDPR-READINESS.md §Art.32` (regulatory anchor),
> `docs/14-DELETION-POLICY.md` (retention boundaries — none of which
> we want to inadvertently delete during a restore).
>
> **Updated.** 2026-04-26.

---

## 1. Pre-conditions

Before starting the drill:

- [ ] Production Supabase project has Point-in-Time Recovery (PITR)
      enabled (Pro+ plan). Verify in the Supabase Dashboard →
      Project Settings → Database → Backups.
- [ ] PITR retention window covers at least the past 7 days.
- [ ] A **separate** Supabase project ("staging-restore") exists OR
      can be created as the drill target. We never restore over
      production.
- [ ] The drill operator has Supabase Owner role on both projects.
- [ ] An incident channel (Slack #incident or equivalent) is open
      throughout the drill — the drill is logged like a real
      incident, even though no actual outage exists.

---

## 2. Drill scenarios

The annual drill MUST cover at least scenario A. B and C are recommended
but not gating; rotate through them across years so each gets exercised
roughly every 2-3 years.

### Scenario A — Whole-DB Point-in-Time restore (gating)

Most realistic disaster scenario. Restores the entire database to a
target timestamp 1-6 hours in the past.

### Scenario B — Storage-only object restore

Recovers a deleted clinical-reports PDF blob via the Supabase Storage
versioning API. Useful evidence if a tenant asks for proof that
soft-deleted exports can be recovered within their grace window.

### Scenario C — Single-tenant logical export + import

Demonstrates that a tenant offboarding (DPA termination — see
`32-EXT-LEGAL-TEMPLATES §1.7`) can be fulfilled within the 30-day
window. Uses the per-patient JSON envelope from
`GET /api/v1/patients/{id}/export`.

This SOP details Scenario A in full. Scenarios B and C have shorter
sub-procedures at the end (§7 and §8).

---

## 3. Scenario A — step-by-step

### 3.1 Choose the restore target (10 min)

Pick a stable timestamp in the past. Typical choice: `now() - 2h`.
Avoid timestamps in the middle of a known mass-write event (you will
see partial state and the assertions in §3.5 will be noisy).

```
DRILL_TARGET=$(date -u -d "2 hours ago" "+%Y-%m-%dT%H:%M:%SZ")
echo "Drill target timestamp: $DRILL_TARGET"
```

Record the chosen `DRILL_TARGET` in the drill log (template §6).

### 3.2 Pre-restore snapshot of production (5 min)

Before triggering anything, capture three numbers from production
that we will compare against the restored state:

```sql
-- Run against the PRODUCTION DB.
SELECT
  (SELECT count(*) FROM patients      WHERE deleted_at IS NULL)  AS active_patients,
  (SELECT count(*) FROM assessments)                              AS total_assessments,
  (SELECT count(*) FROM audit_events)                             AS total_audit_rows,
  (SELECT max(created_at) FROM audit_events)                      AS last_audit_at;
```

Record the four values in the drill log.

### 3.3 Trigger PITR into the staging-restore project (15-30 min)

In the Supabase Dashboard:

1. Open the **staging-restore** project (NOT production).
2. Project Settings → Database → Backups → "Point in Time Recovery".
3. Choose source = production project.
4. Choose target timestamp = `DRILL_TARGET` from §3.1.
5. Confirm. The dashboard shows progress; typical 10-30 min for a
   small project.

While waiting, document the trigger in the drill log:

> *Triggered PITR from production to staging-restore at
> `<wallclock>` UTC. Source PITR target: `<DRILL_TARGET>`. Operator:
> `<name>`. Approving second pair of eyes: `<name>`.*

### 3.4 Verify restore semantics (15 min)

Connect with `psql` to the staging-restore project (read-only role
preferred) and re-run the same four counts:

```sql
SELECT
  (SELECT count(*) FROM patients      WHERE deleted_at IS NULL)  AS active_patients,
  (SELECT count(*) FROM assessments)                              AS total_assessments,
  (SELECT count(*) FROM audit_events)                             AS total_audit_rows,
  (SELECT max(created_at) FROM audit_events)                      AS last_audit_at;
```

Expected: every count is **less than or equal** to the pre-restore
production numbers (because the staging-restore is a snapshot from
the past). `last_audit_at` must be `<= DRILL_TARGET`.

If any count is **greater** than production, escalate immediately —
something is wrong with the PITR target or the staging project is not
isolated from production. **Stop the drill.**

### 3.5 Per-table sanity (15 min)

```sql
-- Schema applied? Migration audit row should be at version 014 or higher.
SELECT metadata_json ->> 'migration_version' AS v, created_at
FROM audit_events
WHERE action = 'system.migration.applied'
ORDER BY created_at DESC
LIMIT 5;

-- RLS forced on every PHI table (regression check from migration 012)
SELECT c.relname AS tablename,
       c.relrowsecurity      AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'tenants','users','patients','assessments','assessment_measurements',
    'score_results','risk_profiles','nutrition_snapshots','activity_snapshots',
    'followup_plans','alerts','consent_records','audit_events','report_exports',
    'notification_jobs','professional_patient_links','due_items','data_subject_requests',
    'patient_clinical_profiles','professionals'
  )
ORDER BY c.relname;
-- expected: 20 rows, every row with rls_enabled=true AND rls_forced=true.

-- create_assessment_atomic RPC present (B-03 + 013 fix)
SELECT EXISTS (
  SELECT 1 FROM pg_proc WHERE proname = 'create_assessment_atomic'
) AS rpc_present;
-- expected: t

-- fn_anonymize_patient correctly using metadata_json + ip_hash
-- (regression: migration 003 had drift before the 003 fix)
SELECT prosrc LIKE '%metadata_json%' AS has_metadata_json,
       prosrc LIKE '%ip_hash%'       AS has_ip_hash
FROM pg_proc WHERE proname = 'fn_anonymize_patient';
-- expected: both t
```

Record outcomes in the drill log.

### 3.6 Smoke-test the restored app (15 min)

Optional but valuable: spin up a Vercel Preview deploy that points at
the staging-restore Supabase project (env var override) and run:

- Login as a known test admin
- Open `/pages/audit.html` — must show the restored audit history
- Open one patient detail — must show the restored assessments
- Run `npm run test:rls` against the staging-restore DATABASE_URL —
  the cross-tenant negative test must still pass

This proves the restored DB is not just data-shaped but actually
serves traffic. **No real user is affected.** The Preview deployment
is teardown-able.

### 3.7 Teardown (10 min)

- Delete the staging-restore Supabase project (or keep it for §3.6's
  Preview if still in use). Free Supabase projects are recycled
  quickly so do not leave them around indefinitely.
- Stop the Preview deployment if created.
- Mark the incident channel as resolved.

### 3.8 Sign and file the drill log (10 min)

Save the drill log (template in §6) into:

```
docs/restore-drills/<YYYY-MM-DD>-drill-A.md
```

Both the operator and the DPO sign at the bottom. The log lives
alongside the rest of the engineering doc pack; auditors look for it
during a Controller review.

**Total elapsed time, scenario A**: ~90-120 minutes.

---

## 4. RPO / RTO targets

These are the values we commit to in the per-tenant DPA. Fail any of
them in the drill ⇒ open an incident.

| Metric | Target | Source |
|---|---|---|
| RPO (max acceptable data loss) | ≤ 5 minutes | Supabase PITR continuous WAL streaming |
| RTO (max time to restore service) | ≤ 4 hours | PITR provisioning + smoke test |
| Audit-row preservation | 100% within RPO | Strict-audit guarantee (B-09) means audit rows are not lost during the lifetime of the WAL window |

If a future drill produces an actual RTO > 4h, the Tier-2 risk
register row M-01 is reopened and the SOP is revised before the next
attempt.

---

## 5. Failure modes and how to recognise them

| Symptom | Likely cause | First response |
|---|---|---|
| PITR target rejected with "out of retention window" | We chose a timestamp older than the PITR retention | Pick a more recent target. Open a follow-up to extend the retention if a real-incident scenario would require it. |
| Restored DB shows MORE rows than production at the chosen timestamp | Wrong source project chosen / staging is somehow live | **Stop the drill, file an incident**. Disconnect any preview deploy that may have been pointed there. |
| `pg_class.relforcerowsecurity` is false on any PHI table | Migration 012 was not applied to the source project, or the restore lost it | Re-apply migration 012 to the restored project; reopen the drill |
| `create_assessment_atomic` missing | Migration 011 / 013 drift between production and the staging copy | Re-apply 011 and 013 to the restored project |
| Login on the Preview deploy fails | The restored project has different `auth.users` rows than the JWT was minted against | Expected — the test admin must re-sign-in against the restored auth.users. Mint a fresh JWT for the drill session. |

---

## 6. Drill-log template

Copy this into `docs/restore-drills/<YYYY-MM-DD>-drill-A.md` for every
run.

```
# Restore drill — <YYYY-MM-DD> — Scenario A

## Operator
- Lead engineer: <name>
- Witness:        <name>
- DPO:            <name>

## Inputs
- DRILL_TARGET (UTC):         <ISO timestamp>
- Source project (prod):      <supabase project ref>
- Target project (staging):   <supabase project ref>

## Pre-restore production snapshot
- active_patients:    <n>
- total_assessments:  <n>
- total_audit_rows:   <n>
- last_audit_at:      <iso>

## PITR
- Triggered at:               <iso>
- Provisioning duration:      <minutes>
- Restored project ready at:  <iso>

## Post-restore staging snapshot
- active_patients:    <n>     (must be <= production)
- total_assessments:  <n>     (must be <= production)
- total_audit_rows:   <n>     (must be <= production)
- last_audit_at:      <iso>   (must be <= DRILL_TARGET)

## Per-table sanity
- Latest migration version:   <v>
- 20/20 PHI tables FORCE RLS: yes / no / list of misses
- create_assessment_atomic:   present
- fn_anonymize_patient drift fix present: yes / no

## Smoke test (optional)
- Preview deploy URL:    <url>
- /audit.html renders:   yes / no
- /patients renders:     yes / no
- npm run test:rls:      passed / failed

## Outcome
- RTO observed:          <minutes>   (target ≤ 240)
- RPO observed:          <minutes>   (target ≤ 5)
- Drill outcome:         PASS / FAIL
- Issues opened:         <list of issue ids>

## Sign-off
- Lead engineer: ____________________  date: __________
- DPO:           ____________________  date: __________
```

---

## 7. Scenario B — storage-only object restore (sub-procedure)

For a single deleted clinical-reports PDF.

```
1. Identify the object's storage_path. Either from the audit log:

      SELECT entity_id, metadata_json
        FROM audit_events
       WHERE action = 'report.generate'
         AND metadata_json ->> 'storage_path' = '<known path>';

   …or from the user report.

2. In the Supabase Dashboard → Storage → clinical-reports →
   navigate to the object's path → "Restore previous version".

3. If the object has been pruned beyond Storage retention, the only
   path is to RE-GENERATE the report from the persisted assessment
   (the source of truth — `score_results` + `assessment_clinical_snapshot`
   are intact). Use POST /api/v1/assessments/<id>/report.

4. Record outcome in the drill log.
```

Time-box: 30 minutes.

---

## 8. Scenario C — single-tenant export & re-import (sub-procedure)

Demonstrates DPA-termination flow.

```
1. For each patient of the tenant: GET /api/v1/patients/<id>/export
   → store the JSON envelope.

2. Bundle all envelopes into a tar.gz with the tenant's id in the
   filename. Hand the bundle to the controller via the agreed
   secure-transfer channel (counsel-defined).

3. Optional sanity: re-import into a clean staging project by
   replaying the bundles via the standard create-patient + create-
   assessment endpoints. Verify the score outputs match the original
   `engine_version` (deterministic guarantee — see
   docs/23-CLINICAL-ENGINE.md §4).

4. Record outcome.
```

Time-box: dependent on tenant size; expect 30-90 minutes for a
small clinic.

---

## 9. References

- GDPR Art.32(1)(d) — restore capability requirement
- ISO 27001 A.12.3 — backup
- Supabase docs: Backups & Point in Time Recovery
- `docs/14-DELETION-POLICY.md` — retention boundaries
- `docs/27-INCIDENT-RESPONSE.md` — real-incident playbook
- `docs/30-RISK-REGISTER.md` — M-05 row
