# Uelfy Clinical — CI/CD Workflow & Daily Operations

> **Scope.** Day-to-day operational runbook for the developer/founder
> driving the codebase: how a code change moves from "edit on Mac" to
> "live in production", what gates protect each stage, what to do when
> a gate goes red, and how to roll back.
>
> **Audience.** The solo developer/founder (and any future maintainer).
> Assumes you have local access to the repo and Vercel/Supabase
> dashboards.
>
> **Companion docs:**
> - `docs/26-DEPLOYMENT-RUNBOOK.md` — Stack overview, env vars, database
>   migration procedure, manual deploy/rollback (this file extends it
>   for the Sprint 1 hardening).
> - `docs/27-INCIDENT-RESPONSE.md` — When things actually break in
>   production: triage, comms, post-mortem.
> - `docs/12-PACKAGE-UPGRADE.md` — Dependency upgrade policy (this
>   file documents the Renovate automation that implements it).
>
> **Status.** Sprint 1 (May 2026) — first version. Reflects the
> current "direct push to main" workflow chosen by the founder.
> Re-evaluate when the team grows beyond one developer (then activate
> required PR + status checks per task 1.4 plan).

---

## 1. TL;DR — daily push workflow

```bash
cd ~/Documents/GitHub/Prevention2

# 1. Pull latest from origin (always — protects against web-UI commits)
git pull origin main

# 2. Make your changes (edit files)
#    (use your editor; do NOT bypass type checking)

# 3. Local verification (MANDATORY before push)
npm run build:check        # 10 gates (~10s)
npm test                   # 244 tests (~3s)

# 4. Commit + push from terminal or GitHub Desktop
git add <changed-files>
git commit -m "<conventional-commit-message>"
git push origin main

# 5. Watch CI — 3 parallel jobs, total ~5 min
#    https://github.com/luchino99/Prevention2/actions
#
#    build:check + test       ✅  ~2 min
#    Production smoke test    ✅  ~3 min (60s wait + checks)
#    Attach SBOM to Release   ⏭️  Skipped (correct on push events)

# 6. If CI green → done. Vercel has already deployed by then.
#    If CI red → see §10 (failure modes & recovery).
```

**Disciplina critica:** se `build:check` o `npm test` falliscono in
locale, **NON pushare**. Risolvi prima. Solo deploy verdi finiscono in
prod.

---

## 2. Toolchain alignment

The same Node version runs everywhere. Drift between developer Mac,
GitHub Actions, and Vercel is the most common source of "works on my
machine" bugs.

| Surface | Node version | Source of truth |
|---|---|---|
| Developer Mac | 20.18.0 | `.nvmrc` + `nvm use` |
| GitHub Actions CI | 20.18.0 | `actions/setup-node@v4` reads `.nvmrc` |
| Vercel build | 20.x (latest patch) | `package.json` `engines.node` |
| Vercel runtime (lambda) | 20.x | Same |

**Setup on a new Mac:**

```bash
nvm install 20.18.0
nvm alias default 20.18.0
cd ~/Documents/GitHub/Prevention2
nvm use   # reads .nvmrc
node --version   # v20.18.0
```

**Pinning rationale:**

- `.nvmrc` pinned to `20.18.0` (LTS) ensures developer locally matches
  Vercel build. Drift with newer Node (e.g. 22, 25) has historically
  produced silent regressions (e.g. `@supabase/supabase-js` ≥2.50
  WebSocket eager-init regression on Node 20 only).
- `engines.node` in `package.json` is `20.x` to allow Vercel to use the
  latest 20.x patch (security updates) without breaking the build.

---

## 3. Deterministic install — `npm ci` everywhere

`npm install` is **not allowed** in CI/Vercel because it can promote
caret-ranged transitives to versions newer than the lockfile. `npm ci`
installs exactly what `package-lock.json` resolves and fails if the
lockfile and `package.json` diverge.

| Surface | Command | Notes |
|---|---|---|
| Developer Mac | `npm ci` (or `npm install` for dependency changes) | Both produce same lockfile if behaviour is correct |
| GitHub Actions CI | `npm ci --include=dev --no-audit --no-fund` | `--include=dev` because GitHub Actions sets `NODE_ENV=production` which would otherwise omit devDeps; `--no-audit --no-fund` for cleaner logs |
| Vercel build | `npm ci --include=dev --no-audit --no-fund` | Configured in `vercel.json` `installCommand` (Sprint 1 task 1.2) |

**Lockfile discipline:**

- `package-lock.json` is committed (see `064dc41`).
- The CI `Lockfile must be canonical` step fails if `npm ci` modifies
  the lockfile — that means the lockfile is not in sync with
  `package.json`.
- When updating a dependency: edit `package.json`, then `npm install`
  to regenerate the lockfile, then commit BOTH files together.

**The `@supabase/supabase-js@2.45.6` exact pin (no caret):** versions
≥2.50 have a WebSocket eager-init regression on Node 20 that breaks
login. Renovate is configured to ignore this package (see §6) until
Sprint 2 task #44 identifies a safe upgrade target.

---

## 4. CI workflow — `.github/workflows/ci.yml`

Three jobs, parallel where possible.

### Job A — `build:check + test (Node 20 / Ubuntu 22)`

Runs on every `pull_request` and every `push` to main (NOT on `release`
events — gates already passed when the commit was on main).

```
1. Checkout
2. Setup Node from .nvmrc           v20.18.0
3. Print toolchain versions
4. Install (npm ci --include=dev)
5. Lockfile must be canonical       fails if npm ci modified lockfile
6. Build gates                      10 sub-gates (see below)
7. Test suite (vitest)              244 tests
8. SBOM must be fresh               npm run sbom:refresh, must produce zero diff
9. SBOM determinism                 sbom:refresh twice → byte-equal output
```

**The 10 build gates** (`npm run build:check`):

1. `fetch-noto-fonts` — vendored Noto fonts present
2. `fetch-supabase-sdk` — Supabase SDK ESM bundle generated
3. `inject-public-config` — public env vars injected into frontend-dist
4. `verify-build` — required output files present
5. `check-engine-determinism` — clinical engine has no banned patterns
6. `check-rate-limit-async` — all `/api/v1` endpoints use async rate-limit
7. `check-sbom` — committed SBOM matches lockfile-resolved SBOM
8. `check-sbom-cves` — runtime CVE scan, fail on HIGH (`SBOM_CVE_FAIL_ON_HIGH=true` in CI)
9. `run-rls-tests` — RLS regression tests (skipped if `DATABASE_URL` not set)
10. `tsc --noEmit` — full TypeScript typecheck

### Job B — `Attach SBOM to GitHub Release`

Runs ONLY when a Release is published (`release: published` event).
Skipped on push and pull_request.

```
1. Checkout the tag's commit
2. Setup Node from .nvmrc
3. Install
4. Generate fresh SBOM + CVE report
5. Show SBOM + CVE summary in run log
6. Upload sbom.cyclonedx.json + sbom-cve-report.json as release assets
```

Result: each tagged release has a frozen SBOM downloadable from the
Releases page — required for B2B clinical procurement and IEC 62304
SOUP audits.

### Job C — `Production smoke test`

Runs on `push` to main, after job A passes (`needs: build-and-test`).
Skipped on PRs and releases.

```
1. Wait 60s for Vercel deploy to start
2. Health endpoint with polling      6 attempts, 15s backoff (~3 min budget)
3. Verify health status acceptable   ok | degraded (NOT unhealthy)
4. Verify Supabase subsystem up
5. Smoke check root → 307 redirect to login
6. Smoke check /pages/login.html → 200
7. Smoke check /assets/vendor/supabase-js.esm.js → 200
8. Smoke check /security.txt → 200 (rewrite working)
9. Smoke check 6 security headers present
10. Smoke summary in $GITHUB_STEP_SUMMARY
```

If any check fails → red job → GitHub notification. Production may or
may not be down (Vercel keeps previous deploy live if new build fails),
but manual investigation is required.

### Hardening choices

- `permissions: contents: read` (least privilege; release-sbom job
  overrides to `contents: write` for upload)
- `concurrency: cancel-in-progress` on same branch — saves CI minutes
- `timeout-minutes: 10` (build), 5 (release-sbom), 8 (smoke-prod)
- `actions/checkout@v4` and `actions/setup-node@v4` pinned at major;
  Renovate (§6) tracks updates

---

## 5. Vercel deploy lifecycle

```
git push origin main
       │
       ├─→ GitHub triggers webhook to Vercel
       │
       ├─→ Vercel clones repo at the new commit SHA
       │
       ├─→ Vercel runs installCommand: "npm ci --include=dev --no-audit --no-fund"
       │   (235 packages, ~5s with cache, 2-3 min cold)
       │
       ├─→ Vercel runs buildCommand: "npm run build"
       │   = node scripts/fetch-noto-fonts.mjs && fetch-supabase-sdk.mjs &&
       │     inject-public-config.mjs && check-engine-determinism.mjs &&
       │     verify-build.mjs
       │   (~5s)
       │
       ├─→ Vercel compiles each api/v1/*.ts as a serverless function
       │   ("Using TypeScript 5.5.4 (local user-provided)" per file)
       │
       ├─→ Vercel deploys to production URL: https://prevention2.vercel.app
       │   (and to a unique deploy URL: prevention2-git-main-...vercel.app)
       │
       └─→ GitHub Actions smoke-prod job hits /api/v1/health to verify
           (60s wait + 6 retries → ~3 min)
```

**If Vercel build fails:** previous successful deployment stays live in
production. The new code is NOT deployed. The Vercel dashboard shows a
red deploy with build logs. Smoke-prod may pass (because it's hitting
the previous, still-working deploy) — this is correct behaviour but
masks the failure. Always cross-check Vercel dashboard if you suspect
production might be on an old version.

**Production URL:** `https://prevention2.vercel.app`

If a custom domain is added later, update `PROD_URL` in
`.github/workflows/ci.yml` smoke-prod job env block.

---

## 6. Dependency management — Renovate

The repo has Renovate enabled (Sprint 1 task 1.5) with config at
`renovate.json`. Dependabot is **disabled** to avoid duplicate PRs and
to enforce the `@supabase/supabase-js` pin (Dependabot does not respect
configurable ignores the same way).

### Schedule

- Weekly: Monday before 9am Europe/Rome (5 PRs max concurrent)
- Vulnerability alerts: any time (out-of-cycle PRs for CVEs)

### Grouping

Renovate groups updates by ecosystem to reduce PR noise:

| Group | Packages |
|---|---|
| `supabase ecosystem` | All `@supabase/*` (excluded: supabase-js itself) |
| `test-toolchain (vitest/vite/esbuild)` | vitest, vite, esbuild, `@vitest/*`, `@vitejs/*` |
| `vercel ecosystem` | All `@vercel/*` |
| `typescript + types` | typescript, `@types/*` |
| `pdf tooling` | pdf-lib, `@pdf-lib/*` |
| `github-actions` | All actions runners (actions/checkout, etc.) |

### Auto-merge: DISABLED (intentional)

All Renovate PRs require manual merge. Rationale: the project uses
direct-push-to-main without required status checks, so auto-merge could
land regressions silently. When/if branch protection is upgraded to
require CI green for merge, the devDeps patch rule can be relaxed.

### Critical pin protection

`@supabase/supabase-js` is hard-disabled (`enabled: false`) in
`renovate.json`. Sprint 2 task #44 will identify a safe upgrade target.
Until then, Renovate will NOT propose any update for this package.

### PR triage workflow (5 min/week)

Every Monday morning:

1. Open `https://github.com/luchino99/Prevention2/pulls?q=author%3Aapp%2Frenovate`
2. For each PR (5-10 typically):
   - Read the **Release Notes** section (Renovate auto-includes from upstream)
   - Wait for CI green (~5 min)
   - If CI green AND release notes show no breaking changes → click **Merge**
   - If CI red → read failing step, decide: skip this update (close PR), or fix forward (push to PR branch), or wait
   - PRs with `major-update` label: read release notes carefully, may need code changes to adopt
3. Optionally check the **Dependency Dashboard** issue for an overview
   of all pending updates

### Disabling Renovate (if needed)

Uninstall the GitHub App from
`https://github.com/settings/installations`. Then optionally remove
`renovate.json` from the repo. Open Dependabot back up in
`Settings → Code security` if you want a fallback.

---

## 7. Branch protection (minimal)

Only two rules active on `main`:

- ☑ **Do not allow force pushes** — prevents accidental history rewrites
- ☑ **Do not allow deletions** — prevents accidental branch deletion

Everything else is OFF (no required PR, no required reviews, no
required status checks). The founder pushes directly to main. Discipline
substitutes for technical enforcement: always run `npm run build:check
&& npm test` locally before push.

When/why to upgrade this:

- **Second contributor joins**: enable "Require pull request before
  merging" + "Require approvals: 1".
- **First paying customer**: enable "Require status checks to pass
  before merging" with `build:check + test (Node 20 / Ubuntu 22)` as
  required. This is the gate that promotes us from "trust the founder's
  discipline" to "the system enforces correctness".

---

## 8. SBOM (Software Bill of Materials)

The committed SBOM is at the repo root: `sbom.cyclonedx.json` (CycloneDX
1.5 format, ~230 components excluding platform-specific binaries).

Generated by `npm run sbom:refresh` (calls `scripts/refresh-sbom.mjs`),
which:

1. Runs `npm sbom --sbom-format=cyclonedx --sbom-type=application`
2. Pipes the output through `canonicaliseSbom()` in
   `scripts/sbom-canonicalise.mjs` which:
   - Drops volatile fields: `metadata.timestamp`, `serialNumber`,
     `metadata.tools[*].version`, `metadata.component.cdx:npm:package:path`
   - Forces `metadata.component.name` from the `purl` (so directory
     name doesn't leak into the SBOM)
   - Filters out platform-conditional components: `@esbuild/<os>-<arch>`,
     `fsevents`, etc. (so the SBOM is byte-equal across macOS / Linux /
     Windows)
   - Sorts components by `bom-ref` and dependencies by `ref`
3. Writes the canonical JSON to disk

CI gates around the SBOM:

- `check-sbom` — committed SBOM must match the lockfile-resolved SBOM
  (catches "added a dep without `npm run sbom:refresh`")
- `check-sbom-cves` — runtime CVE scan via `npm audit --omit=dev`,
  fails on HIGH (`SBOM_CVE_FAIL_ON_HIGH=true`)
- `SBOM must be fresh` — same as `check-sbom` but in the CI workflow
- `SBOM determinism` — runs `sbom:refresh` twice, must produce
  byte-equal output (catches future regressions of canonicalisation)

When you add or update a dependency:

```bash
npm install <new-or-updated-dep>
npm run sbom:refresh
git add package.json package-lock.json sbom.cyclonedx.json
git commit -m "chore(deps): update X to Y.Z (refreshed SBOM)"
```

The `release-sbom` CI job auto-attaches `sbom.cyclonedx.json` and
`sbom-cve-report.json` to every GitHub Release as downloadable assets.

---

## 9. Common operations

### Update a single dependency manually (out of Renovate cycle)

```bash
cd ~/Documents/GitHub/Prevention2
git pull origin main

npm install <pkg>@<version>     # updates package.json + lockfile
npm run sbom:refresh            # updates SBOM
npm run build:check             # verify all gates green
npm test                        # verify 244/244

git add package.json package-lock.json sbom.cyclonedx.json
git commit -m "chore(deps): update <pkg> to <version>"
git push origin main
```

### Hotfix a production bug

```bash
cd ~/Documents/GitHub/Prevention2
git pull origin main

# Edit files...

npm run build:check     # MANDATORY — catches regressions
npm test                # MANDATORY

git add <files>
git commit -m "fix(<scope>): <one-line description>

<longer description if needed>"

git push origin main

# Watch:
# - Vercel dashboard for deploy success (~2 min)
# - GitHub Actions for smoke-prod result (~5 min total)
# - If smoke-prod red, see §10
```

### Roll back a bad deploy

**Fastest** (Vercel UI, <30 seconds to recover):

1. `https://vercel.com/dashboard` → Prevention2 → Deployments
2. Find the previous green deployment (one before the bad one)
3. Click `…` menu → **Promote to Production**
4. Production back online immediately

Then on the Mac, undo the bad commit:

```bash
cd ~/Documents/GitHub/Prevention2
git pull origin main

# Revert the bad commit (creates a new "revert" commit, preserves history)
git revert <bad-commit-sha>

git push origin main
```

**Avoid `git reset --hard` + `git push --force`** — branch protection
rejects force pushes and forcing it is destructive.

### Release a tagged version

```bash
cd ~/Documents/GitHub/Prevention2
git pull origin main

# Create + push tag
git tag v0.3.0
git push origin v0.3.0

# Create GitHub Release (UI or CLI)
gh release create v0.3.0 \
   --title "v0.3.0 — <short summary>" \
   --notes "<release notes markdown>"

# OR via web UI:
# https://github.com/luchino99/Prevention2/releases/new
# Choose tag v0.3.0, fill title + notes, click "Publish release"

# Watch GitHub Actions:
# - release-sbom job fires automatically (~1 min)
# - sbom.cyclonedx.json + sbom-cve-report.json attached to the release
```

### Test the SBOM release-asset job (no real release needed)

```bash
gh release create v0.X.Y-test --notes "Test SBOM release artifact"
# Wait ~1 min, watch Actions tab for release-sbom job
# Visit https://github.com/luchino99/Prevention2/releases/tag/v0.X.Y-test
# Verify both .json files appear as assets

# Cleanup
gh release delete v0.X.Y-test --yes
git push --delete origin v0.X.Y-test
```

---

## 10. Failure modes and recovery

### `build-and-test` job fails

| Failed step | Cause | Recovery |
|---|---|---|
| `Setup Node from .nvmrc` | `.nvmrc` missing or invalid | Verify `cat .nvmrc` shows `20.18.0` |
| `Install (npm ci)` with `EUSAGE` | `package.json` ↔ `package-lock.json` drift (e.g. someone edited package.json without `npm install`) | `npm install` locally to regenerate lockfile, commit BOTH files |
| `Lockfile must be canonical` | `npm ci` modified the lockfile | Same as above — lockfile is not in sync, run `npm install` and commit |
| `Build gates` `[check-sbom] FAIL` | `sbom.cyclonedx.json` is stale | `npm run sbom:refresh && git add sbom.cyclonedx.json && git commit` |
| `Build gates` `[check-sbom-cves] FAIL` | New HIGH CVE in a runtime dep | Investigate the CVE; bump the dep or accept the risk via waiver in `docs/29-DEPENDENCY-RISK.md` |
| `Test suite` red | Test regression | Run `npm test` locally, isolate failing test, fix code or test |
| `SBOM must be fresh` | Same as `check-sbom` | Same fix |
| `SBOM determinism` | New volatile field in canonicaliseSbom | Inspect the diff in CI logs; add the field to the strip list in `scripts/sbom-canonicalise.mjs` |

### `Production smoke test` job fails

| Failed step | Likely cause | Recovery |
|---|---|---|
| `Health endpoint` 6 retries timeout | Vercel build > 3 min, or build failed | Open Vercel dashboard. If build failed: read logs, fix forward. If build OK but health timeout: check Vercel function logs for runtime error |
| `Verify health status` returns `unhealthy` | Supabase down OR `SUPABASE_SERVICE_ROLE_KEY` missing on Vercel | Check Supabase dashboard; verify Vercel env vars under Project Settings → Environment Variables |
| `Verify Supabase subsystem` `down` | Supabase outage | Wait + recheck; if persists, file ticket with Supabase support |
| `Smoke check root → 307` got 200 | `vercel.json` redirect rule was modified or removed | `git diff vercel.json` to see what changed |
| `Smoke check login page → 200` got 404 | `inject-public-config` script failed silently or `frontend-dist` not deployed | Check Vercel build log for `[verify-build]` output |
| `Missing security headers` | `vercel.json` `headers` section was modified | `git diff vercel.json` |

### Vercel build itself fails (red on Vercel dashboard)

Production stays on the previous deploy — no immediate user impact.
Investigate:

1. Vercel dashboard → failing deployment → **Build Logs** tab
2. Common causes:
   - Lockfile out of sync with `package.json` (npm ci EUSAGE)
   - Missing required env var (e.g. `SUPABASE_URL` missing → `inject-public-config` fails in strict mode)
   - Build timeout (Vercel free tier: 45 min; pro: 90 min — should never happen for us)
3. Fix on Mac, push fix-forward commit. Vercel auto-redeploys.

### Workflow run shows "Skipped" on `Attach SBOM to GitHub Release`

This is **correct** on push events. The job has
`if: github.event_name == 'release'` — it only runs when a release is
published. Not a failure.

---

## 11. Glossary

- **`build-and-test`** — main CI job: 10 build gates + 244 vitest tests
- **`build:check`** — alias for the 10-gate npm script that runs in CI
- **canonicalisation** — process that makes the SBOM byte-equal across
  platforms by stripping volatile fields and filtering platform binaries
- **CVE** — Common Vulnerabilities and Exposures (CVE database; npm audit
  uses the GitHub Advisory Database)
- **devDependencies** — packages needed for build/test but NOT bundled
  into runtime serverless functions
- **EUSAGE** — npm error code: package.json and package-lock.json are
  out of sync; `npm ci` cannot reconcile
- **lockfile** — `package-lock.json`; defines exact resolved versions of
  every package and transitive
- **release-sbom** — CI job that attaches SBOM artefacts to a tagged
  GitHub Release
- **SBOM** — Software Bill of Materials (CycloneDX 1.5 format)
- **smoke test** — quick post-deploy verification that production
  responds; not a full integration test
- **SOUP** — Software Of Unknown Provenance (IEC 62304 §5.1 term for
  third-party deps that must be inventoried)

---

## 12. Quick reference card (copy to a sticky note)

```
DAILY PUSH
  git pull origin main
  ... edit ...
  npm run build:check && npm test
  git add … && git commit -m "…" && git push origin main
  watch CI: github.com/luchino99/Prevention2/actions  (~5 min)

DEPENDENCY UPDATE (out of Renovate)
  npm install pkg@version
  npm run sbom:refresh
  npm run build:check && npm test
  git add package*.json sbom.cyclonedx.json
  git commit -m "chore(deps): …"
  git push

ROLLBACK
  Vercel UI → Deployments → previous → "Promote to Production"
  Then: git revert <bad-sha> && git push

RELEASE
  git tag vX.Y.Z && git push origin vX.Y.Z
  gh release create vX.Y.Z --notes "…"

PR REVIEW (Monday morning, 5 min)
  github.com/luchino99/Prevention2/pulls?q=author:app/renovate
  read release notes → wait CI green → merge or skip

URLS TO BOOKMARK
  Production:   https://prevention2.vercel.app
  Vercel:       https://vercel.com/dashboard
  CI runs:      https://github.com/luchino99/Prevention2/actions
  Renovate PRs: https://github.com/luchino99/Prevention2/pulls?q=author:app/renovate
  Settings:     https://github.com/luchino99/Prevention2/settings
```

---

## 13. Document history

| Date | Change | Author |
|---|---|---|
| 2026-05-07 | Initial version (Sprint 1 task 1.8) | founder + AI pair |
