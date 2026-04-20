# PIANO DI REFACTOR E ARCHITETTURA TARGET
## HealthAI -> Piattaforma B2B Cardio-Nefro-Metabolica

---

## 1. ARCHITETTURA CARTELLE FINALE

```
/app
  /frontend                          # Next.js 14+ App Router
    /public
      /images
      favicon.ico
    /src
      /app                            # Route-based pages
        /auth
          /login/page.tsx
          /callback/page.tsx
        /dashboard/page.tsx            # Dashboard professionista
        /patients
          /page.tsx                    # Lista pazienti
          /[patientId]
            /page.tsx                  # Scheda paziente
            /assessments
              /new/page.tsx            # Nuovo assessment
              /[assessmentId]/page.tsx # Dettaglio assessment
            /reports/page.tsx          # Report paziente
        /settings/page.tsx
        /patient-portal               # Portale paziente (ruolo patient)
          /page.tsx
          /trends/page.tsx
          /consents/page.tsx
        layout.tsx
        globals.css
      /components
        /ui                            # Design system base
          Button.tsx, Card.tsx, Badge.tsx, Modal.tsx, Input.tsx, Select.tsx
        /charts
          RiskGauge.tsx, TrendLine.tsx, ScoreRadar.tsx
        /forms
          AssessmentForm.tsx, PatientForm.tsx, MeasurementsForm.tsx
        /scores
          ScoreCard.tsx, ScoreSummary.tsx, CompositeRiskBadge.tsx
        /alerts
          AlertBanner.tsx, AlertList.tsx
        /layout
          Sidebar.tsx, Header.tsx, PatientNav.tsx
      /lib
        /api-client                    # Fetch wrapper con auth
          index.ts
        /auth
          supabase-client.ts           # UNICO punto Supabase config
          auth-provider.tsx
          use-session.ts
        /validation
          assessment-schema.ts
          patient-schema.ts
        /formatters
          date.ts, score.ts, units.ts
      /styles
        design-tokens.css

  /backend                             # Node.js / Express o Vercel Functions
    /src
      /api
        /auth
          session.ts                   # POST /api/auth/session
          me.ts                        # GET /api/me
        /patients
          list.ts                      # GET /api/patients
          create.ts                    # POST /api/patients
          detail.ts                    # GET /api/patients/:id
          update.ts                    # PATCH /api/patients/:id
        /assessments
          list.ts                      # GET /api/patients/:id/assessments
          create.ts                    # POST /api/patients/:id/assessments
          detail.ts                    # GET /api/assessments/:id
        /reports
          generate.ts                  # POST /api/assessments/:id/report
          download.ts                  # GET /api/reports/:id/download
        /alerts
          list.ts                      # GET /api/patients/:id/alerts
          ack.ts                       # POST /api/alerts/:id/ack
        /consents
          create.ts                    # POST /api/consents
          history.ts                   # GET /api/consents/:subjectId
        /admin
          audit.ts                     # GET /api/admin/audit
        /ai
          tips.ts                      # POST /api/ai/nutrition-tips
          summary.ts                   # POST /api/ai/report-summary
      /domain
        /clinical
          /score-engine
            index.ts                   # Orchestratore
            score2.ts
            score2-diabetes.ts
            ada.ts
            fli.ts
            frail.ts
            bmi.ts
            metabolic-syndrome.ts
            fib4.ts
            egfr.ts                    # NUOVO: CKD-EPI 2021
          /risk-aggregation
            composite-risk.ts
            risk-categories.ts
          /screening-engine
            required-screenings.ts
          /followup-engine
            followup-plan.ts
            timeline.ts
          /nutrition-engine
            predimed.ts
            caloric-needs.ts
            diet-quality.ts
          /activity-engine
            activity-assessment.ts
            sedentary-risk.ts
          /alert-engine
            alert-rules.ts
            alert-deriver.ts
          /report-engine
            report-payload.ts
            pdf-generator.ts
      /security
        auth-middleware.ts
        rbac.ts
        tenant-isolation.ts
      /audit
        audit-logger.ts
      /notifications
        notification-service.ts
      /repositories
        patient-repo.ts
        assessment-repo.ts
        score-repo.ts
        alert-repo.ts
        consent-repo.ts
        audit-repo.ts
      /services
        assessment-service.ts          # Orchestrazione: assessment -> scores -> risk -> alerts -> report
        patient-service.ts
        report-service.ts
      /templates
        /pdf
          clinical-report.ts
      /config
        env.ts                         # Validazione env vars
        supabase.ts                    # Server-side Supabase (service role)
      /middleware
        cors.ts
        rate-limit.ts
        security-headers.ts
        validate.ts
      /utils
        crypto.ts
        date.ts

  /shared                              # Codice condiviso frontend/backend
    /types
      patient.ts
      assessment.ts
      score.ts
      alert.ts
      consent.ts
      api.ts
    /constants
      score-thresholds.ts
      risk-categories.ts
      clinical-ranges.ts
    /schemas
      assessment-input.ts              # Zod schema
      patient-input.ts
      measurement-ranges.ts

  /tests
    /unit
      /score-engine
        score2.test.ts
        score2-diabetes.test.ts
        ada.test.ts
        fli.test.ts
        frail.test.ts
        bmi.test.ts
        metabolic-syndrome.test.ts
        fib4.test.ts
        egfr.test.ts
      /risk-aggregation
        composite-risk.test.ts
      /alert-engine
        alert-rules.test.ts
    /integration
      assessment-flow.test.ts
      patient-crud.test.ts
      report-generation.test.ts
      consent-flow.test.ts
    /e2e
      login.test.ts
      dashboard.test.ts
      patient-detail.test.ts
      assessment-create.test.ts
    /fixtures
      patients.json
      assessments.json
      golden-scores.json               # Output attesi per test equivalenza

  /supabase
    /migrations
      001_tenants.sql
      002_users_roles.sql
      003_patients.sql
      004_clinical_profiles.sql
      005_assessments.sql
      006_score_results.sql
      007_risk_profiles.sql
      008_nutrition_activity.sql
      009_followup_alerts.sql
      010_consents_audit.sql
      011_reports_notifications.sql
      012_rls_policies.sql
      013_indexes.sql
    /policies
      tenant_isolation.sql
      clinician_access.sql
      patient_portal.sql
    /seed
      demo_tenant.sql
      demo_professional.sql
      demo_patients.sql

  /docs
    01-AUDIT-TECNICO.md
    02-PIANO-REFACTOR.md
    03-ARCHITECTURE.md
    04-API-SPEC.md
    05-THREAT-MODEL.md
    06-GDPR-MAP.md
    CHANGELOG.md
```

---

## 2. SEQUENZA DI IMPLEMENTAZIONE

### FASE 1: Fondamenta Sicurezza + Schema Database (Priorita massima)

**Obiettivo:** Eliminare tutte le vulnerabilita critiche, creare lo schema B2B multi-tenant.

1. Creare config centralizzata (`/backend/src/config/env.ts`) con validazione env vars
2. Scrivere migrazioni SQL per le 16 tabelle target
3. Implementare RLS policies per isolamento tenant
4. Creare auth middleware con JWT validation
5. Creare RBAC middleware (platform_admin, tenant_admin, clinician, assistant_staff, patient)
6. Implementare security headers middleware
7. Creare audit logger

**Output:** Database pronto, auth funzionante, zero credenziali esposte.

### FASE 2: Clinical Engine (Score puri)

**Obiettivo:** Estrarre tutte le formule in moduli TypeScript puri, testati con equivalenza pre/post.

1. Estrarre SCORE2 da `score2.html` -> `score-engine/score2.ts`
2. Estrarre SCORE2-Diabetes da `score2-diabetes.html` -> `score-engine/score2-diabetes.ts`
3. Estrarre ADA da `ADA-score.html` -> `score-engine/ada.ts`
4. Estrarre FLI da `FLI.html` -> `score-engine/fli.ts`
5. Estrarre FRAIL da `FRAIL.html` -> `score-engine/frail.ts`
6. Estrarre BMI, MetS, FIB-4 da `dashboard-logic.js`
7. Estrarre PREDIMED da `dashboard-logic.js`
8. Implementare eGFR CKD-EPI 2021 (nuovo)
9. Scrivere test di equivalenza con fixture golden
10. Creare orchestratore `buildAssessmentSnapshot()`

**Output:** Clinical engine completo, deterministico, testato.

### FASE 3: De-scope Prodotto

**Obiettivo:** Rimuovere feature consumer, mantenere solo verticale clinico.

1. Rimuovere `chat.html`, `chatbot-logic.js`, `chatbot.html`
2. Rimuovere sezione piano alimentare completo da dashboard
3. Rimuovere sezione piano allenamento da dashboard
4. Rimuovere `build/`, `assets/models/`
5. Rimuovere bridge iframe: `score2-score.js`, `score2-diabetes.score.js`, `ada-score.js`, `fli-score.js`, `frail-score.js`
6. Rimuovere `api/recuperaAnagrafica.js`, `api/salvaAnagrafica.js`
7. Rimuovere `index-backup.html`

**Output:** Codebase pulita, solo feature B2B cliniche.

### FASE 4: API Backend

**Obiettivo:** Creare API server-side sicure per tutte le operazioni.

1. `POST /api/auth/session` - Bootstrap sessione
2. `GET /api/me` - Profilo utente + ruolo
3. `GET/POST /api/patients` - CRUD pazienti
4. `GET/PATCH /api/patients/:id` - Dettaglio/aggiornamento
5. `POST /api/patients/:id/assessments` - Crea assessment (chiama clinical engine)
6. `GET /api/patients/:id/assessments` - Storico
7. `POST /api/assessments/:id/report` - Genera PDF
8. `GET /api/patients/:id/alerts` - Alert aperti
9. `POST /api/alerts/:id/ack` - Chiudi alert
10. `POST /api/consents` - Registra consenso
11. `GET /api/admin/audit` - Audit trail
12. `POST /api/ai/nutrition-tips` - Tips AI bounded (con consenso)

Ogni endpoint: JWT auth + RBAC + tenant isolation + input validation + audit log.

**Output:** API completa e sicura.

### FASE 5: Frontend B2B

**Obiettivo:** Nuova UI professionista + portale paziente.

1. Login page hardened con legal links
2. Dashboard professionista: lista pazienti, alert, follow-up scadenza
3. Scheda paziente: overview clinica, timeline assessments, trend score
4. Form nuovo assessment: parametri + storia + lab + lifestyle
5. Visualizzazione risultati: score cards, composite risk, screening suggeriti
6. Portale paziente: trend, reminder, consensi, report condivisi

**Output:** Frontend B2B funzionale.

### FASE 6: Report PDF + Alert

**Obiettivo:** Report clinico professionale server-side + sistema alert intelligenti.

1. PDF engine con: dati paziente, score, risk composite, screening, follow-up, trend, disclaimer
2. Branding tenant (logo, nome clinica, professionista)
3. Signed URL temporanei per download
4. Alert engine: clinical_risk_up, followup_due, missing_data, red_flag, diet_adherence_drop, activity_decline
5. Notification service per alert

**Output:** Report PDF professionale + alert attivi.

### FASE 7: GDPR Operazionalizzazione

**Obiettivo:** Consent versioning, retention, export/deletion workflow.

1. Consent records con policy_version, granted_at, revoked_at, legal_basis
2. Data export endpoint (patient right of access)
3. Data deletion/anonymization workflow
4. Retention policy engine
5. AI usage sotto consenso separato con data minimization

**Output:** Compliance GDPR operativa.

### FASE 8: Test + Hardening Finale

**Obiettivo:** Test suite completa, penetration testing, go-live readiness.

1. Unit test su ogni score (equivalenza pre/post)
2. Integration test su flusso assessment completo
3. Security test su RLS (cross-tenant isolation)
4. E2E test su flussi principali
5. Performance test su dashboard e query storiche
6. Security checklist finale

**Output:** Applicazione pronta per beta controllata.

---

## 3. STACK TECNOLOGICO TARGET

| Layer | Tecnologia | Motivazione |
|-------|-----------|-------------|
| Frontend | Next.js 14 (App Router) + TypeScript | SSR, routing, API routes integrate |
| Styling | Tailwind CSS 3 + shadcn/ui | Design system professionale |
| Charts | Chart.js o Recharts | Gia in uso, maturo |
| State | React Context + SWR/TanStack Query | Semplice, cache-friendly |
| Backend | Next.js API Routes o Express standalone | Integrato o separabile |
| Database | Supabase (PostgreSQL) | Gia in uso, RLS nativo |
| Auth | Supabase Auth + custom RBAC | JWT, multi-tenant |
| PDF | @react-pdf/renderer o pdfkit (server) | Server-side, professionale |
| AI | OpenAI API (bounded, opzionale) | Solo tips non prescrittivi |
| Testing | Vitest + Playwright | Unit + E2E |
| Deploy | Vercel | Gia in uso |
| Validation | Zod | Schema validation shared |

---

## 4. MIGRAZIONE DATI

### Da `anagrafica_utenti` monolitica a schema normalizzato:

```
anagrafica_utenti (legacy)
  |
  +-> users (auth profile: user_id, email, role, tenant_id)
  +-> professionals (user_id, license, specialty, clinic)
  +-> patients (id, tenant_id, created_by, display_name, sex, birth_year, external_code)
  +-> patient_clinical_profiles (patient_id, smoking, diagnoses, medications, allergies)
  +-> assessments (id, patient_id, assessed_by, date, status)
  +-> assessment_measurements (assessment_id, bmi, waist, sbp, dbp, labs...)
  +-> score_results (assessment_id, score_code, value, category, payload)
  +-> nutrition_snapshots (assessment_id, predimed_score, adherence_band)
  +-> activity_snapshots (assessment_id, minutes_per_week, sedentary_level)
```

### Script di migrazione:
1. Per ogni email in `anagrafica_utenti`, creare patient + clinical_profile
2. Creare un assessment "legacy import" con tutti i dati attuali
3. Calcolare score_results con il nuovo clinical engine
4. Verificare equivalenza con valori salvati
5. Marcare migrazione completata

---

## 5. MAPPING FILE ATTUALI -> TARGET

| File attuale | Azione | Target |
|-------------|--------|--------|
| `index.html` | REWRITE | `frontend/src/app/page.tsx` (landing B2B) |
| `login.html` + `login.js` | REFACTOR | `frontend/src/app/auth/login/page.tsx` |
| `dashboard.html` + `dashboard-logic.js` | REWRITE | `frontend/src/app/dashboard/page.tsx` |
| `profilo.html` | REFACTOR | `frontend/src/app/patients/[id]/page.tsx` |
| `score2.html` (formula) | EXTRACT | `backend/src/domain/clinical/score-engine/score2.ts` |
| `score2-diabetes.html` (formula) | EXTRACT | `backend/src/domain/clinical/score-engine/score2-diabetes.ts` |
| `ADA-score.html` (formula) | EXTRACT | `backend/src/domain/clinical/score-engine/ada.ts` |
| `FLI.html` (formula) | EXTRACT | `backend/src/domain/clinical/score-engine/fli.ts` |
| `FRAIL.html` (formula) | EXTRACT | `backend/src/domain/clinical/score-engine/frail.ts` |
| `dashboard-logic.js` (BMI,MetS,FIB4,PREDIMED) | EXTRACT | Moduli score-engine + nutrition-engine |
| `api/consent.js` | REFACTOR | `backend/src/api/consents/create.ts` |
| `api/openai.js` | REFACTOR | `backend/src/api/ai/tips.ts` + `summary.ts` |
| `chatbot.html`, `chat.html`, `chatbot-logic.js` | REMOVE | - |
| `score2-score.js`, etc. (bridges) | REMOVE | - |
| `api/recuperaAnagrafica.js` | REMOVE | - |
| `api/salvaAnagrafica.js` | REMOVE | - |
| `build/`, `assets/models/` | REMOVE | - |
| `css/*.css` | REPLACE | Tailwind + design tokens |

---

## 6. RISCHI E MITIGAZIONI

| Rischio | Probabilita | Impatto | Mitigazione |
|---------|------------|---------|-------------|
| Regressione formule score | Media | Critico | Test equivalenza con fixture golden PRIMA del refactor |
| Perdita dati migrazione | Bassa | Critico | Backup pre-migrazione + script reversibile + verifica |
| Tempi di sviluppo | Alta | Alto | Fasi incrementali, MVP per fase |
| Complessita RLS | Media | Alto | Test automatizzati cross-tenant |
| GDPR non completa | Media | Alto | Consulenza legale parallela |

---

## 7. DEFINITION OF DONE PER FASE

### Fase 1 (Sicurezza + DB):
- [ ] Zero credenziali hardcoded nel frontend
- [ ] Schema 16 tabelle creato
- [ ] RLS attiva su tutte le tabelle sanitarie
- [ ] Auth middleware funzionante con JWT
- [ ] RBAC implementato per 5 ruoli
- [ ] Audit logger attivo

### Fase 2 (Clinical Engine):
- [ ] 9 score estratti in moduli puri TypeScript
- [ ] eGFR CKD-EPI implementato
- [ ] Test equivalenza passano al 100%
- [ ] Orchestratore buildAssessmentSnapshot funzionante
- [ ] Zero dipendenze da iframe/postMessage

### Fase 3 (De-scope):
- [ ] Chatbot rimosso
- [ ] Piano alimentare rimosso
- [ ] Piano allenamento rimosso
- [ ] Bridge iframe rimossi
- [ ] API insicure rimosse

### Fase 4-8: (definiti nei rispettivi deliverable)
