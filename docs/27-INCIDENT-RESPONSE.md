# Uelfy Clinical — Incident Response Playbook

> **Scope.** Detection, triage, containment, eradication, recovery, and
> notification for security and privacy incidents. Companion to
> `20-SECURITY.md`, `21-PRIVACY-TECHNICAL.md`, `22-GDPR-READINESS.md`,
> `26-DEPLOYMENT-RUNBOOK.md`.
>
> **Audience.** On-call engineer, security lead, DPO, founder. Tenant
> controllers reference this playbook through their DPA but execute their
> own controller-side response in parallel.
>
> **Stance.** This is a *technical* playbook. The legal interpretation
> of "personal data breach" (Art.4(12) GDPR), the controller's duty to
> notify the supervisory authority (Art.33), and the duty to notify the
> data subject (Art.34) sit with the controller. Uelfy's role as
> processor (Art.33(2)) is to **notify the controller without undue
> delay** when we become aware of a breach affecting their data.
>
> **`EXT-LEGAL`.** Statutory notification templates and counsel sign-off
> on the supervisory-authority filing belong to the controller's DPO.

---

## 1. Roles & contacts

| Role | Responsibility | Where to reach (operational) |
|---|---|---|
| On-call engineer | First responder, technical containment | Vercel/Supabase access + escalation channel |
| Security lead | Triage classification, decision to escalate | (controller-private) |
| DPO / founder | Controller notification, regulatory filing | (controller-private) |
| Tenant controller | Statutory notification to authority + data subjects | Per-tenant DPA |

The contact list itself is `EXT-LEGAL` (it changes per tenant) and
lives in the per-tenant DPA appendix. Operationally, the on-call
engineer is the named entry point.

---

## 2. Severity classification

| Sev | Definition | Examples |
|---|---|---|
| **SEV-1** | Confirmed PHI exposure, OR active ongoing exfiltration, OR multi-tenant data crossover | RLS bypass actually exploited, service-role key in a public commit, audit table tampered with |
| **SEV-2** | Likely PHI exposure (vulnerability proven, exploitation not confirmed) OR critical control failure with no evidence of exposure yet | RLS misconfiguration discovered in production, `AUDIT_WRITE_FAILED` storm on a privacy-significant endpoint |
| **SEV-3** | Security control degradation without PHI exposure | Rate limiter offline, MFA flow broken for some users, cron secret rotation overdue |
| **SEV-4** | Operational anomaly under investigation | Unusual login pattern, single failed audit write |

The classification is **inclusive** — when in doubt, escalate.

---

## 3. Detection signals

| Signal | Source | Default severity |
|---|---|---|
| `AUDIT_WRITE_FAILED` log line | Vercel function logs | SEV-3 (single) → SEV-2 (storm > 5/min) |
| `RLS denied` in DB logs | Supabase logs | SEV-3 (one) → SEV-2 (pattern) |
| Multiple failed-login spikes from a single IP hash | `audit_events` query | SEV-3 |
| Successful login from impossible-travel IP | (not currently auto-flagged — manual review) | SEV-3 |
| HTTP 500 spike on a write endpoint | Vercel observability | SEV-3 |
| Cron run failure | Vercel cron history | SEV-3 (one miss) → SEV-2 (consecutive) |
| Anonymisation cron skipped its window > 24h | Vercel cron history | SEV-2 (retention SLA at risk) |
| Service-role-key committed to public repo | GitHub secret-scan / vendor alert | SEV-1 |
| Patient row visible across tenants | Manual report or external researcher | SEV-1 |
| Audit-row missing for an action that did happen | Forensic query | SEV-2 |

---

## 4. Lifecycle

### 4.1 Identification (T+0)

- Acknowledge the alert.
- Capture: timestamp (UTC), source signal, raw evidence (log lines,
  query results, screenshots).
- Open an incident note in the operator's incident channel. Use a
  fresh incident-id (e.g. `INC-2026-04-26-001`).

### 4.2 Triage (T+0 to T+30 min)

- Assign severity per §2.
- For **SEV-1** or suspected **SEV-2** with PHI scope: **page the DPO
  / founder immediately.** Do not wait to confirm scope before paging
  on a SEV-1.
- For SEV-3 / SEV-4: continue investigation; escalate if scope grows.

### 4.3 Containment

Goal: stop further damage, even if it means short-term degraded
service. Acceptable trade-off for a SEV-1.

| Scenario | Containment action |
|---|---|
| RLS bypass active | Disable the affected endpoint at the API gateway (Vercel rewrite to a 503 page). Force-revert to last-known-good code. |
| Service-role key leaked | **Rotate immediately** (Supabase Dashboard → API → Regenerate). Update Vercel env. Redeploy. Revoke the leaked key. Audit recent activity using the new key. |
| Cron secret leaked | Rotate `CRON_SIGNING_SECRET`. Redeploy. Audit `audit_events` for unauthorised cron-bearing activity (none expected — cron handlers don't act on user data). |
| Audit storm | Identify the failing dependency (DB write timeout? RLS conflict?). If the audit failure is masking real activity, decide whether to fail-closed (refuse the user request) or fail-open (continue). Strict-audit endpoints already fail-closed by design (B-09). |
| Unauthorised admin access | Suspend the user account (Supabase Auth UI). Revoke any active sessions. Force MFA re-enrolment on next login. |
| Suspected dependency vulnerability with active exploit | Pin the dependency to a safe version. Redeploy. Snyk-style audit of recent installs. |

### 4.4 Eradication

- Patch the root cause (code change, migration, config change).
- Add a regression test where possible (`28-TESTING-STRATEGY.md`).
- For RLS / RBAC issues, add a policy-level test, not just a code-level
  test.

### 4.5 Recovery

- Re-enable disabled endpoints (after verifying the fix in staging).
- Re-run the §6 smoke tests from `26-DEPLOYMENT-RUNBOOK.md`.
- Confirm normal traffic patterns resume.

### 4.6 Post-incident review (within 5 business days)

Format: blameless postmortem.

- Timeline.
- Detection: what worked, what didn't.
- Containment: what worked, what didn't.
- Root cause.
- Action items (owners + due dates) — at least one of these is a
  detection-improvement item.
- Customer-facing communication summary (if any).

Stored in the operator's incident folder. Privacy-significant incidents
are also referenced from `11-CHANGELOG.md` under "Security" with a
masked summary (no PHI, no actor identity).

---

## 5. Personal-data-breach notification (Art.33 / Art.34)

A "personal data breach" under Art.4(12) is a *security* incident
leading to accidental or unlawful destruction, loss, alteration,
unauthorised disclosure of, or access to, personal data.

### 5.1 Uelfy as processor → controller (Art.33(2))

When Uelfy becomes aware of a breach affecting tenant data, we notify
the controller **without undue delay**.

Operational SLA: **24 hours** from the on-call engineer's classification
of the incident as SEV-1 or SEV-2-with-likely-PHI-scope.

Notification minimum content (Art.33(3) elements that the processor
must support the controller with):

- Nature of the breach (categories of data, approximate counts of
  records and subjects affected).
- Likely consequences.
- Measures taken or proposed to address the breach and mitigate
  effects.
- Contact for further information (on-call engineer / DPO).

### 5.2 Controller → supervisory authority (Art.33(1))

The controller has 72 hours from awareness to notify the supervisory
authority unless the breach is unlikely to result in a risk to
individual rights. **Uelfy does not file this notification on the
controller's behalf.** We supply the technical evidence pack:

- Affected resource ids (UUIDs, never PHI).
- Audit trail extract for the affected window.
- Root-cause description.
- Remediation summary.
- Confirmation that the technical containment is in place.

### 5.3 Controller → data subject (Art.34)

Required when the breach is likely to result in a high risk to the
rights and freedoms of natural persons. The controller decides; Uelfy
supports with the technical evidence pack.

### 5.4 What Uelfy will *not* do

- We will not notify the supervisory authority on the controller's
  behalf (out of our processor role).
- We will not contact the data subjects directly (the controller owns
  that channel).
- We will not publish a public breach disclosure without the
  controller's coordination.

---

## 6. Forensic queries (operator cookbook)

These run against the Supabase project (read-only role recommended).
Each one is safe to run in production.

### 6.1 Recent audit events for a tenant

```sql
select created_at, action, entity_type, entity_id, actor_user_id, outcome
from audit_events
where tenant_id = $TENANT_ID
  and created_at > now() - interval '24 hours'
order by created_at desc
limit 200;
```

### 6.2 Failed-login pattern by IP-hash

```sql
select ip_hash, count(*) as failures, max(created_at) as latest
from audit_events
where action = 'auth.failed_login'
  and created_at > now() - interval '1 hour'
group by ip_hash
having count(*) > 5
order by failures desc;
```

### 6.3 Patient rows accessed by an actor (consent investigation)

```sql
select created_at, action, entity_id
from audit_events
where actor_user_id = $ACTOR_ID
  and entity_type = 'patient'
  and created_at between $WINDOW_START and $WINDOW_END
order by created_at;
```

### 6.4 DSR ledger state for a subject

```sql
select id, kind, status, requested_at, sla_deadline, fulfilled_at
from data_subject_requests
where subject_patient_id = $PATIENT_ID
order by requested_at desc;
```

### 6.5 Anonymisation status for a soft-deleted patient

```sql
select id, deleted_at, anonymized_at
from patients
where id = $PATIENT_ID;
```

### 6.6 Audit-row presence check for a privacy-significant action

```sql
select count(*) from audit_events
 where action = 'consent.revoke'
   and entity_id = $CONSENT_ID;
-- expected: 1 (post-Phase 7.1, recordAuditStrict guarantees)
```

---

## 7. Tabletop scenarios (run quarterly)

Practice the playbook on synthetic incidents. Each scenario takes 30–60
minutes.

### 7.1 "RLS policy regression"

Hypothesis: a migration accidentally drops an RLS policy on `patients`.

Tabletop:
1. How is it detected? (RLS denial spike? Manual QA?)
2. Containment: disable the affected endpoint? Block all reads?
3. Forensic query: which actors read which rows in the gap?
4. Notification window — when does the 24h processor SLA start?

### 7.2 "Service-role key leaked"

Hypothesis: an engineer pastes the service-role key into a public Slack
channel.

Tabletop:
1. Detection signal: GitHub/Slack secret scanner.
2. Rotation in < 5 min.
3. How do we know it wasn't used externally?
4. Public statement?

### 7.3 "Cron silently stopped"

Hypothesis: anonymisation cron has not run for 96 hours.

Tabletop:
1. Detection: Vercel cron-history alert? Manual check?
2. Risk: PHI retained beyond grace window — retention SLA breach.
3. Remediation: manual cron run + post-mortem on monitoring gap.

---

## 8. Communication templates (drafts)

### 8.1 Internal SEV-1 page

> **SEV-1** — `INC-YYYY-MM-DD-NNN` — `<headline>`
> Detection: `<source signal>` at `<UTC timestamp>`
> Affected: tenant=`<id-or-all>`, scope=`<patients|consents|audit|other>`
> Containment in progress: `<action>`
> On-call: `<name>`
> DPO/founder paged: yes/no — pinging now.

### 8.2 Processor → controller notification (Art.33(2)) — draft

```
Subject: [Uelfy Security] Notification of suspected personal data breach — INC-XXXX

Controller: <tenant>
Detected: <UTC timestamp>
Categories of data affected: <e.g. patient identifying + clinical PHI>
Approximate scope: <count of records / subjects, or "under investigation">
Nature of incident: <one-paragraph description>
Likely consequences: <one paragraph>
Measures taken: <containment + eradication summary>
Measures proposed: <follow-up actions>
Technical evidence pack: <link to attached forensic extract — do not include PHI>
Contact: <on-call engineer + DPO>
```

`EXT-LEGAL`: counsel reviews the wording for any external disclosure.

---

## 9. Logging & evidence preservation

For any SEV-1 or SEV-2:

- **Do not delete** any log file, audit row, or migration during the
  incident.
- Snapshot the relevant `audit_events` rows to a separate read-only
  store (CSV export from Supabase is acceptable).
- Snapshot Vercel function logs for the affected window.
- Preserve all email / Slack / chat traffic about the incident.

The 7-year audit retention default already covers post-incident
analysis windows (`14-DELETION-POLICY.md`).

---

## 10. Training & drills

- New engineers walk this playbook on day 1.
- The on-call rotation includes a quarterly tabletop (§7).
- Annual review of contact lists, severity mapping, and detection
  signals.

These cadences are operational defaults; controller-specific drill
requirements are `EXT-LEGAL` per DPA.

---

## 11. Open items

| Item | Owner | Status |
|---|---|---|
| Automated alert on `AUDIT_WRITE_FAILED` log lines | Engineering | Roadmap |
| Automated alert on RLS-denial spikes | Engineering | Roadmap |
| Per-tenant breach-notification contact registry | Operator + EXT-LEGAL | Lives in the per-tenant DPA |
| External counsel-reviewed Art.33/34 templates | EXT-LEGAL | Pending |
| Pentest cadence and reports | EXT-LEGAL | See `25-MDR-READINESS.md §8` |
| Public security.txt + responsible-disclosure policy | Engineering + business | Roadmap |

---

**Cross-references**

- `20-SECURITY.md` — security architecture.
- `21-PRIVACY-TECHNICAL.md` — privacy-by-design technical view.
- `22-GDPR-READINESS.md` — Article-by-article readiness (Art.33/34).
- `26-DEPLOYMENT-RUNBOOK.md` — smoke tests, rotation, rollback.
- `14-DELETION-POLICY.md` — retention windows for evidence preservation.
