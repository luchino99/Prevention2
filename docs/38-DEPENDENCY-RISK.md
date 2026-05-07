# Uelfy Clinical — Dependency Risk Register

> **Scope.** Decision log for non-trivial dependency upgrades, version
> pins (with rationale), security waivers, and the test-before-merge
> protocol for production-runtime packages.
>
> **Audience.** Founder + future maintainer. Audit-trail evidence for
> ISO 27001 / SOC 2 / IEC 62304 SOUP review (procurement teams ask
> "how do you decide to upgrade a dependency on health-related
> software?" — this doc is the answer).
>
> **Companion docs:**
> - `docs/12-PACKAGE-UPGRADE.md` — general policy
> - `docs/26-DEPLOYMENT-RUNBOOK.md` — ops, env vars, manual deploy
> - `docs/35-CI-CD-WORKFLOW.md` — Renovate weekly cadence
> - `renovate.json` — Renovate rules (incl. ignored packages)
>
> **Status.** Sprint 2 task 2.7 — initial version. Living document:
> append a new entry for every non-trivial upgrade decision.

---

## 1. Active pins and waivers

| Package | Pinned at | Risk accepted | Owner | Review by |
|---|---|---|---|---|
| `@supabase/supabase-js` | `2.45.6` (exact, no caret) | Pulls in `@supabase/auth-js@2.65.1` which has GHSA-8r88-6cj9-9fh5 (LOW, CVSS 0). Versions ≥2.50 trigger a WebSocket eager-init regression that breaks login on Node 20. | founder | Sprint 2 task 2.7 (this doc) |

All other packages are managed via Renovate (see `renovate.json` — group
schedules, no auto-merge).

---

## 2. Test-before-merge protocol for runtime deps

A dependency that ships into a Vercel serverless function (i.e.
anything in `dependencies` of `package.json`) requires the following
before its version is bumped:

| Step | Acceptance criterion |
|---|---|
| 1. `npm install <pkg>@<version>` succeeds (no peer-dep conflict) | exit 0 |
| 2. `npm ci` reproduces the result on a clean tree | exit 0 |
| 3. `npm run build:check` is green | all 11 gates green incl. `check-sbom-cves` (no new HIGH CVE) |
| 4. `npm test` is green | 244/244 (or whatever the current count is) |
| 5. `npm run sbom:refresh` produces stable byte-equal output | re-run twice → diff -q empty |
| 6. Smoke test against a Vercel preview deployment | `/api/v1/health` returns `status: "ok"` and login works manually |
| 7. Production deploy then smoke-prod CI | green |
| 8. 24h soak in production with no error rate increase | observation |

A dev-only dep (`devDependencies`) skips steps 6-8 (it never reaches
runtime).

---

## 3. Pin: `@supabase/supabase-js@2.45.6`

### Why pinned

* Versions 2.50.0 → unknown-upper-bound introduced a regression where
  the Realtime WebSocket client eagerly initialises during the SDK
  module load (instead of lazily on first `.channel()` call). On Node
  20 this throws because the WebSocket polyfill init runs before
  globalThis.WebSocket is defined in the Vercel serverless function
  environment.
* Symptom: `/api/v1/auth/session` returns 500 with "WebSocket is not
  defined" stack trace; the entire login flow is broken.
* We verified this empirically and pinned `2.45.6` (the last 2.4x
  version, before the regression introduction). The exact version (no
  `^` caret) prevents Renovate / npm from floating to a vulnerable
  version on `npm install`.

### Why upgrade (LOW CVE)

* `@supabase/auth-js@<=2.69.1` has GHSA-8r88-6cj9-9fh5 ("Insecure Path
  Routing from Malformed User Input"). Severity LOW, CVSS 0 — does not
  block production.
* `supabase-js@2.45.6` ships `auth-js@2.65.1` (verified via
  `node_modules/@supabase/auth-js/package.json`).
* Long-term, staying multiple major versions behind on the SDK is a
  growing cost (other security/quality fixes accumulate, Renovate
  cannot help us, manual maintenance burden grows).

### Upgrade target investigation (Sprint 2 task 2.7)

**Hypothesis:** Recent versions (2.7x or later) include both the
auth-js fix AND a subsequent fix for the WebSocket regression
(Supabase team is unlikely to have left it broken for 50+ minor
versions). Dependabot proposed `2.105.3` as the upgrade target — that's
what the maintainers consider current.

**Test plan (founder-driven, requires live DB + Vercel preview):**

1. **Hot bump to `2.105.3` (the optimistic path):**
   ```bash
   cd ~/Documents/GitHub/Prevention2
   git checkout -b sprint2/upgrade-supabase-js-2.105
   # NOTE: not on main — this is risky enough to keep on a branch
   npm install @supabase/supabase-js@2.105.3
   node -e "console.log('auth-js installed:', require('@supabase/auth-js/package.json').version)"
   # expected: >=2.69.2 (closes the LOW CVE)
   ```
2. **Run all gates:**
   ```bash
   rm -rf node_modules
   npm ci
   npm run build:check     # all 11 gates incl. check-sbom-cves
   npm test                # 244/244
   npm run sbom:refresh    # update SBOM with new tree
   cat sbom-cve-report.json | python3 -c "import json,sys;r=json.load(sys.stdin);print('counts:',r['counts'])"
   # expected: low=0 (or low without auth-js entry)
   ```
3. **Push branch + Vercel preview:**
   ```bash
   git add package.json package-lock.json sbom.cyclonedx.json sbom-cve-report.json
   git commit -m "chore(deps): test bump @supabase/supabase-js to 2.105.3 (Sprint 2 task 2.7)"
   git push -u origin sprint2/upgrade-supabase-js-2.105
   ```
   Vercel auto-deploys the branch to a preview URL (e.g.
   `prevention2-git-sprint2-upgrade-supabase-js-2-105-<hash>.vercel.app`).
4. **Smoke the preview manually (CRITICAL):**
   - Visit the preview URL `/pages/login.html`
   - Open DevTools → Console
   - Try a login with a test account
   - Check that:
     * No "WebSocket is not defined" error in console
     * Login succeeds and redirects to dashboard
     * Dashboard data loads (Supabase calls work)
   - If realtime channels are used (alerts, follow-up): verify they
     still subscribe successfully
5. **Decision tree:**
   - **All green** → merge to main, close Sprint 2 task 2.7,
     remove `enabled: false` for `@supabase/supabase-js` in
     `renovate.json` (so Renovate can keep it updated going
     forward), append entry to §4 "Decision log".
   - **Login broken with WebSocket error** → revert branch, document
     in §4 with version + symptom, repeat with a lower version
     (binary-search style: try 2.85, then 2.65, then 2.55).
   - **Tests fail / typecheck fail** → check release notes for
     breaking API changes; either adopt the change in our code or
     stay pinned.
   - **CVE gate flags new HIGH** → investigate; may indicate a
     transitive dep that worsens. Decide on a per-CVE basis.

### Rollback

Same branch:
```bash
git revert HEAD
git push origin sprint2/upgrade-supabase-js-2.105
```

Or simply close the branch without merging (Vercel preview is
ephemeral; no harm done).

---

## 4. Decision log

Append-only. Each upgrade attempt or pin renewal is one row.

| Date | Package | From → To | Outcome | Operator | Notes |
|---|---|---|---|---|---|
| 2026-04-XX | `@supabase/supabase-js` | `2.50.0` → `2.45.6` | PINNED | founder | Original WebSocket regression discovery. See `docs/11-CHANGELOG.md` `[0.2.1-hotfix-websocket]`. |
| 2026-05-07 | `@supabase/supabase-js` | `2.45.6` → ??? | INVESTIGATE | founder | Sprint 2 task 2.7. Test plan in §3. Pending operator execution. |

---

## 5. CVE waivers (currently accepted risks)

| CVE / GHSA | Package | Severity | Why accepted | Review date |
|---|---|---|---|---|
| GHSA-8r88-6cj9-9fh5 | `@supabase/auth-js@2.65.1` (transitive via supabase-js@2.45.6) | LOW (CVSS 0) | Closing requires upgrading the parent SDK past the WebSocket regression band; Sprint 2 task 2.7 is the planned closure. CVSS 0 means no demonstrable exploit path against our auth flow. | 2026-08-07 (90 days from Sprint 2) |

---

## 6. Document history

| Date | Change | Author |
|---|---|---|
| 2026-05-07 | Initial version (Sprint 2 task 2.7 kick-off) | founder + AI pair |
