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

  // Recupero dati dal DB
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
      ada_category,
      fli_score
    `)
    .eq('email', email)
    .single();

  if (profileError) {
    console.error("Errore nel recupero dati:", profileError.message);
    return;
  }

  // Funzione per applicare il colore al cerchio pieno
  function setScoreCircleColor(elementId, value, thresholds = { high: 60, medium: 30 }) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.className = "absolute w-24 h-24 rounded-full"; // reset
    if (value >= thresholds.high) el.classList.add("bg-score-high");
    else if (value >= thresholds.medium) el.classList.add("bg-score-medium");
    else el.classList.add("bg-score-low");
  }


  // ====== SCORE2 ======
  const score2Val = profile.score2_risk !== null && profile.score2_risk !== undefined
    ? parseFloat(profile.score2_risk).toFixed(1)
    : "--";

  document.getElementById("score2-banner-score").textContent = `${score2Val}%`;
  setScoreCircleColor("score2-bg-circle", parseFloat(score2Val), { high: 15, medium: 10 });

  // Aggiorna riepilogo in alto
  const score2SummaryEl = document.getElementById("score2-summary-indicator");
  if (score2SummaryEl) {
    score2SummaryEl.textContent = `${score2Val}%`;
    score2SummaryEl.className = "score-indicator"; // reset classi
    if (score2Val >= 15) score2SummaryEl.classList.add("score-high");
    else if (score2Val >= 10) score2SummaryEl.classList.add("score-medium");
    else score2SummaryEl.classList.add("score-low");
  }

  // ====== ADA Diabetes Risk ======
  const adaVal = profile.ada_score !== null && profile.ada_score !== undefined
    ? parseInt(profile.ada_score)
    : "--";

  document.getElementById("ada-banner-score").textContent = `${adaVal}/9`;
  setScoreCircleColor("ada-bg-circle", adaVal, { high: 5, medium: 3 });

  // ====== Fatty Liver Index (FLI) ======
  const fliVal = profile.fli_score !== null && profile.fli_score !== undefined
    ? parseFloat(profile.fli_score).toFixed(1)
    : "--";

 

});
