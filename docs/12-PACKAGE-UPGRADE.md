# package.json upgrade manifest — additions required by the refactor

The legacy manifest is preserved as-is. Apply the following changes explicitly
before the first production build. Nothing in the new code silently mutates
`package.json`; all changes are listed here so they can be reviewed and
code-reviewed line-by-line.

## 1. Metadata (replace)

```diff
-  "name": "chatbot-sanitario",
-  "description": "Chatbot sanitario per prevenzione con AI",
-  "keywords": ["chatbot", "sanità", "prevenzione", "openai", "vercel"],
+  "name": "uelfy-clinical",
+  "description": "Uelfy Clinical — B2B cardio-nephro-metabolic risk assessment platform",
+  "keywords": ["clinical", "score2", "cardio-nephro-metabolic", "b2b", "gdpr"],
```

## 2. Engines

```json
"engines": { "node": "20.x" }
```

The `20.x` pin (rather than `>=20.0.0`) keeps Vercel and local dev on the
same major, avoids accidental upgrades to Node 22, and matches the
`actions/setup-node` node-version used in the GitHub Actions workflow.

## 3. Scripts (canonical layout shipped in Wave 4)

The final scripts block reflects a clean separation between the **deploy
artifact pipeline** (what Vercel runs in production) and the **quality
gate pipeline** (what CI runs on every PR/push). Keeping `tsc` out of the
production `build` command is deliberate and required — Vercel installs
only `dependencies` when `NODE_ENV=production`, so invoking `tsc` during
deploy would fail with `tsc: command not found`.

```json
"scripts": {
  "dev":                  "vercel dev",
  "typecheck":            "tsc --noEmit --project tsconfig.json",
  "typecheck:prod":       "tsc --noEmit --project tsconfig.prod.check.json",
  "inject:public-config": "node scripts/inject-public-config.mjs",
  "build":                "node scripts/inject-public-config.mjs",
  "build:check":          "node scripts/inject-public-config.mjs && tsc --noEmit --project tsconfig.json",
  "test":                 "vitest run"
}
```

### Why `build` is "inject only"

| Concern            | `build` (Vercel deploy)                                  | `build:check` (local / CI)                                    |
|--------------------|----------------------------------------------------------|---------------------------------------------------------------|
| Environment        | `NODE_ENV=production`, prod install (no devDeps)         | full install (devDependencies available)                      |
| Purpose            | produce the `frontend-dist/` artifact                    | catch regressions before they reach `main`                    |
| Runs `tsc`?        | No — TypeScript is a devDependency                       | Yes — via `tsconfig.json`                                     |
| Blocks deploy on?  | Only actual artifact failures (inject crashes)           | Type errors, test failures, missing pages                     |

The quality gate is enforced in `.github/workflows/ci.yml`, which runs
three jobs on every push/PR to `main`:

1. **typecheck** — `npm run typecheck && npm run typecheck:prod`
2. **test** — `npm test` (vitest)
3. **build-dryrun** — `npm run inject:public-config` in lenient mode and
   verifies the 8 expected pages exist under `frontend-dist/pages/`.

### Optional scripts (not shipped by default)

Add these if/when the corresponding tooling is introduced:

```json
"test:watch":        "vitest",
"coverage":          "vitest run --coverage",
"lint":              "eslint . --ext .ts,.tsx",
"format":            "prettier --write .",
"supabase:push":     "supabase db push",
"supabase:diff":     "supabase db diff -f"
```

## 4. Dependencies (runtime — installed on Vercel production builds)

```json
"dependencies": {
  "@supabase/supabase-js": "^2.45.0",
  "pdf-lib":               "^1.17.1",
  "zod":                   "^3.23.8"
}
```

Rationale: these three packages are the only ones the running serverless
functions actually need at runtime. `@vercel/node` is a *type-only* import
(the runtime is provided by Vercel itself) and therefore lives in
`devDependencies`. Keeping the runtime surface minimal reduces the deploy
bundle and the supply-chain attack surface.

The legacy `openai: ^4.0.0` dependency has been removed in Wave 4 along
with the archived `api/openai.js` route. The OPENAI_* env vars in
`.env.example` are kept as future scaffolding for bounded, supportive AI
commentary (see blueprint §"Bounded AI"). Re-add the SDK only when a new,
PHI-aware route is implemented under `api/v1/`.

## 5. DevDependencies (installed only outside production)

```json
"devDependencies": {
  "@types/node":  "^20.14.0",
  "@vercel/node": "^3.2.0",
  "typescript":   "5.5.4",
  "vitest":       "^1.6.0"
}
```

The shipped devDependencies are intentionally minimal. Optional tooling
(eslint, prettier, `@vitest/coverage-v8`, `supabase` CLI) can be added
when the team adopts them; they are not required to build or ship.

## 6. Environment variables template (`.env.example`)

Create at the repo root:

```
# Public — safe to expose to the browser
PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
PUBLIC_SUPABASE_ANON_KEY=<anon-jwt>

# Private — server only
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<anon-jwt>
SUPABASE_SERVICE_ROLE_KEY=<service-role-jwt>

# Optional (bounded AI helpers)
OPENAI_API_KEY=

# Runtime
NODE_ENV=production
LOG_LEVEL=info
```

## 7. Vercel configuration (`vercel.json`, canonical)

The shipped `vercel.json` declares the build pipeline, per-function
duration caps, scheduled crons for GDPR retention/anonymization, and a
strict response-header baseline. The redirects block normalizes legacy
`/frontend/*` URLs to the new paths served from `frontend-dist/`.

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": null,
  "buildCommand": "npm run build",
  "installCommand": "npm install",
  "outputDirectory": "frontend-dist",
  "functions": {
    "api/v1/assessments/[id]/report.ts": { "maxDuration": 30 },
    "api/v1/patients/[id]/export.ts":    { "maxDuration": 30 },
    "api/v1/internal/retention.ts":      { "maxDuration": 60 },
    "api/v1/internal/anonymize.ts":      { "maxDuration": 60 }
  },
  "crons": [
    { "path": "/api/v1/internal/retention",  "schedule": "0 3 * * *" },
    { "path": "/api/v1/internal/anonymize",  "schedule": "0 4 * * *" }
  ],
  "redirects": [
    { "source": "/",                  "destination": "/pages/login.html", "permanent": false },
    { "source": "/frontend/:path*",   "destination": "/:path*",           "permanent": true  }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options",        "value": "DENY" },
        { "key": "Referrer-Policy",        "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy",     "value": "camera=(), microphone=(), geolocation=()" }
      ]
    }
  ]
}
```

Note: the function runtime is inferred from `engines.node` (20.x) in
`package.json`; declaring `"runtime": "nodejs20.x"` per function is
redundant and has been omitted to keep the config minimal.

## 8. Supabase storage bucket

Create a private bucket named `clinical-reports`:

```sql
insert into storage.buckets (id, name, public)
values ('clinical-reports', 'clinical-reports', false);
```

RLS policies for the bucket are covered by the signed-URL flow in
`api/v1/assessments/[id]/report.ts` — objects are never fetched directly
by the browser.
