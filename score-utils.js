// score-utils.js
export function calculateADARisk(userData) {
  let score = 0;

  const age = parseInt(userData.eta);
  if (age >= 40 && age < 50) score += 1;
  else if (age >= 50 && age < 60) score += 2;
  else if (age >= 60) score += 3;

  const gender = userData.sesso?.toLowerCase();
  if (gender === "maschio") score += 1;

  if (gender === "femmina" && userData.gestational?.toLowerCase() === "sì") score += 1;

  if (userData.familiari_diabete?.toLowerCase() === "sì") score += 1;
  const sistolica = parseFloat(userData.pressione_sistolica);
if (!isNaN(sistolica) && sistolica >= 135) score += 1;


  const minuti = parseInt(userData.minuti_attivita || 0);
  const attivo = minuti >= 150;
  if (!attivo) score += 1;

  const peso = parseFloat(userData.peso);
  const altezza = parseFloat(userData.altezza);
  const bmi = peso / ((altezza / 100) ** 2);
  if (bmi >= 25 && bmi < 30) score += 1;
  else if (bmi >= 30) score += 2;

  return {
    score,
    bmi: bmi.toFixed(1),
    riskCategory: score >= 5 ? 'Alto rischio' : score >= 3 ? 'Moderato' : 'Basso'
  };
}

export function calculateFLI(userData) {
  const peso = parseFloat(userData.peso);
  const altezza = parseFloat(userData.altezza);
  const bmi = peso / ((altezza / 100) ** 2);
  const tg = parseFloat(userData.trigliceridi || 0);
  const ggt = parseFloat(userData.ggt || 0);
  const circonferenza = parseFloat(userData.circonferenza_vita || 0);

  const lnx = Math.log(tg) + 0.953 * Math.log(ggt) + 0.139 * bmi + 0.718 * Math.log(circonferenza) - 15.745;
  const fli = (Math.exp(lnx) / (1 + Math.exp(lnx))) * 100;

  return {
    fli,
    category: fli >= 60 ? 'Alta probabilità' : fli >= 30 ? 'Probabile' : 'Bassa'
  };
}

export function calculateSCORE2(userData) {
  const age = parseInt(userData.eta);
  const gender = userData.sesso?.toLowerCase();
  const sbp = parseFloat(userData.pressione_sistolica);
  const chol = parseFloat(userData.colesterolo_totale);
  const hdl = parseFloat(userData.colesterolo_hdl_valore);
  const smoking = userData.fumatore?.toLowerCase() === 'sì';

  if (!age || !sbp || !chol || !hdl) return { value: 0, risk: 'Dati insufficienti' };

  let score = 0;

  if (age >= 40 && age < 50) score += 0;
  else if (age >= 50 && age < 60) score += 3;
  else if (age >= 60 && age < 70) score += 6;
  else if (age >= 70) score += 9;

  if (sbp >= 140) score += 2;
  if (sbp >= 160) score += 3;
  if (sbp >= 180) score += 4;

  const nonHDL = chol - hdl;
  if (nonHDL >= 190) score += 1;
  if (nonHDL >= 220) score += 2;
  if (nonHDL >= 280) score += 3;

  if (smoking) score += 4;

  const riskPercent = Math.min(score * 0.5, 20);

  return {
    value: riskPercent.toFixed(1),
    risk: riskPercent < 1 ? 'Basso' :
          riskPercent < 5 ? 'Moderato' :
          riskPercent < 10 ? 'Alto' : 'Molto alto'
  };
}

export function calculateSCORE2Diabetes(userData) {
  const gender = userData.sesso?.toLowerCase() === 'femmina' ? 'female' : 'male';
  const age = parseFloat(userData.eta);
  const sbp = parseFloat(userData.pressione_sistolica);
  const tchol = parseFloat(userData.colesterolo_totale);
  const hdl = parseFloat(userData.colesterolo_hdl_valore);
  const smoking = userData.fumatore?.toLowerCase() === 'sì' ? 1 : 0;
  const agediab = parseFloat(userData.eta_diagnosi_diabete || age);
  const hba1c = parseFloat(userData.hba1c);
  const egfr = parseFloat(userData.egfr);
  const riskRegion = userData.risk_region || 'moderate';

  if ([age, sbp, tchol, hdl, hba1c, egfr].some(val => isNaN(val))) {
    return { value: 0, risk: 'Dati insufficienti' };
  }

  const coef = {
    age: gender === 'male' ? 0.5368 : 0.6624,
    smoking: gender === 'male' ? 0.4774 : 0.6139,
    sbp: gender === 'male' ? 0.1322 : 0.1421,
    tchol: gender === 'male' ? 0.1102 : 0.1127,
    hdl: gender === 'male' ? -0.1087 : -0.1568,
    agediab: gender === 'male' ? -0.0998 : -0.1180,
    hba1c: gender === 'male' ? 0.0955 : 0.1173,
    egfr: gender === 'male' ? -0.0591 : -0.0640,
    egfr2: gender === 'male' ? 0.0058 : 0.0062,
    baseline_survival: gender === 'male' ? 0.9605 : 0.9776,
    scale1: gender === 'male'
      ? { low: -0.5699, moderate: -0.1565, high: 0.3207, very_high: 0.5836 }
      : { low: -0.7380, moderate: -0.3143, high: 0.5710, very_high: 0.9412 },
    scale2: gender === 'male'
      ? { low: 0.7476, moderate: 0.8009, high: 0.9360, very_high: 0.8294 }
      : { low: 0.7019, moderate: 0.7701, high: 0.9369, very_high: 0.8329 }
  };

  const lnx = coef.age * age +
    coef.smoking * smoking +
    coef.sbp * sbp +
    coef.tchol * tchol +
    coef.hdl * hdl +
    coef.agediab * agediab +
    coef.hba1c * hba1c +
    coef.egfr * egfr +
    coef.egfr2 * egfr * egfr;

  const survival = coef.baseline_survival;
  const risk = 1 - Math.pow(survival, Math.exp((lnx - coef.scale1[riskRegion]) / coef.scale2[riskRegion]));

  return {
    value: (risk * 100).toFixed(1),
    risk: risk < 0.05 ? 'Basso' : risk < 0.10 ? 'Moderato' : risk < 0.20 ? 'Alto' : 'Molto alto'
  };
}

export function calculateFRAIL(userData) {
  const items = ['fatigue', 'resistance', 'ambulation', 'illnesses', 'loss'];
  const total = items.reduce((sum, item) => {
    return sum + (userData[`frail_${item}`]?.toLowerCase() === 'sì' ? 1 : 0);
  }, 0);

  return {
    score: total,
    status: total === 0 ? 'Robusto' : total <= 2 ? 'Pre-frail' : 'Frail'
  };
}
