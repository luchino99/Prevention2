

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
async function calculateAllScores() {
  console.log("🧠 Avvio calcolo di tutti gli score clinici...");

  // 1. Score di base già presenti nella dashboard
  calculateBMI();
  calculatePREDIMED();
  checkMetabolicSyndrome();
  calculateFIB4();
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

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadUserData();            // <-- devi avere già questa funzione altrove o dichiararla
    await calculateAllScores();
    updateDashboard();
  } catch (err) {
    console.error("Errore durante l'inizializzazione:", err);
  }
});
