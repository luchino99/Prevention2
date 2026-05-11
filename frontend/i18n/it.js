/**
 * i18n/it.js — Italian translations for Uelfy Clinical (it-IT locale).
 *
 * Sprint 8 task 8.1 (scaffold) + task 8.2 (populated page-by-page).
 * ---------------------------------------------------------------------------
 *
 * Editing rules
 * =============
 *   * Keep keys hierarchical and page-scoped: `<page>.<section>.<element>`
 *     e.g. `login.form.email_label`, `dashboard.kpi.patients_total`.
 *   * Generic UI primitives go under `common.*`: `common.cancel`,
 *     `common.save`, `common.required`, `common.loading`.
 *   * Validation/error messages under `errors.*`.
 *   * Domain-clinical terminology (scores, ranges, alerts) under
 *     `clinical.*` — when in doubt, defer to the published Italian
 *     translations of the source guideline (ESC, KDIGO, SIMG).
 *
 * Tone
 * ====
 *   Voi formale ("Inserisca", "Confermi", "Selezioni"), tono clinico
 *   professionale neutro. Mai consumer / wellness ("ciao!", "ottimo!").
 *   Verb forms target il professionista, NON il paziente — l'app è B2B.
 *
 * Sprint 8.2 will populate the empty sections page-by-page. The scaffold
 * below contains the cross-cutting `common.*` + `errors.*` + a handful
 * of representative page keys to validate the lookup helper.
 */

export const translations = {
  // ── Cross-cutting primitives ────────────────────────────────────────
  common: {
    app_name: 'Uelfy Clinical',
    cancel: 'Annulla',
    save: 'Salva',
    confirm: 'Conferma',
    close: 'Chiudi',
    edit: 'Modifica',
    delete: 'Elimina',
    create: 'Crea',
    submit: 'Invia',
    back: 'Indietro',
    next: 'Avanti',
    previous: 'Precedente',
    loading: 'Caricamento in corso…',
    saving: 'Salvataggio in corso…',
    required: 'Obbligatorio',
    optional: 'Facoltativo',
    yes: 'Sì',
    no: 'No',
    none: 'Nessuno',
    not_available: 'Non disponibile',
    not_specified: 'Non specificato',
    search: 'Cerca',
    filter: 'Filtra',
    reset: 'Ripristina',
    sign_out: 'Esci',
    skip_to_content: 'Vai al contenuto principale',
    open: 'Apri',
    patient: 'Paziente',
    view: 'Visualizza',
    download: 'Scarica',
    export: 'Esporta',
  },

  // ── Validation / error messages (technical, neutral) ────────────────
  errors: {
    generic: 'Si è verificato un errore. Riprovi tra qualche istante.',
    network: 'Connessione di rete non disponibile.',
    unauthorized: 'Sessione scaduta. Effettui nuovamente l’accesso.',
    forbidden: 'Operazione non consentita per il Suo ruolo.',
    not_found: 'Risorsa non trovata.',
    server: 'Errore del server. Il problema è stato registrato.',
    field_required: 'Campo obbligatorio.',
    email_invalid: 'Formato e-mail non valido.',
    password_too_short: 'La password deve avere almeno 8 caratteri.',
    audit_failure: 'Impossibile registrare l’operazione nel log clinico. Operazione non completata.',
  },

  // ── Sidebar / nav-header (component shared across pages) ────────────
  nav: {
    dashboard: 'Cruscotto',
    patients: 'Pazienti',
    alerts: 'Alert clinici',
    audit: 'Log di sicurezza',
    tenant_settings: 'Impostazioni',
    privacy: 'Informativa privacy',
    terms: 'Condizioni d’uso',
    ifu: 'Istruzioni d’uso',
    primary_navigation: 'Navigazione principale',

    // Breadcrumb + assessment-nav + patient-chip (component nav-header.js)
    breadcrumb_aria: 'Percorso di navigazione',
    assessment_nav_aria: 'Navigazione tra valutazioni',
    previous_assessment_aria: 'Valutazione precedente',
    next_assessment_aria: 'Valutazione successiva',
    prev_chip: '‹ Precedente',
    next_chip: 'Successiva ›',
    assessment_label_prefix: 'Valutazione · ',
    current_patient_aria: 'Paziente corrente',
    composite_risk_title_prefix: 'Rischio composito: ',
    composite_risk_not_stratified: 'rischio non ancora stratificato',
    composite_risk_not_available: 'Rischio composito non ancora disponibile',
    age_suffix: '{years} anni',
  },

  // ── Login page ──────────────────────────────────────────────────────
  login: {
    title: 'Uelfy Clinical',
    subtitle: 'Acceda con il Suo account professionale',
    email_label: 'E-mail',
    password_label: 'Password',
    submit: 'Accedi',
    submitting: 'Accesso in corso…',
    privacy_note_prefix: 'Accedendo accetta l’',
    privacy_note_link: 'informativa sulla privacy',
    error_signin_failed: 'Accesso non riuscito. Verifichi le credenziali.',
  },

  // ── MFA enrolment ───────────────────────────────────────────────────
  mfa: {
    title: 'Abilitare l’autenticazione a due fattori',
    body: 'Gli account clinici devono essere protetti con un’app authenticator TOTP.',
    enroll_cta: 'Abilita 2FA',
    code_label: 'Codice authenticator',
    verify: 'Verifica',
    error_start: 'Impossibile avviare la procedura di abilitazione 2FA.',
  },

  // ── Dashboard ───────────────────────────────────────────────────────
  dashboard: {
    title: 'Cruscotto',
    welcome: 'Buongiorno, {nome}',
    kpi_patients: 'Pazienti totali',
    kpi_alerts_open: 'Alert aperti',
    kpi_assessments_this_month: 'Valutazioni del mese',
    kpi_last_signin: 'Ultimo accesso',
    quick_new_assessment: 'Nuova valutazione',
    quick_new_patient: 'Nuovo paziente',
    recent_patients: 'Pazienti recenti',
    view_all: 'Vedi tutti',
    high_severity_alerts: 'Alert ad alta gravità aperti',
    no_open_critical: 'Nessun alert critico aperto.',
    view_all_alerts: 'Vedi tutti gli alert',
    load_patients_failed: 'Caricamento pazienti non riuscito',
    col_ref: 'Codice',
    col_dob: 'Data di nascita',
    col_sex: 'Sesso',
  },

  // ── Patients list ───────────────────────────────────────────────────
  patients: {
    title: 'Pazienti',
    search_placeholder: 'Cerca per cognome, codice paziente…',
    new_patient: 'Nuovo paziente',
    new_patient_btn: '+ Nuovo paziente',
    new_dialog_title: 'Nuovo paziente',
    create_patient_btn: 'Crea paziente',
    creating: 'Creazione in corso…',
    create_failed: 'Creazione paziente non riuscita.',
    dob_required: 'La data di nascita è obbligatoria.',
    col_name: 'Nome',
    col_birthdate: 'Data di nascita',
    col_last_assessment: 'Ultima valutazione',
    col_open_alerts: 'Alert aperti',
    col_status: 'Stato',
    status_active: 'attivo',
    status_inactive: 'inattivo',
    pagination_label: 'Pagina {page} / {total} · {count} pazienti',
    empty_title: 'Non ci sono ancora pazienti',
    empty_body: 'Aggiunga il primo paziente per iniziare a registrare valutazioni cliniche.',
    empty_search: 'Nessun paziente corrisponde ai filtri di ricerca.',
    empty_cta: 'Crea il primo paziente',
    back_to_dashboard: 'Torna al cruscotto',
    field_first_name: 'Nome *',
    field_last_name: 'Cognome *',
    field_external_code: 'Codice paziente *',
    field_external_code_placeholder: 'Numero cartella, ID interno…',
    field_sex: 'Sesso *',
    field_dob: 'Data di nascita *',
    field_email: 'E-mail di contatto',
    field_phone: 'Telefono di contatto',
    field_notes: 'Note',
    sex_male: 'Maschio',
    sex_female: 'Femmina',
    consent_label: 'Il paziente ha prestato il consenso al trattamento dei dati sanitari',
  },

  // ── Alerts ──────────────────────────────────────────────────────────
  alerts: {
    title: 'Alert clinici',
    severity_critical: 'Critico',
    severity_high: 'Elevato',
    severity_moderate: 'Moderato',
    severity_warning: 'Avviso',
    severity_info: 'Informativo',
    filter_severity_all: 'Tutte le gravità',
    status_open: 'Aperti',
    status_acknowledged: 'In carico',
    status_resolved: 'Risolti',
    status_dismissed: 'Archiviati',
    acknowledge: 'Prendi in carico',
    acknowledge_alert: 'Prendi in carico l’alert',
    resolve: 'Risolvi',
    resolve_alert: 'Risolvi l’alert',
    dismiss: 'Archivia',
    dismiss_alert: 'Archivia l’alert',
    btn_ack: 'Prendi in carico',
    btn_resolve: 'Risolvi',
    btn_dismiss: 'Archivia',
    note_required: 'Nota clinica obbligatoria',
    note_placeholder: 'Motivazione, azioni intraprese, follow-up…',
    action_note_label: 'Nota clinica (registrata nei metadati)',
    action_failed: 'Operazione non riuscita.',
    load_failed: 'Caricamento alert non riuscito',
    col_severity: 'Gravità',
    col_title: 'Titolo',
    col_type: 'Tipo',
    col_opened: 'Aperto il',
    col_actions: 'Azioni',
    empty_title: 'Nessun alert clinico al momento',
    empty_body: 'I nuovi alert generati dalle valutazioni dei Suoi pazienti compariranno qui.',
    empty_filter: 'Nessun alert corrisponde ai filtri impostati.',
    pagination_label: 'Pagina {page} / {total} · {count} alert',
  },

  // ── Audit ───────────────────────────────────────────────────────────
  audit: {
    title: 'Log di sicurezza',
    subtitle: 'Tracciabilità delle operazioni privacy-significative.',
    filter_action: 'Azione',
    filter_actor: 'ID utente',
    filter_resource: 'Tipo risorsa',
    filter_outcome: 'Esito',
    filter_from: 'Dal (UTC)',
    filter_to: 'Al (UTC)',
    option_any: '— qualunque —',
    outcome_success: 'success',
    outcome_failure: 'failure',
    export_csv: 'Esporta CSV',
    export_csv_title: 'Scarica il filtro corrente in formato CSV',
    exporting: 'Esportazione in corso…',
    export_failed: 'Esportazione non riuscita',
    load_failed: 'Caricamento eventi non riuscito',
    access_denied: 'Il log di sicurezza è accessibile solo ai ruoli tenant_admin o platform_admin.',
    col_at: 'Quando',
    col_action: 'Azione',
    col_resource: 'Risorsa',
    col_resource_id: 'ID risorsa',
    col_actor: 'Utente',
    col_outcome: 'Esito',
    col_metadata: 'Metadati',
    pagination_label: 'Pagina {page} / {total} · {count} eventi',
    empty_title: 'Nessun evento corrisponde ai filtri',
    empty_body: 'Nessun evento corrisponde ai filtri impostati. Provi ad ampliare l’intervallo di date o a rimuovere i filtri.',
  },

  // ── Tenant settings ─────────────────────────────────────────────────
  tenant_settings: {
    title: 'Impostazioni',
    retention_section: 'Conservazione dei dati',
    retention_audit_label: 'Log audit (giorni)',
    retention_alerts_label: 'Alert risolti (giorni)',
    retention_notifications_label: 'Notifiche (giorni)',
    retention_hint: 'Lasciare vuoto per usare i valori predefiniti della piattaforma.',
    save: 'Salva impostazioni',
    saved_ok: 'Impostazioni salvate.',
  },

  // ── Patient detail ──────────────────────────────────────────────────
  patient_detail: {
    title: 'Scheda paziente',
    section_demographics: 'Dati anagrafici',
    section_clinical: 'Profilo clinico',
    section_assessments: 'Storico valutazioni',
    section_alerts: 'Alert attivi',
    new_assessment: 'Nuova valutazione',
    export_pdf: 'Esporta PDF',
    empty_assessments_title: 'Nessuna valutazione registrata',
    empty_assessments_body: 'Effettui la prima valutazione clinica per iniziare il monitoraggio longitudinale.',
    empty_assessments_cta: 'Avvia la prima valutazione',
  },

  // ── Assessment new ──────────────────────────────────────────────────
  assessment_new: {
    title: 'Nuova valutazione',
    compute: 'Calcola valutazione',
    computing: 'Calcolo in corso…',
    section_lifestyle: 'Stile di vita',
    section_anthropometry: 'Antropometria',
    section_labs: 'Esami di laboratorio',
    section_vitals: 'Parametri vitali',
    section_history: 'Anamnesi',
    error_create: 'Creazione valutazione non riuscita.',
    error_missing_id: 'Valutazione creata, ma la risposta non contiene l’identificativo.',
  },

  // ── Assessment view ─────────────────────────────────────────────────
  assessment_view: {
    title: 'Dettaglio valutazione',
    composite_risk: 'Rischio composito',
    section_scores: 'Punteggi calcolati',
    section_alerts: 'Alert generati',
    section_followup: 'Piano di follow-up',
    section_completeness: 'Avvisi di completezza',
    generate_report: 'Genera PDF clinico',
    report_generating: 'Generazione PDF in corso…',
    report_ready: 'Report generato. Aggiorni la pagina per ottenere il link firmato.',
  },

  // ── Empty states (cross-page, used by Sprint 8.6) ───────────────────
  empty: {
    no_results: 'Nessun risultato',
    no_results_body: 'Provi a modificare i filtri o l’intervallo di tempo.',
  },

  // ── Trust / legal anchor labels (linked from footer + nav) ──────────
  legal: {
    privacy_page_title: 'Informativa sulla privacy',
    terms_page_title: 'Condizioni d’uso',
    dpa_page_title: 'Accordo di trattamento dei dati (DPA)',
    ifu_page_title: 'Istruzioni d’uso clinico',
    last_updated_prefix: 'Ultimo aggiornamento:',
    version_prefix: 'Versione documento:',
  },
};
