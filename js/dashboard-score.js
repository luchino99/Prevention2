import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabase = createClient(
  'https://nkkaxbmzacaxkwgtfmds.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ra2F4Ym16YWNheGt3Z3RmbWRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Nzc3NzQsImV4cCI6MjA2OTQ1Mzc3NH0.k36sBT3jILmLXc9jcLz843uLDCHrnuvhuMmMvBNzEPo'
);

document.addEventListener("DOMContentLoaded", async () => {
  const { data: { session }, error } = await supabase.auth.getSession();

  if (!session || !session.user) {
    window.location.href = "login.html";
    return;
  }

  const email = session.user.email;

  // Recupero tutti i dati in un'unica query
  const { data: profile, error: profileError } = await supabase
    .from('anagrafica_utenti')
    .select(`
      stanchezza,
      camminata,
      malattie_croniche,
      sedia,
      perdita_peso,
      score2_risk,
      score2_category,
      ada_score,
      ada_category
    `)
    .eq('email', email)
    .single();

  if (profileError) {
    console.error("Errore nel recupero dati:", profileError.message);
    return;
  }

  // ====== FRAIL SCALE ======
  const answers = {
    fatigue: profile.stanchezza === "si" ? "yes" : "no",
    resistance: profile.sedia === "si" ? "yes" : "no",
    ambulation: profile.camminata === "no" ? "yes" : "no", // qui NO è negativo
    illnesses: profile.malattie_croniche === "si" ? "yes" : "no",
    loss: profile.perdita_peso === "si" ? "yes" : "no"
  };

  const frailScore = Object.values(answers).filter(v => v === "yes").length;

  let frailBadgeText = "";
  let frailBadgeClass = "";

  if (frailScore === 0) {
    frailBadgeText = "Robusto";
    frailBadgeClass = "bg-green-100 text-green-700";
  } else if (frailScore <= 2) {
    frailBadgeText = "Pre-Frailty";
    frailBadgeClass = "bg-yellow-100 text-yellow-700";
  } else {
    frailBadgeText = "Fragile";
    frailBadgeClass = "bg-red-100 text-red-700";
  }

  // Aggiorna banner FRAIL
  document.getElementById("frail-banner-score").textContent = `${frailScore} / 5`;
  const frailBadgeEl = document.getElementById("frail-banner-badge");
  frailBadgeEl.textContent = frailBadgeText;
  frailBadgeEl.className = `badge ${frailBadgeClass}`;

  // Aggiorna dettagli variabili FRAIL
  const frailVarsEl = document.getElementById("frail-variable-list");
  frailVarsEl.innerHTML = "";
  const labelMap = {
    fatigue: "Affaticamento",
    resistance: "Resistenza",
    ambulation: "Deambulazione",
    illnesses: "Malattie Croniche",
    loss: "Perdita di Peso"
  };

  for (const [key, value] of Object.entries(answers)) {
    const item = document.createElement("div");
    item.className = `text-sm flex justify-between px-2 py-1 rounded ${
      value === "yes" ? "text-red-600" : "text-green-600"
    }`;
    item.innerHTML = `<span>${labelMap[key]}</span><span>${value === "yes" ? "❌ Sì" : "✅ No"}</span>`;
    frailVarsEl.appendChild(item);
  }
// ====== SCORE2 ======
const score2Val = profile.score2_risk !== null && profile.score2_risk !== undefined
  ? parseFloat(profile.score2_risk).toFixed(1)
  : "--";

// Aggiorna riepilogo in alto
const score2SummaryEl = document.getElementById("score2-summary-indicator");
if (score2SummaryEl) score2SummaryEl.textContent = `${score2Val}%`;

// Aggiorna banner nella tab Rischi
const score2BannerEl = document.getElementById("score2-banner-score");
if (score2BannerEl) score2BannerEl.textContent = `${score2Val}%`;

// Badge colore SCORE2
let score2ColorClass;
if (score2Val >= 15) {
  score2ColorClass = "badge-danger"; // rosso
} else if (score2Val >= 10) {
  score2ColorClass = "badge-warning"; // giallo
} else {
  score2ColorClass = "badge-success"; // verde
}
const score2Badge = document.getElementById("score2-badge");
if (score2Badge) {
  score2Badge.className = `badge ${score2ColorClass}`;
}

// Cerchio colore SCORE2
const score2Circle = document.querySelector("#score2-banner circle.progress-ring__circle");
if (score2Circle) {
  if (score2Val >= 15) score2Circle.setAttribute("stroke", "#EA4335"); // rosso
  else if (score2Val >= 10) score2Circle.setAttribute("stroke", "#FBBC05"); // giallo
  else score2Circle.setAttribute("stroke", "#34A853"); // verde
}

// ====== ADA Diabetes Risk ======
const adaScore = profile.ada_score !== null && profile.ada_score !== undefined
  ? parseInt(profile.ada_score)
  : "--";

// Testo ADA con massimo 9
const adaScoreEl = document.getElementById("ada-banner-score");
if (adaScoreEl) adaScoreEl.textContent = `${adaScore}/9`;

// Badge colore ADA (esempio: >=5 rosso)
const adaBadgeEl = document.getElementById("ada-badge");
if (adaBadgeEl) {
  adaBadgeEl.className = "badge";
  adaBadgeEl.classList.add(adaScore >= 5 ? "badge-danger" : "badge-success");
}

// Cerchio colore ADA (opzionale, se vuoi gestirlo)
const adaCircle = document.querySelector("#ada-banner circle.progress-ring__circle");
if (adaCircle) {
  if (adaScore >= 5) adaCircle.setAttribute("stroke", "#EA4335"); // rosso
  else adaCircle.setAttribute("stroke", "#34A853"); // verde
}

// ====== Fatty Liver Index (FLI) ======
const fliScore = profile.fli_score !== null && profile.fli_score !== undefined
  ? parseFloat(profile.fli_score).toFixed(1)
  : "--";

// Testo FLI
const fliScoreEl = document.getElementById("fni-banner-score");
if (fliScoreEl) fliScoreEl.textContent = fliScore;

// Cerchio colore FLI
const fliCircle = document.querySelector("#fni-banner circle.progress-ring__circle");
if (fliCircle) {
  if (fliScore >= 60) fliCircle.setAttribute("stroke", "#EA4335"); // rosso
  else if (fliScore >= 30) fliCircle.setAttribute("stroke", "#FBBC05"); // giallo
  else fliCircle.setAttribute("stroke", "#34A853"); // verde
}


});
