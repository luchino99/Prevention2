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
  const score2El = document.getElementById("score2-banner-score");
  const score2CategoryEl = document.getElementById("score2-indicator-score");
  if (score2El) score2El.textContent = `${profile.score2_risk || "--"}%`;
  if (score2CategoryEl) score2CategoryEl.textContent = profile.score2_category || "--";

  // ====== ADA DIABETES RISK ======
  const adaScoreEl = document.getElementById("ada-banner-score");
  if (adaScoreEl) adaScoreEl.textContent = `${profile.ada_score || "--"}/8`;
  const adaBadgeEl = document.getElementById("ada-badge");
  if (adaBadgeEl) {
    adaBadgeEl.className = "badge";
    adaBadgeEl.classList.add(profile.ada_score >= 5 ? "badge-danger" : "badge-success");
  }
});
