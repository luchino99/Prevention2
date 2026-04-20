# Deprecated legacy files — removal manifest

This document lists legacy top-level HTML/JS files that MUST be removed or
redirected after the B2B frontend (`frontend/pages/*`) is deployed.

The deletions are intentionally staged so that the current production surface
keeps working until the new pages are wired into the deployment pipeline.

## Must be removed (consumer-app / non-clinical scope)

| Path                          | Reason                                                                                                      | Replacement                       |
|-------------------------------|-------------------------------------------------------------------------------------------------------------|-----------------------------------|
| `chatbot.html`                | Generic wellness chatbot. Out of clinical scope; violates bounded-AI rule.                                  | Removed — no replacement          |
| `chat.html`                   | Consumer symptom chat. Unsafe clinical positioning.                                                         | Removed — no replacement          |
| `chatbot-logic.js`            | Client-side chat engine.                                                                                    | Removed                           |
| `diet-plan.html` / `mealplan*`| Full meal plan generator — removed from scope.                                                              | Diet-quality monitoring (PREDIMED) inside assessment |
| `workout*.html`               | Training program generator — removed from scope.                                                            | Activity captured as risk/lifestyle variable only   |
| `exercise-plan*.js`           | Exercise prescription logic.                                                                                | Removed                           |
| `index.html` (current)        | Consumer landing page.                                                                                      | New B2B landing (`frontend/pages/index.html`, TBD)  |
| `login.html` (current, root)  | Uses email-as-key, weak CSP, no RLS awareness.                                                              | `frontend/pages/login.html`       |
| `dashboard.html` (current)    | Self-service, single-user logic, iframe/postMessage architecture, reads anagrafica by email.               | `frontend/pages/dashboard.html`   |
| `anagrafica.html`             | Self-service anagraphics for a single user.                                                                 | `frontend/pages/patient-detail.html` (TBD)          |
| `api/recuperaAnagrafica.js`   | Query patient by email, no auth, unsafe.                                                                    | `api/v1/patients/[id]` (with RBAC + RLS)            |
| `api/salvaAnagrafica.js`      | Upsert by email without authorization.                                                                      | `api/v1/patients` POST / PATCH    |
| `api/openai.js`               | Unbounded AI with consumer wellness framing.                                                                | Bounded AI services in `backend/src/services/ai/*` (TBD) |
| `api/consent.js` (legacy)     | Single-record consent model without versioning.                                                             | `api/v1/consents` (versioned)     |

## Must be refactored (keep, but rework)

| Path                          | Current state                                                                                                      | Action                                                                                                 |
|-------------------------------|--------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------|
| `engine/**` (validated scores)| Contains SCORE2, SCORE2-Diabetes, ADA, FLI, FRAIL, BMI, MetS formulas.                                              | Formulas are preserved in `backend/src/domain/clinical/score-engine/*`. Legacy folder can be archived once equivalence tests pass. |
| `supabase-client.js` (root)   | Exposes anon key inline; used by multiple HTML files.                                                              | Replaced by `frontend/assets/js/api-client.js` which uses `__UELFY_CONFIG__`.                          |
| `index.html` structure        | Multi-iframe layout with postMessage.                                                                              | Replaced by a single app shell under `frontend/pages`.                                                 |

## Archival procedure

1. Run the new equivalence test suite (`tests/equivalence/*`) — all scores must match legacy output to 1e-9 tolerance.
2. Tag the last commit that still contains legacy files as `legacy-final` for historical traceability.
3. Move the files listed above to `/_legacy_archive/` (kept out of deploy) with a README explaining their deprecated status.
4. After one release cycle with the new frontend in production, delete `/_legacy_archive/`.
