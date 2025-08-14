// Configuration constants
const supabaseUrl = 'https://nkkaxbmzacaxkwgtfmds.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ra2F4Ym16YWNheGt3Z3RmbWRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Nzc3NzQsImV4cCI6MjA2OTQ1Mzc3NH0.k36sBT3jILmLXc9jcLz843uLDCHrnuvhuMmMvBNzEPo';
const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);

// Variabili globali per i dati utente
let userData = {};
let dashboardData = {
  bmi: { value: 0, category: '', status: '' },
  score2: { value: 0, risk: '', category: '' },
  predimed: { value: 0, adherence: '', status: '' },
  metabolicSyndrome: { present: false, criteria: 0, factors: [] },
  diabetesRisk: { score: 0, maxScore: 8, risk: '', factors: [] },
  score2Diabetes: { value: 0, risk: '', category: '', hba1c: 0, glicemia: 0, sistolica: 0 },
  fib4: { value: 0, risk: '', category: '', ast: 0, alt: 0, plt: 0 },
  fni: { value: 0, status: '', category: '', albumina: 0, linfociti: 0 },
  recommendations: [],
  screenings: [],
  lifestyle: {},
  nutrition: {},
  activity: {}
};

// Store chart instances globally
let predimedChart = null;
let macroChart = null;

// Carica i dati dell'utente all'avvio
document.addEventListener('DOMContentLoaded', async function () {
  try {
    // Verifica autenticazione
    const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError || !sessionData.session) {
      window.location.href = 'login.html';
      return;
    }

    const emailUtente = sessionData.session.user.email;

    // Carica dati dal database
    await loadUserData(emailUtente);
    populatePianoAlimentareForm();
    populateCurrentActivity();
    populateTrainingPlan();
    fixFloatingLabels();
    


// 🔹 Mappatura campi HTML → colonne DB
const mapping = {
  eta: "eta",
  sesso: "sesso",
  altezza: "altezza",
  peso: "peso",
  obiettivo: "obiettivo",
  attivita_fisica: "tipo_lavoro",
  
  preferenze: "preferenze_alimentari", // ✅ preferenze alimentari per piano
  intolleranze: "intolleranze",
  alimenti_esclusi: "alimenti_esclusi",
  pasti: "numero_pasti",
  orari_pasti: "orari_pasti",
  patologie: "patologie",
  farmaci: "farmaci_dettaglio"
};

const btnGeneraPiano = document.getElementById("btn-genera-piano");
console.log("🔍 Bottone trovato:", btnGeneraPiano);

if (btnGeneraPiano) {
  btnGeneraPiano.addEventListener("click", async () => {
    console.log("✅ Bottone cliccato");
    const output = document.getElementById("piano-alimentare-output");

    // Messaggio di caricamento
    output.innerHTML = `
      <div class="flex items-center gap-2 text-green-700">
        <i class="fas fa-spinner fa-spin"></i>
        <span>Generazione piano in corso... Attendere qualche secondo</span>
      </div>
    `;

    try {
      // Normalizza tipo_lavoro
      let tipoLavoroVal = userData.tipo_lavoro || document.getElementById("attivita_fisica")?.value || "";
      console.log("📊 tipo_lavoro letto:", tipoLavoroVal);
      tipoLavoroVal = tipoLavoroVal.trim().toLowerCase();

      const validi = ["sedentario", "leggermente attivo", "moderatamente attivo", "molto attivo", "estremamente attivo"];
      if (!validi.includes(tipoLavoroVal)) {
        output.innerHTML = `<p class="text-red-600">⚠️ Seleziona un livello di attività fisica valido.</p>`;
        return;
      }

      // Costruzione payload come nel chatbot
      const payload = {
        dieta: true,
        email: userData.email || "", // se disponibile
        eta: userData.eta || document.getElementById("eta")?.value || "",
        sesso: userData.sesso || document.getElementById("sesso")?.value || "",
        altezza: userData.altezza || document.getElementById("altezza")?.value || "",
        peso: userData.peso || document.getElementById("peso")?.value || "",
        obiettivo: userData.obiettivo || document.getElementById("obiettivo")?.value || "",
        tipo_lavoro: tipoLavoroVal,
        preferenze_alimentari: userData.preferenze_alimentari || document.getElementById("preferenze")?.value || "",
        intolleranze: userData.intolleranze || document.getElementById("intolleranze")?.value || "",
        alimenti_esclusi: userData.alimenti_esclusi || document.getElementById("alimenti_esclusi")?.value || "",
        numero_pasti: userData.numero_pasti || document.getElementById("pasti")?.value || "",
        orari_pasti: userData.orari_pasti || document.getElementById("orari_pasti")?.value || "",
        patologie: userData.patologie || document.getElementById("patologie")?.value || "",
        farmaci: userData.farmaci_dettaglio || document.getElementById("farmaci")?.value || "",
        calorie_target: dashboardData?.nutrition?.target || null
      };

      console.log("📤 Invio payload dieta (dashboard):", payload);

      // Chiamata API
      const response = await fetch("https://prevention2.vercel.app/api/openai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      console.log("📥 Risposta API:", data);

      if (!data.risposta) {
        throw new Error("Nessuna risposta dal modello");
      }

output.innerHTML = `
  <h4 class="text-lg font-semibold mb-3 text-green-700">🍽️ Il tuo piano alimentare personalizzato</h4>
  ${formatMealPlanProfessional(data.risposta)}
`;

    } catch (error) {
      console.error("❌ Errore generazione piano alimentare:", error);
      output.innerHTML = `<p class="text-red-600">❌ Errore durante la generazione del piano. Riprova più tardi.</p>`;
    }
  });
}

  function formatMealPlanProfessional(planText) {
  const giornoRegex = /^####\s*(Lunedì|Martedì|Mercoledì|Giovedì|Venerdì|Sabato|Domenica)/i;
  const bmrRegex = /BMR.*?(\d+)\s*kcal/i;
  const tdeeRegex = /TDEE.*?(\d+)\s*kcal/i;

  const bmrMatch = planText.match(bmrRegex);
  const tdeeMatch = planText.match(tdeeRegex);

  let bmr = bmrMatch ? bmrMatch[1] : null;
  let tdee = tdeeMatch ? tdeeMatch[1] : null;

  const lines = planText.split("\n").map(l => l.trim()).filter(l => l);
  let currentDay = null;
  let days = {};

  lines.forEach(line => {
    if (giornoRegex.test(line)) {
      currentDay = line.replace(/^####\s*/i, "").replace(":", "");
      days[currentDay] = { colazione: "", spuntino_mattina: "", pranzo: "", spuntino_pomeriggio: "", cena: "" };
    }
    else if (/^\-\s*\*\*Colazione/i.test(line)) {
      days[currentDay].colazione = line.replace(/^\-\s*\*\*Colazione.*?:\s*/i, "");
    }
    else if (/^\-\s*\*\*Spuntino mattina/i.test(line)) {
      days[currentDay].spuntino_mattina = line.replace(/^\-\s*\*\*Spuntino mattina.*?:\s*/i, "");
    }
    else if (/^\-\s*\*\*Pranzo/i.test(line)) {
      days[currentDay].pranzo = line.replace(/^\-\s*\*\*Pranzo.*?:\s*/i, "");
    }
    else if (/^\-\s*\*\*Spuntino pomeriggio/i.test(line)) {
      days[currentDay].spuntino_pomeriggio = line.replace(/^\-\s*\*\*Spuntino pomeriggio.*?:\s*/i, "");
    }
    else if (/^\-\s*\*\*Cena/i.test(line)) {
      days[currentDay].cena = line.replace(/^\-\s*\*\*Cena.*?:\s*/i, "");
    }
  });

  let html = "";

  // Box BMR e TDEE
if (bmr || tdee) {
  html += `
    <div class="mb-4 p-4 bg-green-100 border border-green-300 rounded-lg shadow-sm">
      <h3 class="text-lg font-semibold text-green-800 mb-2">📊 Fabbisogno Calorico</h3>
      ${bmr ? `<p class="text-gray-700"><strong>BMR:</strong> ${bmr} kcal/giorno</p>` : ""}
      ${tdee ? `<p class="text-gray-700"><strong>TDEE:</strong> ${tdee} kcal/giorno</p>` : ""}
      ${dashboardData.nutrition?.target ? `<p class="text-gray-700"><strong>Calorie suggerite (in base all'obiettivo):</strong> ${dashboardData.nutrition.target} kcal/giorno</p>` : ""}
    </div>
  `;
}


  // Tabella pasti
  html += `<div class="overflow-x-auto">
    <table class="min-w-full border border-gray-200 rounded-xl shadow-lg">
      <thead class="bg-green-600 text-white">
        <tr>
          <th class="px-4 py-3">📅 Giorno</th>
          <th class="px-4 py-3">🥣 Colazione</th>
          <th class="px-4 py-3">🍏 Spuntino Mattina</th>
          <th class="px-4 py-3">🍽️ Pranzo</th>
          <th class="px-4 py-3">🥜 Spuntino Pomeriggio</th>
          <th class="px-4 py-3">🍲 Cena</th>
        </tr>
      </thead>
      <tbody class="bg-white divide-y divide-gray-200">`;

  Object.keys(days).forEach(day => {
    html += `
      <tr class="hover:bg-green-50 transition">
        <td class="px-4 py-3 font-semibold text-green-700">${day}</td>
        <td class="px-4 py-3">${days[day].colazione}</td>
        <td class="px-4 py-3">${days[day].spuntino_mattina}</td>
        <td class="px-4 py-3">${days[day].pranzo}</td>
        <td class="px-4 py-3">${days[day].spuntino_pomeriggio}</td>
        <td class="px-4 py-3">${days[day].cena}</td>
      </tr>
    `;
  });

  html += `</tbody></table></div>`;
  return html;
}

    // === LISTENER: Salva Dati Piano Alimentare ===
const btnSalvaPiano = document.getElementById("salva-dati-piano");

if (btnSalvaPiano) {
  btnSalvaPiano.addEventListener("click", async () => {
    console.log("💾 [Salva Dati Piano] Click rilevato");

    const mapping = {
      eta: "eta",
      sesso: "sesso",
      altezza: "altezza",
      peso: "peso",
      obiettivo: "obiettivo",
      attivita_fisica: "tipo_lavoro",
      preferenze: "preferenze_alimentari",
      intolleranze: "intolleranze",
      alimenti_esclusi: "alimenti_esclusi",
      pasti: "numero_pasti",
      orari_pasti: "orari_pasti",
      patologie: "patologie",
      farmaci: "farmaci_dettaglio"
    };

    const aggiornamenti = {};
    for (const [fieldId, dbField] of Object.entries(mapping)) {
      const el = document.getElementById(fieldId);
      if (el) {
        aggiornamenti[dbField] = el.value.trim();
      }
    }

    console.log("📦 Dati da salvare su Supabase:", aggiornamenti);

    try {
      const { error } = await supabaseClient
        .from("anagrafica_utenti")
        .update(aggiornamenti)
        .eq("email", userData.email);

      if (error) throw error;

      Object.assign(userData, aggiornamenti);

      console.log("✅ Salvataggio completato con successo");
      showNotification("Dati salvati con successo!", "success");

    } catch (err) {
      console.error("❌ Errore durante il salvataggio:", err);
      showNotification("Errore durante il salvataggio. Riprova.", "error");
    }
  });
} else {
  console.warn("⚠️ Bottone #salva-dati-piano non trovato nel DOM");
}

// === POPOLA FORM ATTIVITÀ FISICA DA DB ===
/* ===== POPOLAMENTO CAMPI ===== */
function populateCurrentActivity() {
  document.getElementById('frequenza_attuale').value = userData.frequenza_attivita_fisica || 0;
  document.getElementById('frequenza_attuale_label').textContent =
    `${userData.frequenza_attivita_fisica || 0} volte a settimana`;
  document.getElementById('tipo_attivita_attuale').value = userData.tipo_attivita || "";
  document.getElementById('intensita_attuale').value = userData.tipo_lavoro || "";
  document.getElementById('minuti_settimana_attuale').value = userData.durata_attivita || "";
}

function populateTrainingPlan() {
  const mapping = {
    obiettivo_allenamento: "obiettivo",
    livello_esperienza: "esperienza",
    frequenza_allenamenti: "frequenza",
    durata_sessione: "durata",
    luogo_allenamento: "luogo",
    attrezzatura_disponibile: "attrezzatura",
    cardio_preferiti: "cardio",
    focus_principale: "focus",
    infortuni: "infortuni",
    pushups: "pushups",
    squats: "squats",
    plank: "plank",
    step_test: "step_test"
  };

  for (const [id, dbField] of Object.entries(mapping)) {
    const el = document.getElementById(id);
    if (el) el.value = userData[dbField] || "";
  }
}

/* ===== SLIDER DINAMICO ===== */
document.getElementById('frequenza_attuale')?.addEventListener('input', function () {
  document.getElementById('frequenza_attuale_label').textContent = `${this.value} volte a settimana`;
});

/* ===== SALVATAGGIO ATTIVITÀ ATTUALE ===== */
document.getElementById('salva-attivita-attuale')?.addEventListener('click', async () => {
  try {
    const payload = {
      frequenza_attivita_fisica: document.getElementById('frequenza_attuale').value,
      tipo_attivita: document.getElementById('tipo_attivita_attuale').value,
      tipo_lavoro: document.getElementById('intensita_attuale').value,
      durata_attivita: document.getElementById('minuti_settimana_attuale').value
    };

    const { error } = await supabaseClient
      .from('anagrafica_utenti')
      .update(payload)
      .eq('email', userData.email);

    if (error) throw error;
    Object.assign(userData, payload);
    showNotification('✅ Attività attuale salvata con successo!', 'success');
  } catch (err) {
    console.error(err);
    showNotification('❌ Errore salvataggio attività attuale', 'error');
  }
});

/* ===== SALVATAGGIO PIANO ALLENAMENTO ===== */
document.getElementById('salva-piano-allenamento')?.addEventListener('click', async () => {
  try {
    const payload = {
      obiettivo: document.getElementById('obiettivo_allenamento').value,
      esperienza: document.getElementById('livello_esperienza').value,
      frequenza: document.getElementById('frequenza_allenamenti').value,
      durata: document.getElementById('durata_sessione').value,
      luogo: document.getElementById('luogo_allenamento').value,
      attrezzatura: document.getElementById('attrezzatura_disponibile').value,
      cardio: document.getElementById('cardio_preferiti').value,
      focus: document.getElementById('focus_principale').value,
      infortuni: document.getElementById('infortuni').value,
      pushups: document.getElementById('pushups').value,
      squats: document.getElementById('squats').value,
      plank: document.getElementById('plank').value,
      step_test: document.getElementById('step_test').value
    };

    const { error } = await supabaseClient
      .from('anagrafica_utenti')
      .update(payload)
      .eq('email', userData.email);

    if (error) throw error;
    Object.assign(userData, payload);
    showNotification('✅ Dati per piano allenamento salvati con successo!', 'success');
  } catch (err) {
    console.error(err);
    showNotification('❌ Errore salvataggio piano allenamento', 'error');
  }
});

/* ===== GENERA PIANO ALLENAMENTO (STILE CHATBOT) ===== */
document.getElementById('genera-piano-allenamento')?.addEventListener('click', async () => {
  const container = document.getElementById('output-piano-allenamento');

  container.innerHTML = `
    <div class="flex items-center gap-2 text-blue-600 dark:text-blue-400">
      <i class="fas fa-spinner fa-spin"></i>
      <span>Generazione piano di allenamento in corso... Attendere qualche secondo</span>
    </div>
  `;

  try {
    const payload = {
      allenamento: true,
      email: userData.email,
      obiettivo: document.getElementById('obiettivo_allenamento').value,
      esperienza: document.getElementById('livello_esperienza').value,
      frequenza: document.getElementById('frequenza_allenamenti').value,
      durata: document.getElementById('durata_sessione').value,
      luogo: document.getElementById('luogo_allenamento').value,
      attrezzatura: document.getElementById('attrezzatura_disponibile').value,
      cardio: document.getElementById('cardio_preferiti').value,
      focus: document.getElementById('focus_principale').value,
      infortuni: document.getElementById('infortuni').value,
      pushups: document.getElementById('pushups').value,
      squats: document.getElementById('squats').value,
      plank: document.getElementById('plank').value,
      step_test: document.getElementById('step_test').value
    };

    const res = await fetch("https://prevention2.vercel.app/api/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!data.risposta) throw new Error("Nessuna risposta dal modello");

    container.innerHTML = formatWorkoutPlan(data.risposta);

  } catch (error) {
    console.error(error);
    container.innerHTML = `<p class="text-red-600 dark:text-red-400">❌ Errore durante la generazione del piano. Riprova più tardi.</p>`;
  }
});

    function formatWorkoutPlan(planText) {
  const lines = planText.split("\n").map(l => l.trim()).filter(l => l);
  let html = `
    <h4 class="text-lg font-semibold mb-3 text-blue-700 dark:text-blue-400">💪 Il tuo piano di allenamento personalizzato</h4>
    <div class="space-y-4">
  `;

  let currentSection = null;

  lines.forEach(line => {
    if (/^(Giorno|Day|Lunedì|Martedì|Mercoledì|Giovedì|Venerdì|Sabato|Domenica)/i.test(line)) {
      if (currentSection) html += "</ul>";
      html += `<h5 class="mt-4 font-bold text-gray-800 dark:text-gray-200">${line}</h5><ul class="list-disc list-inside space-y-1">`;
      currentSection = line;
    } else {
      html += `<li class="text-gray-700 dark:text-gray-300">${line}</li>`;
    }
  });

  if (currentSection) html += "</ul>";
  html += "</div>";
  return html;
}







    // Sovrascrivi i dati dinamici con quelli salvati dal DB
dashboardData.score2 = {
  value: parseFloat(userData.score2_risk) || 0,
  risk: userData.score2_category || "Non calcolato",
  category: (userData.score2_category || "").toLowerCase().includes("alto")
              ? "danger"
              : (userData.score2_category || "").toLowerCase().includes("moderato")
                ? "warning"
                : "success"
};

    dashboardData.score2Diabetes = {
      value: parseFloat(userData.score2_diabetes_risk) || 0,
      hba1c: parseFloat(userData.hba1c) || 0,
      glicemia: parseFloat(userData.glicemia_valore) || 0,
      sistolica: parseFloat(userData.pressione_sistolica) || 0,
      category: (userData.score2_diabetes_category || "").toLowerCase().includes("alto") ? "danger"
              : (userData.score2_diabetes_category || "").toLowerCase().includes("moderato") ? "warning"
              : "success"
    };

    dashboardData.fni = {
      value: parseFloat(userData.fli_score) || 0,
      albumina: parseFloat(userData.albumina) || 0,
      linfociti: parseFloat(userData.linfociti) || 0,
      category: (userData.fli_category || "").toLowerCase().includes("alto") ? "danger"
              : (userData.fli_category || "").toLowerCase().includes("intermedio") ? "warning"
              : "success"
    };

dashboardData.diabetesRisk = {
  score: parseInt(userData.ada_score) || 0,
  risk: userData.ada_category || "Non calcolato",
  maxScore: 8
};

    dashboardData.fib4 = {
      value: 0,
      ast: parseFloat(userData.ast) || 0,
      alt: parseFloat(userData.alt) || 0,
      plt: parseFloat(userData.piastrine) || 0,
      risk: '',
      category: ''
    };

    // Calcoli e aggiornamenti
    calculateFIB4();
    calculateBMI();
    calculatePREDIMED();
    initializeCharts();
    checkMetabolicSyndrome();
    setupTabs();
    setupExportButton();
    updateDashboard();
    analyzeLifestyle();
    setupLifestyleSliders();
    calculateNutritionalNeeds();  // già esistente
    updateNutritionTab();         // AGGIUNGI QUESTA


  } catch (error) {
    console.error('Errore inizializzazione dashboard:', error);
  }
});

const themeToggle = document.getElementById('theme-toggle');

function applyTheme(theme) {
  const html = document.documentElement;
  html.setAttribute('data-theme', theme);
  if (themeToggle) {
    themeToggle.textContent = (theme === 'dark') ? '☀️' : '🌙';
  }

  // Salva la preferenza
  localStorage.setItem('preferred-theme', theme);
}

// Imposta il tema iniziale
const savedTheme = localStorage.getItem('preferred-theme') || 'light';
applyTheme(savedTheme);

if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    // Invia messaggio al frame esterno se serve
    window.parent.postMessage({ type: 'theme', theme: next }, '*');
  });
}

// (opzionale) ricevi tema da iframe genitore
window.addEventListener('message', function (event) {
  if (event.data?.type === 'theme') {
    applyTheme(event.data.theme);
  }
});



// Funzione per caricare i dati utente
async function loadUserData(email) {
  try {
    const { data, error } = await supabaseClient
    .from('anagrafica_utenti')
    .select('*')
    .eq('email', email)
    .single();

    if (error) {
      console.error('Errore Supabase:', error);
      throw error;
    }

    userData = data || {};
    userData.email = email;
    console.log('🔍 Dati utente caricati:', userData);

    // Debug: verifica campi specifici per SCORE2 e ADA Risk
    console.log('📊 Campi SCORE2:', {
      eta: userData.eta,
      sesso: userData.sesso,
      pressione_sistolica: userData.pressione_sistolica,
      colesterolo_totale: userData.colesterolo_totale,
      colesterolo_hdl_valore: userData.colesterolo_hdl_valore,
      fumatore: userData.fumatore
    });

    console.log('📊 Campi ADA Risk:', {
      familiari_diabete: userData.familiari_diabete,
      pressione_alta: userData.pressione_alta,
      attivita_fisica: userData.attivita_fisica,
      durata_attivita: userData.durata_attivita,
      glicemia_valore: userData.glicemia_valore
    });

  } catch (error) {
    console.error('❌ Errore caricamento dati:', error);
    // Aggiungi dati di fallback per il debug
    userData = {
      email: email,
      // Aggiungi valori di test per verificare se il problema è nel caricamento dati
      eta: 55,
      sesso: 'maschio',
      pressione_sistolica: 145,
      pressione_diastolica: 85,
      colesterolo_totale: 200,
      colesterolo_hdl_valore: 45,
      fumatore: 'no'
    };
    console.log('🔧 Usando dati di fallback per debug:', userData);
  }
}


  // Lista dei campi del piano alimentare
function populatePianoAlimentareForm() {
  const mapping = {
    eta: "eta",
    sesso: "sesso",
    altezza: "altezza",
    peso: "peso",
    obiettivo: "obiettivo",
    attivita_fisica: "tipo_lavoro",
    
    preferenze: "preferenze_alimentari", // ✅ usa la colonna giusta
    intolleranze: "intolleranze",
    alimenti_esclusi: "alimenti_esclusi",
    pasti: "numero_pasti",
    orari_pasti: "orari_pasti",
    patologie: "patologie",
    farmaci: "farmaci_dettaglio"
  };

  Object.keys(mapping).forEach(fieldId => {
    const dbField = mapping[fieldId];
    const el = document.getElementById(fieldId);
    if (el && userData[dbField] !== undefined && userData[dbField] !== null) {
      el.value = userData[dbField] || "";
    }
  });
}


function fixFloatingLabels() {
  document.querySelectorAll("#form-piano-alimentare input, #form-piano-alimentare select").forEach(el => {
    if (el.value && el.value.trim() !== "") {
      el.classList.add("has-value");
    } else {
      el.classList.remove("has-value");
    }

    el.addEventListener("input", () => {
      if (el.value && el.value.trim() !== "") {
        el.classList.add("has-value");
      } else {
        el.classList.remove("has-value");
      }
    });
  });
}



function calculateAllScores() {
  console.log('🚀 Inizio calcolo di tutti gli score...');
  console.log('📊 Dati disponibili:', Object.keys(userData));

  // Inizializza i dati di default
  dashboardData.score2 = { value: '0.0', risk: 'Non calcolato', category: 'warning' };
  dashboardData.diabetesRisk = { score: 0, maxScore: 8, factors: [], risk: 'Non calcolato' };

  calculateBMI();
  calculatePREDIMED();
  checkMetabolicSyndrome();
  calculateFIB4();

  console.log('🎯 Risultati finali degli score:', {
    bmi: dashboardData.bmi,
    fib4: dashboardData.fib4,
  });
} // ✅ CHIUSURA CORRETTA DEL BLOCCO



// 1. Calcolo BMI
function calculateBMI() {
  const peso = parseFloat(userData.peso);
  const altezza = parseFloat(userData.altezza) / 100;

  if (peso && altezza) {
    const bmi = peso / (altezza * altezza);
    dashboardData.bmi.value = bmi.toFixed(1);

    if (bmi < 18.5) {
      dashboardData.bmi.category = 'Sottopeso';
      dashboardData.bmi.status = 'warning';
    } else if (bmi < 25) {
      dashboardData.bmi.category = 'Normopeso';
      dashboardData.bmi.status = 'success';
    } else if (bmi < 30) {
      dashboardData.bmi.category = 'Sovrappeso';
      dashboardData.bmi.status = 'warning';
    } else {
      dashboardData.bmi.category = 'Obesità';
      dashboardData.bmi.status = 'danger';
    }
  }
}



// 3. Calcolo PREDIMED
function calculatePREDIMED() {
  let score = 0;

  for (let i = 1; i <= 14; i++) {
    const value = String(userData[`predimed_${i}`]).toLowerCase();
    if (['sì', 'si', '1', 'true'].includes(value)) {
      score++;
    }
  }

  dashboardData.predimed.value = score;

  if (score >= 10) {
    dashboardData.predimed.adherence = 'Alta aderenza';
    dashboardData.predimed.status = 'success';
  } else if (score >= 6) {
    dashboardData.predimed.adherence = 'Media aderenza';
    dashboardData.predimed.status = 'warning';
  } else {
    dashboardData.predimed.adherence = 'Bassa aderenza';
    dashboardData.predimed.status = 'danger';
  }
}

// 4. Verifica sindrome metabolica
function checkMetabolicSyndrome() {
  let criteria = 0;
  let factors = [];

  if (userData.vita?.toLowerCase() === 'sì') {
    criteria++;
    factors.push('Girovita elevato');
  }

  const glicemia = parseFloat(userData.glicemia_valore || 0);
  if (glicemia >= 100 || userData.diabete?.toLowerCase() === 'sì') {
    criteria++;
    factors.push('Glicemia alta');
  }

  const hdlValore = parseFloat(userData.colesterolo_hdl_valore);
  const sesso = userData.sesso?.toLowerCase();

  if ((sesso === 'maschio' && hdlValore < 40) || (sesso === 'femmina' && hdlValore < 50)) {
    criteria++;
    factors.push('HDL basso');
  }

  const sistolica = parseFloat(userData.pressione_sistolica);
  const diastolica = parseFloat(userData.pressione_diastolica);
  if (sistolica >= 130 || diastolica >= 85) {
    criteria++;
    factors.push('Pressione elevata');
  }

  const trigli = parseFloat(userData.trigliceridi);
  if (trigli >= 150) {
    criteria++;
    factors.push('Trigliceridi elevati');
  }

  dashboardData.metabolicSyndrome = {
    present: criteria >= 3,
    criteria: criteria,
    factors: factors
  };
}





// 7. Calcolo FIB4
function calculateFIB4() {
  const age = parseInt(userData.eta);
  const ast = parseFloat(userData.ast);
  const alt = parseFloat(userData.alt);
  const plt = parseFloat(userData.piastrine);

  if (!isNaN(age) && !isNaN(ast) && !isNaN(alt) && !isNaN(plt) && alt !== 0 && plt !== 0) {
    const fib4 = (age * ast) / (plt * Math.sqrt(alt));
    const fib4Rounded = fib4.toFixed(2);

    let risk = 'Basso rischio';
    let category = 'success';

    if (fib4 >= 3.25) {
      risk = 'Alto rischio';
      category = 'danger';
    } else if (fib4 >= 1.45) {
      risk = 'Rischio intermedio';
      category = 'warning';
    }

    dashboardData.fib4 = {
      value: fib4Rounded,
      ast: ast,
      alt: alt,
      plt: plt,
      risk: risk,
      category: category
    };

    console.log("✅ FIB4 calcolato:", dashboardData.fib4);

  } else {
    dashboardData.fib4 = {
      value: "--",
      ast: ast || 0,
      alt: alt || 0,
      plt: plt || 0,
      risk: "Dati insufficienti",
      category: "warning"
    };

    console.warn("⚠️ FIB4 non calcolabile. Dati mancanti:", { age, ast, alt, plt });
  }
}



// 9. Genera raccomandazioni personalizzate
function generateRecommendations() {
  dashboardData.recommendations = [];

  if (dashboardData.bmi.status === 'warning' || dashboardData.bmi.status === 'danger') {
    dashboardData.recommendations.push({
      title: 'Controllo del peso',
      description: 'Raggiungere un BMI tra 18.5 e 25 attraverso dieta equilibrata',
      priority: 'high'
    });
  }

  if (parseFloat(dashboardData.score2.value) >= 5) {
    dashboardData.recommendations.push({
      title: 'Ridurre rischio cardiovascolare',
      description: 'Controllo pressione, colesterolo e cessazione fumo',
      priority: 'high'
    });
  }

  if (dashboardData.predimed.value < 10) {
    dashboardData.recommendations.push({
      title: 'Migliorare alimentazione',
      description: 'Aumentare aderenza alla dieta mediterranea',
      priority: 'medium'
    });
  }

  if (userData.attivita_fisica?.toLowerCase() === 'no') {
    dashboardData.recommendations.push({
      title: 'Aumentare attività fisica',
      description: 'Raggiungere almeno 150 minuti di attività moderata a settimana',
      priority: 'high'
    });
  }

  if (userData.insonnia?.toLowerCase() === 'sì' || parseInt(userData.stress) > 7) {
    dashboardData.recommendations.push({
      title: 'Migliorare qualità del sonno',
      description: 'Creare routine serale e gestire lo stress',
      priority: 'medium'
    });
  }

  // Raccomandazioni basate sui nuovi score
  if (dashboardData.fib4.category === 'danger') {
    dashboardData.recommendations.push({
      title: 'Valutazione epatica',
      description: 'Consultare uno specialista per approfondimenti sulla funzionalità epatica',
      priority: 'high'
    });
  }

  if (dashboardData.fni.category === 'danger' || dashboardData.fni.category === 'warning') {
    dashboardData.recommendations.push({
      title: 'Migliorare stato nutrizionale',
      description: 'Consultare un nutrizionista per ottimizzare l\'apporto proteico',
      priority: 'high'
    });
  }

  if (dashboardData.score2Diabetes.category === 'danger') {
    dashboardData.recommendations.push({
      title: 'Controllo glicemico urgente',
      description: 'Controllo diabetologico per ottimizzazione terapia',
      priority: 'high'
    });
  }
}

// 10. Determina screening necessari
function determineScreenings() {
  dashboardData.screenings = [];
  const eta = parseInt(userData.eta);
  const sesso = userData.sesso?.toLowerCase();

  dashboardData.screenings.push({
    name: 'Controllo pressione arteriosa',
    frequency: 'Annuale',
    status: 'pending',
    dueIn: '2 mesi'
  });

  dashboardData.screenings.push({
    name: 'Esami del sangue completi',
    frequency: 'Annuale',
    status: 'overdue',
    dueIn: 'Scaduto'
  });

  if (eta >= 50) {
    dashboardData.screenings.push({
      name: 'Screening colon-retto',
      frequency: 'Ogni 2 anni',
      status: 'completed',
      dueIn: '2024'
    });
  }

  if (eta >= 45 || dashboardData.diabetesRisk.risk !== 'Basso') {
    dashboardData.screenings.push({
      name: 'Screening diabete',
      frequency: 'Ogni 3 anni',
      status: 'pending',
      dueIn: '6 mesi'
    });
  }

  if ((sesso === 'femmina' || sesso === 'donna') && eta >= 40) {
    dashboardData.screenings.push({
      name: 'Mammografia',
      frequency: 'Ogni 2 anni',
      status: 'pending',
      dueIn: '3 mesi'
    });
  }

  // Screening basati sui nuovi score
  if (dashboardData.fib4.category === 'warning' || dashboardData.fib4.category === 'danger') {
    dashboardData.screenings.push({
      name: 'Ecografia epatica',
      frequency: 'Secondo necessità',
      status: 'pending',
      dueIn: '1 mese'
    });
  }
}

// 11. Analizza stile di vita
function analyzeLifestyle() {
  const stress = parseInt(userData.stress) || 5;
  const hasInsomnia = userData.insonnia?.toLowerCase() === 'sì';
  const hasDepression = userData.depressione?.toLowerCase() === 'sì';

  dashboardData.lifestyle = {
    stress: {
      level: stress,
      category: stress <= 3 ? 'Basso' : stress <= 7 ? 'Medio' : 'Alto',
      percentage: (stress / 10) * 100
    },
    sleep: {
      quality: hasInsomnia ? 'Insufficiente' : 'Buona',
      percentage: hasInsomnia ? 30 : 80,
      issues: userData.tipo_insonnia || ''
    },
    mood: {
      status: hasDepression ? 'Da monitorare' : 'Buono',
      percentage: hasDepression ? 40 : 75
    }
  };
}

// Funzione per gestire e salvare slider
function setupLifestyleSliders() {
  const stressSlider = document.getElementById('slider-stress');
  const umoreSlider = document.getElementById('slider-umore');
  const sonnoSlider = document.getElementById('slider-sonno');

  const valoreStress = document.getElementById('valore-stress');
  const valoreUmore = document.getElementById('valore-umore');
  const valoreSonno = document.getElementById('valore-sonno');

  if (!stressSlider || !umoreSlider || !sonnoSlider) return;

  // Valori iniziali da userData
  stressSlider.value = userData.stress || 5;
  umoreSlider.value = userData.umore || 5;
  sonnoSlider.value = userData.sonno_qualita || 5;

  valoreStress.textContent = stressSlider.value;
  valoreUmore.textContent = umoreSlider.value;
  valoreSonno.textContent = sonnoSlider.value;

const salvaValore = async (campo, valore) => {
  try {
    console.log(`📤 Tentativo di salvataggio di ${campo}:`, valore);
    const { error } = await supabaseClient
      .from('anagrafica_utenti')
      .update({ [campo]: valore })
      .eq('email', userData.email);

    if (error) throw error;
    console.log(`✅ ${campo} salvato con successo`);
  } catch (err) {
    console.error(`❌ Errore salvataggio ${campo}:`, err.message);
  }
};

// Aggiungi listener real-time + salvataggio
stressSlider.addEventListener('input', async () => {
  const val = parseInt(stressSlider.value);
  valoreStress.textContent = val;
  await salvaValore('stress', val);
});

umoreSlider.addEventListener('input', async () => {
  const val = parseInt(umoreSlider.value);
  valoreUmore.textContent = val;
  await salvaValore('umore', val);
});

sonnoSlider.addEventListener('input', async () => {
  const val = parseInt(sonnoSlider.value);
  valoreSonno.textContent = val;
  await salvaValore('sonno_qualita', val);
});

}



// 12. Calcola fabbisogno nutrizionale
function calculateNutritionalNeeds() {
  const peso = parseFloat(userData.peso);
  const altezza = parseFloat(userData.altezza);
  const eta = parseInt(userData.eta);
  const sesso = userData.sesso?.toLowerCase();
  const attivita = userData.tipo_lavoro || 'sedentario';
  const obiettivo = userData.obiettivo?.toLowerCase() || 'mantenimento';

  let bmr;
  if (sesso === 'maschio' || sesso === 'uomo') {
    bmr = (10 * peso) + (6.25 * altezza) - (5 * eta) + 5;
  } else {
    bmr = (10 * peso) + (6.25 * altezza) - (5 * eta) - 161;
  }

  const activityFactors = {
    'sedentario': 1.2,
    'leggermente attivo': 1.375,
    'moderatamente attivo': 1.55,
    'molto attivo': 1.725,
    'estremamente attivo': 1.9
  };

  const tdee = bmr * (activityFactors[attivita] || 1.2);

  let calorieTarget = tdee;
  let obiettivoDescrizione = "Mantenimento";
  if (obiettivo.includes("dimagr")) {
    calorieTarget = tdee - 300;
    obiettivoDescrizione = "Dimagrimento moderato";
  } else if (obiettivo.includes("massa")) {
    calorieTarget = tdee + 300;
    obiettivoDescrizione = "Aumento massa muscolare";
  }

  dashboardData.nutrition = {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    target: Math.round(calorieTarget),
    objective: obiettivoDescrizione,
    activityLevel: attivita,
    macros: {
      protein: { percentage: 25, grams: Math.round(calorieTarget * 0.25 / 4) },
      carbs: { percentage: 45, grams: Math.round(calorieTarget * 0.45 / 4) },
      fats: { percentage: 30, grams: Math.round(calorieTarget * 0.30 / 9) }
    }
  };
}


// 13. Valuta attività fisica
function evaluatePhysicalActivity() {
  const frequency = userData.frequenza_attivita_fisica || '0 volte/settimana';
  const type = userData.tipo_attivita || '';
  const duration = parseInt(userData.durata_attivita) || 0;
  const weeklyMinutes = duration;

  dashboardData.activity = {
    current: {
      frequency: frequency,
      type: type,
      duration: duration + ' minuti',
      intensity: 'Moderata',
      weeklyMinutes: weeklyMinutes
    },
    target: {
      aerobic: 150,
      strength: 2
    },
    compliance: {
      percentage: Math.min((weeklyMinutes / 150) * 100, 100),
      status: weeklyMinutes >= 150 ? 'Adeguata' : 'Insufficiente'
    },
    suggestions: []
  };

  if (weeklyMinutes < 150) {
    dashboardData.activity.suggestions.push({
      type: 'Obiettivo principale',
      text: 'Aumentare l\'attività aerobica a 150 min/settimana'
    });
  }

  if (!type.includes('forza') && !type.includes('rafforzamento')) {
    dashboardData.activity.suggestions.push({
      type: 'Tipo di allenamento',
      text: 'Aggiungere esercizi di forza 2 volte/settimana'
    });
  }
}




// Aggiorna tutti gli elementi della dashboard
function updateDashboard() {
  console.log('🔄 Inizio aggiornamento dashboard...');
  console.log('📊 Dati da visualizzare:', dashboardData);


  // === Parametri SCORE2 in stile FRAIL ===
  const score2Vars = [
    { label: 'Pressione', value: `${userData.pressione_sistolica || '--'} mmHg`, positive: parseFloat(userData.pressione_sistolica) < 140 },
    { label: 'Colesterolo Totale', value: `${userData.colesterolo_totale || '--'} mg/dL`, positive: parseFloat(userData.colesterolo_totale) < 200 },
    { label: 'HDL', value: `${userData.colesterolo_hdl_valore || '--'} mg/dL`, positive: parseFloat(userData.colesterolo_hdl_valore) >= 40 },
    { label: 'Fumo', value: userData.fumatore || '--', positive: (userData.fumatore || '').toLowerCase() === 'no' }
  ];
  document.getElementById("score2-variable-list").innerHTML =
    score2Vars.map(v => `<div class="badge ${v.positive ? 'badge-success' : 'badge-danger'}">${v.label}: ${v.value}</div>`).join('');

  // SCORE2-Diabetes
  document.getElementById("score2d-banner-text").textContent = `${dashboardData.score2Diabetes?.value || "--"}%`;

  // === Parametri SCORE2-Diabetes in stile FRAIL ===
  const score2dVars = [
    { label: 'HbA1c', value: `${userData.hba1c || '--'} %`, positive: parseFloat(userData.hba1c) < 5.7 },
    { label: 'Glicemia', value: `${userData.glicemia_valore || '--'} mg/dL`, positive: parseFloat(userData.glicemia_valore) < 100 },
    { label: 'Pressione', value: `${userData.pressione_sistolica || '--'} mmHg`, positive: parseFloat(userData.pressione_sistolica) < 131 },
    { label: 'Colesterolo Totale', value: `${userData.colesterolo_totale || '--'} mg/dL`, positive: parseFloat(userData.colesterolo_totale) < 200 },
    { label: 'HDL', value: `${userData.colesterolo_hdl_valore || '--'} mg/dL`, positive: parseFloat(userData.colesterolo_hdl_valore) >= 40 }
  ];
  document.getElementById("score2d-variable-list").innerHTML =
    score2dVars.map(v => `<div class="badge ${v.positive ? 'badge-success' : 'badge-danger'}">${v.label}: ${v.value}</div>`).join('');


// FRAIL
document.getElementById("frail-banner-score").textContent = `${userData.frail_score || "--"} / 5`;
const frailBadge = document.getElementById("frail-banner-badge");
frailBadge.textContent = userData.frail_category || "--";
frailBadge.className = "badge";
if (userData.frail_category === "Robusto") frailBadge.classList.add("badge-success");
else if (userData.frail_category === "Pre-Frailty") frailBadge.classList.add("badge-warning");
else if (userData.frail_category === "Fragile") frailBadge.classList.add("badge-danger");

// === Parametri FRAIL in stile SCORE2 ===
const frailVars = [
  { label: 'Affaticamento', value: userData.stanchezza || '--', positive: (userData.stanchezza || '').toLowerCase() === 'no' },
  { label: 'Resistenza', value: userData.sedia || '--', positive: (userData.sedia || '').toLowerCase() === 'no' },
  { label: 'Cammino', value: userData.camminata || '--', positive: (userData.camminata || '').toLowerCase() === 'si' },
  { label: 'Malattie', value: userData.malattie_croniche || '--', positive: (userData.malattie_croniche || '').toLowerCase() === 'no' },
  { label: 'Perdita di peso', value: userData.perdita_peso || '--', positive: (userData.perdita_peso || '').toLowerCase() === 'no' }
];

document.getElementById("frail-variable-list").innerHTML =
  frailVars.map(v => `<div class="badge ${v.positive ? 'badge-success' : 'badge-danger'}">${v.label}: ${v.value}</div>`).join('');



  // FIB4
  const fib4Vars = [
    { label: 'AST', value: `${dashboardData.fib4.ast || '--'} U/L`, positive: dashboardData.fib4.ast < 40 },
    { label: 'ALT', value: `${dashboardData.fib4.alt || '--'} U/L`, positive: dashboardData.fib4.alt < 41 },
    { label: 'Piastrine', value: `${dashboardData.fib4.plt || '--'} x10⁹/L`, positive: dashboardData.fib4.plt > 150 && dashboardData.fib4.plt < 450 }
  ];
  document.getElementById("fib4-variable-list").innerHTML =
    fib4Vars.map(v => `<div class="badge ${v.positive ? 'badge-success' : 'badge-danger'}">${v.label}: ${v.value}</div>`).join('');

  // FNI (Fatty Liver Index)
  document.getElementById("fni-banner-score").textContent = `${userData.fli_score || "--"}`;
  const fniVars = [
    { label: 'Circonferenza vita', value: `${userData.circonferenza_vita || '--'} cm`, positive: parseFloat(userData.circonferenza_vita) < 102 },
    { label: 'Trigliceridi', value: `${userData.trigliceridi || '--'} mg/dL`, positive: parseFloat(userData.trigliceridi) < 150 },
    { label: 'Gamma-GT', value: `${userData.ggt || '--'} U/L`, positive: parseFloat(userData.ggt) < 55 },
    { label: 'Peso', value: `${userData.peso || '--'} kg`, positive: true },
    { label: 'Altezza', value: `${userData.altezza || '--'} cm`, positive: true }
  ];
  document.getElementById("fni-variable-list").innerHTML =
    fniVars.map(v => `<div class="badge ${v.positive ? 'badge-success' : 'badge-danger'}">${v.label}: ${v.value}</div>`).join('');

  // ADA Diabetes Risk
  const adaVars = [
    { label: 'Glicemia', value: `${userData.glicemia_valore || '--'} mg/dL`, positive: parseFloat(userData.glicemia_valore) < 100 },
    { label: 'Familiarità diabete', value: userData.familiari_diabete || '--', positive: (userData.familiari_diabete || '').toLowerCase() === 'no' },
    { label: 'Ipertensione', value: userData.pressione_alta || '--', positive: (userData.pressione_alta || '').toLowerCase() === 'no' },
    { label: 'Attività fisica', value: `${userData.durata_attivita || '--'} min/settimana`, positive: parseInt(userData.durata_attivita) >= 150 }
  ];
  document.getElementById("ada-variable-list").innerHTML =
    adaVars.map(v => `<div class="badge ${v.positive ? 'badge-success' : 'badge-danger'}">${v.label}: ${v.value}</div>`).join('');

  updateNewScoreBanners();
  updateHealthSummary();
  updateMetabolicProfile();
  updateRiskTab();
  updateScreeningTab();
  updateLifestyleTab();
  calculateNutritionalNeeds();
  updateNutritionTab();
  updateActivityTab();
  updateRecommendations();


  console.log('✅ Dashboard aggiornata');
}


document.getElementById('btn-avvia-suggerimenti')?.addEventListener('click', async () => {
  const contenitore = document.getElementById('contenitore-suggerimenti-ai');
  contenitore.classList.remove('hidden');
  contenitore.innerHTML = '<p class="text-gray-500 text-sm italic">🧠 Analisi in corso... Attendere qualche secondo.</p>';

  try {
    const response = await fetch("https://prevention2.vercel.app/api/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        suggerimenti_prioritari: true,
        ...userData
      })
    });

    const { suggerimenti } = await response.json();

    if (!suggerimenti) {
      throw new Error("Nessuna risposta dal modello.");
    }

    // Converti i suggerimenti in paragrafi HTML
    const paragrafi = suggerimenti
      .split('\n')
      .filter(line => line.trim() !== '')
      .map(text => `<div class="p-3 bg-blue-50 border-l-4 border-blue-500 rounded text-sm text-gray-800">${text}</div>`)
      .join('');

    contenitore.innerHTML = paragrafi;

  } catch (error) {
    console.error("Errore generazione suggerimenti:", error);
    contenitore.innerHTML = `<p class="text-red-600 text-sm">❌ Errore durante la generazione dei suggerimenti. Riprova più tardi.</p>`;
  }
});

document.getElementById('btn-avvia-screening-ai')?.addEventListener('click', async () => {
  const container = document.getElementById('contenitore-screening-ai');
  container.classList.remove('hidden');
  container.innerHTML = '<p class="text-gray-500 text-sm italic">🧠 Generazione in corso... Attendere qualche secondo.</p>';

  try {
    const response = await fetch("https://prevention2.vercel.app/api/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        screening_ai: true,
        ...userData,
        score2_risk: dashboardData.score2?.value || "--",
        score2_category: dashboardData.score2?.category || "--",
        ada_score: dashboardData.diabetesRisk?.score || "--",
        ada_category: dashboardData.diabetesRisk?.risk || "--",
        fib4: dashboardData.fib4?.value || "--",
        bmi: dashboardData.bmi?.value || "--",
        metabolicSyndrome: dashboardData.metabolicSyndrome?.present || false
      })
    });

    const { screening } = await response.json();

    if (!screening) throw new Error("Nessuna risposta dal modello.");

    const blocchi = screening
      .split('\n')
      .filter(line => line.trim() !== '')
      .map(text => `<div class="p-3 bg-green-50 border-l-4 border-green-600 rounded text-sm text-gray-800">${text}</div>`)
      .join('');

    container.innerHTML = blocchi;

  } catch (error) {
    console.error("❌ Errore generazione screening:", error);
    container.innerHTML = `<p class="text-red-600 text-sm">❌ Errore durante la generazione. Riprova più tardi.</p>`;
  }
});

document.getElementById('btn-consigli-benessere')?.addEventListener('click', async () => {
  const container = document.getElementById('contenitore-consigli-benessere');
  container.classList.remove('hidden');
  container.innerHTML = '<p class="text-gray-500 text-sm italic">🧠 Generazione consigli in corso... Attendere qualche secondo.</p>';

  try {
    const response = await fetch("https://prevention2.vercel.app/api/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        consigli_benessere: true,
        stress: userData.stress || 5,
        umore: userData.umore || 5,
        sonno_qualita: userData.sonno_qualita || 5,
        prompt: `
Sei un assistente esperto in psicologia del benessere. L'utente ha riportato i seguenti livelli:
- Stress: ${userData.stress || 5}/10
- Umore: ${userData.umore || 5}/10
- Qualità del sonno: ${userData.sonno_qualita || 5}/10

Rispondi solo in codice HTML. Genera 3 consigli scientificamente validati e pratici, basandoti sui dati inseriti dall'utente, per:

1. Gestione dello stress
2. Miglioramento dell’umore
3. Qualità del sonno

Formato obbligatorio:
<h2>Gestione dello stress (livello di stress rilevato)</h2>
<p>...consiglio breve qui...</p>
<h2>Miglioramento dell'umore (livello di umore rilevato)</h2>
<p>...consiglio breve qui...</p>
<h2>Qualità del sonno (livello di sonno rilevato)</h2>
<p>...consiglio breve qui...</p>

NON scrivere alcuna introduzione o testo extra al di fuori dell’HTML. Ogni sezione verrà renderizzata come blocco indipendente.
`

      })
    });

    const data = await response.json();
    const suggerimenti = data.suggerimenti;

    if (!suggerimenti) throw new Error("Nessuna risposta dal modello.");

    // Parsing della risposta HTML strutturata
    const rawHTML = suggerimenti.trim();
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = rawHTML;

    const sections = tempDiv.querySelectorAll('h2');
    const htmlFinale = Array.from(sections).map((h2, index) => {
      const p = h2.nextElementSibling;
      const colori = ['bg-indigo-100', 'bg-green-100', 'bg-yellow-100'];
      const bordi = ['border-indigo-400', 'border-green-400', 'border-yellow-400'];

      return `
        <div class="w-full md:w-1/3 p-3">
          <div class="p-4 rounded shadow ${colori[index]} border-l-4 ${bordi[index]} h-full">
            ${h2.outerHTML}
            ${p?.outerHTML || ''}
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = `<div class="flex flex-col md:flex-row -mx-3">${htmlFinale}</div>`;

  } catch (error) {
    console.error("❌ Errore durante la generazione dei consigli benessere:", error);
    container.innerHTML = `<p class="text-red-600 text-sm">❌ Errore durante la generazione. Riprova più tardi.</p>`;
  }
});


// Funzioni di aggiornamento UI
function updateHealthSummary() {
  console.log('🔄 Aggiornamento riepilogo salute...');

  // BMI
  const bmiIndicator = document.getElementById('bmi-indicator');
  const bmiBadge = document.getElementById('bmi-badge');
  const bmiCategory = document.getElementById('bmi-category');
  const bmiStatus = dashboardData.bmi.status;

  if (bmiIndicator) {
    const classSuffix = bmiStatus === 'success' ? 'medium' : bmiStatus === 'warning' ? 'low' : 'high';
    bmiIndicator.textContent = dashboardData.bmi.value;
    bmiIndicator.className = `score-indicator score-${classSuffix}`;
  }

  if (bmiBadge) {
    bmiBadge.textContent = dashboardData.bmi.category;
    bmiBadge.className = `badge badge-${bmiStatus}`;
  }

  if (bmiCategory) {
    bmiCategory.textContent = dashboardData.bmi.category;
  }

  // SCORE2
  const score2Indicator = document.getElementById('score2-indicator');
  const score2Badge = document.getElementById('score2-badge');
  const score2Category = document.getElementById('score2-category');
  const score2Status = dashboardData.score2.category;

  if (score2Indicator) {
    const classSuffix = score2Status === 'success' ? 'medium' : score2Status === 'warning' ? 'low' : 'high';
    score2Indicator.textContent = `${dashboardData.score2.value}%`;
    score2Indicator.className = `score-indicator score-${classSuffix}`;
  }

  if (score2Badge) {
    score2Badge.textContent = dashboardData.score2.risk;
    score2Badge.className = `badge badge-${score2Status}`;
  }

  if (score2Category) {
    score2Category.textContent = dashboardData.score2.risk;
  }

  // PREDIMED
  const predimedIndicator = document.getElementById('predimed-indicator');
  const predimedBadge = document.getElementById('predimed-badge');
  const predimedCategory = document.getElementById('predimed-category');
  const predimedStatus = dashboardData.predimed.status;

  if (predimedIndicator) {
    const classSuffix = predimedStatus === 'success' ? 'medium' : predimedStatus === 'warning' ? 'low' : 'high';
    predimedIndicator.textContent = dashboardData.predimed.value;
    predimedIndicator.className = `score-indicator score-${classSuffix}`;
  }

  if (predimedBadge) {
    predimedBadge.textContent = predimedStatus === 'success' ? 'Buona' : predimedStatus === 'warning' ? 'Migliorabile' : 'Scarsa';
    predimedBadge.className = `badge badge-${predimedStatus}`;
  }

  if (predimedCategory) {
    predimedCategory.textContent = dashboardData.predimed.adherence;
  }

  console.log('✅ Riepilogo salute aggiornato');
}


function updateMetabolicProfile() {
  const metabolicSection = document.querySelector('.card .space-y-3');
  if (!metabolicSection) return;

  const badge = metabolicSection.querySelector('.badge');
  badge.textContent = dashboardData.metabolicSyndrome.present ? 'Presente' : 'Assente';
  badge.className = `badge badge-${dashboardData.metabolicSyndrome.present ? 'danger' : 'success'}`;

  const progressBar = metabolicSection.querySelector('.bg-red-500');
  const percentage = (dashboardData.metabolicSyndrome.criteria / 5) * 100;
  progressBar.style.width = percentage + '%';
  progressBar.className = `h-2.5 rounded-full ${dashboardData.metabolicSyndrome.present ? 'bg-red-500' : 'bg-yellow-500'}`;

  metabolicSection.querySelector('.text-xs').textContent =
  `${dashboardData.metabolicSyndrome.criteria} criteri soddisfatti su 5`;

  const factorsContainer = metabolicSection.querySelector('.flex.flex-wrap.gap-2');
  factorsContainer.innerHTML = dashboardData.metabolicSyndrome.factors
  .map(factor => `<div class="badge badge-danger">${factor}</div>`)
  .join('');
}

function updateRiskTab() {
  console.log('🔄 Aggiornamento tab rischi...');
  console.log('📊 SCORE2 per grafico:', dashboardData.score2);
  console.log('📊 Diabetes Risk per grafico:', dashboardData.diabetesRisk);

  // Aggiorna grafico rischio cardiovascolare - USA FORMULA DI SCORE2-DIABETE
  const cvRisk = document.querySelector('#tab-rischi .progress-ring__circle.ring-cv');
  if (cvRisk) {
    const percentage = parseFloat(dashboardData.score2.value);
    console.log('🎯 === CORREZIONE GRAFICO CV ===');
    console.log('Percentuale CV:', percentage + '%');

    // USA LA STESSA FORMULA CHE FUNZIONA IN SCORE2-DIABETE
    const circumference = 314.16;
    const offset = circumference - (percentage / 100 * circumference);

    cvRisk.style.strokeDashoffset = offset;
    console.log('✅ CV - Circumference:', circumference, 'Offset:', offset, 'per', percentage + '%');
    console.log('🔍 Per 9% dovrebbe essere circa', circumference * 0.91, '- Applicato:', offset);

    // Cambia colore in base al rischio
    const strokeColor = dashboardData.score2.category === 'danger' ? '#EA4335' :
    dashboardData.score2.category === 'warning' ? '#FBBC05' : '#34A853';
    cvRisk.setAttribute('stroke', strokeColor);
    console.log('🎨 Colore grafico CV:', strokeColor, 'per categoria:', dashboardData.score2.category);
  } else {
    console.warn('⚠️ Elemento grafico CV non trovato');
  }

  // Aggiorna testo CV usando ID specifico
  const cvText = document.getElementById('cv-risk-text');
  if (cvText) {
    cvText.textContent = dashboardData.score2.value + '%';
    console.log('📝 Testo CV aggiornato:', cvText.textContent);
  } else {
    console.warn('⚠️ Elemento testo CV non trovato');
  }

  // Aggiorna dettagli CV usando ID specifici
  const cvAge = document.getElementById('cv-age');
  const cvPressure = document.getElementById('cv-pressure');
  const cvCholesterol = document.getElementById('cv-cholesterol');
  const cvSmoking = document.getElementById('cv-smoking');

  if (cvAge) {
    cvAge.textContent = `${userData.eta || '--'} anni`;
    console.log('📝 Età CV aggiornata:', userData.eta);
  }

  if (cvPressure) {
    cvPressure.textContent = `${userData.pressione_sistolica || '--'}/${userData.pressione_diastolica || '--'} mmHg`;
    console.log('📝 Pressione CV aggiornata:', userData.pressione_sistolica, userData.pressione_diastolica);
  }

  if (cvCholesterol) {
    cvCholesterol.textContent = `HDL ${userData.colesterolo_hdl_valore || '--'} mg/dL`;
    console.log('📝 Colesterolo CV aggiornato:', userData.colesterolo_hdl_valore);
  }

  if (cvSmoking) {
    cvSmoking.textContent = userData.fumatore || 'No';
    console.log('📝 Fumo CV aggiornato:', userData.fumatore);
  }
  // Aggiorna grafico rischio diabete (ADA)
  const diabetesCircle = document.querySelector('#tab-rischi .progress-ring__circle.ring-ada');
  const diabetesText = document.getElementById('diabetes-risk-text');

  if (diabetesCircle && diabetesText) {
    const score = dashboardData.diabetesRisk.score;
    const maxScore = dashboardData.diabetesRisk.maxScore;

    const percentage = (score / maxScore) * 100;
    const circumference = 314.16;
    const offset = circumference - (percentage / 100 * circumference);

    diabetesCircle.style.strokeDashoffset = offset;

    const strokeColor = dashboardData.diabetesRisk.risk === 'Alto' ? '#EA4335' :
    dashboardData.diabetesRisk.risk === 'Moderato' ? '#FBBC05' : '#34A853';

    diabetesCircle.setAttribute('stroke', strokeColor);
    diabetesText.textContent = `${score}/${maxScore}`;

    console.log('✅ ADA Risk grafico aggiornato:', { score, maxScore, percentage, offset });
  } else {
    console.warn('⚠️ Elemento ADA Risk ring o testo non trovato');
  }




  // Aggiorna dettagli rischio diabete
  const glicemiaEl = document.getElementById('glicemia-valore');
  if (glicemiaEl) {
    const glicemia = parseFloat(userData.glicemia_valore || 0);
    glicemiaEl.textContent = `${glicemia} mg/dL`;
    console.log('📝 Glicemia aggiornata:', glicemia);
  }

  const famDiabeteEl = document.getElementById('familiarita-diabete');
  if (famDiabeteEl) {
    const rispostaGrezza = String(userData.familiari_diabete || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const risposta = ['si', 'sì', 'yes', 'y', 'true', 'ok'].includes(rispostaGrezza) ? 'Sì' : 'No';
    famDiabeteEl.textContent = risposta;
    console.log('📝 Familiarità diabete aggiornata:', risposta, '(raw:', userData.familiari_diabete, ')');
  }

  const ipertensioneEl = document.getElementById('ipertensione');
  if (ipertensioneEl) {
    const pressioneAlta = String(userData.pressione_alta || '').toLowerCase() === 'sì' ||
    parseFloat(userData.pressione_sistolica) >= 140;
    ipertensioneEl.textContent = pressioneAlta ? 'Sì' : 'No';
    console.log('📝 Ipertensione aggiornata:', pressioneAlta);
  }

  const attivitaFisicaEl = document.getElementById('attivita-fisica');
  if (attivitaFisicaEl) {
    const minutiSettimanali = parseInt(userData.durata_attivita) || 0;
    attivitaFisicaEl.textContent = minutiSettimanali >= 150 ? 'Adeguata' : 'Insufficiente';
    console.log('📝 Attività fisica aggiornata:', minutiSettimanali, 'min/settimana');
  }

  console.log('✅ Tab rischi aggiornato');
}

function updateNewScoreBanners() {
  console.log('🔄 === AGGIORNAMENTO GRAFICI NUOVI SCORE ===');

  // SCORE2-Diabetes
  if (dashboardData.score2Diabetes?.value > 0) {
    const circle = document.querySelector('#score2d-banner .progress-ring__circle');
    const text = document.getElementById('score2d-banner-text');
    const hba1cEl = document.getElementById('score2d-banner-hba1c');
    const glicemiaEl = document.getElementById('score2d-banner-glucose');
    const sbpEl = document.getElementById('score2d-banner-sbp');

    if (circle && text) {
      const percentage = parseFloat(dashboardData.score2Diabetes.value);
      const circumference = 314.16;
      const offset = circumference - (percentage / 100 * circumference);
      circle.style.strokeDashoffset = offset;

      const strokeColor = dashboardData.score2Diabetes.category === 'danger' ? '#EA4335' :
                          dashboardData.score2Diabetes.category === 'warning' ? '#FBBC05' : '#34A853';
      circle.setAttribute('stroke', strokeColor);

      text.textContent = `${dashboardData.score2Diabetes.value}%`;
    }

    if (hba1cEl) hba1cEl.textContent = `${dashboardData.score2Diabetes.hba1c || '--'} %`;
    if (glicemiaEl) glicemiaEl.textContent = `${dashboardData.score2Diabetes.glicemia || '--'} mg/dL`;
    if (sbpEl) sbpEl.textContent = `${dashboardData.score2Diabetes.sistolica || '--'} mmHg`;
  }



  //FIB4
if (!isNaN(parseFloat(dashboardData.fib4?.value))) {
  const fib4 = dashboardData.fib4;

  const scoreEl = document.getElementById('fib4-banner-score');
  const astEl = document.getElementById('fib4-banner-ast');
  const altEl = document.getElementById('fib4-banner-alt');
  const pltEl = document.getElementById('fib4-banner-plt');

  if (scoreEl) {
    scoreEl.textContent = fib4.value;
    scoreEl.className = `score-indicator-2 text-2xl score-${fib4.category === 'success' ? 'medium' : fib4.category === 'warning' ? 'low' : 'high'}`;
  }

  if (astEl) astEl.textContent = `${fib4.ast || '--'} U/L`;
  if (altEl) altEl.textContent = `${fib4.alt || '--'} U/L`;
  if (pltEl) pltEl.textContent = `${fib4.plt || '--'} x10⁹/L`;

  // ✅ Log UI
  console.log("🎯 FIB4 nella UI:", {
    score: scoreEl?.textContent,
    ast: astEl?.textContent,
    alt: altEl?.textContent,
    plt: pltEl?.textContent
  });
} else {
  console.warn("⚠️ FIB4 non soddisfa condizione UI:", dashboardData.fib4);
}





  // FNI
  if (dashboardData.fni?.value > 0) {
    const scoreEl = document.getElementById('fni-banner-score');
    const albuminaEl = document.getElementById('fni-banner-albumina');
    const linfocitiEl = document.getElementById('fni-banner-linfociti');

    if (scoreEl) {
      const classSuffix = dashboardData.fni.category === 'danger' ? 'high' :
                          dashboardData.fni.category === 'warning' ? 'low' : 'medium';
      scoreEl.textContent = dashboardData.fni.value;
      scoreEl.className = `score-indicator-2 text-2xl score-${classSuffix}`;
    }

    if (albuminaEl) albuminaEl.textContent = `${dashboardData.fni.albumina || '--'} g/dL`;
    if (linfocitiEl) linfocitiEl.textContent = `${dashboardData.fni.linfociti || '--'} /mm³`;
  }

  console.log('✅ Tutti i nuovi score aggiornati');
}


function updateScreeningTab() {
  const container = document.querySelector('#tab-screening .space-y-3');
  if (!container) return;

  container.innerHTML = dashboardData.screenings.map(screening => {
    const borderColor = screening.status === 'completed' ? 'border-green-500' :
    screening.status === 'pending' ? 'border-yellow-500' : 'border-red-500';
    const badgeClass = screening.status === 'completed' ? 'badge-success' :
    screening.status === 'pending' ? 'badge-warning' : 'badge-danger';
    const badgeText = screening.status === 'completed' ? 'Completo' :
    screening.status === 'pending' ? 'In scadenza' : 'Scaduto';

    return `
    <div class="flex items-center p-2 rounded border-l-4 ${borderColor}">
    <div class="flex-1">
    <h4 class="font-medium">${screening.name}</h4>
    <p class="text-sm text-gray-600">Raccomandato ${screening.frequency}</p>
    </div>
    <div class="flex items-center space-x-2">
    <span class="badge ${badgeClass}">${badgeText}</span>
    <span class="text-xs text-gray-500">${screening.dueIn}</span>
    </div>
    </div>
    `;
  }).join('');
}

function updateLifestyleTab() {
  if (predimedChart) {
    // Prepara i dati da predimed_1 a predimed_14
    const predimedData = Array.from({ length: 14 }, (_, i) => {
      const key = `predimed_${i + 1}`;
      const risposta = String(userData[key] || '').toLowerCase();
      return ['sì', 'si', '1', 'true'].includes(risposta) ? 1 : 0;
    });

    console.log("📊 Dati PREDIMED per radar chart:", predimedData);

    // Aggiorna i dati del grafico
    predimedChart.data.datasets[0].data = predimedData;
    predimedChart.update();
  }

  // Aggiorna testo punteggio e aderenza
  const predimedScoreEl = document.getElementById('predimed-score');
  const predimedAdherenceEl = document.getElementById('predimed-adherence');

  if (predimedScoreEl) {
    predimedScoreEl.innerHTML = `Punteggio attuale: <span class="font-medium">${dashboardData.predimed.value}/14</span>`;
  }

  if (predimedAdherenceEl) {
    predimedAdherenceEl.innerHTML = `Aderenza alla dieta mediterranea: <span class="font-medium">${dashboardData.predimed.adherence}</span>`;
  }

  // Aggiorna barre di benessere psicologico
  const stressBar = document.querySelector('#tab-stile-vita .bg-yellow-500');
  if (stressBar) {
    const pct = dashboardData.lifestyle.stress.percentage;
    stressBar.style.width = pct + '%';
    stressBar.className = `h-2 rounded-full ${pct > 70 ? 'bg-red-500' : pct > 40 ? 'bg-yellow-500' : 'bg-green-500'}`;
  }

  const sleepBar = document.querySelector('#tab-stile-vita .bg-red-500');
  if (sleepBar) {
    const pct = dashboardData.lifestyle.sleep.percentage;
    sleepBar.style.width = pct + '%';
    sleepBar.className = `h-2 rounded-full ${pct < 40 ? 'bg-red-500' : pct < 70 ? 'bg-yellow-500' : 'bg-green-500'}`;
  }

  const moodBar = document.querySelector('#tab-stile-vita .bg-green-500');
  if (moodBar) {
    const pct = dashboardData.lifestyle.mood.percentage;
    moodBar.style.width = pct + '%';
  }
}


function updateNutritionTab() {
  const data = dashboardData.nutrition;

  document.getElementById("valore-bmr").textContent = `${data.bmr} kcal`;
  document.getElementById("valore-tdee").textContent = `${data.tdee} kcal`;
  document.getElementById("valore-obiettivo").textContent = data.objective;
  document.getElementById("valore-calorie-target").textContent = `${data.target} kcal`;
  document.getElementById("valore-attivita").textContent = data.activityLevel;

  document.getElementById("macro-protein").textContent = `${data.macros.protein.percentage}%`;
  document.getElementById("grammi-protein").textContent = `${data.macros.protein.grams}g`;

  document.getElementById("macro-carbs").textContent = `${data.macros.carbs.percentage}%`;
  document.getElementById("grammi-carbs").textContent = `${data.macros.carbs.grams}g`;

  document.getElementById("macro-fat").textContent = `${data.macros.fats.percentage}%`;
  document.getElementById("grammi-fat").textContent = `${data.macros.fats.grams}g`;

  // Grafico a torta (se previsto)
  if (macroChart) macroChart.destroy();
  const ctx = document.getElementById("macro-chart").getContext("2d");
  macroChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Proteine', 'Carboidrati', 'Grassi'],
      datasets: [{
        data: [
          data.macros.protein.percentage,
          data.macros.carbs.percentage,
          data.macros.fats.percentage
        ],
        backgroundColor: ['#16a34a', '#2563eb', '#facc15']
      }]
    },
    options: { cutout: '60%' }
  });
}


function updateActivityTab() {
  const activityDetails = document.querySelector('#tab-attivita .space-y-3');
  if (activityDetails) {
    activityDetails.innerHTML = `
    <div class="flex justify-between">
    <span class="text-sm text-gray-600">Frequenza</span>
    <span class="font-medium">${dashboardData.activity.current.frequency}</span>
    </div>
    <div class="flex justify-between">
    <span class="text-sm text-gray-600">Tipo</span>
    <span class="font-medium">${dashboardData.activity.current.type || 'Non specificato'}</span>
    </div>
    <div class="flex justify-between">
    <span class="text-sm text-gray-600">Durata</span>
    <span class="font-medium">${dashboardData.activity.current.duration}</span>
    </div>
    <div class="flex justify-between">
    <span class="text-sm text-gray-600">Intensità</span>
    <span class="font-medium text-yellow-600">${dashboardData.activity.current.intensity}</span>
    </div>
    <div class="flex justify-between">
    <span class="text-sm text-gray-600">Minuti/settimana</span>
    <span class="font-medium ${dashboardData.activity.compliance.status === 'Adeguata' ? 'text-green-600' : 'text-red-600'}">${dashboardData.activity.current.weeklyMinutes} (${dashboardData.activity.compliance.status})</span>
    </div>
    `;
  }

  const suggestionsContainer = document.querySelectorAll('#tab-attivita .space-y-3')[1];
  if (suggestionsContainer) {
    suggestionsContainer.innerHTML = dashboardData.activity.suggestions.map(suggestion => `
      <div class="p-3 rounded-lg border-l-4 border-blue-500">
      <h4 class="font-medium">${suggestion.type}</h4>
      <p class="text-sm text-gray-600">${suggestion.text}</p>
      </div>
      `).join('') || `
      <div class="p-3 rounded-lg border-l-4 border-green-500">
      <h4 class="font-medium">Ottimo lavoro!</h4>
      <p class="text-sm text-gray-600">Stai già raggiungendo gli obiettivi di attività fisica raccomandati</p>
      </div>
      `;
    }
  }

  function updateRecommendations() {
    const container = document.querySelector('.recommendation-card').parentElement;
    if (!container) return;

    container.innerHTML = dashboardData.recommendations
    .slice(0, 3)
    .map(rec => `
      <div class="recommendation-card p-3 bg-gray-50">
      <h3 class="font-medium">${rec.title}</h3>
      <p class="text-sm text-gray-600">${rec.description}</p>
      </div>
      `).join('');
    }

    // Inizializza i grafici
function initializeCharts() {
  const predimedCtx = document.getElementById('predimed-chart').getContext('2d');

  if (predimedChart) predimedChart.destroy();

const predimedLabels = [
  'Olio EVO',     // predimed_1
  'Olio ≥ 4v week',    // predimed_2
  'Verdure',      // predimed_3
  'Frutta',       // predimed_4
  'Carne rossa',  // predimed_5
  'Bevande zuccherate',  // predimed_6
  'Vino',         // predimed_7
  'Legumi',       // predimed_8
  'Pesce',        // predimed_9
  'Dolci',        // predimed_10
  'Carni bianche',// predimed_11
  'Frutta secca', // predimed_12
  'Soffritti',    // predimed_13
  'Dieta Mediterranea'    // predimed_14
];

const predimedTooltips = [
  'Usare olio extravergine d’oliva come principale fonte di grassi',                          // 1
  'Consumare più di 4 cucchiai di olio extravergine al giorno',                              // 2
  'Mangiare verdure almeno 2 volte al giorno',                                               // 3
  'Mangiare frutta almeno 3 volte al giorno',                                                // 4
  'Limitare carne rossa o salumi a meno di 1 porzione al giorno',                            // 5
  'Limitare le bevande zuccherate a meno di una al giorno',                                  // 6
  'Bere vino in quantità moderate durante i pasti',                                          // 7
  'Consumare legumi almeno 3 volte a settimana',                                             // 8
  'Consumare pesce o frutti di mare almeno 3 volte a settimana',                             // 9
  'Consumare dolci industriali meno di 3 volte a settimana',                                 // 10
  'Preferire carni bianche rispetto alle carni rosse',                                       // 11
  'Mangiare frutta secca almeno 3 volte a settimana',                                        // 12
  'Usare soffritti a base di olio d’oliva e pomodoro almeno 2 volte a settimana',            // 13
  'Sentire la propria alimentazione vicina al modello mediterraneo'                          // 14
];

  // Dati predimed (valori numerici e risposte testuali)
  const predimedNumericalAnswers = [];
  const predimedRawAnswers = [];

  for (let i = 0; i < 14; i++) {
    const key = `predimed_${i + 1}`;
    const risposta = String(userData[key] || '').toLowerCase();
    predimedRawAnswers.push(risposta);

    const isPositive = ['sì', 'si', '1', 'true'].includes(risposta);
    predimedNumericalAnswers.push(isPositive ? 1 : 0);
  }

  predimedChart = new Chart(predimedCtx, {
    type: 'radar',
    data: {
      labels: predimedLabels,
      datasets: [
{
  label: 'Risposte utente',
  data: predimedNumericalAnswers,
  backgroundColor: 'rgba(66, 133, 244, 0.2)',
  borderColor: '#4285F4',
  borderWidth: 2,
  pointBackgroundColor: '#4285F4',
  pointRadius: 7,
  pointHoverRadius: 9,
  pointHitRadius: 9,
  pointStyle: 'circle'
},
        {
          label: 'Obiettivo',
          data: Array(14).fill(1),
          backgroundColor: 'rgba(52, 168, 83, 0.1)',
          borderColor: '#34A853',
          borderWidth: 1,
          borderDash: [5, 5],
          pointRadius: 4 ,// invisibile ma serve per confronto
          pointHoverRadius: 7,
          pointHitRadius: 7
        }
      ]
    },
    options: {
      responsive: true,
      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: true
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: function (context) {
  // Mostra solo il tooltip per il dataset dell'utente
  if (context.dataset.label !== 'Risposte utente') {
    return null; // Ignora gli altri dataset
  }

  const i = context.dataIndex;
  const risposta = predimedRawAnswers[i];
  const obiettivo = predimedTooltips[i];

  let messaggioRisposta = 'Risposta utente: ';
  if (['sì', 'si', '1', 'true'].includes(risposta)) {
    messaggioRisposta += 'Lo faccio';
  } else if (['no', '0', 'false'].includes(risposta)) {
    messaggioRisposta += 'Non lo faccio, ma dovrei';
  } else {
    messaggioRisposta += 'Non disponibile';
  }

  return [messaggioRisposta, `Obiettivo: ${obiettivo}`];
}

          }
        },
        legend: {
          labels: {
            usePointStyle: true,
            font: {
              size: 13
            }
          }
        }
      },
      scale: {
        ticks: {
          beginAtZero: true,
          max: 1,
          stepSize: 1,
          display: false
        },
        pointLabels: {
          font: {
            size: 12
          }
        }
      }
    }
  });
}



function setupTabs() {
      document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', () => {
          const tabId = button.getAttribute('data-tab');

          document.querySelectorAll('.tab-button').forEach(btn => {
            btn.classList.remove('active');
          });
          document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
          });

          button.classList.add('active');
          if (tabId === 'tab-stile-vita') {
  setupLifestyleSliders();
}
          document.getElementById(tabId).classList.add('active');

          if (tabId === 'tab-stile-vita' && predimedChart) {
            predimedChart.update();
          }
          if (tabId === 'tab-nutritional' && macroChart) {
            macroChart.update();
          }
        });
      });
    }

    // Setup export button
    function setupExportButton() {
      const exportButton = document.querySelector('button:has(i.fas.fa-file-pdf)');
      if (exportButton) {
        exportButton.addEventListener('click', exportDashboardPDF);
      }
    }

    // Funzione per esportare PDF
    async function exportDashboardPDF() {
      const exportButton = document.querySelector('button:has(i.fas.fa-file-pdf)');
      const originalButtonText = exportButton.innerHTML;

      exportButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Esportazione...';
      exportButton.disabled = true;

      const currentActiveTab = document.querySelector('.tab-content.active');
      const allTabs = document.querySelectorAll('.tab-content');
      allTabs.forEach(tab => tab.classList.add('active'));

      if (predimedChart) predimedChart.update();
      if (macroChart) macroChart.update();

      setTimeout(() => {
        const dashboardContent = document.querySelector('main');

        const options = {
          margin: 10,
          filename: `Dashboard_HealthAI_${userData.email}_${new Date().toLocaleDateString('it-IT')}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: {
            scale: 1,
            useCORS: true,
            logging: false,
            allowTaint: true,
            foreignObjectRendering: false
          },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        html2pdf().from(dashboardContent).set(options).save()
        .then(() => {
          allTabs.forEach(tab => tab.classList.remove('active'));
          if (currentActiveTab) currentActiveTab.classList.add('active');

          exportButton.innerHTML = originalButtonText;
          exportButton.disabled = false;

          showNotification('PDF esportato con successo!', 'success');
        })
        .catch(error => {
          console.error('Errore export PDF:', error);

          allTabs.forEach(tab => tab.classList.remove('active'));
          if (currentActiveTab) currentActiveTab.classList.add('active');

          exportButton.innerHTML = originalButtonText;
          exportButton.disabled = false;

          showNotification('Errore durante l\'esportazione', 'error');
        });
      }, 500);
    }

    // Funzione per mostrare notifiche
    function showNotification(message, type) {
      const notification = document.createElement('div');
      notification.className = `fixed top-4 right-4 px-6 py-3 rounded-md shadow-lg z-50 ${
        type === 'success' ? 'bg-green-500' : 'bg-red-500'
      } text-white`;
      notification.innerHTML = `
      <div class="flex items-center">
      <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'} mr-2"></i>
      <span>${message}</span>
      </div>
      `;

      document.body.appendChild(notification);

      setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transition = 'opacity 0.5s ease';
        setTimeout(() => {
          document.body.removeChild(notification);
        }, 500);
      }, 3000);
    }

    // Auto-refresh ogni 5 minuti
    setInterval(async () => {
      const { data: sessionData } = await supabaseClient.auth.getSession();
      if (sessionData.session) {
        await loadUserData(sessionData.session.user.email);
        calculateAllScores();
        updateDashboard();
      }
    }, 300000);

    // Gestione logout
    document.getElementById('logout-btn')?.addEventListener('click', async () => {
      await supabaseClient.auth.signOut();
      window.location.href = 'login.html';
    });

// ===== SEZIONE PULSANTI INFO SU OGNI SCORE =====
const infoTexts = {


"score2-diabetes": `
<strong>🏥 SCORE2-Diabetes – Rischio Cardiovascolare nei Diabetici</strong><br><br>
Lo <strong>SCORE2-Diabetes</strong> è un modello validato per stimare il <em>rischio di eventi cardiovascolari fatali e non fatali a 10 anni</em> nelle persone con <strong>diabete di tipo 2</strong>.
<br><br>
📌 <u>Interpretazione:</u><br>
- <strong>Basso</strong>: &lt;10% → Rischio contenuto.<br>
- <strong>Intermedio</strong>: 10–20% → Necessario rafforzare la prevenzione.<br>
- <strong>Alto</strong>: &gt;20% → Richiesto intervento clinico immediato.<br><br>
💡 <u>Prevenzione:</u> Controllo stretto della glicemia e della pressione, ottimizzazione del profilo lipidico, abolizione del fumo, dieta mediterranea, attività fisica regolare.
  `,

  "score2": `
<strong>❤️ SCORE2 – Rischio Cardiovascolare nella Popolazione Generale</strong><br><br>
Lo <strong>SCORE2</strong> calcola il rischio di <em>malattie cardiovascolari fatali e non fatali</em> a 10 anni nella popolazione adulta senza diagnosi di diabete.
<br><br>
📌 <u>Interpretazione:</u><br>
- <strong>Basso</strong>: &lt;5%<br>
- <strong>Moderato</strong>: 5–10%<br>
- <strong>Alto</strong>: &gt;10%<br><br>
💡 <u>Prevenzione:</u> Monitoraggio periodico di pressione e colesterolo, riduzione del sale, dieta ricca di frutta e verdura, mantenimento del peso forma, cessazione del fumo.
  `,

  "frail": `
<strong>🧓 FRAIL Scale – Valutazione della Fragilità nell’Anziano</strong><br><br>
La <strong>FRAIL Scale</strong> misura lo stato di fragilità dell’individuo, valutando 5 parametri: Affaticamento, Resistenza, Deambulazione, Malattie croniche, Perdita di peso involontaria.
<br><br>
📌 <u>Interpretazione:</u><br>
- <strong>Robusto</strong>: 0 punti<br>
- <strong>Pre-Frailty</strong>: 1–2 punti<br>
- <strong>Fragile</strong>: ≥3 punti<br><br>
💡 <u>Prevenzione:</u> Allenamento di forza e resistenza, fisioterapia, alimentazione proteica adeguata, integrazione di vitamina D e calcio, prevenzione cadute.
  `,

  "fli": `
<strong>🧪 FLI – Fatty Liver Index</strong><br><br>
Il <strong>Fatty Liver Index</strong> è uno strumento non invasivo per stimare la probabilità di <em>steatosi epatica</em> (fegato grasso) basato su circonferenza vita, BMI, trigliceridi e GGT.
<br><br>
📌 <u>Interpretazione:</u><br>
- <strong>Basso rischio</strong>: &lt;30 → Steatosi improbabile<br>
- <strong>Intermedio</strong>: 30–59 → Indeterminato, approfondire<br>
- <strong>Alto rischio</strong>: ≥60 → Steatosi probabile<br><br>
💡 <u>Prevenzione:</u> Ridurre peso corporeo, controllare trigliceridi, limitare alcol e zuccheri semplici, aumentare attività fisica aerobica.
  `,

  "ada": `
<strong>🩺 ADA Diabetes Risk Score</strong><br><br>
Il punteggio <strong>ADA</strong> stima il rischio di sviluppare <em>diabete di tipo 2</em> nei prossimi anni, basandosi su fattori come età, peso, familiarità e stile di vita.
<br><br>
📌 <u>Interpretazione:</u><br>
- <strong>Basso rischio</strong>: 0–2 punti<br>
- <strong>Moderato</strong>: 3–4 punti<br>
- <strong>Alto rischio</strong>: ≥5 punti<br><br>
💡 <u>Prevenzione:</u> Migliorare dieta, aumentare attività fisica, controlli glicemici regolari, riduzione di peso in caso di sovrappeso.
  `,

  "fib4": `
<strong>🧬 FIB4 – Indice di Fibrosi Epatica</strong><br><br>
Il <strong>FIB4</strong> è un indice derivato da età, AST, ALT e conta piastrinica per stimare la probabilità di <em>fibrosi epatica</em>.
<br><br>
📌 <u>Interpretazione:</u><br>
- <strong>Basso rischio</strong>: &lt;1.45<br>
- <strong>Intermedio</strong>: 1.45–3.25<br>
- <strong>Alto rischio</strong>: &gt;3.25<br><br>
💡 <u>Prevenzione:</u> Limitare consumo di alcol, mantenere peso forma, controllare glicemia e lipidi, valutazione epatologica se rischio intermedio/alto.
  `,
  
  "metabolic-syndrome": `
<strong>🧩 Sindrome Metabolica – Profilo Metabolico</strong><br><br>
La <strong>Sindrome Metabolica</strong> è una condizione caratterizzata dalla presenza simultanea di <em>almeno 3 fattori di rischio</em> per malattie cardiovascolari e diabete di tipo 2.<br><br>
📌 <u>Criteri diagnostici principali:</u><br>
- <strong>Girovita elevato</strong> (≥102 cm uomo, ≥88 cm donna)<br>
- <strong>Ipertensione arteriosa</strong> (≥130/85 mmHg o terapia antipertensiva)<br>
- <strong>Glicemia a digiuno elevata</strong> (≥100 mg/dL o diagnosi di diabete)<br>
- <strong>HDL basso</strong> (&lt;40 mg/dL uomo, &lt;50 mg/dL donna)<br>
- <strong>Trigliceridi elevati</strong> (≥150 mg/dL)<br><br>
📊 <u>Importanza clinica:</u><br>
La sindrome metabolica aumenta significativamente il rischio di <strong>infarto, ictus e diabete di tipo 2</strong>. È un campanello d’allarme che segnala uno squilibrio del metabolismo e la necessità di interventi mirati.<br><br>
💡 <u>Strategie preventive:</u><br>
- Riduzione del peso corporeo (anche un calo del 5-10% migliora i parametri)<br>
- Attività fisica regolare: ≥150 min/settimana di esercizio aerobico<br>
- Dieta mediterranea o DASH: ricca di fibre, povera di zuccheri semplici e grassi saturi<br>
- Controllo regolare della pressione, glicemia e profilo lipidico<br>
- Limitare il consumo di alcol e abolire il fumo<br><br>
📅 <u>Follow-up raccomandato:</u><br>
Visita di controllo e monitoraggio dei parametri ogni 6-12 mesi, o più frequentemente in caso di peggioramento.
`,

"predimed": `
<strong>🥗 Valutazione PREDIMED – Aderenza alla Dieta Mediterranea</strong><br><br>
Il <strong>PREDIMED</strong> è un questionario validato che misura il grado di <em>aderenza alla dieta mediterranea</em>, uno dei modelli alimentari più studiati e associati a una riduzione significativa del rischio cardiovascolare e metabolico.<br><br>
📌 <u>Interpretazione punteggio:</u><br>
- <strong>Bassa aderenza</strong>: 0–5 punti → Necessarie modifiche sostanziali all’alimentazione.<br>
- <strong>Media aderenza</strong>: 6–9 punti → Buona base, ma margini di miglioramento.<br>
- <strong>Alta aderenza</strong>: ≥10 punti → Alimentazione fortemente protettiva.<br><br>
📊 <u>Benefici documentati della dieta mediterranea:</u><br>
Riduzione del rischio di infarto, ictus, diabete tipo 2, alcuni tumori e malattie neurodegenerative.<br><br>
💡 <u>Raccomandazioni pratiche:</u><br>
- Aumentare consumo di frutta, verdura, legumi e cereali integrali.<br>
- Usare olio extravergine d'oliva come principale fonte di grassi.<br>
- Incrementare il consumo di pesce e frutta secca.<br>
- Limitare carni rosse, insaccati e dolci industriali.<br>
- Preferire cotture semplici e moderare l'uso del sale.
`,

"psychological-wellbeing": `
<strong>🧠 Benessere Psicologico – Stress, Sonno e Umore</strong><br><br>
La valutazione del <strong>benessere psicologico</strong> si basa su tre indicatori chiave: <em>stress percepito</em>, <em>qualità del sonno</em> e <em>stato dell'umore</em>. Questi fattori influenzano profondamente la salute generale, il sistema immunitario e il rischio di malattie croniche.<br><br>
📌 <u>Interpretazione indicatori:</u><br>
- <strong>Stress</strong>: livelli alti (&gt;7/10) associati a rischio cardiovascolare, disturbi del sonno e peggioramento del controllo glicemico.<br>
- <strong>Sonno</strong>: qualità scarsa (<6 ore o frequenti risvegli) aumenta rischio di obesità, diabete e depressione.<br>
- <strong>Umore</strong>: sintomi persistenti di tristezza o ansia richiedono valutazione clinica.<br><br>
📊 <u>Importanza clinica:</u><br>
Il benessere psicologico è un determinante fondamentale della salute: gestire stress e sonno migliora parametri metabolici, pressione arteriosa e resilienza immunitaria.<br><br>
💡 <u>Strategie di miglioramento:</u><br>
- Praticare tecniche di rilassamento (respirazione, meditazione, mindfulness).<br>
- Mantenere routine regolari di sonno e igiene del sonno.<br>
- Attività fisica regolare, preferibilmente all'aperto.<br>
- Coltivare relazioni sociali positive.<br>
- Chiedere supporto a professionisti in caso di sintomi persistenti.
`,

  "caloric-needs": `
<strong>🔥 Fabbisogno Calorico – BMR, TDEE e Calorie Suggerite</strong><br><br>
Il fabbisogno calorico indica la quantità di energia (calorie) necessaria per mantenere le funzioni vitali e sostenere l’attività fisica quotidiana.<br><br>

📌 <u>Concetti chiave:</u><br>
- <strong>BMR (Basal Metabolic Rate)</strong>: il metabolismo basale, cioè il numero di calorie necessarie per mantenere le funzioni vitali a riposo (respirazione, circolazione, temperatura corporea).<br>
- <strong>TDEE (Total Daily Energy Expenditure)</strong>: il dispendio energetico totale, ottenuto sommando al BMR le calorie consumate per tutte le attività giornaliere, compreso lo sport.<br>
- <strong>Calorie suggerite</strong>: il fabbisogno calorico totale personalizzato in base all’obiettivo (mantenimento, dimagrimento o aumento di massa).<br><br>

⚙️ <u>Come influisce l’attività fisica:</u><br>
- Più alta è l’attività fisica, maggiore sarà il TDEE e quindi le calorie suggerite.<br>
- Allenamenti intensi richiedono un surplus calorico per evitare perdita di massa muscolare.<br><br>

💡 <u>Consigli pratici:</u><br>
- Per <strong>dimagrire</strong>: mantenere un deficit calorico moderato (circa 300–500 kcal/die) preservando un adeguato apporto proteico.<br>
- Per <strong>aumentare massa</strong>: mantenere un surplus calorico controllato (200–400 kcal/die) con rapporto equilibrato di macronutrienti.<br>
- Per <strong>mantenimento</strong>: assumere un apporto calorico pari al TDEE con proporzione bilanciata di nutrienti.
`,

"macronutrients": `
<strong>🍽️ Ripartizione dei Macronutrienti – Proteine, Carboidrati, Grassi</strong><br><br>
La ripartizione dei macronutrienti è la distribuzione delle calorie totali giornaliere tra proteine, carboidrati e grassi, fondamentale per ottimizzare prestazioni, composizione corporea e salute generale.<br><br>

📌 <u>Proteine</u>:<br>
- Le quantità indicate nel nostro grafico si riferiscono a <strong>proteine nette</strong>, cioè la quantità di proteine effettivamente contenute nell’alimento.<br>
- La quantità netta dipende dalla <em>composizione dell’alimento</em>. Ad esempio:<br>
  • 100g di <strong>petto di pollo</strong> → ~23g proteine nette.<br>
  • 100g di <strong>tonno fresco</strong> → ~21g proteine nette.<br>
  • 100g di <strong>uova intere</strong> → ~13g proteine nette.<br>
  • 100g di <strong>pane</strong> → ~8g proteine nette.<br>
  • 100g di <strong>riso</strong> crudo → ~7g proteine nette.<br>
- Per calcolare quante proteine nette si assumono, è necessario conoscere la tabella nutrizionale dell’alimento.<br><br>

📌 <u>Carboidrati</u>:<br>
- Fonte primaria di energia per muscoli e cervello.<br>
- Presenti in pane, pasta, riso, patate, frutta.<br>
- Meglio privilegiare carboidrati complessi e ricchi di fibre.<br><br>

📌 <u>Grassi</u>:<br>
- Essenziali per ormoni, vitamine liposolubili e salute cellulare.<br>
- Fonti salutari: olio extravergine d’oliva, frutta secca, pesce azzurro, avocado.<br><br>

⚖️ <u>Rapporto per obiettivo</u>:<br>
- <strong>Dimagrimento</strong>: proteine alte, carboidrati moderati, grassi moderati.<br>
- <strong>Aumento massa</strong>: carboidrati alti, proteine moderate-alte, grassi moderati.<br>
- <strong>Mantenimento</strong>: proporzioni bilanciate in base alle preferenze e all’attività.<br><br>

💡 <u>Nota</u>: una dieta equilibrata non significa eliminare un macronutriente, ma adattarne la quantità alle necessità personali.
`



};

document.querySelectorAll(".info-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const key = btn.dataset.info;
    const content = infoTexts[key] || "<strong>ℹ️ Informazioni non disponibili</strong>";

    // Rileva il tema corrente dalla dashboard
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const isDark = currentTheme === 'dark';

    // Crea overlay modale
    const modal = document.createElement("div");
    modal.className = "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50";

    modal.innerHTML = `
      <div class="${isDark ? 'bg-gray-800 text-gray-100' : 'bg-white text-gray-900'} 
                  rounded-lg shadow-lg max-w-md w-full p-6 max-h-[80vh] flex flex-col">

        <!-- Contenuto scrollabile -->
        <div class="overflow-y-auto pr-2" style="max-height: calc(80vh - 60px); scrollbar-width: thin;">
          ${content}
        </div>

        <!-- Pulsante chiudi -->
        <div class="mt-4 text-right flex-shrink-0">
          <button class="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded" id="close-info-modal">
            Chiudi
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Chiudi modale
    document.getElementById("close-info-modal").addEventListener("click", () => {
      modal.remove();
    });
  });
});




