# `_archive_legacy/` — historical pre-refactor code

**Status: NOT shipped. NOT executed at runtime. Kept for traceability only.**

Everything inside this directory was part of the consumer-style wellness app
that preceded the Wave-1..4 refactor into a B2B clinical platform. It is
preserved so the audit/changelog timeline (`docs/01-AUDIT-TECNICO.md`,
`docs/11-CHANGELOG.md`) keeps cross-references resolvable, and so future
contributors can answer "where did the legacy formula live?" without going
back through git history.

## Why this is safe to keep in-tree

- `vercel.json` builds only the new `frontend/` (via
  `scripts/inject-public-config.mjs` → `frontend-dist/`), so no HTML in this
  archive is ever served.
- `vercel.json` `functions` block declares only `api/v1/**` paths; the moved
  `openai.js`, `consent.js`, `recuperaAnagrafica.js`, `salvaAnagrafica.js`
  are outside `api/` and are not deployed.
- `package.json` no longer depends on `openai`. Any `import 'openai'` inside
  this archive is a dead reference.
- Helper directories `_archive_legacy/js`, `_archive_legacy/css`,
  `_archive_legacy/assets`, `_archive_legacy/images` are not referenced from
  the new `frontend/` (verified by grep — see Wave 4 validation gate).

## What's inside

| Path | Origin | Replaced by |
|---|---|---|
| `index.html`, `index-backup.html`, `dashboard.html`, `login.html`, `profilo.html` | Pre-refactor consumer landing & profile pages | `frontend/pages/{dashboard,patients,patient-detail,alerts,audit,assessment-new,assessment-view,login}.html` |
| `chat.html`, `chatbot.html`, `chatbot-logic.js` | Generic wellness chatbot | **Removed by scope** (blueprint: chatbot/general wellness sprawl removed) |
| `score2.html`, `score2-diabetes.html`, `ADA-score.html`, `FLI.html`, `FRAIL.html` | Per-score standalone pages | Unified clinical engine in `backend/src/domain/clinical/*` invoked by `api/v1/patients/[id]/assessments` |
| `score2-score.js`, `score2-diabetes.score.js`, `ada-score.js`, `fli-score.js`, `frail-score.js`, `js/dashboard-score.js`, `js/dashboard-logic.js` | Frontend-side score computation against `anagrafica_utenti` | `backend/src/domain/clinical/*` (server-side, deterministic, validated) |
| `login.js` | Old Supabase email/password login + `anagrafica_utenti` upsert | `frontend/pages/login.html` + `backend/src/middleware/auth-middleware.ts` (no `anagrafica_utenti`) |
| `openai.js` | OpenAI proxy with PHI sent to GPT-4 + permissive CORS | **Removed by scope.** Future bounded AI must live under `api/v1/**` with PHI redaction. |
| `consent.js` | Pre-RBAC consent endpoint with hard-coded service-role key in handler | `api/v1/consents/index.ts` (Zod-validated, RBAC-gated, append-only into `consent_records`) |
| `recuperaAnagrafica.js`, `salvaAnagrafica.js` | Email-as-key reads/writes against `anagrafica_utenti`, `Access-Control-Allow-Origin: *`, hard-coded Supabase URL | **Removed.** New flow: `api/v1/patients` with `tenant_id`-isolated, JWT-authenticated, RLS-enforced inserts. |
| `css/`, `assets/`, `images/` | Old per-page stylesheets and 3D model assets used by the consumer landing | Replaced by `frontend/assets/css/app.css`. 3D models had no clinical purpose and are not migrated. |

## Removal plan

This directory should be deleted once:

1. The Wave 4 changes have been live in production for at least one full
   billing cycle without any reference to legacy paths in error logs.
2. The `docs/01-AUDIT-TECNICO.md` audit narrative is regenerated to refer to
   git history rather than in-tree paths.
3. A final `git tag` is created at the point of removal so the legacy code
   remains recoverable from history.

Until then, do not modify or import from anything in this directory.
