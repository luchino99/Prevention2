
// Configuration constants
const supabaseUrl = 'https://lwuhdgrkaoyvejmzfbtx.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3dWhkZ3JrYW95dmVqbXpmYnR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU2NzU1MDcsImV4cCI6MjA2MTI1MTUwN30.1c5iH4PYW-HeigfXkPSgnVK3t02Gv3krSeo7dDSqqsk';
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
document.addEventListener('DOMContentLoaded', async function() {
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
// ✅ Sovrascrivi i dati dinamici con quelli salvati dal DB
dashboardData.score2 = {
  value: parseFloat(userData.score2_risk) || 0,
  risk: userData.score2_category || "Non calcolato",
  category: (userData.score2_category || "").toLowerCase().includes("alto") ? "danger"
           : (userData.score2_category || "").toLowerCase().includes("moderato") ? "warning"
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

    
    //calculateAllScores();
    
    updateDashboard();
    initializeCharts();
    setupTabs();
    setupExportButton();

  } catch (error) {
    console.error('Errore inizializzazione dashboard:', error);
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

// Calcola tutti gli score clinici - Versione con debug
function calculateAllScores() {
  console.log('🚀 Inizio calcolo di tutti gli score...');
  console.log('📊 Dati disponibili:', Object.keys(userData));

  // Inizializza i dati di default
  dashboardData.score2 = { value: '0.0', risk: 'Non calcolato', category: 'warning' };
  dashboardData.diabetesRisk = { score: 0, maxScore: 8, factors: [], risk: 'Non calcolato' };

  calculateBMI();
  calculateSCORE2();
  calculatePREDIMED();
  checkMetabolicSyndrome();
  calculateDiabetesRisk();
  calculateScore2Diabetes();
  calculateFIB4();
  calculateFNI();
  generateRecommendations();
  determineScreenings();
  analyzeLifestyle();
  calculateNutritionalNeeds();
  evaluatePhysicalActivity();

  console.log('🎯 Risultati finali degli score:', {
    bmi: dashboardData.bmi,
    score2: dashboardData.score2,
    diabetesRisk: dashboardData.diabetesRisk,
    score2Diabetes: dashboardData.score2Diabetes,
    fib4: dashboardData.fib4,
    fni: dashboardData.fni
  });

  // Debug specifico per i valori che non si vedono
  console.log('🔢 SCORE2 - Valore specifico:', dashboardData.score2.value, 'Rischio:', dashboardData.score2.risk);
  console.log('🔢 ADA Risk - Score specifico:', dashboardData.diabetesRisk.score, '/', dashboardData.diabetesRisk.maxScore, 'Rischio:', dashboardData.diabetesRisk.risk);
  console.log('🔢 Nuovi score - SCORE2D:', dashboardData.score2Diabetes?.value, 'FIB4:', dashboardData.fib4?.value, 'FNI:', dashboardData.fni?.value);
}

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

// 2. Calcolo SCORE2 - Versione migliorata con debug
function calculateSCORE2() {
  console.log('🔄 Inizio calcolo SCORE2...');

  const eta = parseInt(userData.eta);
  const sesso = userData.sesso?.toLowerCase();
  const sistolica = parseFloat(userData.pressione_sistolica);
  const colTotale = parseFloat(userData.colesterolo_totale);
  const hdl = parseFloat(userData.colesterolo_hdl_valore);
  const fumatore = userData.fumatore?.toLowerCase() === 'sì';

  console.log('📋 Valori SCORE2 estratti:', {
    eta, sesso, sistolica, colTotale, hdl, fumatore
  });

  // Verifica che tutti i valori necessari siano presenti
  if (!eta || isNaN(eta)) {
    console.warn('⚠️ Età mancante o non valida:', userData.eta);
    dashboardData.score2 = { value: '0.0', risk: 'Dati insufficienti', category: 'warning' };
    return;
  }

  if (!sistolica || isNaN(sistolica)) {
    console.warn('⚠️ Pressione sistolica mancante o non valida:', userData.pressione_sistolica);
    dashboardData.score2 = { value: '0.0', risk: 'Dati insufficienti', category: 'warning' };
    return;
  }

  if (!colTotale || isNaN(colTotale) || !hdl || isNaN(hdl)) {
    console.warn('⚠️ Valori colesterolo mancanti:', { colTotale, hdl });
    dashboardData.score2 = { value: '0.0', risk: 'Dati insufficienti', category: 'warning' };
    return;
  }

  let score = 0;

  // Fattore età
  if (eta >= 40 && eta < 50) score += 0;
  else if (eta >= 50 && eta < 60) score += 3;
  else if (eta >= 60 && eta < 70) score += 6;
  else if (eta >= 70) score += 9;

  // Fattore pressione
  if (sistolica >= 140) score += 2;
  if (sistolica >= 160) score += 3;
  if (sistolica >= 180) score += 4;

  // Fattore colesterolo
  const nonHDL = colTotale - hdl;
  if (nonHDL >= 190) score += 1;
  if (nonHDL >= 220) score += 2;
  if (nonHDL >= 280) score += 3;

  // Fattore fumo
  if (fumatore) score += 4;

  // Converti in percentuale di rischio
  const riskPercent = Math.min(score * 0.5, 20);

  console.log('🧮 Calcolo SCORE2 completato:', { score, riskPercent });

  dashboardData.score2.value = riskPercent.toFixed(1);

  if (riskPercent < 1) {
    dashboardData.score2.risk = 'Basso';
    dashboardData.score2.category = 'success';
  } else if (riskPercent < 5) {
    dashboardData.score2.risk = 'Moderato';
    dashboardData.score2.category = 'warning';
  } else if (riskPercent < 10) {
    dashboardData.score2.risk = 'Alto';
    dashboardData.score2.category = 'danger';
  } else {
    dashboardData.score2.risk = 'Molto alto';
    dashboardData.score2.category = 'danger';
  }

  console.log('✅ SCORE2 calcolato:', dashboardData.score2);
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

// 5. Calcolo rischio diabete (ADA Risk Score) - Versione con debug ultra-dettagliato
function calculateDiabetesRisk() {
  console.log('🔄 Inizio calcolo ADA Diabetes Risk...');

  let score = 0;
  let factors = [];

  const eta = parseInt(userData.eta);
  const bmi = parseFloat(dashboardData.bmi.value);

  console.log('📋 Valori base ADA Risk:', {
    eta: eta,
    bmi: bmi,
    peso: userData.peso,
    altezza: userData.altezza
  });

  // 1. FATTORE ETÀ
  console.log('🎂 === CONTROLLO ETÀ ===');
  console.log('Età utente:', eta);

  if (eta >= 40 && eta < 50) {
    score += 1;
    factors.push('Età 40-49');
    console.log('✅ Età 40-49: +1 punto');
  } else if (eta >= 50 && eta < 60) {
    score += 2;
    factors.push('Età 50-59');
    console.log('✅ Età 50-59: +2 punti');
  } else if (eta >= 60) {
    score += 3;
    factors.push('Età ≥60');
    console.log('✅ Età ≥60: +3 punti');
  } else {
    console.log('❌ Età <40: 0 punti');
  }
  console.log('Punteggio dopo età:', score);

  // 2. FATTORE BMI
  console.log('⚖️ === CONTROLLO BMI ===');
  console.log('BMI calcolato:', bmi);

  if (!isNaN(bmi)) {
    if (bmi >= 25 && bmi < 30) {
      score += 1;
      factors.push('Sovrappeso');
      console.log('✅ BMI 25-30 (Sovrappeso): +1 punto');
    } else if (bmi >= 30 && bmi < 40) {
      score += 2;
      factors.push('Obesità');
      console.log('✅ BMI 30-40 (Obesità): +2 punti');
    } else if (bmi >= 40) {
      score += 3;
      factors.push('Obesità grave');
      console.log('✅ BMI ≥40 (Obesità grave): +3 punti');
    } else {
      console.log('❌ BMI normale (<25): 0 punti');
    }
  } else {
    console.log('⚠️ BMI non calcolabile');
  }
  console.log('Punteggio dopo BMI:', score);

  // 3. FAMILIARITÀ DIABETE
  console.log('👨‍👩‍👧‍👦 === CONTROLLO FAMILIARITÀ ===');
  const famRaw = userData.familiari_diabete;
  console.log('Familiarità diabete (raw):', famRaw, 'Tipo:', typeof famRaw);

  if (famRaw) {
    const rispostaFam = String(famRaw).toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

    console.log('Familiarità diabete (processed):', rispostaFam);

    const hasFamilyHistory = rispostaFam && (
      rispostaFam.includes("si") ||
      rispostaFam.includes("yes") ||
      rispostaFam === "true" ||
      rispostaFam === "ok" ||
      rispostaFam === "y" ||
      rispostaFam === "1"
    );

    if (hasFamilyHistory) {
      score += 1;
      factors.push("Familiarità diabete");
      console.log('✅ Familiarità diabete: +1 punto');
    } else {
      console.log('❌ Nessuna familiarità diabete: 0 punti');
    }
  } else {
    console.log('❌ Campo familiarità vuoto: 0 punti');
  }
  console.log('Punteggio dopo familiarità:', score);

  // 4. IPERTENSIONE
  console.log('🩺 === CONTROLLO IPERTENSIONE ===');
  const pressioneAltaRaw = userData.pressione_alta;
  const sistolica = parseFloat(userData.pressione_sistolica);

  console.log('Pressione alta (campo):', pressioneAltaRaw, 'Tipo:', typeof pressioneAltaRaw);
  console.log('Pressione sistolica:', sistolica, 'Tipo:', typeof sistolica);

  let hasHypertension = false;

  // Controllo campo pressione_alta
  if (pressioneAltaRaw) {
    const rispostaIpertensione = String(pressioneAltaRaw).toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    console.log('Pressione alta (processed):', rispostaIpertensione);

    if (['si', 'sì', 'yes', 'true', 'ok', 'y', '1'].includes(rispostaIpertensione)) {
      hasHypertension = true;
      console.log('✅ Ipertensione da campo "pressione_alta": SÌ');
    }
  }

  // Controllo valore numerico pressione
  if (!hasHypertension && !isNaN(sistolica) && sistolica >= 140) {
    hasHypertension = true;
    console.log('✅ Ipertensione da valore sistolica ≥140: SÌ');
  }

  if (hasHypertension) {
    score += 1;
    factors.push('Ipertensione');
    console.log('✅ Ipertensione: +1 punto');
  } else {
    console.log('❌ Nessuna ipertensione: 0 punti');
  }
  console.log('Punteggio dopo ipertensione:', score);

  // 5. ATTIVITÀ FISICA
  console.log('🏃‍♂️ === CONTROLLO ATTIVITÀ FISICA ===');
  const attivitaRaw = userData.attivita_fisica;
  const durataRaw = userData.durata_attivita;

  console.log('Attività fisica (campo):', attivitaRaw, 'Tipo:', typeof attivitaRaw);
  console.log('Durata attività:', durataRaw, 'Tipo:', typeof durataRaw);

  let insufficientActivity = false;

  if (attivitaRaw && String(attivitaRaw).toLowerCase().includes('no')) {
    insufficientActivity = true;
    console.log('✅ Sedentario (attività_fisica = no)');
  } else {
    // Controlla durata se fa attività
    const durata = parseInt(durataRaw || '0');
    console.log('Durata attività fisica:', durata, 'minuti/settimana');

    if (durata < 150) {
      insufficientActivity = true;
      console.log('✅ Attività fisica insufficiente (<150 min/settimana)');
    } else {
      console.log('❌ Attività fisica adeguata (≥150 min/settimana)');
    }
  }

  if (insufficientActivity) {
    score += 1;
    const reason = attivitaRaw && String(attivitaRaw).toLowerCase().includes('no') ?
    'Sedentarietà' : 'Attività fisica insufficiente';
    factors.push(reason);
    console.log('✅ Attività fisica insufficiente: +1 punto');
  } else {
    console.log('❌ Attività fisica adeguata: 0 punti');
  }
  console.log('Punteggio dopo attività fisica:', score);

  // RISULTATO FINALE
  const riskLevel = score >= 5 ? 'Alto' : score >= 3 ? 'Moderato' : 'Basso';

  console.log('🎯 === RISULTATO FINALE ADA ===');
  console.log('Punteggio totale:', score, '/ 8');
  console.log('Fattori di rischio:', factors);
  console.log('Livello di rischio:', riskLevel);

  dashboardData.diabetesRisk = {
    score: score,
    maxScore: 8,
    factors: factors,
    risk: riskLevel
  };

  console.log('✅ ADA Diabetes Risk calcolato:', dashboardData.diabetesRisk);
}

// 6. Calcolo SCORE2-Diabete
function calculateScore2Diabetes() {
const hba1c = parseFloat(userData.hba1c);
const sistolica = parseFloat(userData.pressione_sistolica);
const eta = parseInt(userData.eta);
const haDiabete = String(userData.diabete || "").toLowerCase().includes("sì");
const fumatore = String(userData.fumatore || "").toLowerCase().includes("sì");

if (!haDiabete) {
  dashboardData.score2Diabetes = {
    value: 'ND',
    hba1c: hba1c || 0,
    sistolica: sistolica || 0,
    risk: 'Non applicabile',
    category: 'warning'
  };
  return;
}

let riskScore = 0;

// Età
if (eta >= 40 && eta < 50) riskScore += 2;
else if (eta >= 50 && eta < 60) riskScore += 4;
else if (eta >= 60 && eta < 70) riskScore += 6;
else if (eta >= 70) riskScore += 8;

// Pressione sistolica
if (sistolica >= 130) riskScore += 2;
if (sistolica >= 160) riskScore += 3;
if (sistolica >= 180) riskScore += 4;

// Fumo
if (fumatore) riskScore += 3;

// HbA1c
if (hba1c >= 6.5 && hba1c < 7.5) riskScore += 1;
else if (hba1c >= 7.5 && hba1c < 9) riskScore += 2;
else if (hba1c >= 9) riskScore += 3;

// Rischio stimato (più realistico)
const riskPercent = riskScore * 1.3; // oppure *1.4


let category = 'success';
let risk = 'Basso';
if (riskPercent >= 20) {
  category = 'danger';
  risk = 'Molto alto';
} else if (riskPercent >= 15) {
  category = 'danger';
  risk = 'Alto';
} else if (riskPercent >= 10) {
  category = 'warning';
  risk = 'Moderato';
}

dashboardData.score2Diabetes = {
  value: riskPercent.toFixed(1),
  hba1c: hba1c || 0,
  sistolica: sistolica || 0,
  risk: risk,
  category: category
};
}


// 7. Calcolo FIB4
function calculateFIB4() {
  const age = parseInt(userData.eta);
  const ast = parseFloat(userData.ast);
  const alt = parseFloat(userData.alt);
  const plt = parseFloat(userData.piastrine);

  if (!isNaN(age) && !isNaN(ast) && !isNaN(alt) && !isNaN(plt) && alt !== 0 && plt !== 0) {
    // Formula FIB4: (Age × AST) / (Platelets × √ALT)
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
  }
}

// 8. Calcolo FNI (Functional Nutritional Index)
function calculateFNI() {
  const albumina = parseFloat(userData.albumina);
  const linfociti = parseFloat(userData.linfociti);

  if (!isNaN(albumina) && !isNaN(linfociti)) {
    // Formula FNI: (10 × albumina) + (0.005 × linfociti)
    const fni = (10 * albumina) + (0.005 * linfociti);
    const fniRounded = fni.toFixed(1);

    let status = 'Normale';
    let category = 'success';

    if (fni < 35) {
      status = 'Malnutrizione severa';
      category = 'danger';
    } else if (fni < 45) {
      status = 'Malnutrizione lieve';
      category = 'warning';
    }

    dashboardData.fni = {
      value: fniRounded,
      albumina: albumina,
      linfociti: linfociti,
      status: status,
      category: category
    };
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

// 12. Calcola fabbisogno nutrizionale
function calculateNutritionalNeeds() {
  const peso = parseFloat(userData.peso);
  const altezza = parseFloat(userData.altezza);
  const eta = parseInt(userData.eta);
  const sesso = userData.sesso?.toLowerCase();
  const attivita = userData.tipo_lavoro || 'sedentario';

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
  const targetCalories = dashboardData.bmi.value > 25 ? tdee - 300 : tdee;

  dashboardData.nutrition = {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    target: Math.round(targetCalories),
    objective: dashboardData.bmi.value > 25 ? 'Dimagrimento moderato' : 'Mantenimento',
    activityLevel: attivita,
    macros: {
      protein: { percentage: 25, grams: Math.round(targetCalories * 0.25 / 4) },
      carbs: { percentage: 45, grams: Math.round(targetCalories * 0.45 / 4) },
      fats: { percentage: 30, grams: Math.round(targetCalories * 0.30 / 9) }
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

  // SCORE2
  const score2El = document.getElementById("score2-indicator");
  const score2CategoryEl = document.getElementById("score2-category");
  if (score2El) score2El.textContent = `${dashboardData.score2?.value || "--"}%`;
  if (score2CategoryEl) score2CategoryEl.textContent = dashboardData.score2?.risk || "--";

  // SCORE2-Diabetes
  document.getElementById("score2d-banner-text").textContent = `${dashboardData.score2Diabetes?.value || "--"}%`;
  document.getElementById("score2d-banner-hba1c").textContent = `${dashboardData.score2Diabetes?.hba1c || "--"} %`;
  document.getElementById("score2d-banner-glucose").textContent = `${dashboardData.score2Diabetes?.glicemia || "--"} mg/dL`;
  document.getElementById("score2d-banner-sbp").textContent = `${dashboardData.score2Diabetes?.sistolica || "--"} mmHg`;

  // FRAIL
  document.getElementById("frail-banner-score").textContent = `${userData.frail_score || "--"} / 5`;
  const frailBadge = document.getElementById("frail-banner-badge");
  frailBadge.textContent = userData.frail_category || "--";
  frailBadge.className = "badge";
  if (userData.frail_category === "Robusto") frailBadge.classList.add("badge-success");
  else if (userData.frail_category === "Pre-Frailty") frailBadge.classList.add("badge-warning");
  else if (userData.frail_category === "Fragile") frailBadge.classList.add("badge-danger");

  // FNI (Fatty Liver Index)
  document.getElementById("fni-banner-score").textContent = dashboardData.fni?.value || "--";
  document.getElementById("fni-banner-albumina").textContent = dashboardData.fni?.albumina || "--";
  document.getElementById("fni-banner-linfociti").textContent = dashboardData.fni?.linfociti || "--";

  // ADA Risk Score
  document.getElementById("cv-risk-text").textContent = `${dashboardData.diabetesRisk?.score || "--"} / ${dashboardData.diabetesRisk?.maxScore || "8"}`;
  document.getElementById("cv-age").textContent = `${userData.eta || "--"} anni`;
  document.getElementById("cv-pressure").textContent = `${userData.pressione_sistolica || "--"} mmHg`;
  document.getElementById("cv-cholesterol").textContent = `${userData.colesterolo_totale || "--"} mg/dL`;
  document.getElementById("cv-smoking").textContent = userData.fumatore || "--";

  // Aggiorna elementi della dashboard estesi
  updateHealthSummary();
  updateMetabolicProfile();
  updateRiskTab();
  updateScreeningTab();
  updateLifestyleTab();
  updateNutritionTab();
  updateActivityTab();
  updateRecommendations();
  updateNewScoreBanners();

  console.log('✅ Dashboard aggiornata');
}





// Funzioni di aggiornamento UI
function updateHealthSummary() {
  console.log('🔄 Aggiornamento riepilogo salute...');
  console.log('📊 Dati per riepilogo:', {
    bmi: dashboardData.bmi,
    
    predimed: dashboardData.predimed
  });

  // BMI - Usa ID specifici
  const bmiIndicator = document.getElementById('bmi-indicator');
  const bmiBadge = document.getElementById('bmi-badge');
  const bmiCategory = document.getElementById('bmi-category');

  if (bmiIndicator) {
    bmiIndicator.textContent = dashboardData.bmi.value;
    bmiIndicator.className = `score-indicator score-${dashboardData.bmi.status === 'success' ? 'medium' : dashboardData.bmi.status === 'warning' ? 'low' : 'high'}`;
    console.log('✅ BMI indicator aggiornato:', dashboardData.bmi.value);
  } else {
    console.warn('⚠️ BMI indicator non trovato');
  }

  if (bmiBadge) {
    bmiBadge.textContent = dashboardData.bmi.category;
    bmiBadge.className = `badge badge-${dashboardData.bmi.status}`;
    console.log('✅ BMI badge aggiornato:', dashboardData.bmi.category);
  }

  if (bmiCategory) {
    bmiCategory.textContent = dashboardData.bmi.category;
    console.log('✅ BMI categoria aggiornata:', dashboardData.bmi.category);
  }

  // SCORE2 - Usa ID specifici
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
  
  // PREDIMED - Usa ID specifici
  const predimedIndicator = document.getElementById('predimed-indicator');
  const predimedBadge = document.getElementById('predimed-badge');
  const predimedCategory = document.getElementById('predimed-category');

  if (predimedIndicator) {
    predimedIndicator.textContent = dashboardData.predimed.value;
    predimedIndicator.className = `score-indicator score-${dashboardData.predimed.status === 'success' ? 'medium' : dashboardData.predimed.status === 'warning' ? 'low' : 'high'}`;
    console.log('✅ PREDIMED indicator aggiornato:', dashboardData.predimed.value);
  } else {
    console.warn('⚠️ PREDIMED indicator non trovato');
  }

  if (predimedBadge) {
    predimedBadge.textContent = dashboardData.predimed.status === 'success' ? 'Buona' : dashboardData.predimed.status === 'warning' ? 'Migliorabile' : 'Scarsa';
    predimedBadge.className = `badge badge-${dashboardData.predimed.status}`;
    console.log('✅ PREDIMED badge aggiornato');
  } else {
    console.warn('⚠️ PREDIMED badge non trovato');
  }

  if (predimedCategory) {
    predimedCategory.textContent = dashboardData.predimed.adherence;
    console.log('✅ PREDIMED categoria aggiornata:', dashboardData.predimed.adherence);
  } else {
    console.warn('⚠️ PREDIMED categoria non trovata');
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

  // SCORE2-Diabete (questo funziona già bene)
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


  // FIB4 - CORREZIONE GRAFICO
  if (dashboardData.fib4?.value > 0) {
    console.log('📊 FIB4 - Valore:', dashboardData.fib4.value, 'Categoria:', dashboardData.fib4.category);

    const scoreEl = document.getElementById('fib4-banner-score');
    const astEl = document.getElementById('fib4-banner-ast');
    const altEl = document.getElementById('fib4-banner-alt');
    const pltEl = document.getElementById('fib4-banner-plt');

    if (scoreEl) {
      scoreEl.textContent = dashboardData.fib4.value;
      scoreEl.className = `score-indicator-2 text-2xl score-${dashboardData.fib4.category === 'success' ? 'medium' : dashboardData.fib4.category === 'warning' ? 'low' : 'high'}`;
      console.log('✅ FIB4 score indicator aggiornato:', dashboardData.fib4.value);
    }

    if (astEl) astEl.textContent = `${dashboardData.fib4.ast || '--'} U/L`;
    if (altEl) altEl.textContent = `${dashboardData.fib4.alt || '--'} U/L`;
    if (pltEl) pltEl.textContent = `${dashboardData.fib4.plt || '--'} x10⁹/L`;

    console.log('✅ FIB4 non ha grafico circolare - usa solo indicator');
  }

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
    const predimedData = [
      userData.predimed_1 === 'sì' ? 1 : 0,
      userData.predimed_2 === 'sì' ? 1 : 0,
      userData.predimed_3 === 'sì' ? 1 : 0,
      userData.predimed_4 === 'sì' ? 1 : 0,
      userData.predimed_5 === 'sì' ? 1 : 0,
      userData.predimed_6 === 'sì' ? 1 : 0,
      userData.predimed_7 === 'sì' ? 1 : 0
    ];

    predimedChart.data.datasets[0].data = predimedData;
    predimedChart.update();
  }

  const predimedScoreEl = document.getElementById('predimed-score');
  const predimedAdherenceEl = document.getElementById('predimed-adherence');

  if (predimedScoreEl) {
    predimedScoreEl.innerHTML = `Punteggio attuale: <span class="font-medium">${dashboardData.predimed.value}/14</span>`;
  }

  if (predimedAdherenceEl) {
    predimedAdherenceEl.innerHTML = `Aderenza alla dieta mediterranea: <span class="font-medium">${dashboardData.predimed.adherence}</span>`;
  }

  const stressBar = document.querySelector('#tab-stile-vita .bg-yellow-500');
  if (stressBar) {
    stressBar.style.width = dashboardData.lifestyle.stress.percentage + '%';
    stressBar.className = `h-2 rounded-full ${dashboardData.lifestyle.stress.percentage > 70 ? 'bg-red-500' : dashboardData.lifestyle.stress.percentage > 40 ? 'bg-yellow-500' : 'bg-green-500'}`;
  }

  const sleepBar = document.querySelector('#tab-stile-vita .bg-red-500');
  if (sleepBar) {
    sleepBar.style.width = dashboardData.lifestyle.sleep.percentage + '%';
    sleepBar.className = `h-2 rounded-full ${dashboardData.lifestyle.sleep.percentage < 40 ? 'bg-red-500' : dashboardData.lifestyle.sleep.percentage < 70 ? 'bg-yellow-500' : 'bg-green-500'}`;
  }

  const moodBar = document.querySelector('#tab-stile-vita .bg-green-500');
  if (moodBar) {
    moodBar.style.width = dashboardData.lifestyle.mood.percentage + '%';
  }
}

function updateNutritionTab() {
  const nutritionDetails = document.querySelector('#tab-nutritional .space-y-3');
  if (nutritionDetails) {
    nutritionDetails.innerHTML = `
    <div class="flex justify-between">
    <span class="text-sm text-gray-600">BMR</span>
    <span class="font-medium">${dashboardData.nutrition.bmr} kcal</span>
    </div>
    <div class="flex justify-between">
    <span class="text-sm text-gray-600">TDEE</span>
    <span class="font-medium">${dashboardData.nutrition.tdee} kcal</span>
    </div>
    <div class="flex justify-between">
    <span class="text-sm text-gray-600">Obiettivo</span>
    <span class="font-medium">${dashboardData.nutrition.objective}</span>
    </div>
    <div class="flex justify-between">
    <span class="text-sm text-gray-600">Calorie suggerite</span>
    <span class="font-medium text-blue-600">${dashboardData.nutrition.target} kcal</span>
    </div>
    <div class="flex justify-between">
    <span class="text-sm text-gray-600">Attività fisica</span>
    <span class="font-medium">${dashboardData.nutrition.activityLevel}</span>
    </div>
    `;
  }

  if (macroChart) {
    macroChart.data.datasets[0].data = [
      dashboardData.nutrition.macros.protein.percentage,
      dashboardData.nutrition.macros.carbs.percentage,
      dashboardData.nutrition.macros.fats.percentage
    ];
    macroChart.update();
  }

  const macroDetails = document.querySelector('#tab-nutritional .grid.grid-cols-3');
  if (macroDetails) {
    macroDetails.innerHTML = `
    <div class="p-2 rounded-lg">
    <div class="text-sm font-medium">Proteine</div>
    <div class="text-lg font-bold text-green-600">${dashboardData.nutrition.macros.protein.percentage}%</div>
    <div class="text-xs text-gray-500">${dashboardData.nutrition.macros.protein.grams}g</div>
    </div>
    <div class="p-2 rounded-lg">
    <div class="text-sm font-medium">Carboidrati</div>
    <div class="text-lg font-bold text-blue-600">${dashboardData.nutrition.macros.carbs.percentage}%</div>
    <div class="text-xs text-gray-500">${dashboardData.nutrition.macros.carbs.grams}g</div>
    </div>
    <div class="p-2 rounded-lg">
    <div class="text-sm font-medium">Grassi</div>
    <div class="text-lg font-bold text-yellow-600">${dashboardData.nutrition.macros.fats.percentage}%</div>
    <div class="text-xs text-gray-500">${dashboardData.nutrition.macros.fats.grams}g</div>
    </div>
    `;
  }
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
      // PREDIMED Chart
      const predimedCtx = document.getElementById('predimed-chart').getContext('2d');

      if (predimedChart) {
        predimedChart.destroy();
      }

      predimedChart = new Chart(predimedCtx, {
        type: 'radar',
        data: {
          labels: ['Olio oliva', 'Verdura', 'Frutta', 'Cereali', 'Legumi', 'Pesce', 'Vino'],
          datasets: [{
            label: 'Punteggio attuale',
            data: [0, 0, 0, 0, 0, 0, 0],
            backgroundColor: 'rgba(66, 133, 244, 0.2)',
            borderColor: '#4285F4',
            borderWidth: 2,
            pointBackgroundColor: '#4285F4'
          }, {
            label: 'Obiettivo',
            data: [1, 1, 1, 1, 1, 1, 1],
            backgroundColor: 'rgba(52, 168, 83, 0.1)',
            borderColor: '#34A853',
            borderWidth: 1,
            borderDash: [5, 5],
            pointBackgroundColor: '#34A853'
          }]
        },
        options: {
          scale: {
            ticks: {
              beginAtZero: true,
              max: 1,
              stepSize: 1
            }
          }
        }
      });

      // Macronutrienti Chart
      const macroCtx = document.getElementById('macro-chart').getContext('2d');

      if (macroChart) {
        macroChart.destroy();
      }

      macroChart = new Chart(macroCtx, {
        type: 'doughnut',
        data: {
          labels: ['Proteine', 'Carboidrati', 'Grassi'],
          datasets: [{
            data: [25, 45, 30],
            backgroundColor: ['#34A853', '#4285F4', '#FBBC05'],
            borderWidth: 0
          }]
        },
        options: {
          cutout: '70%',
          plugins: {
            legend: {
              display: false
            }
          }
        }
      });
    }

    // Setup delle tabs
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

    // Gestione temi
    document.addEventListener('DOMContentLoaded', function () {
      const themeToggle = document.getElementById('theme-toggle');

      function applyTheme(theme) {
        const html = document.documentElement;
        html.setAttribute('data-theme', theme);

        if (themeToggle) {
          themeToggle.textContent = (theme === 'dark') ? '☀️' : '🌙';
        }
      }

      if (themeToggle) {
        themeToggle.addEventListener('click', function () {
          const currentTheme = document.documentElement.getAttribute('data-theme');
          const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

          applyTheme(newTheme);
          window.parent.postMessage({ type: 'theme', theme: newTheme }, '*');
        });
      }

      window.addEventListener('message', function (event) {
        if (event.data && event.data.type === 'theme') {
          applyTheme(event.data.theme);
        }
      });
    });


    document.getElementById('refresh-btn').addEventListener('click', function() {
      window.location.reload();
    });
