# Uelfy Clinical — Production Launch Checklist

> **Scope.** Single, gating checklist that must pass before a tenant
> goes into clinical production. Each line is binary (done / not done)
> and references the doc that owns the substantive evidence.
>
> **Audience.** Founder, on-call engineer, DPO, controller-side
> contact.
>
> **Stance.** This checklist is **gating**, not aspirational. A line
> in the "not done" column is a launch blocker unless explicitly
> waived in writing by the controller and (for clinical / regulatory
> lines) the regulatory consultant.
>
> **Use.** Print it. Tick it. Sign it. Store the signed copy with the
> per-tenant DPA.

---

## Section A — Engineering gates

### A.1 Code & build

- [ ] `npm run typecheck` passes on the deploy branch
- [ ] `npm run typecheck:prod` passes (stricter `tsconfig.prod.check.json`)
- [ ] `npm run test` passes — all unit + integration + equivalence
- [ ] `npm run build` succeeds — `verify-build.mjs` passes
- [ ] No `TODO` / `FIXME` in `backend/src/domain/clinical/`
- [ ] No `console.log` left in production code paths (excluding
      structured logger calls)
- [ ] Engine version stamped in `engine/version.ts` matches the
      changelog tip in `29-CHANGELOG-CLINICAL.md`

**Evidence:** CI build link, `26-DEPLOYMENT-RUNBOOK.md §5`.

### A.2 Migrations

- [ ] Migrations 001–012 applied in target Supabase project (in order)
- [ ] `select * from pg_extension` shows expected extensions
- [ ] Both ENABLE and FORCE RLS active on every PHI table (B-01
      verification — set by migration 012). Use the canonical query
      below — `pg_tables` only exposes `rowsecurity`; the FORCE flag
      lives on `pg_class.relforcerowsecurity` so we must join
      `pg_class` + `pg_namespace`:

      ```sql
      SELECT c.relname AS tablename,
             c.relrowsecurity      AS rowsecurity,
             c.relforcerowsecurity AS forcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname IN (<the 20 PHI tables — see migration 012>)
      ORDER BY c.relname;
      -- expected: 20 rows, all with both flags = true
      ```
- [ ] `\du` confirms `anon` has **no** SELECT/INSERT/UPDATE/DELETE on
      PHI tables (B-02 verification)
- [ ] `select fn_anonymize_patient` and `fn_retention_prune` exist
      (migration 003)
- [ ] `select create_assessment` RPC exists (migration 011)
- [ ] `select is_linked_to_patient` SECURITY DEFINER helper exists
      (migration 005)

**Evidence:** `26-DEPLOYMENT-RUNBOOK.md §3`.

### A.3 Environment variables

- [ ] `SUPABASE_URL` set in Production scope
- [ ] `SUPABASE_ANON_KEY` set in Production scope (also baked into bundle)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set in Production scope only — never
      in Preview, never in repo
- [ ] `CRON_SIGNING_SECRET` ≥ 32 random bytes; constant-time-comparable
- [ ] `CRON_SIGNING_SECRET` rotated within last 12 months
- [ ] `NODE_ENV=production`
- [ ] `OPENAI_API_KEY` **unset** unless the controller has explicitly
      enabled the optional AI commentary in the per-tenant DPA
- [ ] `ANONYMIZE_GRACE_DAYS` set to the per-tenant value (default 30)

**Evidence:** `26-DEPLOYMENT-RUNBOOK.md §2`.

### A.4 Cron jobs

- [ ] `vercel.json` `crons` block lists both `/api/v1/internal/retention`
      (`0 3 * * *`) and `/api/v1/internal/anonymize` (`0 4 * * *`)
- [ ] Vercel UI shows both crons enabled with a recent successful run
- [ ] Curl test (no auth) returns 401 on each cron endpoint
      (B-04 verification)
- [ ] Curl test (correct `CRON_SIGNING_SECRET`) returns 200 with
      structured JSON

**Evidence:** `26-DEPLOYMENT-RUNBOOK.md §6.4`.

### A.5 Security headers

- [ ] `curl -I` against a `/pages/*` URL returns: HSTS,
      X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy,
      Permissions-Policy, COOP, CORP, CSP
- [ ] CSP `connect-src` restricted to self + `https://*.supabase.co`
- [ ] No `unsafe-eval` in any CSP
- [ ] `/api/*` returns `Cache-Control: no-store, no-cache, must-revalidate, private`

**Evidence:** `vercel.json` headers; `26-DEPLOYMENT-RUNBOOK.md §12`.

### A.6 Audit & telemetry

- [ ] `audit_events` table populated within 5 minutes of a test login
- [ ] `recordAuditStrict` propagated across all 7 guarantee pathways
      (post-Phase 7.1 verification)
- [ ] No `AUDIT_WRITE_FAILED` log lines in last 24 hours of staging
      smoke testing

**Evidence:** `21-PRIVACY-TECHNICAL.md §4`, `30-RISK-REGISTER.md` B-09.

### A.7 Rate limiting

- [ ] Auth endpoints rate-limited (in-memory or Upstash)
- [ ] If multi-instance deploy: Upstash configured and verified
- [ ] Limit thresholds documented and accepted by controller

**Evidence:** `20-SECURITY.md §10`.

### A.8 Smoke tests post-deploy

All §6 smoke tests in `26-DEPLOYMENT-RUNBOOK.md` pass:

- [ ] Health
- [ ] Auth round-trip
- [ ] Cron auth (401 / 401 / 200)
- [ ] Audit emission
- [ ] PDF render
- [ ] DSR endpoint state machine (staging only)

---

## Section B — Privacy & GDPR gates

### B.1 Records and policies

- [ ] Privacy notice live at `/legal/privacy` and aligned with the
      controller's lawful-basis assignment
- [ ] Onboarding flow surfaces consent-record creation
- [ ] DSR ledger schema present (`data_subject_requests`)
- [ ] `consent_records` populated for at least one test patient
- [ ] Per-tenant retention windows configured in `tenants` row

**Evidence:** `21-PRIVACY-TECHNICAL.md §6`, `22-GDPR-READINESS.md`.

### B.2 Subject rights

- [ ] Art.15 / 20 export endpoint returns valid JSON envelope on a test
      patient
- [ ] Art.17 soft-delete + grace + anonymisation cron verified end-to-end
      on staging
- [ ] Art.7(3) consent revoke writes a new `consent_records` row with
      `granted=false` and audits via `recordAuditStrict`
- [ ] DSR endpoints (`POST /api/v1/admin/dsr` + `[id]/process.ts`)
      tested for all 4 transitions

**Evidence:** `22-GDPR-READINESS.md §`.

### B.3 Cross-border

- [ ] Vercel project region = EU
- [ ] Supabase project region = EU
- [ ] Bundled fonts (no Google Fonts CDN) — `scripts/fetch-noto-fonts.mjs`
      ran during build
- [ ] No third-party analytics SDK in the clinical UI
- [ ] If non-EU sub-processor enabled: TIA + SCCs in DPA appendix
      (`EXT-LEGAL`)

**Evidence:** `21-PRIVACY-TECHNICAL.md §9`.

### B.4 Controller-side documents (`EXT-LEGAL`)

- [ ] Per-tenant DPA signed
- [ ] Sub-processor list reviewed and accepted by controller
- [ ] Lawful-basis assignment per data category signed off
- [ ] DPIA completed and on file (Art.35) for large-cohort or paediatric
      tenants
- [ ] Breach-notification contact list current in DPA appendix

**Evidence:** `22-GDPR-READINESS.md §`.

---

## Section C — Clinical engine gates

### C.1 Engine integrity

- [ ] All score modules produce a non-empty `ScoreResultEntry`
      envelope on canonical inputs
- [ ] All score modules produce a typed skip envelope on missing input
      (no fabrication)
- [ ] `engine_version` stamped on every persisted `score_results` row
- [ ] Determinism test passes (running `computeAllScores` twice → equal)
- [ ] Equivalence vectors pass against published guideline appendices
      (or pinned legacy values)

**Evidence:** `23-CLINICAL-ENGINE.md §4`, `28-TESTING-STRATEGY.md`.

### C.2 Decision-support framing

- [ ] UI labels every score block as "decision support" with a clinician
      action
- [ ] PDF "Reference framework" section lists guideline source per
      score
- [ ] No endpoint accepts patient input AND returns a prescription / dose
      / treatment
- [ ] AI commentary, if enabled, renders as a clearly-labelled,
      secondary, non-authoritative block

**Evidence:** `23-CLINICAL-ENGINE.md §6`, `25-MDR-READINESS.md §11`.

### C.3 Alert engine

- [ ] Critical-threshold catalogue per `29-CHANGELOG-CLINICAL.md
      [2026-04-10.01]` active
- [ ] Alert engine split into completeness vs due-follow-up (Task #17)
- [ ] Alert ack / resolve / dismiss endpoints audited via
      `recordAuditStrict`

**Evidence:** `23-CLINICAL-ENGINE.md §8`.

### C.4 Clinical reviewer sign-off (`EXT-CLIN`)

- [ ] Controller's clinical lead has reviewed each score's source
      citation in `24-FORMULA-REGISTRY.md` and confirmed it matches the
      tenant's intended-use population
- [ ] Controller has reviewed and accepted the alert threshold catalogue
- [ ] Controller has reviewed and accepted the lifestyle-engine output
      bounds (no meal-planner / no workout-planner reaffirmed)

**Evidence:** `24-FORMULA-REGISTRY.md`, `25-MDR-READINESS.md`.

---

## Section D — Regulatory gates (`EXT-MDR`)

These are gates only if the tenant is operating the platform as a
CE-marked medical device. For decision-support deployments under
clinician oversight, these become recommendations.

- [ ] Final qualification + classification (likely IIa per Rule 11)
      reviewed by notified body
- [ ] Intended-purpose statement signed off
- [ ] Risk-management file (ISO 14971) on file
- [ ] Clinical evaluation report (CER) on file
- [ ] QMS (ISO 13485) audited
- [ ] Independent penetration test report on file
- [ ] PMS plan + PSUR template on file
- [ ] Vigilance reporting workflow defined
- [ ] UDI assigned + EUDAMED registration filed
- [ ] Tenant-facing IFU (Instructions For Use) issued

**Evidence:** `25-MDR-READINESS.md §12`.

---

## Section E — Operational gates

### E.1 On-call & contacts

- [ ] On-call rotation defined with at least 2 engineers
- [ ] Escalation path to DPO / founder documented and tested
- [ ] Tenant-side incident contact recorded in DPA appendix

### E.2 Backup & recovery

- [ ] Supabase point-in-time recovery (PITR) enabled
- [ ] Recovery point objective (RPO) accepted by controller
- [ ] Restore drill conducted (annual cadence) — `EXT-LEGAL`

### E.3 Observability

- [ ] Structured logs flowing to Vercel function logs
- [ ] Log-based alerting on `AUDIT_WRITE_FAILED` configured (or
      manual review process documented as interim — see `30-RISK-REGISTER.md`
      L-04)
- [ ] DB connection / cron-success monitoring in place

### E.4 Documentation pack

- [ ] All Phase 8 docs (20-29) and Phase 9 docs (30-31) accessible to
      the on-call engineer and the DPO
- [ ] `27-INCIDENT-RESPONSE.md` walked through with the on-call
      engineer
- [ ] Quarterly tabletop scheduled

---

## Section F — Sign-off

| Role | Name | Date | Signature |
|---|---|---|---|
| Engineering lead (Uelfy) | | | |
| DPO (Uelfy) | | | |
| Founder (Uelfy) | | | |
| Controller — clinical lead | | | |
| Controller — DPO | | | |
| Controller — IT lead | | | |
| Regulatory consultant (if MDR-scope) | | | |

**Waivers.** Any unticked line that proceeds to launch must have a
written waiver from the controller (and, for §C / §D, the regulatory
consultant) attached as an appendix. The waiver must state the residual
risk, the compensating control, and the remediation plan.

---

## Section G — Post-launch (T+30 days)

- [ ] All §A.8 smoke tests re-run
- [ ] No SEV-1 or SEV-2 incidents
- [ ] DSR pipeline empty or all in-SLA
- [ ] Cron success rate ≥ 99% over the window
- [ ] Audit-write success rate = 100% on guarantee pathways
- [ ] Risk register updated — any new risk surfaced is filed

---

**Cross-references**

- `20-SECURITY.md` — security architecture (gates §A.5–A.7).
- `21-PRIVACY-TECHNICAL.md` — privacy by design (gates §B.1–B.3).
- `22-GDPR-READINESS.md` — Article-by-article (gates §B).
- `23-CLINICAL-ENGINE.md` — engine architecture (gates §C.1–C.2).
- `24-FORMULA-REGISTRY.md` — per-score citations (gate §C.4).
- `25-MDR-READINESS.md` — regulatory posture (gates §D).
- `26-DEPLOYMENT-RUNBOOK.md` — deploy procedure (gates §A.2, A.4, A.8).
- `27-INCIDENT-RESPONSE.md` — playbook (gates §E.1, E.4).
- `28-TESTING-STRATEGY.md` — test posture.
- `29-CHANGELOG-CLINICAL.md` — engine evolution log.
- `30-RISK-REGISTER.md` — consolidated residual-risk view.
