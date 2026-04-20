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

```diff
+  "engines": { "node": ">=20.0.0" },
```

## 3. Scripts (replace the minimal `dev` with the full toolchain)

```json
"scripts": {
  "dev":               "vercel dev",
  "build":             "tsc --noEmit",
  "typecheck":         "tsc --noEmit",
  "test":              "vitest run --config tests/vitest.config.ts",
  "test:watch":        "vitest --config tests/vitest.config.ts",
  "test:equivalence":  "vitest run --config tests/vitest.config.ts tests/equivalence",
  "test:unit":         "vitest run --config tests/vitest.config.ts tests/unit",
  "test:integration":  "vitest run --config tests/vitest.config.ts tests/integration",
  "coverage":          "vitest run --config tests/vitest.config.ts --coverage",
  "lint":              "eslint . --ext .ts,.tsx",
  "format":            "prettier --write .",
  "supabase:push":     "supabase db push",
  "supabase:diff":     "supabase db diff -f"
},
```

## 4. Dependencies (runtime)

```json
"dependencies": {
  "@supabase/supabase-js": "^2.43.4",
  "@vercel/node":          "^3.0.26",
  "pdf-lib":               "^1.17.1",
  "zod":                   "^3.23.8"
}
```

The legacy `openai: ^4.0.0` entry can remain installed if needed by the
archived `api/openai.js` during the transition window; remove it once the
legacy route is deleted.

## 5. DevDependencies

```json
"devDependencies": {
  "@types/node":          "^20.12.12",
  "@typescript-eslint/eslint-plugin": "^7.11.0",
  "@typescript-eslint/parser":        "^7.11.0",
  "@vitest/coverage-v8":  "^1.6.0",
  "eslint":               "^9.3.0",
  "prettier":             "^3.2.5",
  "supabase":             "^1.172.0",
  "typescript":           "^5.4.5",
  "vitest":               "^1.6.0"
}
```

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

## 7. Vercel configuration hints (`vercel.json`, optional)

```json
{
  "functions": {
    "api/v1/**/*.ts": {
      "runtime": "nodejs20.x",
      "memory": 1024,
      "maxDuration": 15
    }
  },
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options",        "value": "DENY" },
        { "key": "Referrer-Policy",        "value": "strict-origin-when-cross-origin" }
      ]
    }
  ]
}
```

## 8. Supabase storage bucket

Create a private bucket named `clinical-reports`:

```sql
insert into storage.buckets (id, name, public)
values ('clinical-reports', 'clinical-reports', false);
```

RLS policies for the bucket are covered by the signed-URL flow in
`api/v1/assessments/[id]/report.ts` — objects are never fetched directly
by the browser.
