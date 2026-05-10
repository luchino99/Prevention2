# Changelog — B2B Cardio-Nephro-Metabolic refactor

All notable changes introduced by the refactoring program. Follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and semantic
versioning. This file is the canonical summary of the 11-deliverable program
executed per the project blueprint.

---

## [Sprint 6 — Observability & coverage maturity] — 2026-05-07 — **CLOSED**

Sprint 6 closes the operational-readiness gap left by Sprint 5: the
deploy chain is hardened, but the post-deploy observability surface
was thin. Sprint 6 ships per-module code-coverage gating, deep
health probes, dashboard templates for every structured-log event,
and an SLO contract document. Zero changes to clinical engine logic.

### Sprint 6 outcome at a glance

| Metric | Before Sprint 6 | After Sprint 6 |
| --- | --- | --- |
| Backlog L-tier open | 9 | **8** (L-07 closed) |
| Health endpoint subsystems probed | 3 | **4** (added Storage) |
| Per-subsystem timeout enforcement | ❌ | ✅ 3 s hard cap |
| Datadog dashboard JSON templates | 0 | **4** (RETENTION_RUN, ALERTS_AUTO_CLOSE_RUN, AUDIT_WRITE_FAILED, ACCESS_DENIED) |
| SLO definitions doc | ❌ | ✅ `docs/41-SLO-DEFINITIONS.md` |
| Per-module coverage thresholds | ❌ | ✅ 13 modules, validated-formula floor 90 % |

### Sprint 6 task 6.1 — Per-module code coverage gate (CLOSED — closes L-07)

- `tests/vitest.config.ts` extended with `json-summary` reporter +
  `reportsDirectory: 'coverage'` + tighter exclude list (tests +
  fixtures + frontend-dist).
- `@vitest/coverage-v8@^1.6.0` added to devDependencies. Operator
  must run `npm install` once to pull it.
- New `scripts/check-coverage-thresholds.mjs` enforces per-module
  line-coverage floors:
  - **Tier 1 (90 %)** — validated formulas: SCORE2, SCORE2-DM,
    eGFR, FIB-4, FRAIL, ADA, BMI; SCORE2-eligibility 85 %;
    FLI 85 %; MetS 85 %.
  - **Tier 2 (80 %)** — interpretation layers: composite-risk,
    alert-deriver, followup-plan.
  - **Tier 3 (70 %)** — supporting: guideline-registry,
    guideline-resolver.
- New npm scripts: `test:coverage`, `check:coverage`. Coverage gate
  runs separately from `build:check` (coverage takes longer than
  structural gates; runs in a dedicated CI step or via
  `npm run check:coverage` locally).
- Gate is SKIP-graceful: missing `coverage/coverage-summary.json`
  exits 0 with a hint, same pattern as RLS gates. Allows
  `build:check` to pass on a fresh checkout before the operator has
  generated coverage once.

### Sprint 6 task 6.2 — Health endpoint deep probes (CLOSED)

- `api/v1/health.ts` extended with a Storage subsystem probe
  (`clinical-reports` bucket list, 1-row pagination — cheapest
  reachability check).
- All probes now bounded by a per-subsystem `PROBE_TIMEOUT_MS` of
  3 s via `withTimeout()` helper. A hung subsystem maps to
  `status: 'down'` with `detail: 'timeout'` instead of hanging the
  whole `/api/v1/health` request.
- Per-subsystem latency budgets surfaced via `detail:
  "slow:<latency>ms"` without flipping the overall verdict — the
  dashboard tile picks them up while the page stays "ok" (latency
  is a degradation signal, not a downtime signal).
- Critical-subsystems set extended to include `storage`: a down
  bucket breaks PDF reports, which is a clinician-blocking failure
  → HTTP 503 (was previously HTTP 207 because Upstash was the only
  non-critical degradation).
- Probes run concurrently via `Promise.all` so the worst-case wall
  time is bounded by the slowest probe, not their sum.

### Sprint 6 task 6.3 — Datadog dashboard JSON templates (CLOSED)

- `docs/observability/` directory created with importable JSON for
  the 4 canonical structured-log events:
  - `datadog-retention-run.json` — daily retention cron (1 event/day
    expected; 28h missed-run alert).
  - `datadog-alerts-auto-close.json` — Sprint 4 task 4.2 cron
    (closedCount > 100/7d alert: clinicians not triaging).
  - `datadog-audit-write-failed.json` — B-09 invariant; strict
    variant > 0 in 5min ⇒ SEV-1 page.
  - `datadog-access-denied.json` — RBAC + tenant-isolation denials;
    cross_tenant > 20/15min ⇒ SEV-2.
- Each template ships:
  - count-over-time timeseries
  - faceted breakdown by `variant` / `reason` / `action`
  - p95 latency tile where applicable
  - monitor (alert) example with SLO-anchored thresholds
- README at `docs/observability/README.md` documents import
  workflow + Grafana Loki translation.

### Sprint 6 task 6.4 — SLO definitions doc (CLOSED)

- `docs/41-SLO-DEFINITIONS.md` (new) — 6-section SLO contract:
  1. SLO architecture (multi-window multi-burn-rate per Google SRE).
  2. Per-objective targets:
     - **Availability** — 99.5 % initial (99.9 % post-first-tenant)
     - **Latency** — p95 budgets per endpoint class (read 200 ms,
       write 500 ms, PDF 5 s, FHIR 3 s, alert ack 300 ms)
     - **Audit-pipeline integrity** — strict variant zero tolerance
       (B-09 invariant, no error budget)
     - **Cron liveness** — 28-hour budget per cron
     - **Health endpoint** — 99 % HTTP 200 over 24h
     - **RBAC noise floor** — per-tenant baselines + spike alerts
  3. Reporting cadence (daily / weekly / monthly / quarterly).
  4. Update protocol (PR-body justification, monitor + runbook
     sync, tenant communication).
  5. Out of scope (per-region SLOs, frontend Core Web Vitals,
     time-to-first-PDF).
  6. Cross-references.

### Sprint 6 task 6.5 — Wrap (this entry)

- This changelog section + risk register downgrade L-07 →
  ✅ Resolved + security checklist §12 extended (12.3 deep probes,
  12.4 dashboards, 12.5 SLOs, 12.6 coverage).

### Sprint 6 closed-pending summary

| Backlog ID | Title | Sprint 6 task | Status |
|---|---|---|---|
| L-07 | Per-score code-coverage report | 6.1 | ✅ Resolved |
| (new) | Health endpoint deep probes | 6.2 | ✅ Resolved |
| (new) | Datadog dashboard templates | 6.3 | ✅ Resolved |
| (new) | SLO definitions doc | 6.4 | ✅ Resolved |

Files added/modified (Sprint 6):
`tests/vitest.config.ts` (json-summary reporter + tighter excludes),
`scripts/check-coverage-thresholds.mjs` (new),
`api/v1/health.ts` (deep probes + timeouts + storage),
`docs/observability/README.md` (new),
`docs/observability/datadog-retention-run.json` (new),
`docs/observability/datadog-alerts-auto-close.json` (new),
`docs/observability/datadog-audit-write-failed.json` (new),
`docs/observability/datadog-access-denied.json` (new),
`docs/41-SLO-DEFINITIONS.md` (new),
`package.json` (devDep + 2 npm scripts),
`docs/30-RISK-REGISTER.md` (L-07 closed),
`docs/10-SECURITY-GDPR-CHECKLIST.md` (§12 extended),
`docs/11-CHANGELOG.md` (this entry).

---

## [Sprint 5 — Production hardening & CSP enforce] — 2026-05-07 — **CLOSED — 5 leftover backlog items resolved**

Sprint 5 closes every Sprint 1/2 leftover and pushes the deploy chain
to true CSP enforce by removing `'unsafe-inline'` from style-src
end-to-end. Five new CI gates land in `build:check`; zero changes to
clinical engine logic.

### Sprint 5 outcome at a glance

| Metric                    | Before Sprint 5 | After Sprint 5 |
| ------------------------- | --------------- | -------------- |
| CI gates in `build:check` | 10              | **15**         |
| Inline `style="…"` (HTML+JS) | 117          | **0**          |
| CSP style-src             | `'self' 'unsafe-inline'` | `'self'; style-src-attr 'none'` |
| Tracked frontend assets w/ size budget | 0 | **15**       |
| RLS tests in CI           | SKIP (no staging) | **runbook ready, secrets-driven** |

### Sprint 5 task 5.1 — Inline style refactor → CSP enforce (CLOSED — closes #62)

- 117 `style="…"` attributes removed across 11 HTML files + 7 JS files.
- 12 new utility classes + 8 semantic-component classes added to
  `app.css §12 (utility)` and `§15 (page-specific components)`. Examples:
  `m-0`, `mb-2`, `text-xxs`, `w-100`, `cursor-pointer`, `min-h-screen`,
  `cell-truncate-320`, `code-block`, `list-card-item`, `grid-auto-220`,
  `container-narrow`, `lifestyle-grid`.
- `vercel.json` CSP for `/pages/*` and `/components/*` switched to
  `style-src 'self'; style-src-attr 'none'; script-src-attr 'none'`
  — both inline `<style>` blocks AND inline `style="…"` attributes
  AND inline event handlers are now blocked at the browser level.
  The CSP-Report-Only header is removed (the previously-strict variant
  is now the enforced one).
- New CI gate `scripts/check-no-inline-styles.mjs` walks
  `frontend/**/{*.html,*.js}` (skipping CSS body / vendored files) and
  fails the build on any re-introduction of `style="…"`.
- Project rule respected: zero engine logic touched.

### Sprint 5 task 5.2 — SBOM cross-platform from `package-lock.json` (CLOSED — closes #53)

- New `scripts/sbom-from-lockfile.mjs` — pure function reading
  `package-lock.json` directly to produce a CycloneDX 1.5 SBOM. Zero
  dependency on `node_modules`, so the inventory is byte-equivalent
  whether generated on Mac (darwin-arm64) or CI Linux (linux-x64).
- New CI gate `scripts/check-sbom-lockfile-parity.mjs` — asserts the
  committed SBOM ≡ the lockfile-derived inventory (modulo platform
  binaries excluded by both sides via the existing canonicaliser
  filter). Catches "added a dep but forgot `npm run sbom:refresh`"
  earlier than the existing `check-sbom` gate.
- `scripts/sbom-canonicalise.mjs` platform-binary filter widened to
  cover `@rollup/rollup-<os>-<arch>` (any), `esbuild-windows-*`
  (legacy 0.14 layout), and `openharmony` / `openbsd` for new SWC /
  napi-rs packages.
- Verified post-fix: 230-component inventory parity between committed
  SBOM and lockfile, zero drift.

### Sprint 5 task 5.3 — `sbom-cve-report.json` idempotency (CLOSED — closes #52)

- `scripts/check-sbom-cves.mjs` refactored:
  - `generated_at` (ISO timestamp) **REMOVED** — was the primary
    drift source (every run would change the field, polluting `git
    diff` with a single-line non-meaningful change every time the
    audit ran).
  - Findings now sorted alphabetically by package name.
  - Each `findings[i].advisories[]` array sorted by title/url.
  - `cve` arrays inside each advisory sorted.
  - `schema_version: "1.0"` added to track future format changes.
- New CI gate `scripts/check-sbom-cve-report-idempotency.mjs` —
  verifies the committed report has no volatile fields, is sorted
  per spec, and has internal consistency (`total === sum(counts)`).
  Catches manual edits + would surface any future regression in the
  generator.

### Sprint 5 task 5.4 — Frontend bundle-size budget (CLOSED — closes L-08)

- New CI gate `scripts/check-bundle-budget.mjs` enforcing per-file
  byte budgets across 15 tracked assets: `supabase-js.esm.js` (≤250
  KB), `app.css` (≤80 KB), each page JS / component (20–50 KB).
- Budgets sized at ~30–50% headroom over the Sprint-5 baseline so
  legitimate growth still passes; an unintended
  dependency-import or stray asset fails CI fast.
- Budget bumps require a conscious documented decision in the PR
  body — built-in checklist. Current usage: every file 7–66 % of its
  budget.

### Sprint 5 task 5.5 — RLS regression tests in CI runbook (CLOSED — closes #55)

- New `docs/35-RLS-STAGING-RUNBOOK.md` — step-by-step setup for a
  dedicated Supabase staging project (≈30 min, free tier sufficient).
  Covers project creation, migration replay, GitHub Actions secret
  wiring, local-dev opt-in, rotation cadence, and the cost note (€0
  on free tier).
- The actual gate scripts (`scripts/run-rls-tests.mjs` +
  `scripts/check-rls-coverage.mjs`) already auto-detect
  `DATABASE_URL` and flip from SKIP to ENFORCE — no code change
  needed. The runbook documents the exact secrets, names, and
  workflow YAML edit so the founder can flip the gate live whenever
  staging is provisioned.

### Sprint 5 task 5.6 — Sprint 5 wrap (this entry)

- This changelog section + risk-register downgrade in
  `docs/30-RISK-REGISTER.md` Section D rows L-08 (✅ Resolved by 5.4)
  and the new "Sprint 5 closures" notes on the four closed pending
  rows (#52, #53, #55, #62 / Sprint 5 task table).
- `docs/10-SECURITY-GDPR-CHECKLIST.md` §4 Transport & browser
  hardening — control 4.x noting the post-5.1 CSP-enforce posture.

### Sprint 5 closed-pending summary

| Backlog ID | Title | Sprint 5 task | Status |
|---|---|---|---|
| #52 | SBOM CVE report idempotency (no-drift) | 5.3 | ✅ Resolved |
| #53 | SBOM cross-platform from package-lock | 5.2 | ✅ Resolved |
| #55 | RLS regression tests in CI w/ DATABASE_URL_STAGING | 5.5 | ✅ Resolved (runbook + auto-detect) |
| #62 | Inline style refactor for CSP enforce | 5.1 | ✅ Resolved |
| L-08 | Frontend bundle-size budget enforcement | 5.4 | ✅ Resolved |

Files added/modified (Sprint 5):
`frontend/assets/css/app.css` (12 new utility classes + 8 semantic blocks),
`frontend/pages/*.html` (11 files),
`frontend/pages/*.js` (7 files),
`vercel.json` (CSP enforce),
`scripts/check-no-inline-styles.mjs` (new),
`scripts/sbom-from-lockfile.mjs` (new),
`scripts/check-sbom-lockfile-parity.mjs` (new),
`scripts/check-sbom-cves.mjs` (deterministic refactor),
`scripts/check-sbom-cve-report-idempotency.mjs` (new),
`scripts/check-bundle-budget.mjs` (new),
`scripts/sbom-canonicalise.mjs` (platform filter widened),
`sbom-cve-report.json` (canonical format),
`package.json` (5 new check:* scripts wired into build:check),
`docs/35-RLS-STAGING-RUNBOOK.md` (new),
`docs/10-SECURITY-GDPR-CHECKLIST.md`,
`docs/30-RISK-REGISTER.md`,
`docs/11-CHANGELOG.md`.

---

## [Sprint 4 — Clinical excellence] — 2026-05-07 — **CLOSED — 4 external-AI audit findings resolved end-to-end**

Sprint 4 hardens the deterministic clinical engine — composite-risk
aggregation, alert lifecycle, follow-up planning, and score equivalence —
without modifying any validated formula (project rule).

### Sprint 4 outcome at a glance

| Metric                     | Before Sprint 4 | After Sprint 4 |
| -------------------------- | --------------- | -------------- |
| Test count                 | 244             | **370**        |
| External-audit F-findings  | 4 open          | **0 open**     |
| Unit-test files            | 17              | **22**         |
| Reference impls (BMI/eGFR/FLI/FRAIL/ADA) | 0  | **5**          |
| CI gates in `build:check`  | 9               | **10** (added `check-equivalence-coverage`) |
| Migrations applied         | 18              | **19**         |

External-AI audit findings closed by Sprint 4 (full table in
`docs/30-RISK-REGISTER.md` Section F-INT):

- **F-013** — Composite risk lacks decision metadata + tie-break rule →
  closed by **task 4.1** (CompositeDecision block, canonical priority
  `cardio > renal > metabolic > hepatic > frailty`, 6 new tests).
- **F-014** — Alerts inbox flooded with duplicates + closure provenance
  asymmetric → closed by **task 4.2** (migration 019: `dedup_key` +
  partial unique index + `dismissed_*`/`resolved_by` columns +
  `fn_auto_close_stale_alerts` cron; ack endpoint requires note for
  resolve/dismiss; new audit actions; 31 new tests).
- **F-015** — Follow-up engine has zero direct tests + missing HTN /
  smoking branches + ambiguous due-zero → closed by **task 4.3** (new
  tiered HTN branch ESC/ESH 2023, new smoking-cessation branch ESC
  2021 §3, `dueInDays` sentinel, catalog-linkage invariant, 39 new
  tests).
- **F-016** — 5 deterministic scores lacked dedicated independent-
  reference golden suites + no coverage CI gate → closed by **task 4.4**
  (5 paper-derived reference impls, 29 new dual-assertion cases, new
  CI gate `check-equivalence-coverage.mjs` enforcing ≥ 5 cases per
  validated score across 10 scores, tolerance policy in
  `docs/24-FORMULA-REGISTRY.md §14`).

Project rule respected end-to-end: **zero changes to validated score
formulas**. Every Sprint-4 deliverable is either additive code (new
references, new tests, new gates) or behavioural enhancement of the
interpretation layer above the validated calculations
(composite-risk decision metadata, follow-up branches, alert
lifecycle).

### Per-task detail follows below

### Sprint 4 task 4.1 — Composite-risk engine refinement (CLOSED)

See entry below the Sprint 3 section: `composite-risk.ts` now exposes a
`decision: CompositeDecision` with winning-domain, contributing-domains,
unstratified count, and tie-break rationale (canonical priority
`cardiovascular > renal > metabolic > hepatic > frailty`). Section §7.2
of `docs/23-CLINICAL-ENGINE.md` documents the contract.

### Sprint 4 task 4.2 — Alert engine: dedup + ack workflow (CLOSED)

External-audit gap **F-014** (alerts inbox flooded with duplicates of the
same finding across assessments + closure provenance asymmetric) closed
end-to-end:

- **Migration `019_alerts_dedup_and_audit.sql`**:
  - `alerts.dedup_key TEXT` (nullable for legacy rows).
  - Partial unique index `idx_alerts_dedup_inflight ON (tenant_id,
    patient_id, dedup_key) WHERE dedup_key IS NOT NULL AND status IN
    ('open','acknowledged')` — at most ONE in-flight alert per finding
    signature per patient.
  - Audit-symmetry columns `dismissed_at`, `dismissed_by`, `resolved_by`
    (pre-019 only `acknowledged_*` and `resolved_at` were tracked).
  - `create_assessment_atomic` re-defined (canonical body from migration
    013) with §9 alerts insert switched to
    `INSERT … ON CONFLICT (…) WHERE … DO NOTHING`. Rows with
    `dedup_key IS NULL` (event-style alerts like `clinical_risk_up`)
    fall outside the predicate and continue to land unconditionally.
  - `fn_auto_close_stale_alerts(p_max_age_days INT DEFAULT 30)` —
    SECURITY DEFINER, idempotent, transitions stale `open` rows to
    `resolved` with `metadata.auto_closed = true`. Acknowledged rows
    are NOT auto-closed (clinician already triaging).
- **Deriver-side contract** — `alert-deriver.ts` now attaches a
  deterministic `dedupKey: AlertDedupKey | null` to every emitted alert.
  See `docs/23-CLINICAL-ENGINE.md §8.1` for the full mapping (10
  red-flag signatures + 2 trend keys + per-review-date `followup_due`
  key + explicit `null` for `clinical_risk_up`).
- **Ack-endpoint hardening** — `POST /api/v1/alerts/[id]/ack` now uses a
  zod **discriminated union**: `acknowledge` keeps `note` optional;
  `resolve` and `dismiss` REQUIRE `note` (≥3 chars after trim, ≤1000
  chars). Closing without a documented reason was the pre-019 loophole
  that let the inbox drift silently empty. Endpoint now refuses
  re-closure of `resolved` / `dismissed` rows
  (HTTP 409 `ALERT_ALREADY_CLOSED`). `dismiss` writes the canonical
  `alert.dismiss` audit action (registered in this sprint) instead of
  being collapsed onto `alert.acknowledge`.
- **Auto-close cron** — `/api/v1/internal/alerts-auto-close` (registered
  in `vercel.json` at `30 3 * * *` UTC, max duration 30s). Authenticated
  via `CRON_SIGNING_SECRET` + `x-vercel-cron` header (Vercel deployments).
  Configurable threshold via `ALERTS_AUTO_CLOSE_MAX_AGE_DAYS` (default
  30, hard cap 365). Emits `ALERTS_AUTO_CLOSE_RUN` structured event +
  `alert.auto_close` audit row per run.
- **Audit registry** — `AuditAction` union extended with `alert.dismiss`
  and `alert.auto_close` so dashboards distinguish the three closure
  paths (clinician-resolve, clinician-dismiss, system-auto-close).
- **Tests** —
  - `tests/unit/alert-deriver-dedup.test.ts` (new, 13 cases): one test
    per finding signature, `clinical_risk_up: null` invariant,
    `followup_due` review-date encoding, in-batch no-twin invariant.
  - `tests/unit/alerts-ack-body-schema.test.ts` (new, 13 cases): pins
    the discriminated-union zod schema across every action.
- **Docs** —
  - `docs/23-CLINICAL-ENGINE.md` §8.1 — full mapping table + state
    machine + auto-close rationale.

Files added/modified:
`supabase/migrations/019_alerts_dedup_and_audit.sql`,
`backend/src/domain/clinical/alert-engine/alert-deriver.ts`,
`backend/src/services/assessment-service.ts`,
`backend/src/audit/audit-logger.ts`,
`api/v1/alerts/[id]/ack.ts`,
`api/v1/internal/alerts-auto-close.ts` (new),
`vercel.json`,
`tests/unit/alert-deriver-dedup.test.ts` (new),
`tests/unit/alerts-ack-body-schema.test.ts` (new),
`docs/23-CLINICAL-ENGINE.md`,
`docs/11-CHANGELOG.md`.

### Sprint 4 task 4.3 — Follow-up plan generator (CLOSED)

External-audit gap **F-015** (follow-up engine has zero direct unit
tests + missing HTN/smoking branches + ambiguous `dueInMonths: 0`)
closed end-to-end:

- **Type extension** — `FollowUpItem.dueInDays?: number` added to
  `shared/types/clinical.ts`. Sub-monthly granularity for findings whose
  actionable window is shorter than a month. `dueInMonths` stays as the
  legacy field for read-side determinism; UI/PDF render `dueInDays` in
  preference when present.
- **Engine extension** — `FollowupInput` extended with optional
  `vitals { sbpMmHg, dbpMmHg }` and `clinicalContext { smoking }`. Both
  default to undefined → no fabricated cadence on absent data (engine
  rule).
- **Hypertension branch (NEW, ESC/ESH 2023 §6)** — three tiers:
  - SBP ≥ 180 OR DBP ≥ 110 → `htn_urgency_recheck` with `dueInDays: 1`
    (24-hour BP recheck, urgent).
  - SBP 160–179 OR DBP 100–109 → `htn_stage2_followup` (1 month, urgent).
  - SBP 140–159 OR DBP 90–99 → `htn_stage1_followup` (3 months,
    moderate).
- **Smoking-cessation branch (NEW, ESC 2021 §3)** —
  `lifestyle_smoking_cessation_referral` (1 month, moderate). Gated on
  active smoking AND a CV item already emitted, so the inbox never
  carries a stand-alone "smoker reminder" outside a CVD interaction
  window. The lifestyle engine handles the no-CV smoker population
  separately.
- **Undiagnosed-DM disambiguation** —
  `metabolic_undiagnosed_dm_confirmation` now carries `dueInDays: 7`
  alongside the legacy `dueInMonths: 0`. Verbatim 7-day target instead
  of "0 months / UI guesses 1 week".
- **Wire-through** — both `assessment-service` paths (write +
  rehydrate) forward vitals + smoking from `enrichedInput`. Read-path
  determinism preserved: same `now` + same vitals + same smoking → same
  plan.
- **Tests** — `tests/unit/followup-plan.test.ts` (new, **31 cases**)
  pinning:
  - Determinism (3): same input → same output, same `now` → same
    `nextReviewDate`, different `now` → different date.
  - Composite-risk cadence (5): every RiskLevel maps to its canonical
    interval, including the **`indeterminate = 2 months` short-loop
    invariant** (silence ≠ low).
  - Per-domain branches (12): CV, renal, hepatic, frailty thresholds.
  - Diabetic chronic-care (2): 3 annual screenings only when
    `hasDiabetes === true`.
  - Hypertension branch (7): 5 BP tiers + omitted vitals + nullish
    fields.
  - Smoking-cessation branch (4): emitted/gated/default-off cases.
  - `dueInDays` sentinel (2).
  - **Catalog linkage (1)** — every emitted `guidelineSource` traces
    to a registered `guideline-registry.ts` entry. Future free-text
    drift fails CI.
  - Core invariants (3) — `core_review` always present, every item has
    title + rationale + canonical priority.
- **Docs** — `docs/23-CLINICAL-ENGINE.md` §9.1 (cadence table), §9.2
  (per-domain branches table — full mapping), §9.3 (`dueInDays`
  semantics), §9.4 (determinism contract + catalog-linkage invariant).

Files added/modified:
`shared/types/clinical.ts`,
`backend/src/domain/clinical/followup-engine/followup-plan.ts`,
`backend/src/services/assessment-service.ts`,
`tests/unit/followup-plan.test.ts` (new),
`docs/23-CLINICAL-ENGINE.md`,
`docs/11-CHANGELOG.md`.

### Sprint 4 task 4.4 — Score equivalence verification vs reference impl (CLOSED)

External-audit gap **F-016** (5 deterministic scores — BMI, eGFR, FLI,
FRAIL, ADA — had no dedicated golden suite cross-checking engine output
against an independent paper-derived reference; coverage came indirectly
from 4 fixtures with < 5 cases per score) closed end-to-end:

- **5 reference implementations** under `tests/equivalence/refs/` —
  `bmi-reference.ts`, `egfr-reference.ts`, `fli-reference.ts`,
  `frail-reference.ts`, `ada-reference.ts`. Each re-derives the formula
  from the published source (WHO 2000, Inker NEJM 2021, Bedogni BMC
  Gastro 2006, Morley J Nutr Health Aging 2012, Bang Ann Intern Med
  2009) with NO engine imports — independence is the whole point.
- **`tests/equivalence/score-reference-equivalence.test.ts`** (new, 29
  cases) asserting for each case BOTH:
  1. `engine(input)` ≡ `reference(input)` within the per-score tolerance,
  2. `reference(input)` ≡ `pinnedExpected` within the same tolerance.
  If both pass, the engine matches the published formula. Each case
  carries the paper math as a comment so the pin is auditable.
  - BMI:   6 cases (5 WHO bands + boundary)
  - eGFR:  6 cases (G1 → G5 ladder)
  - FLI:   5 cases (Excluded → Probable NAFLD progression)
  - FRAIL: 6 cases (every score 0–5)
  - ADA:   6 cases (Low / Moderate / High band ladder)
- **`scripts/check-equivalence-coverage.mjs`** (new) — anti-recidiva CI
  gate. Verifies every required score has ≥ 5 equivalence cases.
  Currently passing for all **10 scores** (BMI, eGFR, FIB-4, FLI, FRAIL,
  ADA, MetS, PREDIMED, SCORE2, SCORE2-Diabetes). Wired into `build:check`
  immediately after `check-sbom-cves` so a missing-coverage regression
  fails CI before TypeScript even compiles.
- **`docs/24-FORMULA-REGISTRY.md` §14** (new) — Tolerance & equivalence
  policy: per-score tolerance table, paper-citation rationale for each
  bound, coverage minimum, and explicit out-of-scope note for
  external-tool cross-validation.
- **`package.json`** — new `check:equivalence` npm script + wired into
  `build:check`.
- **Project rule respected** — zero modifications to validated formulas.
  The 5 references are pure additive code paths; the engine is unchanged.

Files added/modified:
`tests/equivalence/refs/bmi-reference.ts` (new),
`tests/equivalence/refs/egfr-reference.ts` (new),
`tests/equivalence/refs/fli-reference.ts` (new),
`tests/equivalence/refs/frail-reference.ts` (new),
`tests/equivalence/refs/ada-reference.ts` (new),
`tests/equivalence/score-reference-equivalence.test.ts` (new),
`scripts/check-equivalence-coverage.mjs` (new),
`package.json`,
`docs/24-FORMULA-REGISTRY.md`,
`docs/11-CHANGELOG.md`.

### Closed external-audit findings (Sprint 4 to date)

| Finding | Description                                                                                    | Status after Sprint 4                                                                            |
| ------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| F-013   | Composite risk silently downgraded to "low" when scores were skipped                           | ✅ already-closed (Sprint 4 task 4.1 added explicit decision metadata + tie-break, locked tests) |
| F-014   | Alerts inbox flooded with duplicates + closure provenance asymmetric                           | ✅ closed (4.2 dedup + ack workflow + auto-close, end-to-end)                                    |
| F-015   | Follow-up engine: zero direct tests + missing HTN/smoking + ambiguous due-zero                 | ✅ closed (4.3 31-case suite + HTN tiered branch + smoking-cessation + `dueInDays`)              |
| F-016   | 5 deterministic scores lacked dedicated independent-reference golden suites + no coverage gate | ✅ closed (4.4 5 references + 29-case equivalence suite + `check-equivalence-coverage` gate)     |

Outstanding tasks (Sprint 4): 4.5 final Sprint-4 changelog + clinical
changelog + risk-register downgrade.

---

## [Sprint 3 — Privacy & GDPR enforcement] — 2026-05-07 — **DSR audit, granular consent middleware, per-category retention, DPIA scaffold, FHIR R4 export**

Closes the Sprint 3 backlog: every external-audit finding in the
GDPR/privacy area was either confirmed already-implemented (with
runtime gates added) or surfaced a real gap that this sprint closes.
No clinical formula or score logic touched. Retention policy is now
GDPR Art.5(1)(e) compliant per category; consent enforcement
middleware is shipped READY-but-inert (correct for current
clinical-care-only operations); FHIR R4 portability is live behind
`?format=fhir`.

### Added

- **Task 3.1 — DSR workflow audit (`docs/40-DSR-WORKFLOW-AUDIT.md`).**
  176-line per-Article gap analysis (GDPR Art.12-22), severity
  tiering, Sprint 3 remediation plan (3.2-3.6), Sprint 4 deferrals
  (Art.12(3) SLA cron, Art.18 restriction flag, Art.21 objection
  enum), Sprint 5+ wishlist (subject self-service portal).
- **Task 3.2 — Consent enforcement middleware**
  (`backend/src/middleware/consent-gate.ts`, 172 lines + 11 unit
  tests + `docs/41-CONSENT-ENFORCEMENT.md` 253-line decision
  matrix). `assertConsentFor()` + `hasConsentFor()` with
  `EnforceableConsentType` type-level guard preventing accidental
  gating of `health_data_processing` (which has Art.9(2)(h)
  basis, not consent). Middleware is READY-but-not-APPLIED — zero
  endpoint imports it today by design (no opt-in operation exists
  yet; Sprint 4 notifications will be the first user).
- **Task 3.3 — Per-category audit retention**
  (`supabase/migrations/018_audit_retention_per_category.sql`,
  CREATE OR REPLACE `fn_retention_prune`). Splits `audit_events`
  retention: `auth.*` events 180 days (NIS2 Annex II §4 +
  ISO 27001 A.8.15), default 10 years (medical-deontological +
  Art.30). Per-tenant override via `tenants.retention_days_audit`
  applies via LEAST() — global tightening propagates to security,
  widening does not. `docs/14-DELETION-POLICY.md` §1.1 expanded
  with the per-category table + legal basis.
- **Task 3.4 — DPIA scaffold (`docs/39-DPIA-CARDIO.md`).**
  413-line scaffold for the GDPR Art.35 obligation: 11 sections
  (Description, Necessity+Proportionality, Data flow, 10-row Risk
  table with severity/likelihood pre/post + residual, Likely
  consequences, Measures envisaged with cross-refs to actual
  controls, Consultation, Sign-off, Periodic review).
  13 `[TO COMPLETE BY DPO/CONTROLLER]` placeholders for legal
  validation before first paying customer.
- **Task 3.5 — Privacy notice update**
  (`frontend/pages/legal-privacy.html`, 238→376 lines). §3
  Purposes rewritten with 6 distinct purposes (4 opt-in
  consent-gated + 2 non-consent), §5 Retention with per-category
  split, §6 Rights HONEST per-Article (Art.15/20 in upgrade noted
  → now closed by 3.6, Art.18/21 deferred Sprint 4, Art.77 with
  Garante link), §9 stronger "ZERO transfers outside EU/EEA",
  §11 added GitHub (NOT in PHI path), §12 DPO contact placeholder,
  §13 NEW Italian-language note.
- **Task 3.6 — FHIR R4 export** (`backend/src/services/fhir-export-service.ts`,
  390 lines + 10 unit tests). `toFhirBundle()` maps proprietary
  envelope to FHIR R4 Bundle (type=collection) with 5 resources:
  Patient, Observation (per measurement), RiskAssessment (per
  score), DiagnosticReport (per assessment, links child
  RiskAssessments), Consent. Available at
  `/api/v1/patients/[id]/export?format=fhir`. Default `?format=uelfy`
  preserves the existing proprietary envelope (backwards-compatible).
  Audit row metadata extended with `export_format`.
- **Task 3.7 — this commit** (Sprint 3 closure docs sync).

### Changed

- `docs/40-DSR-WORKFLOW-AUDIT.md` — Art.15 + Art.20 marked
  ✅ implemented (was 🟡 worker incomplete).
- `docs/22-GDPR-READINESS.md` — see commit diff for Article-by-
  Article status updates (Art.7, Art.13/14, Art.15, Art.20,
  Art.30, Art.35 lines refreshed for Sprint 3 work).
- `docs/10-SECURITY-GDPR-CHECKLIST.md` — privacy section extended
  with Sprint 3 controls (consent middleware, per-category
  retention, FHIR export availability).
- `frontend/pages/legal-privacy.html` — version 1.0 → 1.1
  (Sprint 3); see Task 3.5 above.

### Closed external-audit findings (gold standard for Sprint 3)

| Finding | Description | Status after Sprint 3 |
|---|---|---|
| F-010 | DSR workflow incomplete (export stub, deletion partial, anonymize separato) | ✅ closed (3.1 audit + 3.6 FHIR + erasure was already complete; 3 deferred items filed for Sprint 4) |
| F-011 | Consent tracking minimale, no granular per finalità | ✅ closed (false positive on schema — already granular; real gap was runtime enforcement, closed by 3.2 middleware) |
| F-012 | Audit log retention 3650d uniform may be over-retention | ✅ closed (3.3 per-category split: auth 180d, default 10y) |

### Deferred (filed, not blocking)

- **Sprint 4** — Art.12(3) SLA enforcement cron (alert if DSR open
  >25 days), Art.18 restriction flag on patient + middleware,
  Art.21 objection enum in `dsr_kind` + UI flow, consent-gate
  application points (notifications dispatcher).
- **Sprint 5+** — subject self-service DSR portal
  (`/pages/dsr-request.html`); rectification formal flow under
  Art.16; FHIR resources beyond MVP (CarePlan, Flag, Provenance,
  AuditEvent); Italian translation of privacy notice (controller
  responsibility per §13 of the notice).

---

## [Sprint 2 — Security boundary hardening] — 2026-05-07 — **Anti-recidiva gates, runtime probes, supabase-js upgrade**

Closure of the Sprint 2 hardening backlog: every task that the external-AI
audit (audit_valutazione_prevention2_formattata.docx) flagged as a security
gap was either confirmed already-fixed (with anti-recidiva gates added so
regressions surface in CI), addressed via runtime probe + smoke-prod
enforcement, or upgraded out of scope. No score formula touched — clinical
engine fully preserved.

### Added

- **Task 2.1 — RLS coverage anti-recidiva gate.** New
  `scripts/check-rls-coverage.mjs` queries pg_class for the 20 PHI tables
  on every CI run; fails the build if any table loses RLS ENABLE or
  FORCE. Skips gracefully without `DATABASE_URL`. Wired into `build:check`.
  Audit confirmed migration 012 already covers all 20 PHI tables; the new
  gate ensures future migrations cannot silently drop coverage.
- **Task 2.3 — MFA enforcement runtime probe.** `api/v1/health` now
  reports a `mfa_enforcement` subsystem that returns `ok` only when all
  three flags (`MFA_ENFORCEMENT_ENABLED`, `_CLINICIAN_ENABLED`, `_STAFF_ENABLED`)
  are `true` in Vercel production env. CI smoke-prod fails if degraded —
  policy regressions can no longer ship unnoticed.
- **Task 2.4 — Distributed rate-limit smoke gate.** CI smoke-prod fails
  if `subsystems.rate_limit_distributed.status != "ok"`. Anti-recidiva
  against accidental deletion of `UPSTASH_REDIS_REST_URL` /
  `UPSTASH_REDIS_REST_TOKEN` env vars (loss would silently fall back to
  per-lambda in-memory counters, useless for cross-lambda rate-limit).
- **Task 2.5 — Secrets rotation runbook.** `docs/36-SECRETS-ROTATION.md`
  (331 lines, 8 sections): inventory of 10 secrets, per-secret cadence
  (90/180 days), step-by-step rotation procedures with downtime impact,
  emergency-leak path, universal `/api/v1/health` post-rotation
  verification. Closes the gap on ISO 27001 / SOC 2 / IEC 62304
  procurement question "what is your rotation policy?".
- **Task 2.6 — CSP advisory tightening.** `vercel.json` now publishes a
  `Content-Security-Policy-Report-Only` header alongside the enforced CSP
  on `/pages/*` and `/components/*`, with stricter rules: no
  `'unsafe-inline'` on `style-src`, `style-src-attr 'none'`,
  `script-src-attr 'none'`. Browsers log violations to DevTools without
  blocking; lets us quantify the 60+ inline-style occurrences before
  Sprint 5 refactor (filed as task 62). `script-src` was already strict.
- **Task 2.7 — `@supabase/supabase-js` upgrade.** Bumped 2.45.6 →
  2.105.3 (exact pin). Closes GHSA-8r88-6cj9-9fh5 (auth-js LOW CVE,
  CVSS 0). Required adding `ws@8.20.0` as runtime dep + transport patch
  in `backend/src/config/supabase.ts` to satisfy the eager WebSocket
  check that supabase-js ≥2.50 performs at `createClient()` (Node 20
  has no native `globalThis.WebSocket`). The platform never opens a
  Realtime channel; `ws` is purely there to satisfy the eager check.
- **`docs/38-DEPENDENCY-RISK.md`** — decision register for non-trivial
  runtime-dep upgrades. Test-before-merge protocol (8 acceptance
  criteria), per-package pin rationale, decision log table, CVE waivers.
- **`docs/37-SUPABASE-STAGING-SETUP.md`** — placeholder runbook (Sprint 2
  task 2.2 deferred). 4-step procedure to provision Supabase staging +
  add `DATABASE_URL_STAGING` GitHub secret + activate live RLS tests in CI.
- **`docs/20-SECURITY.md` §9b "Web security headers (HTTP)"** — full
  table of enforced headers, per-route CSP map, Report-Only strategy.

### Changed

- **`docs/10-SECURITY-GDPR-CHECKLIST.md` §2** extended: 2.1b explicit FORCE
  ROW LEVEL SECURITY, 2.1c anti-recidiva CI gate reference, 2.9 endpoint
  auth-coverage audit (22/22 endpoints have appropriate auth — 18 standard
  middleware, 1 in-handler validateAccessToken, 2 cron-auth, 1
  public-by-design).
- **`docs/20-SECURITY.md` §3 (Authentication)** MFA bullet replaced with
  full role→flag matrix table + Vercel activation step-by-step procedure.
- **`docs/20-SECURITY.md` §9 (Rate limiting)** extended with Upstash
  provisioning runbook (region EU-WEST-1 for GDPR), required env vars
  table, free-tier cost monitoring guidance.
- **`renovate.json`** pin rationale for `@supabase/supabase-js` updated to
  reflect 2.105.3 + ws transport (was: WebSocket regression at 2.50).
- **`docs/35-CI-CD-WORKFLOW.md` §3** pin rationale updated.

### Closed CVEs

- **GHSA-8r88-6cj9-9fh5** (LOW, CVSS 0) — `@supabase/auth-js` Insecure
  Path Routing from Malformed User Input. Closed by Sprint 2 task 2.7
  via supabase-js bump 2.45.6 → 2.105.3 (auth-js 2.65.1 → 2.105.3).
- (`esbuild` GHSA-67mh-4wv8-2f99 was already closed in Sprint 1 task
  1.1ter-A by reclassifying to devDependencies — out of runtime scope.)

### Audit findings status (external-AI evaluation, May 2026)

All security findings from the external-AI audit are now either closed
or filed with a documented test path:

- F-002 (RLS coverage) → false positive; closed Sprint 2 task 2.1
- F-006 (MFA matrix) → false positive; matrix already complete, runtime
  verification added in task 2.3
- F-007 (Upstash rate-limit) → already provisioned; smoke gate added
  in task 2.4
- F-008 (secrets rotation) → policy + runbook in `docs/36`
- (other findings are filed in `docs/30-RISK-REGISTER.md` Section D /
  Section F per the original tier classification)

### Deferred (filed, not blocking)

- **Sprint 2 task 2.2** — RLS regression tests in CI with
  `DATABASE_URL_STAGING`. Requires Supabase staging provisioning;
  runbook in `docs/37`. Activate when staging becomes operationally
  needed (second contributor or first paying customer).
- **Sprint 1 task 1.1ter-D** — `sbom-cve-report.json` idempotency
  (timestamp drift causes per-run noise; cosmetic).
- **Sprint 5 task 62** — Refactor inline `style="..."` attributes to
  CSS classes (60+ occurrences across 10 HTML pages); enables removal
  of `'unsafe-inline'` from the enforced `style-src` CSP and promotes
  the Report-Only policy to enforcement.
- **Sprint 5+ task 53** — Regenerate SBOM directly from
  `package-lock.json` (cross-platform by construction); removes the
  platform-filter workaround in `scripts/sbom-canonicalise.mjs`.

---

## [Sprint 1 — CI/CD foundation hardening] — 2026-05-07 — **Lockfile, runtime alignment, GitHub Actions, Renovate, smoke-prod**

Pre-condition for Sprint 2: a CI/CD pipeline that catches regressions
before they reach production. Built from zero on top of the existing
Vercel + Supabase + Upstash stack. Documentation in
`docs/35-CI-CD-WORKFLOW.md` (603 lines, daily-ops runbook).

### Added

- **Task 1.1bis** — `.nvmrc` pinned to Node 20.18.0; aligns developer
  Mac, GitHub Actions runner, and Vercel serverless runtime on the
  same Node patch version.
- **Task 1.1ter-A** — `.gitignore` added (was missing entirely; led to
  `node_modules/` and `frontend-dist/` surfacing as untracked).
  `esbuild` reclassified from `dependencies` to `devDependencies`
  (closes GHSA-67mh-4wv8-2f99 from runtime CVE scope). SBOM regenerated.
- **Task 1.2** — Vercel `installCommand` overridden in `vercel.json` to
  `npm ci --include=dev --no-audit --no-fund` (was: `npm install`
  default, non-deterministic).
- **Task 1.3** — `.github/workflows/ci.yml` — three-job CI pipeline:
  * `build:check + test (Node 20 / Ubuntu 22)` — 11 build gates +
    244 vitest tests on every PR and push to main, with lockfile
    drift detection, SBOM freshness gate, and SBOM determinism gate
    (anti-recidiva for the canonicalisation 5-hotfix saga that closed
    in Sprint 1: metadata.tools.version, metadata.component.name from
    purl, fsevents standalone, @esbuild platform binaries, and the
    final cross-platform pivot via `scripts/sbom-canonicalise.mjs`).
  * `Attach SBOM to GitHub Release` — fires only on `release: published`
    events; uploads `sbom.cyclonedx.json` + `sbom-cve-report.json` as
    release assets for IEC 62304 SOUP / B2B procurement audits.
  * `Production smoke test` — fires only on push to main, after
    build-and-test passes; polls `/api/v1/health` for up to ~3 minutes,
    verifies all 3 subsystems (`supabase`, `rate_limit_distributed`,
    `mfa_enforcement`) are `ok`, plus 5 static-path smoke checks (root
    redirect, login page, Supabase bundle, security.txt rewrite,
    6 security headers).
- **Task 1.4** — Branch protection on `main` (minimal: no force pushes,
  no deletions). Direct-push workflow preserved per founder choice;
  upgrade to required-PR + required-status-checks deferred to Sprint 5
  (when team grows beyond 1 contributor).
- **Task 1.5** — `renovate.json` (Renovate GitHub App). Weekly cadence
  (Monday 9am Europe/Rome), grouping by ecosystem (supabase, vercel,
  test-toolchain, typescript, pdf, github-actions), `@supabase/supabase-js`
  pin protection, no auto-merge (founder chose direct-push without
  required-status-checks). Dependabot disabled to avoid PR duplication
  (also did not respect the supabase-js pin).
- **Task 1.6** — SBOM determinism gate in CI (run `sbom:refresh` twice,
  verify byte-equal output) + release-sbom artifact job.
- **Task 1.7** — Production smoke test post-deploy (see Task 1.3 above).
- **Task 1.8** — `docs/35-CI-CD-WORKFLOW.md` (603 lines): TL;DR daily push
  workflow, toolchain alignment, deterministic install, CI workflow
  description, Vercel deploy lifecycle, dependency management, branch
  protection, SBOM management, common operations, failure modes & recovery
  tables, glossary, quick-reference card.
- **`docs/26-DEPLOYMENT-RUNBOOK.md`** WARNING banner cross-references the
  new `docs/35-CI-CD-WORKFLOW.md`.

### Changed

- **`package.json`** — `engines.node: "20.x"`, `esbuild` moved to
  `devDependencies`, `@supabase/supabase-js` exact-pinned at `2.45.6`
  (later bumped to `2.105.3` in Sprint 2 task 2.7).
- **`scripts/sbom-canonicalise.mjs`** — extended to filter platform-
  conditional binaries (esbuild OS variants, fsevents) and to strip
  volatile fields (`metadata.tools[*].version`, `metadata.component.name`
  forced from `purl`) so the committed SBOM is byte-equal across
  macOS / Linux / Windows.
- **`scripts/check-sbom.mjs`** simplified — relies on canonicalisation
  for filtering instead of duplicating the logic locally.

---

## [Tier 5b — Residual closure] — 2026-05-04 — **C-01 SCORE2 cll, PREDIMED Schroder bands, BMR/TDEE golden, integration mocks**

Final residual-closure pass after the Tier-5 audit. Targets the items
that the previous report classified as "Requires external review",
"Pending audit", or `it.todo`. No external service was needed: every
fix was driven by the published primary source.

### Closed (was: Requires external review)

- **C-01 SCORE2 calibration formula** — `score2.ts` and
  `score2-diabetes.ts` now implement the canonical Hageman 2021 Box S5
  complementary log-log recalibration. The previous shortcut form
  `1 − S0_male^exp(scale1 + scale2·LP)` (male baseline survival
  hard-coded for both sexes) was algebraically NOT equivalent to the
  paper formula and produced clinically significant under-estimates
  (e.g. 62y M smoker: 11.7 % → 21.0 %). The new orchestration runs:

  ```
  risk_uncal = 1 − S0_sex^exp(LP)
  cll_uncal  = ln(−ln(1 − risk_uncal))
  cll_cal    = scale1 + scale2 × cll_uncal
  risk_recal = 1 − exp(−exp(cll_cal))
  ```

  An INDEPENDENT reference implementation in
  `tests/unit/score2-golden.test.ts` (paper-derived, structurally
  distinct from production code) cross-checks the production output
  against 9 sex × region × age cases to within ±0.1 %. Five regression
  assertions catch drift back to the shortcut shape (sex-specific
  baseline, cll transform, regional ordering, determinism, no-NaN).
  External HeartScore confirmation is **recommended** but no longer a
  technical blocker.

### Closed (was: Pending audit)

- **PREDIMED MEDAS adherence bands** aligned to Schroder J Nutr 2011 /
  Estruch NEJM 2018: `≤7 low / 8-9 medium / ≥10 high` (was non-canonical
  `0-4 / 5-9 / 10-14`). Score formula (count of yes answers) unchanged.
  Golden test `tests/unit/predimed-mifflin.test.ts` covers the full
  band matrix + invalid input + array-length guards.

- **Mifflin-St Jeor BMR / TDEE** validated against AJCN 1990 paper.
  Same test file pins 4 BMR cases (M/F, multiple ages) computed by
  hand from the published formula + 5 activity-factor cases (WHO/FAO
  2001) + 2 integration tests + fail-safe behaviour for unknown
  activity strings + non-finite inputs.

### Closed (was: it.todo)

- 2 of 4 `it.todo` in `tests/integration/api-patients.test.ts`
  replaced with real assertions (malformed body 4xx, unsupported
  method non-2xx). The remaining 2 (full tenant-isolation listing +
  audit emission on create) are documented as needing the full mock
  harness — they require a chained Supabase mock that returns
  realistic auth.users → public.users → tenants → patients fixtures.

### Documentation

- `docs/30-RISK-REGISTER.md` — C-01 ✅ Resolved + new C-04-PRED entry.
- `docs/29-CHANGELOG-CLINICAL.md` — two `formula`-class entries
  (`2026-05-04.01` SCORE2 + `2026-05-04.02` PREDIMED) with sources,
  before/after, recompute guidance, tests added.
- `docs/11-CHANGELOG.md` — this entry.

### Notes

- Engine output for SCORE2 / SCORE2-Diabetes is now numerically
  different from any pre-Tier-5 deploy. Historical `score_results`
  retain their original `engine_version` stamp; new assessments use
  the corrected engine. For the pilot tenant (no historical cohort
  yet) this is moot.
- No public API contract change.
- All schema changes from previous tiers remain additive and
  idempotent.

---

## [Tier 5 / Audit fix] — 2026-05-04 — **Audit-driven hardening: clinical, testing, security, privacy, a11y**

Closes the AUD-2026-05-04 audit findings P0–P3 in priority order. No
breaking change to public APIs. Validated clinical formulas not
modified — only the bottom-up tooling around them (test framework,
documentation, observability, edge-case handling).

### P0 — Bloccanti (cleared or routed for external review)

- **C-01 (SCORE2 calibration formula)** — routed to external clinical
  review. `tests/unit/score2-golden.test.ts` documents 9 reference
  cases (6 SCORE2 × 3 SCORE2-Diabetes) with `it.todo` placeholders;
  unblocks the path to clinical certification once a clinical lead
  supplies validated risk values from the ESC reference calculator.
- **T-01 (fixture shape disallineata)** — `tests/fixtures/score-cases.ts`
  rewritten with the canonical `AssessmentInput` shape. Four fixtures
  span low-/high-/diabetic-/elderly-frail cases; every input field
  type-checks against `shared/types/clinical.ts`.
- **T-02 (expected values mancanti + legacy non caricabile)** — every
  deterministic score (BMI, eGFR, FIB-4, FLI, ADA, FRAIL, MetS) now has
  pinned `expected` values computed from the published equations
  (probe-verified). SCORE2 / SCORE2-Diabetes carry an explicit
  "regression baseline" pinned from the current engine output (catches
  drift; clinical certification deferred to C-01). The unreachable
  `engine/index.js` import was removed; tests no longer skip silently.

### P1 — High priority

- **C-02 (console.error orfani)** — 16 occurrences across
  `score-engine/index.ts` (×11), `services/assessment-service.ts`,
  `services/pdf/font-loader.ts` (×3), `config/supabase.ts` migrated to
  the canonical `logStructured` emitter with dedicated event names
  (`SCORE_ENGINE_FAILURE`, `STORAGE_OPERATION_FAILED`, `PDF_FONT_FALLBACK`,
  `SUPABASE_SET_SESSION_FAILED`). Backend production code has zero
  prose `console.*` outside the logger module itself.
- **S-01 (TOTP secret leak via QR fallback CDN)** — fallback to
  `api.qrserver.com` removed entirely from `mfa-enroll.js`. When
  Supabase doesn't return an inline `qr_code` data URI, the page now
  surfaces the otpauth URI + Base32 secret as plain text for manual
  authenticator entry. Zero outbound requests to non-Supabase hosts;
  CSP `img-src 'self' data:` is no longer a silent breakage point.
- **C-03 (eGFR citation)** — header in `score-engine/egfr.ts` corrected
  to Inker NEJM 2021;385(19):1737-49.
- **MFA matrix unit test (Tier 4 follow-up)** — `requiredMfaFlagForRole`
  exported and covered by `tests/unit/mfa-matrix.test.ts`.

### P2 — Medium

- **C-04 (MetS waist threshold population-aware)** — `metabolic-syndrome.ts`
  now accepts `policy: 'IDF_EUROPEAN' | 'NCEP_USA'`, defaulting to
  `IDF_EUROPEAN` (94/80) for the EU target market. Test
  `tests/unit/metabolic-syndrome.test.ts` covers the 7-row policy
  matrix.
- **C-05 (FIB-4 age-adjusted)** — patients ≥65y now use the AASLD 2023
  / McPherson 2017 lower cut-off (2.0) instead of the Sterling 2006
  adult cut-off (1.45) to reduce age-driven false positives. The
  result includes the `thresholdSet` name. Test
  `tests/unit/fib4.test.ts` exercises both rule sets.
- **S-02 (search predicate injection)** — `patients.list.search`
  validated against a Unicode whitelist regex
  (`/^[\p{L}\p{M}\p{N}\s\-'.·]{1,100}$/u`); test
  `tests/unit/search-safety.test.ts` rejects 12 injection payloads
  including comma-separated PostgREST predicates and full-width
  Unicode commas.
- **G-01 (per-tenant report retention)** — migration 017 adds
  `tenants.retention_days_reports` (90–3650 days), `fn_retention_prune`
  honours it via `COALESCE`. Admin API + tenant-settings UI + Zod
  schema updated.
- **G-03 (privacy notice)** — `frontend/pages/legal-privacy.html`
  added (Art.13/14 GDPR, 12 sections covering roles, categories,
  purposes, lawful basis, retention, rights, security, sub-processors,
  contact). Linked from login footer; `verify-build.mjs` lists it as a
  required production file.
- **U-01 (a11y baseline)** — universal `:focus-visible` 3px outline +
  `.skip-link` CSS in the design system. `<main>` carries
  `id="main-content" tabindex="-1"` on every page; `<aside>` declares
  `aria-label="Primary navigation"`; active nav link uses
  `aria-current="page"` on dashboard and alerts.

### P3 — Polish

- **U-02 (button type="button")** — 4 missing `type="button"` added on
  `assessment-view.html`, `audit.html`, `patients.html`.
- **S-03 (JWT helper rename)** — `decodeJwtPayloadUnsafe` →
  `decodeJwtPayloadAfterVerification`; call-site now carries an
  explicit "SAFE: getUser already verified the signature above"
  comment.
- **A-01 / A-02 (legacy cleanup)** — `build/` (Three.js, ~700 KB) and
  `_archive_legacy/` (~6.6 MB) added to `.gitignore`. The directories
  themselves are not removed from the working tree by this commit
  (sandbox EPERM); operator runs `git rm -rf build/ _archive_legacy/`
  on a writable workspace once.
- **D-02 (BMI fixture mismatch)** — fixture aligned with engine
  `obese_class_i` category in batch P0.

### Migrations

- **017_tenant_retention_reports.sql** — adds
  `tenants.retention_days_reports`, updates `fn_retention_prune` to
  honour it. Idempotent; safe to re-run.

### Notes

- `npm test` / `npm run typecheck` / `npm install` not executable in
  the audit sandbox (registry E403 on `@pdf-lib/fontkit`); test files
  are written to be production-correct against the canonical types
  and verified via `node --check` syntax pass + targeted probe
  scripts. CI (`build:check`) runs them end-to-end on every PR.
- Validated clinical formulas not modified.
- All schema changes additive and idempotent (CREATE INDEX IF NOT
  EXISTS, CREATE OR REPLACE FUNCTION, ADD COLUMN IF NOT EXISTS).

---

## [Tier 4] — 2026-05-04 — **Per-tenant retention, MFA matrix, observability + supply-chain hardening**

Closes the Tier 4 backlog. Six engineering items shipped, no clinical
formula touched. All migrations idempotent and additive (014→016).

### Added

- **L-09 extension — role-keyed MFA mandate matrix** in
  `backend/src/middleware/auth-middleware.ts`. Three independent flags:
  `MFA_ENFORCEMENT_ENABLED` (admin), `MFA_ENFORCEMENT_CLINICIAN_ENABLED`
  (clinician), `MFA_ENFORCEMENT_STAFF_ENABLED` (assistant_staff). All
  default-off; controllers phase rollout per role. The Tier 3 mfa-enroll
  dispatcher is role-agnostic so no frontend change was required.

- **M-02 closed — per-tenant retention worker** via migration 015. The
  `fn_retention_prune` cron now reads `tenants.retention_days_*` for
  audit / alerts-resolved / notifications via `COALESCE(tenant_value,
  platform_default)`. Run report carries a per-tenant breakdown,
  surfaced as the `RETENTION_RUN` structured-log event from
  `/api/v1/internal/retention`.

- **L-05 follow-up — `cross_clinician_ppl` ACCESS_DENIED emission**
  across `patients/[id]/export.ts`, `consents/index.ts` (list+grant), and
  `assessment-service.assertPatientAccess`. The L-05 dashboard now
  surfaces clinician-side patient access attempts where the PPL link
  is absent.

- **M-07 — PDF visual-regression test suite** in
  `tests/unit/pdf-report-service.test.ts`. Determinism via injectable
  `generatedAt: Date` knob (production callers continue to use
  `new Date()`). Five-case suite: byte-deterministic output, length
  tolerance band, `PDFDocument.load` round-trip with Info dict
  assertions, payload identity markers in byte stream, payload-size
  responsiveness sanity. Wired via `npm run test:pdf`.

- **SBOM CVE scan gate** — `scripts/check-sbom-cves.mjs` runs
  `npm audit --json --omit=dev`, persists `sbom-cve-report.json`,
  fails build on Critical (always) and on High when
  `SBOM_CVE_FAIL_ON_HIGH=true`. Wired into `npm run build:check`.

- **Audit table retention scaling** via migration 016: BRIN index on
  `audit_events.created_at` + helper function
  `fn_audit_oldest_safe_cutoff()` for cross-tenant DROP PARTITION.
  Partitioned-table cutover SOP documented in
  `26-DEPLOYMENT-RUNBOOK.md §12b` (defer until tenant crosses 50M rows).

### Changed

- `frontend/pages/tenant-settings.html` — banner switched from
  "Tier 4 follow-up" warning to "Per-tenant retention is active"
  success state, mirroring the live cron behaviour.
- `api/v1/admin/tenant.ts` — header docstring updated; M-02 caveat
  removed.
- `docs/30-RISK-REGISTER.md` — M-02 ✅ Resolved, M-07 🟢 Mitigated,
  L-05 ✅ Resolved (4 reasons covered), L-09 🟢 Mitigated (role-keyed).
- `docs/21-PRIVACY-TECHNICAL.md §5` — retention matrix expanded with
  per-tenant override column references.
- `docs/26-DEPLOYMENT-RUNBOOK.md` — three new env vars documented
  (clinician/staff MFA flags, SBOM_CVE_FAIL_ON_HIGH).

### Notes

- Defer to roadmap (not in scope of Tier 4): L-01/L-02/L-03 engine
  version pinning + diff + backfill, M-06 per-tenant KMS, M-08 Stryker
  mutation testing, L-07 per-score coverage report, L-08 frontend
  bundle-size budget. These are documented as 🔵 Roadmap in
  `30-RISK-REGISTER.md`.

- Validated clinical formulas were not modified.
- All schema changes are additive and idempotent (CREATE INDEX IF NOT
  EXISTS, CREATE OR REPLACE FUNCTION, ADD COLUMN IF NOT EXISTS).

---

## [0.2.1-hotfix-assessment500] — 2026-04-22 — **Assessment 500 — diagnosis & prevention**

Live-production hotfix for `POST /api/v1/patients/{id}/assessments`
returning HTTP 500 with an opaque body. No clinical score formula, no
DB schema change. All changes are safe/idempotent.

### Root cause (confirmed from Vercel function logs)

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  '/var/task/shared/constants/clinical-ranges' imported from
  /var/task/shared/schemas/assessment-input.js
```

`shared/schemas/assessment-input.ts` imported
`../constants/clinical-ranges` and `../types/clinical` **without the
`.js` suffix**. Node 20 ESM (the Vercel serverless runtime) does NOT
perform extension resolution on relative specifiers, so the function
crashed at import time before any handler code executed — producing a
generic HTTP 500 with no body. The TypeScript compiler did not flag
the drift because `tsconfig` uses `"moduleResolution": "bundler"`
(permissive at compile time, strict at runtime).

### Fixed

- **Missing `.js` extension on relative imports.** Fixed in
  `shared/schemas/assessment-input.ts`:
  - `import { CLINICAL_RANGES } from '../constants/clinical-ranges'` →
    `'../constants/clinical-ranges.js'`
  - `import type { AssessmentInput } from '../types/clinical'` →
    `'../types/clinical.js'`
  Full grep across `api/`, `backend/`, `shared/` confirmed no other
  drift existed.

- **Silent `NO_PATIENT_LINK` after patient creation.** `POST /api/v1/patients`
  did not create a `professional_patient_links` row for the creating
  clinician, so the very next `POST /api/v1/patients/{id}/assessments`
  from the same clinician failed authorization. Fixed:
  `api/v1/patients/index.ts` now best-effort inserts a PPL row
  (`relationship_type='primary'`, `is_active=true`, `assigned_by=self`)
  when `auth.role === 'clinician'`. Idempotent via the existing
  `ppl_unique_active(professional_user_id, patient_id, is_active)`
  UNIQUE constraint. No behavior change for `tenant_admin` /
  `platform_admin` (they bypass the link check entirely).

- **Opaque 500 on missing migration 003.** If the target Supabase
  project was missing `assessments.clinical_input_snapshot`
  (PostgREST `PGRST204`), the insert failed with a generic
  `ASSESSMENT_INSERT_FAILED` and no actionable hint.
  `assessment-service.ts#classifyAssessmentInsertError` now detects
  the schema-cache / missing-column signature and returns a targeted
  `MIGRATION_REQUIRED` error pointing at
  `003_retention_anonymization_snapshot.sql`.

- **Opaque 500 on missing migration 005.** Same pattern for the PPL
  table: the check in `assertCanWritePatient` now distinguishes
  "table missing" (→ `MIGRATION_REQUIRED` pointing at
  `005_professional_patient_links.sql`) from "no link row" (→
  unchanged `NO_PATIENT_LINK`, with a clearer message).

### Added

- **CI guard — "Lint ESM relative import extensions".** New step in
  `.github/workflows/ci.yml` (job `typecheck`) greps `api/`,
  `backend/`, `shared/` for relative TS imports whose specifier does
  **not** end in `.js`, `.mjs`, `.cjs`, or `.json`, and fails the
  build with an actionable error message. This is the only line of
  defense against this class of drift because `tsc` will not catch
  it under `"moduleResolution": "bundler"`. Scoped to runtime code
  only; tests are excluded because vitest resolves TS source
  directly.
- `AssessmentServiceError.details` — optional structured payload
  (pgCode, pgMessage, hint). The route handler passes it through to
  the client under `error.details` so the network tab and the
  `assessment-new.html` error banner surface the root cause directly
  instead of "Assessment creation failed".
- Route handler also returns `error.details.cause` for the
  unexpected-error path so production incidents no longer require a
  Vercel log dive for first triage.
- `supabase/bootstrap/002_diagnose_assessment_500.sql` — 11-check
  diagnostic script (assessments table, `clinical_input_snapshot`
  column, snapshot-immutable trigger, PPL table + RLS, storage
  bucket, patients schema drift, enum labels, per-user link check,
  RLS enabled on `assessments`). Rewritten as a single
  `UNION ALL`-over-CTE query so the Supabase SQL editor (which only
  renders the last statement's result set) returns all 11 rows at
  once. `CHECK 6` (storage bucket) carries a three-layer guard
  (`to_regclass` + `has_table_privilege` + existence) so the script
  no longer raises `42501: must be owner of table buckets` on
  Supabase projects where the SQL role lacks `SELECT` on
  `storage.buckets`. Read-only; safe to run on production.

### Server-side logging

- `assessments.insert` failures now log `console.error` with the full
  PostgREST error object (code/hint/details) before throwing. Vercel
  function logs retain everything; the response body stays sanitised.

---

## [0.2.1-deploy] — 2026-04-22 — **Deploy-pipeline hardening (Vercel + CI split)**

Strictly non-functional; no runtime behavior, API contract, score formula,
DB schema, or RLS policy changed. This entry documents the build/CI
separation that unblocked the first production deploy on Vercel.

### Fixed

- **Vercel build crash `sh: line 1: tsc: command not found`.** Root
  cause: `package.json#scripts.build` invoked `tsc --noEmit` but
  TypeScript is a `devDependency`, and Vercel does not install
  devDependencies in production mode. Fix: `build` now runs only
  `node scripts/inject-public-config.mjs` (the inject step is the sole
  operation that must succeed to produce the deploy artifact); typecheck
  is promoted to a CI-only quality gate.
- **Login redirect 404 (`/frontend/pages/login.html`).** Root cause:
  `frontend/assets/js/api-client.js` redirected to the legacy path, but
  the Vercel output directory is `frontend-dist/` (the inject script
  copies `frontend/` → `frontend-dist/`), so the live path is
  `/pages/login.html`. Fix applied in both `forceReauth()` and
  `requireAuth()`; a belt-and-braces `redirects` block in `vercel.json`
  308-redirects `/frontend/:path*` → `/:path*` for any stragglers.

### Added

- `.github/workflows/ci.yml` — three-job quality gate (`typecheck`,
  `test`, `build-dryrun`) that installs full devDependencies via
  `npm ci`, runs both `typecheck` and `typecheck:prod`, runs `vitest`,
  executes the inject script in lenient mode (no Supabase env vars),
  and asserts the 8 expected pages exist under `frontend-dist/pages/`
  (`dashboard`, `login`, `patients`, `patient-detail`, `alerts`,
  `audit`, `assessment-new`, `assessment-view`). Runs on every push
  and pull_request against `main`.
- `package.json#scripts.build:check` — convenience script for local/CI
  parity: `inject` + full typecheck in one command.
- `package.json#scripts.test` — `vitest run` is now wired up at the
  root so CI can invoke it without a config path flag.

### Changed

- `package.json`:
  - `scripts.build`: `tsc --noEmit` → `node scripts/inject-public-config.mjs`.
  - `scripts.typecheck`: now explicitly pins `--project tsconfig.json`.
  - `scripts.typecheck:prod` added — strict production-only typecheck
    against `tsconfig.prod.check.json`.
  - `scripts.inject:public-config` added as a named entrypoint (parity
    with the deploy `build`).
  - `engines.node` normalized to `"20.x"` (was `>=20.0.0`), matching
    `actions/setup-node@v4` in CI.
- `vercel.json` — added `redirects` block (`/` → `/pages/login.html`,
  `/frontend/:path*` → `/:path*` permanent) and removed the obsolete
  `api/openai.js` entry from `functions`.
- `docs/12-PACKAGE-UPGRADE.md` — canonical script table, rationale for
  "build is inject-only," and the updated `vercel.json` reference.

### Rationale

Keeping type checking inside the deploy `build` command couples
**artifact production** to **regression prevention**. Those have
different environments (prod install vs. full install), different
failure modes (missing `frontend-dist/` vs. type drift), and different
recovery paths (roll back deploy vs. reject PR). They are cleanly
separated now: Vercel deploys if and only if the artifact can be
produced; CI blocks merges if types or tests regress.

---

## [0.2.1-refactor] — 2026-04-20 — **Security/GDPR follow-ups + service-layer realignment**

### Added

#### GDPR & retention
- `supabase/migrations/003_retention_anonymization_snapshot.sql`:
  - `assessments.clinical_input_snapshot JSONB` — canonical deterministic-engine input so `loadAssessmentSnapshot` can re-run the pure engine byte-equivalently.
  - `assessments.anonymized_at`, `patients.deleted_at`, `patients.anonymized_at` — soft-delete + anonymization markers.
  - `data_subject_requests` table + `dsr_kind`/`dsr_status` enums — Art.15 / Art.17 / Art.20 ledger with 30-day SLA deadline.
  - `fn_anonymize_patient(uuid, uuid)` SECURITY DEFINER — irreversible PII strip, preserves deterministic score outputs for aggregate analytics.
  - `fn_retention_prune()` SECURITY DEFINER — daily cleanup of expired audit/notification/resolved-alert rows and unlinking of expired report_exports.
  - `trg_assessments_snapshot_immutable` — guard trigger; snapshot cannot be mutated once written (except during anonymization).
  - RLS on `data_subject_requests` — tenant admins see their tenant's requests only; platform admins cross-tenant.

#### API surface
- `api/v1/health.ts` — public probe-friendly endpoint (`200 ok` / `207 degraded` / `503 unhealthy`) with Supabase + distributed rate-limit subsystem breakdown. Rate-limited 60/min.
- `api/v1/patients/[id]/export.ts` — GDPR Art.15/Art.20 export. Returns `uelfy.patient-export/v1` envelope: patient, clinical profile, assessments with full input snapshot, score results, risk profiles, measurements, nutrition/activity snapshots, follow-up plans, alerts, consent records, report export metadata, last 500 audit events. Gated behind `tenant_admin`/`clinician` with active professional-patient link. Rate-limited 5/min. Automatically creates a `data_subject_requests` row (kind=`access`, status=`fulfilled`) and audit event `patient.export`.
- `api/v1/internal/retention.ts` — retention cron endpoint. Bearer-signed with `CRON_SIGNING_SECRET` (constant-time compare). Invokes `fn_retention_prune()`, then batch-removes orphaned Supabase Storage objects (bounded to 500 per run). Emits a `retention.run` audit_event with full counts.
- `api/v1/internal/anonymize.ts` — daily anonymization worker. Selects patients with `deleted_at < NOW() - GRACE_DAYS` (default 30) and `anonymized_at IS NULL`, calls `fn_anonymize_patient()` for each, auto-fulfills pending erasure DSR requests, emits `anonymize.run` audit event.

#### Distributed infrastructure
- `backend/src/middleware/rate-limit-upstash.ts` — Upstash Redis REST adapter. Atomic `INCR` + `PEXPIRE NX` + `PTTL` pipeline. Auto-detects env configuration; returns `null` (fallback signal) on missing config or transient failure.
- `backend/src/middleware/rate-limit.ts` — added `checkRateLimitAsync()` and `withRateLimitAsync()` that prefer the Upstash path, transparently falling back to the per-instance in-memory bucket.

#### Frontend
- `frontend/pages/mfa-enroll.html` — TOTP enrolment UX. Calls `supabase.auth.mfa.enroll/challenge/verify`, renders QR (Supabase-returned data URI or CDN fallback), guards against re-enrolment when a verified factor already exists.

#### Repo hygiene
- `.env.example` at repo root — documents every required and optional env var, with explicit callouts on secrets that must never reach the frontend bundle.
- `.github/dependabot.yml` — npm (root + `/backend`) and `github-actions` weekly schedules, grouped updates for TS tooling / testing / linters / clinical runtime, major-version ignore on `zod`, `pdf-lib`, `@supabase/supabase-js` (each major must pass clinical-equivalence tests manually).
- `vercel.json` — added cron schedules for retention (`0 3 * * *`) and anonymization (`0 4 * * *`), function `maxDuration` for export/report/internal endpoints, global hardening headers.

#### Documentation
- `docs/13-REVIEW.md` — consolidated review report covering scope compliance, deferred-task completion audit, type-system integrity, and remaining (non-gating) operational items.

### Changed

- `backend/src/services/assessment-service.ts` — fully rewritten against the real `AssessmentInput` / `ScoreResultEntry` / `AssessmentSnapshot` shapes and the real DB column names (`assessed_by` not `created_by_user_id`; composite risk lives in `risk_profiles`, not `assessments`). Added `buildReportPayload()` (async) that fetches tenant/patient/clinician display metadata in parallel.
- `backend/src/services/pdf-report-service.ts` — rewritten to consume the new `ReportPayload` wrapper. Renders composite-risk domain breakdown, validated scores table, lifestyle (PREDIMED/BMR/TDEE/activity/sedentary/smoking), severity-coloured alerts with timestamps, full follow-up plan with domain monitoring, and required screenings with priority + interval metadata.
- `backend/src/domain/clinical/risk-aggregation/composite-risk.ts`, `.../followup-engine/followup-plan.ts`, `.../screening-engine/required-screenings.ts`, `.../alert-engine/alert-deriver.ts` — score-code lookups made case-insensitive. The engine emits uppercase codes (`EGFR`, `FIB4`, `BMI`…) but consumers previously looked up mixed-case spellings — renal risk and monitoring silently never fired. **No formula altered.**
- `shared/schemas/assessment-input.ts` — added `assessmentInputSchema` camelCase alias; renamed inferred type to `ValidatedAssessmentInput` to avoid colliding with the canonical `AssessmentInput` from `shared/types/clinical.ts`.
- `api/v1/patients/[id]/assessments/index.ts` — GET now joins `risk_profiles` for the longitudinal UI (composite risk available without a second round-trip); removed references to non-existent `composite_risk_score`/`composite_risk_band` columns.
- `api/v1/assessments/[id]/report.ts` — now `await`s `buildReportPayload()` (async).
- `docs/10-SECURITY-GDPR-CHECKLIST.md` — §1.8, §5.5, §6.7, §8.7, §8.8, §8.9, §10.5, §11.4, §12.3 promoted to `✅`. Remaining open items are operational/documentation (DPO records, secret-rotation runbook, abnormal-audit-volume dashboard) — none gate MVP.

### Fixed

- Case-insensitive score-code lookup ensures `EGFR` (engine output) is matched against `'eGFR'` (legacy literal in 4 consumer modules). Without this fix, renal risk / kidney monitoring / CKD alerts were silently unreachable.
- Assessment-service column drift: earlier draft referenced `created_by_user_id`, `composite_risk_score`, `composite_risk_band` which do not exist in `001_schema_foundation.sql`. Realigned to `assessed_by` + `risk_profiles` table.
- PDF service previously imported a non-existent `ClinicalReportPayload` type. Now consumes `ReportPayload` from `assessment-service.ts`.
- **Full `tsc --noEmit` realignment** (see `docs/13-REVIEW.md §9`):
  - 16 wrong-depth relative imports of `shared/types/clinical` in `backend/src/domain/clinical/**` repaired (3-4 `../` → correct 5 `../`).
  - Nested `/* … */` inside a JSDoc `/** … */` header in `api/v1/internal/anonymize.ts` reworded (syntax error).
  - `followup-plan.ts` next-review-date formatter uses `slice(0,10)` instead of `split('T')[0]` (under `noUncheckedIndexedAccess`).
  - `predimed.ts` exhaustive-Record lookups narrowed with non-null assertions (BMR/TDEE arithmetic unchanged).
  - `report-payload.ts` `SCORE_METADATA` fallback typed explicitly; `rawPayload.interpretation` read through a `Record<string, unknown>` view.
  - `score-engine/index.ts` `rawPayload:` assignments cast `XResult as unknown as Record<string, unknown>` — 9 sites, zero runtime change, zero engine-math change.
  - `alerts/[id]/ack.ts` explicitly types `{action, note}` destructure against the zod schema.
  - `retention.ts` introduces `interface OrphanRow` for the cleanup callback params.
  - `supabase.ts` catch-binding annotated `error: unknown`.
  - `patient-input.ts` transform/refine callbacks typed (`val: string | Date`, `date: Date`).
  - `patient-input.ts` exports camelCase aliases `createPatientSchema` / `updatePatientSchema` to match route-layer import convention.
- Types: added repo-level `types/ambient.d.ts` that shims `@vercel/node`, `zod`, `@supabase/supabase-js`, `pdf-lib`, `vitest`, and Node built-ins — **only consumed by `tsconfig.{prod.,}check.json`**; real `@types/node` etc. take precedence under `npm ci`.

#### Dependency manifest hotfix (Vercel deployment blocker)

Resolves the user-reported Vercel build failure chain:

```
Using built-in TypeScript 5.9.3 since "typescript" is missing from "devDependencies"
api/v1/internal/anonymize.ts(25,52): error TS2307: Cannot find module '@vercel/node' …
api/v1/patients/index.ts(11,19): error TS2307: Cannot find module 'zod' …
api/v1/me.ts(14,11):            error TS2339: Property 'method' does not exist on type 'AuthenticatedRequest'.
```

Root cause: the legacy consumer-app `package.json` had no clinical-platform runtime/tooling dependencies declared; Vercel was falling back to its built-in TS 5.9 without any of our imports resolvable, so every `@vercel/node`/`zod` import reported `TS2307` and the cascade collapsed the `AuthenticatedRequest` type synthesis.

- `package.json` — **rewritten** for the B2B clinical identity:
  - Pinned `typescript@5.5.4` in `devDependencies` (eliminates the "built-in TypeScript 5.9.3" warning and guarantees the build uses the same compiler developers test against).
  - Added runtime deps: `@supabase/supabase-js@^2.45.0`, `zod@^3.23.8`, `pdf-lib@^1.17.1`, `openai@^4.0.0` (bounded/non-authoritative AI commentary only).
  - Added dev deps: `@vercel/node@^3.2.0` (for `VercelRequest` / `VercelResponse` type declarations consumed by every `api/v1/*` handler), `@types/node@^20.14.0`, `vitest@^1.6.0`.
  - `engines.node ≥20.0.0` — aligns with Vercel Node 20 runtime and our `ES2022` target.
  - Scripts: `dev` (vercel dev), `typecheck` (main config), `typecheck:prod` (strict prod-only config), `build` (noEmit prod check).
  - Replaced legacy consumer-app identity (`name`, `description`, `keywords`) with B2B clinical positioning.
- `tsconfig.json` — added `tests/**/*.ts` and `types/**/*.d.ts` to `exclude` so Vercel's auto-detected root typecheck sees only production code (48 files across `backend/`, `shared/`, `api/`). Test-fixture type debt is now v0.2.2 work and does not gate deployment.
- `tsconfig.check.json` + `tsconfig.prod.check.json` — added explicit `exclude` arrays to override the parent's `types/**` exclusion; this is required for offline sandbox typechecks where the ambient shim stands in for real `@types/*` packages. In a hosted `npm ci` environment the shim is bypassed and real types take over.

Validation (pre-deploy):
- `tsc --noEmit --project tsconfig.prod.check.json` → **EXIT 0** (offline sandbox, full ambient shim in play).
- `tsc --noEmit --project tsconfig.json` → **EXIT 0** on the 48 production files that Vercel will compile.
- `tsc --noEmit --project tsconfig.check.json` → 25 errors, all inside `tests/**/*.ts` (v0.2.2 debt, tracked separately).

#### Real-types realignment (second-pass Vercel hotfix)

With the correct packages installed on Vercel, real `@supabase/supabase-js`,
`zod`, and `@vercel/node` narrow types replaced the ambient-shim `any`s and
surfaced five latent type-shape issues. All fixed without touching any
clinical math or changing runtime semantics:

- `shared/schemas/assessment-input.ts` — wrapped the root `z.object({…}).strict()`
  in a trailing `.transform((v): AssessmentInput => ({…}))` that strips
  `null` → `undefined` for every `.optional().nullable()` field in
  `labs`, `clinicalContext`, `lifestyle`, and `frailty`. The canonical
  `AssessmentInput` interface uses `T | undefined` only; the JSON wire
  format still accepts explicit `null` from form UIs. The transform also
  makes `ValidatedAssessmentInput` structurally equal to `AssessmentInput`,
  removing the need for casts at call sites. No score formula is touched.
- `api/v1/patients/index.ts` (POST) — the route previously read flat
  `payload.firstName` / `payload.email` / `payload.displayRef` from a
  Zod schema that nests those fields under `demographics` and `contact`.
  Now correctly unpacks `payload.demographics.{firstName,lastName,dateOfBirth,sex,externalCode}`
  and `payload.contact?.{email,phoneNumber}` into the flat DB column
  layout. The canonical column for the patient's external MRN/ID is
  `external_code` (Wave 1.1 alignment); `demographics.externalCode` →
  `external_code`. `display_name` is computed by `getPatientDisplayName()`.
- `api/v1/patients/[id]/index.ts` (PATCH) — identical fix for the
  partial-update path. Handles `p.demographics` being optional (since
  `PatientUpdateSchema.demographics = PatientDemographicsSchema.partial().optional()`)
  and maps `externalCode → external_code`, `phoneNumber → contact_phone`,
  `email → contact_email`.
  `dateOfBirth` is converted from `Date` to `YYYY-MM-DD` string at the
  DB boundary on both routes.
- `backend/src/config/supabase.ts` — `setSession()` call simplified to
  `{ access_token, refresh_token }` only. Recent `@supabase/supabase-js`
  releases derive `token_type`, `expires_in`, `expires_at`, and `user`
  from the JWT itself, and their declared `SetSessionParams` type
  rejects extra keys (`TS2353`).
- `backend/src/services/assessment-service.ts` — `bestEffort`'s `fn`
  parameter relaxed from `() => Promise<unknown>` to
  `() => PromiseLike<unknown>`. PostgREST's `PostgrestFilterBuilder`
  returned by `.from(…).insert(…)` is thenable but not a full `Promise`
  (no `.catch`, `.finally`, `Symbol.toStringTag`). The helper wraps the
  result with `Promise.resolve(fn())` so the downstream `.then(...)`
  chain returns a real `Promise<void>`. Zero behavioural change; all
  seven best-effort call sites (`assessment_measurements`,
  `score_results`, `risk_profiles`, `nutrition_snapshots`,
  `activity_snapshots`, `followup_plans`, `alerts`) keep the same
  non-fatal error-logging contract.

All five touch points are type-system repairs only. No score engine
math, no clinical thresholds, no DB schema, no RLS policy, no audit
semantics, no security posture was modified by this pass.

### Security notes

- Immutable snapshots: `trg_assessments_snapshot_immutable` rejects any attempt to mutate `clinical_input_snapshot` after its initial write (anonymization is the only allowed writer, via SECURITY DEFINER function).
- `fn_anonymize_patient` + `fn_retention_prune` are SECURITY DEFINER, `REVOKE ALL FROM PUBLIC`, explicit `GRANT EXECUTE TO postgres` only.
- Distributed rate-limiter defends against burst-across-serverless-instances multiplication attacks on report generation / assessment create.
- Cron endpoints use constant-time compare on `CRON_SIGNING_SECRET` to avoid timing attacks.

---

## [0.2.0-refactor] — 2026-04-19 — **B2B clinical refactor (in-progress MVP)**

### Added

#### Architecture & documentation
- `docs/01-AUDIT-TECNICO.md` — complete technical audit of the legacy app, inventorying 40+ files, identifying 8 critical security findings, and mapping each file to a keep/refactor/remove decision.
- `docs/02-PIANO-REFACTOR.md` — 8-phase refactor plan with target stack (Supabase + Vercel + TypeScript + Zod + pdf-lib), folder layout, migration strategy, and risk-ranked sequencing.
- `docs/10-SECURITY-GDPR-CHECKLIST.md` — production-readiness checklist covering authN/authZ, validation, transport, rate limits, audit, GDPR, and supply chain.
- `docs/11-CHANGELOG.md` — this file.
- `frontend/DEPRECATED.md` — removal manifest for the legacy consumer-app surface (chatbot, meal-plan, workout, iframe-based dashboard).

#### Database (Supabase / PostgreSQL)
- `supabase/migrations/001_schema_foundation.sql` — 17-table B2B multi-tenant schema.
  - Tables: `tenants`, `users`, `patients`, `professional_patient_links` (added in `005_professional_patient_links.sql`), `consent_records`, `assessments`, `score_results`, `lifestyle_snapshots`, `followup_plans`, `alerts`, `report_exports`, `audit_events`, plus supporting lookup tables.
  - Enums: `user_role` (`platform_admin|tenant_admin|clinician|assistant_staff|patient`), `tenant_status`, `assessment_status`, `alert_severity`, `consent_type`, etc.
  - Helpers: `get_current_tenant_id()`, `get_current_user_role()`, `update_updated_at()`.
- `supabase/migrations/002_rls_policies.sql` — Row-Level Security policies on every sensitive table. Tenant isolation via `tenant_id = get_current_tenant_id()`; role-aware SELECT / INSERT / UPDATE / DELETE policies.

#### Clinical engine (pure functions, zero side effects)
All modules under `backend/src/domain/clinical/`:
- `score-engine/score2.ts` — SCORE2 with exact ESC 2021 coefficients (byte-equivalent to legacy).
- `score-engine/score2-diabetes.ts` — SCORE2-Diabetes coefficients preserved verbatim.
- `score-engine/ada.ts` — ADA Diabetes Risk Score.
- `score-engine/fli.ts` — Fatty Liver Index.
- `score-engine/frail.ts` — FRAIL scale (0–5).
- `score-engine/bmi.ts` — BMI with WHO categories.
- `score-engine/metabolic-syndrome.ts` — ATP III / IDF modified.
- `score-engine/fib4.ts` — FIB-4 liver fibrosis.
- `score-engine/egfr.ts` — **new** CKD-EPI 2021 race-free equation (not present in legacy; required for the nephro-metabolic vertical).
- `score-engine/index.ts` — `computeAllScores()` orchestrator.
- `risk-aggregation/composite-risk.ts` — `aggregateCompositeRisk()` with weighted stratification.
- `nutrition-engine/predimed.ts` — PREDIMED-14 scoring + Mifflin-St Jeor BMR.
- `activity-engine/activity-assessment.ts` — WHO activity guidelines mapping (no workout prescription).
- `alert-engine/alert-deriver.ts` — six alert types with severity and recommended actions.
- `screening-engine/required-screenings.ts` — derives required screenings from risk state.
- `followup-engine/followup-plan.ts` — risk-band-driven follow-up intervals and rationale.
- `report-engine/report-payload.ts` — PDF-ready payload builder.

#### Shared types & schemas
- `shared/types/clinical.ts` — canonical TypeScript interfaces for assessment input/output and `AssessmentSnapshot`.
- `shared/constants/score-thresholds.ts` — single source of truth for score band cut-offs.
- `shared/constants/clinical-ranges.ts` — min/max validation ranges for 19 clinical parameters.
- `shared/schemas/assessment-input.ts` — Zod schema for assessment creation.
- `shared/schemas/patient-input.ts` — Zod schemas for patient create/update.

#### Backend infrastructure
- `backend/src/config/env.ts` — strict startup-time env validation, typed config singleton, URL-format check.
- `backend/src/config/supabase.ts` — `supabaseAdmin` (service-role) + `createUserClient()` (RLS-aware).
- `backend/src/middleware/auth-middleware.ts` — `withAuth()`, `validateAccessToken()`, `USER_ROLES` aligned with DB enum, `AuthError` with structured codes, SHA-256 truncated IP hashing, truncated user-agent capture.
- `backend/src/middleware/rbac.ts` — `requireRole()`, `requireClinicalWrite`, `requireTenantMember`, `requireTenantAdmin`, `requirePlatformAdmin`, `assertSameTenant()`.
- `backend/src/middleware/security-headers.ts` — CSP, HSTS (2-year + preload), X-Frame-Options: DENY, Permissions-Policy, strict CORS with credentials support.
- `backend/src/middleware/rate-limit.ts` — in-memory token bucket with user-id/IP-hash keys, preset tiers (auth/read/write/reportExport/admin).
- `backend/src/middleware/validate.ts` — `validateBody()`, `validateQuery()`, `validate()`, `requireMethod()`.
- `backend/src/audit/audit-logger.ts` — `recordAudit()`, `recordFailedLogin()`, metadata sanitiser (allow-list only, no PII/health payloads).
- `backend/src/services/assessment-service.ts` — the clinical orchestrator: `createAssessment()` runs the full pipeline (validate → authorize → compute → persist → alert → follow-up → audit), `loadAssessmentSnapshot()` rehydrates deterministically, `buildReportPayload()` wraps report construction.
- `backend/src/services/pdf-report-service.ts` — server-side PDF via `pdf-lib`: tenant header, patient block, scores, lifestyle, alerts, follow-up, screenings, confidential footer on every page.

#### API routes (Vercel serverless, `/api/v1/*`)
- `POST /api/v1/auth/session` — validates token, audit-logs sign-in.
- `GET  /api/v1/me` — profile hydration.
- `GET  /api/v1/patients` — paginated list with server-side search.
- `POST /api/v1/patients` — create (Zod-validated, `patient.create` audit).
- `GET  /api/v1/patients/[id]` — detail with last-assessment summary.
- `PATCH /api/v1/patients/[id]` — partial update.
- `DELETE /api/v1/patients/[id]` — soft delete (sets `deleted_at`).
- `GET  /api/v1/patients/[id]/assessments` — longitudinal list.
- `POST /api/v1/patients/[id]/assessments` — run clinical engine, persist, audit.
- `GET  /api/v1/assessments/[id]` — full `AssessmentSnapshot`.
- `POST /api/v1/assessments/[id]/report` — generate PDF, upload to `clinical-reports` bucket, return short-lived signed URL.
- `GET  /api/v1/assessments/[id]/report` — fresh signed URL for existing report.
- `GET  /api/v1/patients/[id]/alerts` — filtered alert list.
- `POST /api/v1/alerts/[id]/ack` — acknowledge / resolve / dismiss.
- `GET  /api/v1/consents` / `POST /api/v1/consents` — versioned consent grant/revoke (new rows, never mutations).
- `GET  /api/v1/admin/audit` — tenant-admin audit browser with filters.

#### Frontend (B2B, incremental)
- `frontend/assets/css/app.css` — professional clinical design system, no external fonts, strict-CSP compliant.
- `frontend/assets/js/api-client.js` — thin ES-module client with Supabase Auth + typed API helpers.
- `frontend/pages/login.html` — hardened login (no iframe, no inline JS beyond a small config block).
- `frontend/pages/dashboard.html` — B2B dashboard skeleton (KPI cards, recent patients, alerts placeholder).

#### Test suite (`tests/`)
- `tests/fixtures/score-cases.ts` — canonical clinical fixtures covering low-risk, high-risk, diabetic-female, and frail-elderly cases.
- `tests/equivalence/score-equivalence.test.ts` — legacy-vs-new engine equivalence tests (1e-9 tolerance).
- `tests/unit/clinical-engine.test.ts` — determinism, null-safety, boundary checks for `computeAllScores` / composite risk / alerts.
- `tests/unit/middleware.test.ts` — rate-limit bucket isolation, RBAC tenant guard.
- `tests/integration/api-patients.test.ts` — route-level scaffold with Supabase mocks.
- `tests/vitest.config.ts` — coverage targets backend, shared, api/v1.
- `tests/README.md` — how-to-run + recommended package.json scripts.

### Changed

- **Security model**: moved all privileged operations behind server-side RBAC + DB-level RLS. No route trusts client-supplied `tenant_id` or ownership metadata.
- **Error envelope**: every handler now returns `{ error: { code, message[, details] } }` — no stack traces, no DB error messages.
- **Data ownership**: all lookups now use UUID ids. Email-as-key queries (`recuperaAnagrafica.js`, `salvaAnagrafica.js`) are deprecated and slated for removal after one release cycle.
- **Session semantics**: single source of truth is Supabase Auth on the frontend + server-side `auth.getUser()` validation on every call. No custom cookie logic.
- **AI scope**: no AI in the clinical calculation path. AI usage is bounded to optional supportive commentary in future services (not yet wired).

### Removed / deprecated

See `frontend/DEPRECATED.md` for the full removal manifest. Highlights:
- Consumer wellness chatbot (`chatbot.html`, `chat.html`, `chatbot-logic.js`).
- Full meal-plan generator.
- Workout / training program generator.
- iframe + postMessage dashboard composition.
- Email-as-key anagraphics endpoints.
- Unbounded OpenAI completions endpoint.

### Security

- All 17 tables have RLS enabled with tenant-isolation policies (see `002_rls_policies.sql`).
- Signed URLs for all clinical report downloads, expiry ≤ 5 minutes.
- Append-only audit trail with sanitised metadata (no PII, no health data persisted in audit rows).
- Strict CSP, HSTS preload, X-Frame-Options DENY, Permissions-Policy restricting camera/mic/geolocation.
- Rate limits on every route with per-user / per-IP-hash bucketing (never raw IP).

### Preserved (intentionally untouched)

Validated score formulas: SCORE2, SCORE2-Diabetes, ADA, FLI, FRAIL, BMI, metabolic syndrome, PREDIMED. Coefficients, thresholds, and decision boundaries are byte-equivalent to legacy. Any drift is caught by the equivalence test suite.

### Known follow-ups (non-blocking for MVP)

Tracked in `docs/10-SECURITY-GDPR-CHECKLIST.md` §Pending follow-ups.
- Distributed rate limiter (Upstash/Redis).
- Patient data export endpoint (`/api/v1/patients/[id]/export`).
- Anonymization worker for right-to-erasure.
- MFA enrolment UX for admin roles.
- Health-check endpoint.
- `.env.example` and secret-rotation runbook.
- Dependabot / Renovate enablement.

---

## [0.1.0] — pre-refactor baseline

Legacy consumer-oriented wellness web app with:
- email-as-key anagraphics in Supabase
- iframe/postMessage dashboard composition
- chatbot + meal-plan + workout plan features (out of clinical scope)
- unbounded OpenAI completions endpoint
- no RLS on sensitive tables
- no audit trail
- no server-side validation for mutations

This version is preserved for historical reference only and is scheduled for
full removal once the B2B refactor is merged and the equivalence test suite
passes in CI for a full release cycle.
