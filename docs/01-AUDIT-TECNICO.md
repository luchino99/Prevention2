# AUDIT TECNICO COMPLETO - HealthAI / Uelfy
## Trasformazione B2B Piattaforma Cardio-Nefro-Metabolica

**Data audit:** 2026-04-19  
**Auditor:** Principal Engineer / CTO  
**Scope:** Intera codebase attuale  
**Obiettivo:** Mappare stato attuale, vulnerabilita, formule score, dipendenze, e decisioni keep/refactor/remove

---

## 1. INVENTARIO FILE E RESPONSABILITA

### 1.1 Frontend Pages (HTML)

| File | Ruolo attuale | Decisione | Motivazione |
|------|--------------|-----------|-------------|
| `index.html` | Landing page consumer "wellness AI" | **REWRITE** | Riposizionare come B2B clinico per professionisti sanitari |
| `login.html` | Login/Signup con campi consumer (eta, sesso, altezza, peso) | **REFACTOR** | Rimuovere campi clinici dal signup, aggiungere ruoli, legal links |
| `chatbot.html` | App shell con sidebar + iframe | **REPLACE** | Eliminare architettura iframe, creare SPA con router |
| `chat.html` | Chat UI con 4 modalita (sintomi, prevenzione, dieta, allenamento) | **REMOVE** | Chatbot generalista fuori scope B2B |
| `dashboard.html` | Dashboard consumer con score + piano alimentare + allenamento | **REWRITE** | Dashboard B2B professionista con lista pazienti, alert, report |
| `profilo.html` | Profilo utente singolo con 50+ campi + avatar base64 | **REFACTOR** | Trasformare in scheda paziente multi-sezione |
| `score2.html` | Calcolatore SCORE2 standalone (iframe) | **EXTRACT** | Estrarre formula in modulo puro, eliminare pagina iframe |
| `score2-diabetes.html` | Calcolatore SCORE2-Diabetes standalone (iframe) | **EXTRACT** | Estrarre formula in modulo puro |
| `ADA-score.html` | Calcolatore ADA Diabetes Risk (iframe) | **EXTRACT** | Estrarre formula in modulo puro |
| `FLI.html` | Calcolatore Fatty Liver Index (iframe) | **EXTRACT** | Estrarre formula in modulo puro |
| `FRAIL.html` | Calcolatore FRAIL scale (iframe) | **EXTRACT** | Estrarre formula in modulo puro |
| `index-backup.html` | Backup vecchio | **REMOVE** | Non necessario |

### 1.2 JavaScript Modules

| File | Ruolo attuale | Decisione |
|------|--------------|-----------|
| `login.js` | Auth Supabase + insert anagrafica con email | **REFACTOR** |
| `chatbot-logic.js` | Engine conversazionale 4 modalita + salvataggio | **REMOVE/REPLACE** |
| `score2-score.js` | Bridge iframe: popola form SCORE2 + ascolta postMessage | **REMOVE** |
| `score2-diabetes.score.js` | Bridge iframe: popola form SCORE2-D + ascolta postMessage | **REMOVE** |
| `ada-score.js` | Bridge iframe: popola form ADA + ascolta postMessage | **REMOVE** |
| `fli-score.js` | Bridge iframe: popola form FLI + ascolta postMessage | **REMOVE** |
| `frail-score.js` | Bridge iframe: popola form FRAIL + ascolta postMessage | **REMOVE** |
| `js/dashboard-logic.js` | Logica dashboard: BMI, PREDIMED, MetS, FIB4, TDEE, macro | **EXTRACT+REFACTOR** |
| `js/dashboard-score.js` | Lettura score da DB per display dashboard | **REMOVE** |

### 1.3 API Routes (Vercel Serverless)

| File | Ruolo | Decisione |
|------|-------|-----------|
| `api/recuperaAnagrafica.js` | GET anagrafica per email, no auth | **REMOVE** |
| `api/salvaAnagrafica.js` | Upsert anagrafica per email, no auth, no validation | **REMOVE** |
| `api/consent.js` | Salva consenso con JWT + RPC | **REFACTOR** |
| `api/openai.js` | 6 modalita AI con invio PHI a OpenAI | **REFACTOR** |

### 1.4 Assets e Config

| File | Decisione |
|------|-----------|
| `css/*.css` | **REPLACE** con design system B2B |
| `images/logo.png`, `logo.png` | **KEEP** |
| `build/` (Three.js, GLTFLoader, 3Drenderer) | **REMOVE** (decorativo, non clinico) |
| `assets/models/*.glb` | **REMOVE** |
| `package.json` | **REWRITE** |
| `vercel.json` | **REWRITE** |
| `final_favicon.ico` | **KEEP** |

---

## 2. VULNERABILITA DI SICUREZZA CRITICHE

### 2.1 Credenziali Hardcoded nel Frontend

**Severita: CRITICA**

La stessa coppia Supabase URL + anon key e hardcoded in **8+ file** client-side:

```
URL:  https://nkkaxbmzacaxkwgtfmds.supabase.co
Key:  eyJhbGciOiJIUzI1NiIs... (JWT anon, exp 2069)
```

**File affetti:** `login.js`, `chatbot.html`, `chatbot-logic.js`, `profilo.html`, `score2-score.js`, `score2-diabetes.score.js`, `ada-score.js`, `fli-score.js`, `frail-score.js`, `js/dashboard-logic.js`, `js/dashboard-score.js`

**Rischio:** Chiunque puo ispezionare il browser e usare questa chiave per leggere/scrivere sulla tabella `anagrafica_utenti` se RLS non e attiva. La chiave scade nel 2069.

**Azione:** Ruotare tutte le chiavi. Centralizzare la configurazione in un singolo modulo. Non esporre mai service_role_key nel frontend.

### 2.2 Email come Chiave Applicativa

**Severita: CRITICA**

Tutte le query usano `.eq("email", email)` come filtro primario:

```javascript
// Pattern ripetuto in TUTTI i file
const { data } = await supabaseClient
  .from("anagrafica_utenti")
  .select("*")
  .eq("email", email);
```

**Rischio IDOR:** Se RLS non filtra per `auth.uid()`, qualsiasi utente autenticato puo passare un'email diversa e accedere ai dati di un altro utente.

**Rischio multi-paziente:** Impossibile avere piu pazienti per professionista con modello email=utente.

**Azione:** Migrare a `user_id` (UUID da auth.users), introdurre `patient_id`, `tenant_id`.

### 2.3 postMessage con Wildcard Origin

**Severita: ALTA**

Tutti i bridge iframe usano `postMessage(data, "*")` e i listener non validano `event.origin`:

```javascript
// Invio (es. score2-score.js)
iframe.contentWindow.postMessage({ action: "extract_score2" }, "*");

// Ricezione (es. score2.html) 
window.addEventListener("message", function(event) {
  // NESSUN CHECK su event.origin
  if (event.data.action === "extract_score2") { ... }
});
```

**Rischio:** Message injection da qualsiasi pagina/iframe sullo stesso browser. Un attaccante puo iniettare risultati score falsi.

**Azione:** Eliminare architettura iframe. Portare calcoli in moduli JS puri importati direttamente.

### 2.4 API Endpoints Senza Autenticazione

**Severita: CRITICA**

`api/recuperaAnagrafica.js` e `api/salvaAnagrafica.js` non verificano JWT/session:

```javascript
// recuperaAnagrafica.js - NESSUN auth check
export default async function handler(req, res) {
  const { email } = req.body;
  const { data } = await supabase.from("anagrafica_utenti").select("*").eq("email", email);
  res.status(200).json(data);
}
```

**Rischio:** Chiunque puo chiamare POST con qualsiasi email e ottenere/modificare tutti i dati clinici.

**Azione:** Eliminare questi endpoint. Ricreare con JWT validation, RBAC, audit logging.

### 2.5 PHI Inviati a OpenAI Senza DPA

**Severita: CRITICA (Compliance)**

`api/openai.js` invia 50+ parametri clinici (HbA1c, glicemia, pressione, colesterolo, farmaci, diagnosi) a OpenAI GPT-4:

```javascript
const prompt = `Sei un medico. Analizza questo paziente:
  BMI: ${userData.bmi}, Glicemia: ${userData.glicemia}, 
  HbA1c: ${userData.hba1c}, Farmaci: ${userData.farmaci}...`;
```

**Rischio GDPR:** Invio di dati sanitari a provider terzo senza base giuridica documentata, DPA, DPIA, consenso specifico. Violazione art. 9, 28, 35 GDPR.

**Azione:** Per il B2B, AI deve essere opzionale, sotto consenso separato, con dati minimizzati e pseudonimizzati.

### 2.6 Avatar in Base64 nei Record

**Severita: MEDIA**

`profilo.html` salva immagini profilo come stringhe base64 nel campo del database:

**Rischio:** Bloat del database (1 immagine = 100KB-2MB in base64), performance degradata, backup inflazionati.

**Azione:** Migrare a object storage (Supabase Storage) con signed URL temporanei.

### 2.7 CORS Wildcard su API Backend

**Severita: ALTA**

`api/recuperaAnagrafica.js` e `api/salvaAnagrafica.js` usano `Access-Control-Allow-Origin: *`

**Azione:** Whitelist di domini autorizzati.

### 2.8 Nessun Security Header

**Severita: ALTA**

Nessun file/config implementa: CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy, X-Content-Type-Options, Strict-Transport-Security.

---

## 3. MAPPATURA QUERY BASATE SU EMAIL

| File | Operazione | Tabella | Fix richiesto |
|------|-----------|---------|---------------|
| `login.js:93` | INSERT | anagrafica_utenti | Usare auth.uid() |
| `score2-score.js:20` | SELECT | anagrafica_utenti | Migrare a patient_id |
| `score2-score.js:82` | UPDATE | anagrafica_utenti | Migrare a assessment_id |
| `score2-diabetes.score.js:23` | SELECT | anagrafica_utenti | Migrare a patient_id |
| `score2-diabetes.score.js:78` | UPDATE | anagrafica_utenti | Migrare a assessment_id |
| `ada-score.js:23` | SELECT | anagrafica_utenti | Migrare a patient_id |
| `ada-score.js:110` | UPDATE | anagrafica_utenti | Migrare a assessment_id |
| `fli-score.js:25` | SELECT | anagrafica_utenti | Migrare a patient_id |
| `fli-score.js:58` | UPDATE | anagrafica_utenti | Migrare a assessment_id |
| `frail-score.js:23` | SELECT | anagrafica_utenti | Migrare a patient_id |
| `dashboard-logic.js:674` | SELECT * | anagrafica_utenti | Migrare a patient_id via assessment |
| `dashboard-logic.js:264+` | UPDATE (multipli) | anagrafica_utenti | Migrare a entita separate |
| `dashboard-score.js:34` | SELECT | anagrafica_utenti | Migrare a score_results |
| `api/recuperaAnagrafica.js` | SELECT | anagrafica_utenti | Eliminare endpoint |
| `api/salvaAnagrafica.js` | UPSERT | anagrafica_utenti | Eliminare endpoint |
| `chatbot-logic.js:870+` | SELECT/UPDATE | anagrafica_utenti | Eliminare chatbot consumer |

**Totale: 16+ operazioni email-based da migrare**

---

## 4. FORMULE DEGLI SCORE CLINICI - INVENTARIO E PRESERVAZIONE

### 4.1 SCORE2 (Rischio Cardiovascolare 10 anni - ESC 2021)

**Fonte:** `score2.html` linee 430-575  
**Status:** Formula completa e corretta  
**Preservare:** SI - logica matematica intatta

```
Variabili: eta, sesso, fumatore, PAS, colesterolo_totale (mg/dL->mmol/L), HDL (mg/dL->mmol/L), regione
Conversione: chol_mmol = chol_mgdl / 38.67; hdl_mmol = hdl_mgdl / 38.67
Trasformazioni: cage=(eta-60)/5, csbp=(PAS-120)/20, ctchol=(tchol_mmol-6), chdl=(hdl_mmol-1.3)/0.5

Coefficienti gender-specifici (maschio/femmina) per:
  eta, fumo, PAS, colesterolo, HDL, 
  interazioni: fumo*eta, PAS*eta, colesterolo*eta, HDL*eta

X = somma(beta_i * variabile_i)
risk_uncalibrated = 1 - S0^exp(X)
risk_calibrated = [1 - exp(-exp(scale1 + scale2 * ln(-ln(1-risk))))] * 100

Calibrazione per 4 regioni europee (low/moderate/high/very_high) con scale gender-specifiche.

Categorie: Basso <5%, Moderato 5-10%, Alto 10-15%, Molto alto >=15% (aggiustate per eta)
```

### 4.2 SCORE2-Diabetes (Rischio CV con Diabete Tipo 2 - ESC 2021)

**Fonte:** `score2-diabetes.html` linee 420-570  
**Status:** Formula completa e corretta  
**Preservare:** SI

```
Variabili aggiuntive vs SCORE2: eta_diagnosi_diabete, HbA1c, eGFR
Conversione HbA1c: % -> mmol/mol = (% - 2.15) * 10.929
Trasformazione eGFR: (ln(eGFR) - 4.5) / 0.15
Trasformazione HbA1c_mmol: (HbA1c_mmol - 31) / 9.34

17 coefficienti (vs 9 di SCORE2) incluse interazioni diabete-specifiche
Stessa calibrazione regionale di SCORE2
```

### 4.3 ADA Diabetes Risk Score (Screening Diabete Tipo 2)

**Fonte:** `ADA-score.html` linee 500-590  
**Status:** Formula semplice e corretta  
**Preservare:** SI

```
Score additivo 0-11 punti:
  Eta: 40-49=1, 50-59=2, >=60=3
  Sesso: maschio=1, femmina=0
  Diabete gestazionale: (solo F) si=1
  Familiarita diabete: si=1
  Ipertensione: si=1
  Inattivita fisica: si=1 (se <150 min/sett)
  BMI: 25-29.9=1, 30-39.9=2, >=40=3

Rischio: 0-2=Basso, 3-4=Moderato, >=5=Alto
```

### 4.4 FLI - Fatty Liver Index (Steatosi Epatica)

**Fonte:** `FLI.html` linee 470-555  
**Status:** Formula corretta  
**Preservare:** SI

```
BMI = peso / (altezza/100)^2
y = 0.953*ln(trigliceridi) + 0.139*BMI + 0.718*ln(GGT) + 0.053*circ_vita - 15.745
FLI = (e^y / (1 + e^y)) * 100

Categorie: <30=Steatosi esclusa, 30-59=Indeterminato, >=60=Steatosi probabile
```

### 4.5 FRAIL Scale (Fragilita)

**Fonte:** `FRAIL.html` linee 580-640  
**Status:** Formula semplice e corretta  
**Preservare:** SI (come modulo opzionale/secondario)

```
5 items binari (0/1): Fatigue, Resistance, Ambulation, Illnesses, Loss
Score totale 0-5
Categorie: 0=Robusto, 1-2=Pre-fragile, 3-5=Fragile
```

### 4.6 BMI (Body Mass Index)

**Fonte:** `js/dashboard-logic.js` linee 793-815  
**Status:** Corretto  
**Preservare:** SI

```
BMI = peso / (altezza/100)^2
Categorie: <18.5=Sottopeso, 18.5-25=Normopeso, 25-30=Sovrappeso, >=30=Obesita
```

### 4.7 PREDIMED (Aderenza Dieta Mediterranea)

**Fonte:** `js/dashboard-logic.js` linee 820-842  
**Status:** Corretto  
**Preservare:** SI

```
Somma di 14 items binari (predimed_1 ... predimed_14)
Categorie: >=10=Alta aderenza, 6-9=Media, <6=Bassa
```

### 4.8 Sindrome Metabolica (ATP III/IDF)

**Fonte:** `js/dashboard-logic.js` linee 845-886  
**Status:** Corretto  
**Preservare:** SI

```
5 criteri:
  1. Circ. vita: M>102cm, F>88cm
  2. Trigliceridi >=150 mg/dL
  3. HDL: M<40, F<50 mg/dL
  4. PAS>=130 o PAD>=85 mmHg
  5. Glicemia a digiuno >=100 mg/dL

Presente se >=3 criteri soddisfatti
```

### 4.9 FIB-4 (Fibrosi Epatica)

**Fonte:** `js/dashboard-logic.js` linee 893-937  
**Status:** Corretto  
**Preservare:** SI

```
FIB4 = (eta * AST) / (piastrine * sqrt(ALT))
Categorie: <1.45=Basso rischio, 1.45-3.25=Intermedio, >=3.25=Alto rischio fibrosi
```

### 4.10 Fabbisogno Calorico (Mifflin-St Jeor)

**Fonte:** `js/dashboard-logic.js` linee 1153-1200  
**Status:** Corretto ma fuori scope B2B principale  
**Preservare:** Parziale (solo come dato informativo, non piano alimentare)

```
BMR maschio = (10*peso) + (6.25*altezza) - (5*eta) + 5
BMR femmina = (10*peso) + (6.25*altezza) - (5*eta) - 161
Fattori attivita: sedentario=1.2, leggero=1.375, moderato=1.55, intenso=1.725, estremo=1.9
TDEE = BMR * fattore_attivita
```

### 4.11 Score da Aggiungere (Proposta)

**eGFR (CKD-EPI 2021)** - Necessario per completare il verticale "nefro":
```
eGFR = 142 * min(Scr/k, 1)^a * max(Scr/k, 1)^-1.200 * 0.9938^age * [1.012 se femmina]
dove k = 0.7(F) o 0.9(M), a = -0.241(F) o -0.302(M), Scr = creatinina sierica
```

**Albuminuria staging** (se dato disponibile):
```
A1: <30 mg/g (normale)
A2: 30-300 mg/g (moderatamente aumentata)  
A3: >300 mg/g (gravemente aumentata)
```

---

## 5. LOGICHE DUPLICATE E FRAMMENTAZIONE

### 5.1 Inizializzazione Supabase Client
Duplicata in **11 file** con copia identica di URL+key. Deve esistere in UN solo modulo.

### 5.2 Lettura Sessione Utente
Pattern `supabaseClient.auth.getSession()` + estrazione email ripetuto in ogni file.

### 5.3 Query anagrafica_utenti
Ogni score bridge fa la propria SELECT con campi diversi. Deve esistere una sola funzione di fetch dati paziente.

### 5.4 Calcolo BMI
Calcolato in: `dashboard-logic.js`, `ADA-score.html` (implicitamente), `FLI.html`, `api/openai.js` prompt. Deve essere calcolato UNA volta nel clinical engine.

### 5.5 Tema Dark/Light
Gestione tema duplicata in `chatbot.html`, `chat.html`, `dashboard-logic.js`, `profilo.html` con postMessage wildcard.

---

## 6. ANALISI FEATURE: COSA TENERE / RIMUOVERE

### DA RIMUOVERE

| Feature | File coinvolti | Motivo |
|---------|---------------|--------|
| Chatbot generalista 4 modalita | `chat.html`, `chatbot-logic.js`, `chatbot.html` | Fuori scope B2B clinico |
| Symptom checker | `chatbot-logic.js` modalita "sintomi" | Rischio medico-legale |
| Piano alimentare completo AI | `dashboard.html` form piano alimentare | Non prescrittivo nel B2B |
| Piano allenamento AI | `dashboard.html` sezione attivita | Fuori scope: no fitness coaching |
| 3D renderer / modelli GLB | `build/`, `assets/models/` | Decorativo, non clinico |
| Landing page consumer | `index.html` | Riposizionare B2B |
| Background Three.js particles | `index.html`, `login.html` | Peso inutile |
| Social login buttons (non funzionanti) | `login.html` | Non implementati |

### DA MANTENERE (con refactor)

| Feature | File sorgente | Target |
|---------|--------------|--------|
| SCORE2 | `score2.html` | `domain/clinical/score-engine/score2.ts` |
| SCORE2-Diabetes | `score2-diabetes.html` | `domain/clinical/score-engine/score2-diabetes.ts` |
| ADA Risk | `ADA-score.html` | `domain/clinical/score-engine/ada.ts` |
| FLI | `FLI.html` | `domain/clinical/score-engine/fli.ts` |
| FRAIL | `FRAIL.html` | `domain/clinical/score-engine/frail.ts` |
| BMI | `dashboard-logic.js` | `domain/clinical/score-engine/bmi.ts` |
| PREDIMED | `dashboard-logic.js` | `domain/clinical/nutrition-engine/predimed.ts` |
| Sindrome Metabolica | `dashboard-logic.js` | `domain/clinical/score-engine/metabolic-syndrome.ts` |
| FIB-4 | `dashboard-logic.js` | `domain/clinical/score-engine/fib4.ts` |
| Consenso (consent.js) | `api/consent.js` | `api/consents/route.ts` |
| TDEE/BMR | `dashboard-logic.js` | `domain/clinical/nutrition-engine/caloric-needs.ts` |

---

## 7. MODIFICHE BREAKING VS NON-BREAKING

### BREAKING CHANGES (richiedono migrazione dati)

1. **Schema database:** Da `anagrafica_utenti` monolitica a 16+ tabelle normalizzate
2. **Chiave primaria:** Da email a user_id/patient_id UUID
3. **Modello autenticazione:** Da consumer single-user a B2B multi-tenant con ruoli
4. **Architettura score:** Da iframe+postMessage a moduli puri server-side
5. **Eliminazione chatbot:** Rimozione flusso conversazionale come entry point
6. **Eliminazione piano alimentare/allenamento:** Feature rimosse

### NON-BREAKING CHANGES (preservano compatibilita)

1. Centralizzazione config Supabase (nessun impatto su logica)
2. Estrazione formule score in moduli puri (stessi input/output)
3. Aggiunta security headers (trasparente al frontend)
4. Aggiunta audit logging (trasparente alla logica)
5. Aggiunta RLS policies (trasparente se query gia filtrano correttamente)
6. Aggiunta test di equivalenza score (non modifica nulla)

---

## 8. DIPENDENZE ESTERNE ATTUALI

| Dipendenza | Uso | Versione | Decisione |
|-----------|-----|----------|-----------|
| Supabase JS SDK | Auth + DB | CDN (varie) | **PIN** + centralizzare |
| OpenAI SDK | AI recommendations | ^4.0.0 | **KEEP** con vincoli |
| Three.js | Background animation | 0.155.0 | **REMOVE** |
| GSAP | Scroll animations | 3.12.2 | **REMOVE** |
| Chart.js | Grafici dashboard | 3.7.0 | **KEEP** |
| html2pdf.js | Export PDF client-side | 0.10.1 | **REPLACE** con server-side |
| Tailwind CSS | Styling dashboard | 2.2.19 (CDN) | **UPGRADE** o sostituire |
| Font Awesome | Icons | 6.0.0/6.4.0 | **KEEP** o Lucide |
| Tween.js | Animations | 18.6.4 | **REMOVE** |
| Formspree | Contact form | External | **KEEP** (solo landing) |

---

## 9. CONCLUSIONI AUDIT

### Stato attuale: NON PRONTO per produzione clinica B2B

**Problemi bloccanti:**
1. Credenziali esposte nel frontend (8+ file)
2. Nessuna autenticazione sulle API di lettura/scrittura dati clinici
3. Email come unica chiave applicativa (no multi-paziente)
4. PHI inviati a OpenAI senza consenso specifico ne DPA
5. Architettura iframe con postMessage wildcard
6. Nessun audit trail
7. Nessun RLS verificato
8. Nessun test automatizzato
9. Feature consumer (chatbot, allenamento, piano alimentare) che diluiscono il posizionamento

**Punti di forza da preservare:**
1. Formule score clinici corrette e complete (SCORE2, SCORE2-D, ADA, FLI, FRAIL, BMI, PREDIMED, MetS, FIB-4)
2. Struttura dati anagrafica ricca (50+ campi clinici)
3. Modulo consenso con JWT (consent.js) come buon punto di partenza
4. Calibrazione regionale SCORE2 implementata

**Prossimo passo:** Piano di refactor e architettura target (documento 02).
