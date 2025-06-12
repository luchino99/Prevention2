

export let userData = {};
export let dashboardData = {
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



import {
  calculateADARisk,
  calculateFLI,
  calculateSCORE2,
  calculateSCORE2Diabetes,
  calculateFRAIL
} from './score-utils.js';




function getScoreCategory(riskLabel) {
  const label = (riskLabel || '').toLowerCase();

  if (['basso', 'low', 'normale', 'robusto'].includes(label)) return 'success';
  if (['moderato', 'media', 'pre-frail', 'intermedio', 'probabile'].includes(label)) return 'warning';
  if (['alto', 'molto alto', 'frail', 'alta probabilità', 'severo'].includes(label)) return 'danger';

  return 'warning'; // fallback neutro
}


function updateLifestyleTab() {
  const lifestyle = dashboardData.lifestyle || {};
  const stress = lifestyle.stress || {};
  const sleep = lifestyle.sleep || {};
  const mood = lifestyle.mood || {};

  if (stress.percentage !== undefined) {
    document.querySelector("#stressBar").style.width = stress.percentage + "%";
    document.querySelector("#stressLevel").textContent = stress.category;
  }

  if (sleep.percentage !== undefined) {
    document.querySelector("#sleepBar").style.width = sleep.percentage + "%";
    document.querySelector("#sleepQuality").textContent = sleep.quality;
  }

  if (mood.percentage !== undefined) {
    document.querySelector("#moodBar").style.width = mood.percentage + "%";
    document.querySelector("#moodStatus").textContent = mood.status;
  }
}



async function calculateAllScores() {
  console.log("🧠 Avvio calcolo di tutti gli score clinici...");

  // 1. Score di base già presenti nella dashboard
  calculateBMI();
  calculateSCORE2();
  calculatePREDIMED(); // ← Questo è fondamentale!
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

  // 2. ADA Risk Score
  const ada = calculateADARisk(userData);
  dashboardData.diabetesRisk = {
    score: ada.score,
    bmi: ada.bmi,
    risk: ada.riskCategory,
    category: getScoreCategory(ada.riskCategory)
  };

  // 3. FLI (Fatty Liver Index)
  const fli = calculateFLI(userData);
  dashboardData.fni = {
    value: parseFloat(fli.fli.toFixed(1)),
    category: fli.category,
    status: getScoreCategory(fli.category)
  };

  // 4. SCORE2 (rischio cardiovascolare a 10 anni)
  const score2 = calculateSCORE2(userData);
  dashboardData.score2 = {
    value: score2.value,
    risk: score2.risk,
    category: getScoreCategory(score2.risk)
  };

  // 5. SCORE2-Diabetes (se utente è diabetico o valori disponibili)
  const score2d = calculateSCORE2Diabetes(userData);
  dashboardData.score2Diabetes = {
    value: score2d.value,
    risk: score2d.risk,
    category: getScoreCategory(score2d.risk),
    hba1c: userData.hba1c || '--',
    glicemia: userData.glicemia_valore || '--',
    sistolica: userData.pressione_sistolica || '--'
  };

  // 6. FRAIL (valutazione geriatrica semplificata per >65 anni)
  if (parseInt(userData.eta) > 65) {
    const frail = calculateFRAIL(userData);
    dashboardData.frail = {
      score: frail.score,
      status: frail.status
    };
  }

  // 🧪 Debug log finale
  console.log("✅ Score calcolati con successo:", dashboardData);
  console.log('🔢 SCORE2:', dashboardData.score2.value, '→', dashboardData.score2.risk);
  console.log('🔢 ADA Risk:', dashboardData.diabetesRisk.score, '/8 →', dashboardData.diabetesRisk.risk);
  console.log('🔢 SCORE2-Diabetes:', dashboardData.score2Diabetes.value, '→', dashboardData.score2Diabetes.risk);
  console.log('🔢 FLI:', dashboardData.fni.value, '→', dashboardData.fni.category);
}

export function updateDashboard() {
  console.log("🔄 Inizio aggiornamento dashboard...");
  console.log("📊 Dati da visualizzare:", dashboardData);

  // === RIEPILOGO SALUTE ===

  // BMI
  document.getElementById("bmi-indicator").textContent = dashboardData.bmi.value || '--';
  document.getElementById("bmi-badge").textContent = dashboardData.bmi.category || '--';
  document.getElementById("bmi-category").textContent = dashboardData.bmi.category || '--';

  // SCORE2
  document.getElementById("score2-indicator").textContent = `${dashboardData.score2.value || 0}%`;
  document.getElementById("score2-badge").textContent = dashboardData.score2.risk || '--';
  document.getElementById("score2-category").textContent = dashboardData.score2.risk || '--';

  // PREDIMED
  document.getElementById("predimed-indicator").textContent = dashboardData.predimed.value || '--';
  document.getElementById("predimed-badge").textContent = dashboardData.predimed.adherence || '--';
  document.getElementById("predimed-category").textContent = dashboardData.predimed.adherence || '--';

  // === RISCHI DETTAGLIATI ===

  // SCORE2-Diabetes
  const score2d = dashboardData.score2Diabetes;
  const score2dValue = parseFloat(score2d.value || 0);
  const offset = 314.16 * (1 - score2dValue / 100);
  document.querySelector(".ring-cv").style.strokeDashoffset = offset;
  document.getElementById("score2d-banner-text").textContent = `${score2dValue}%`;
  document.getElementById("score2d-banner-hba1c").textContent = `${score2d.hba1c || '--'} %`;
  document.getElementById("score2d-banner-glucose").textContent = `${score2d.glicemia || '--'} mg/dL`;
  document.getElementById("score2d-banner-sbp").textContent = `${score2d.sistolica || '--'} mmHg`;

  // ADA Diabetes Risk
  const ada = dashboardData.diabetesRisk;
  const adaPerc = ada.score / ada.maxScore;
  document.querySelector(".ring-ada").style.strokeDashoffset = 314.16 * (1 - adaPerc);
  document.getElementById("diabetes-risk-text").textContent = `${ada.score}/${ada.maxScore}`;
  document.getElementById("glicemia-valore").textContent = `${dashboardData.score2Diabetes.glicemia || '--'} mg/dL`;
  document.getElementById("familiarita-diabete").textContent = userData.familiari_diabete || '--';
  document.getElementById("ipertensione").textContent = userData.pressione_alta || '--';
  document.getElementById("attivita-fisica").textContent = `${userData.durata_attivita || 0} min/settimana`;

  // CV Tab
  document.getElementById("cv-risk-text").textContent = `${score2dValue}%`;
  document.getElementById("cv-age").textContent = `${userData.eta || '--'} anni`;
  document.getElementById("cv-pressure").textContent = `${userData.pressione_sistolica || '--'} mmHg`;
  document.getElementById("cv-cholesterol").textContent = `${userData.colesterolo_totale || '--'} mg/dL`;
  document.getElementById("cv-smoking").textContent = userData.fumatore || '--';

  console.log("✅ Dashboard aggiornata");
}



export async function loadUserData(email) {
  try {
    const { data, error } = await supabaseClient
      .from('anagrafica_utenti')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !data) {
      console.error('❌ Errore Supabase nel recupero dati utente:', error);
      throw error;
    }

    userData = data;
    console.log('🔍 Dati utente caricati correttamente:', userData);
  } catch (err) {
    console.warn('⚠️ Errore durante il recupero dati, uso dati di fallback.');
    userData = {
      nome: 'Debug User',
      eta: 55,
      sesso: 'maschio',
      peso: 75,
      altezza: 175,
      pressione_sistolica: 140,
      pressione_diastolica: 85,
      colesterolo_totale: 180,
      colesterolo_hdl_valore: 45,
      trigliceridi: 160,
      glicemia_valore: 110,
      hba1c: 6.8,
      diabete: 'sì',
      pressione_alta: 'sì',
      fumatore: 'no',
      familiari_diabete: 'no',
      attivita_fisica: 'si',
      durata_attivita: 60,
      tipo_lavoro: 'moderatamente attivo',
      ast: 40,
      alt: 35,
      piastrine: 210,
      albumina: 4.1,
      linfociti: 1900,
      stress: 6,
      insonnia: 'no',
      depressione: 'no'
    };
  }
}


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

  if (dashboardData.fib4.category === 'danger') {
    dashboardData.recommendations.push({
      title: 'Valutazione epatica',
      description: 'Consultare uno specialista per approfondimenti sulla funzionalità epatica',
      priority: 'high'
    });
  }

  if (['danger', 'warning'].includes(dashboardData.fni.category)) {
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

  if (['warning', 'danger'].includes(dashboardData.fib4.category)) {
    dashboardData.screenings.push({
      name: 'Ecografia epatica',
      frequency: 'Secondo necessità',
      status: 'pending',
      dueIn: '1 mese'
    });
  }
}
function analyzeLifestyle() {
  const stress = isNaN(parseInt(userData.stress)) ? 5 : parseInt(userData.stress);
  const hasInsomnia = userData.insonnia?.toLowerCase?.() === 'sì';
  const hasDepression = userData.depressione?.toLowerCase?.() === 'sì';

  dashboardData.lifestyle = {
    stress: {
      level: stress,
      category: stress <= 3 ? 'Basso' : stress <= 7 ? 'Medio' : 'Alto',
      percentage: Math.round((stress / 10) * 100)
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


function evaluatePhysicalActivity() {
  const frequency = userData.frequenza_attivita_fisica || '0 volte/settimana';
  const type = userData.tipo_attivita || '';
  const duration = parseInt(userData.durata_attivita) || 0;
  const weeklyMinutes = duration;

  dashboardData.activity = {
    current: {
      frequency,
      type,
      duration: duration + ' minuti',
      intensity: 'Moderata',
      weeklyMinutes
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

function calculatePREDIMED() {
  let score = 0;

  for (let i = 1; i <= 14; i++) {
    const value = String(userData[`predimed_${i}`] || '').toLowerCase();
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

  console.log('✅ PREDIMED calcolato:', dashboardData.predimed);
}


document.addEventListener('DOMContentLoaded', async function() {
  try {
    const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError || !sessionData.session) {
      window.location.href = 'login.html';
      return;
    }

    const emailUtente = sessionData.session.user.email;

    await loadUserData(emailUtente);
    calculateAllScores();
    updateDashboard();

    initializeCharts();
    setupTabs();
    setupExportButton();

  } catch (error) {
    console.error('Errore inizializzazione dashboard:', error);
  }
});


