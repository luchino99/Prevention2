# Observability templates

Importable dashboard / monitor configurations for the canonical
structured-log events emitted by Uelfy Clinical. Templates target
**Datadog Logs** (the operator's chosen log sink — see
`docs/27-INCIDENT-RESPONSE.md §11`); the JSON shapes import via
*Dashboard → New → Import JSON* and *Monitors → New → Import JSON*.

If the operator is on a different log platform (Grafana Loki, Logflare,
self-hosted ELK), the templates still document the **queries to write**
(`@event:<NAME>`, faceted by `variant` / `reason`) — translating to the
target query DSL is mechanical.

## Files

| File | Purpose |
|---|---|
| `datadog-retention-run.json`     | Dashboard for `RETENTION_RUN` cron event (per-tenant prune breakdown) |
| `datadog-alerts-auto-close.json` | Dashboard for `ALERTS_AUTO_CLOSE_RUN` (Sprint 4 task 4.2 cron) |
| `datadog-audit-write-failed.json`| Dashboard + alert for `AUDIT_WRITE_FAILED` (B-09 invariant breach) |
| `datadog-access-denied.json`     | Dashboard + alert for `ACCESS_DENIED` (Sprint 2 RLS + RBAC denials) |

Each template ships:

1. A "count over time" timeseries — baseline volume.
2. A faceted breakdown — `variant` (best_effort / strict),
   `reason` (cross_tenant / role_mismatch / cross_clinician_ppl /
   unauthenticated / mfa_required), or `action` depending on the
   event.
3. A p95 latency tile where the structured log carries `durationMs`.
4. A monitor (`alert`) example with thresholds anchored on
   `docs/41-SLO-DEFINITIONS.md`.

## Importing into Datadog

```
Datadog → Dashboards → New → Import dashboard JSON → paste file content
Datadog → Monitors  → New monitor → Import monitor JSON
```

## Importing into Grafana / Loki

The Datadog query syntax (`@event:RETENTION_RUN`) maps to Grafana's
Loki LogQL as `{job="uelfy"} |= "RETENTION_RUN"` filtered through
`| json` for facet extraction. The same panels can be reproduced from
the queries documented inside each file's `description` field.

## Updating templates

When a structured-log event gains a new field, update the template
that surfaces it AND update `docs/27-INCIDENT-RESPONSE.md §11` so the
incident playbook stays in sync. The templates are not regenerated
automatically — they are reviewed material.
