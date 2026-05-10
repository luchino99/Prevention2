# SLO Definitions — Uelfy Clinical

> **Stance.** Service-level objectives drive the operator's alerting
> contract. They sit downstream of the **deterministic clinical engine**
> (which has no error budget — formulas are exact) and quantify the
> *operational* surface: what counts as up, what counts as fast enough,
> what triggers a page.
>
> **Audience.** Founder/operator + first tenant DPA negotiation +
> notified-body / pen-test reviewers.
>
> **Companion.** Dashboards + monitors in `docs/observability/`,
> incident playbook in `docs/27-INCIDENT-RESPONSE.md`.

---

## 1. SLO architecture

We use a **Google-SRE multi-window multi-burn-rate** alerting strategy:

* **SLO target** — "what 'good' looks like in a quarter".
* **Error budget** — `(1 − SLO target) × <window>`. Burning the budget
  faster than expected means we are likely to miss the SLO this period
  → page.
* **Multi-window pages** — `14.4× burn over 1h` AND `6× burn over 6h`
  to balance precision (no spurious pages) vs reset (slow burn caught).

A single template:

| Severity | Condition | Action |
|---|---|---|
| **SEV-1** | Strict invariant breached (e.g. AUDIT_WRITE_FAILED variant=strict) | Page immediately |
| **SEV-2** | Burn rate × 14.4 over 1h (5% of 30-day budget in 1h) | Page |
| **SEV-3** | Burn rate × 6 over 6h (2% of 30-day budget in 6h) | Slack / on-call queue |
| **SEV-4** | Drift signal (e.g. cron missed once, retention coverage gap) | Daily review |

---

## 2. SLOs

### 2.1 Availability — `/api/v1/*` endpoints

| Metric | Target |
|---|---|
| **Successful response rate** (HTTP < 500) over rolling 30 days | **99.5 %** initial; **99.9 %** post-first-tenant |
| Window | 30-day rolling |
| Error budget | 0.5 % × 30 d = **3.6 hours/month** of 5xx responses |
| Source | Vercel Logs filtered by `status:>=500` |
| Excluded | 503 emitted by `/api/v1/health` itself when subsystems are degraded — that's operating as designed; counts only as observability signal |

**Burn-rate alerts** (for the 99.5 % target = 0.5 % budget):

* SEV-2 — 5xx rate > 7.2 % over 1h (14.4× burn ⇒ 5 % budget in 1h)
* SEV-3 — 5xx rate > 3.0 % over 6h (6× burn ⇒ 2 % budget in 6h)

### 2.2 Latency — clinical interaction surface

| Endpoint class | p95 budget | p99 budget |
|---|---|---|
| Reads (`GET /api/v1/*` collection + entity) | **200 ms** | 500 ms |
| Writes (`POST /api/v1/patients`, `POST /api/v1/assessments/*`) | **500 ms** | 1500 ms |
| PDF report (`POST /api/v1/assessments/[id]/report`) | **5 s** | 10 s |
| FHIR export (`GET /api/v1/patients/[id]/export?format=fhir`) | **3 s** | 6 s |
| Alert ack (`POST /api/v1/alerts/[id]/ack`) | **300 ms** | 800 ms |

**Why these numbers** — anchored on the typical clinical interaction:
a clinician sweeping the dashboard reads multiple endpoints in quick
succession (200 ms p95 = perceptually instant); writes are
acknowledged in a single click (500 ms p95 ≈ "submitted"); PDF report
is a deliberate "generate and wait" UX (5 s p95 mirrors the existing
visual-regression test). The PDF-Lib pipeline is single-threaded,
so 5 s allows headroom for a 50-page report on a busy serverless
container.

**Source** — Vercel function execution logs (`durationMs`).

### 2.3 Audit-pipeline integrity (B-09 invariant)

| Metric | Target |
|---|---|
| `AUDIT_WRITE_FAILED` events with `variant=strict` over 30 days | **0** (zero tolerance) |
| Window | 30-day rolling |
| Error budget | 0 |
| Action on breach | SEV-1 page + compliance ticket — strict-variant means a state change committed but the audit row didn't, breaking GDPR Art.30 record-of-processing |

This is **not** a normal SLO with a budget — it is an invariant.
Any non-zero count is a bug, not a slow burn.

### 2.4 Cron job liveness

| Cron | Schedule (UTC) | SLO | Alert |
|---|---|---|---|
| `/api/v1/internal/retention` | `0 3 * * *` | At least 1 event/28h | SEV-2 missed |
| `/api/v1/internal/anonymize` | `0 4 * * *` | At least 1 event/28h | SEV-2 missed |
| `/api/v1/internal/alerts-auto-close` | `30 3 * * *` | At least 1 event/28h | SEV-3 missed |

A 28-hour window allows 1 missed run before paging — Vercel Cron has
occasional cold-start retries and we don't want a single skip to wake
someone up.

### 2.5 Health endpoint

| Metric | Target |
|---|---|
| `/api/v1/health` returns HTTP 200 | **99 %** of probes (rolling 24h) |
| 503 (`status:unhealthy`) episodes | **< 4 /quarter**, each ≤ 5 minutes |
| Probe latency (`totalCheckMs`) | p95 **< 1 s**, p99 < 3 s |

The endpoint runs four probes (Supabase + Storage + Upstash + MFA flag
check); 3 s probe timeout per subsystem caps the worst-case wall time
at ~3 s.

### 2.6 RBAC / tenant-isolation noise floor

| Metric | Target |
|---|---|
| `cross_tenant` denials | **< 5 /tenant/day** baseline; spike alerting at > 20 /15min |
| `cross_clinician_ppl` denials | **< 1 /tenant/day** baseline; spike alerting at > 5 /15min |
| `mfa_required` denials | **< 10 /tenant/day** baseline; spike at > 10 /1h |

Baseline budgets reflect "operator clicks the wrong button" —
spike alerts catch active probes or UI regressions.

---

## 3. Reporting cadence

| Cadence | Owner | Output |
|---|---|---|
| Daily | Operator | Datadog dashboard sweep — fast read of the 4 templated boards |
| Weekly | Operator | Burn-rate report (auto-emitted by Datadog → Slack #ops) |
| Monthly | Operator + DPA review (post-first-tenant) | Per-tenant SLO report — uptime, p95 per endpoint class, audit invariants |
| Quarterly | DPO + Operator | Aggregate SLO compliance + lookback at any SEV-1/2 incident from `27-INCIDENT-RESPONSE.md` |

---

## 4. Update protocol

A change to any SLO target in this file requires:

1. PR-body justification — why is the target moving (tenant agreement
   change? tighter regulatory expectation? proven-impossible old
   target?).
2. Update of any monitor in `docs/observability/datadog-*.json` that
   anchors on the old number.
3. Update of `docs/27-INCIDENT-RESPONSE.md §11` if the severity tier
   changed.
4. Communication to the tenant if a per-tenant SLO is in their DPA.

---

## 5. Out of scope

* **Per-region SLOs** — Vercel runs us in `iad1` (US East). When EU
  region is enabled, split this doc by region.
* **Frontend Core Web Vitals** — TTFB / FCP / LCP — out of scope until
  a real-user-monitoring pipeline lands. Bundle-size budget gate
  (Sprint 5 task 5.4) is the current proxy.
* **Time-to-first-PDF for new tenants** — onboarding metric, lives in
  `docs/34-FIRST-TENANT-ONBOARDING.md` once measured.

---

## 6. Cross-references

- `docs/observability/` — dashboard + monitor templates that
  implement these SLOs.
- `docs/27-INCIDENT-RESPONSE.md §11` — runbook entries for each
  monitor.
- `docs/30-RISK-REGISTER.md` Section M-XX — operator-side
  residual risks where SLO budget is the mitigation.
- `docs/22-GDPR-READINESS.md` Art.32 — security of processing.
- `api/v1/health.ts` — the deep-probe implementation.
