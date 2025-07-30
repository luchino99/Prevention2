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

  const { data: profile, error: profileError } = await supabase
    .from('anagrafica_utenti')
    .select('stanchezza, camminata, malattie_croniche, sedia, perdita_peso')
    .eq('email', email)
    .single();

  if (profileError) {
    console.error("Errore nel recupero dati:", profileError.message);
    return;
  }

  const answers = {
    fatigue: profile.stanchezza === "si" ? "yes" : "no",
    resistance: profile.sedia === "si" ? "yes" : "no",
    ambulation: profile.camminata === "no" ? "yes" : "no",
    illnesses: profile.malattie_croniche === "si" ? "yes" : "no",
    loss: profile.perdita_peso === "si" ? "yes" : "no"
  };

  const score = Object.values(answers).filter(v => v === "yes").length;

  let badgeText = "";
  let badgeClass = "";

  if (score === 0) {
    badgeText = "Robusto";
    badgeClass = "bg-green-100 text-green-700";
  } else if (score <= 2) {
    badgeText = "Pre-Frailty";
    badgeClass = "bg-yellow-100 text-yellow-700";
  } else {
    badgeText = "Fragile";
    badgeClass = "bg-red-100 text-red-700";
  }

  // Aggiorna banner principali
  document.getElementById("frail-banner-score").textContent = `${score} / 5`;
  const badgeEl = document.getElementById("frail-banner-badge");
  badgeEl.textContent = badgeText;
  badgeEl.className = `badge ${badgeClass}`;

  // Aggiorna dettagli delle variabili
  const varsEl = document.getElementById("frail-variable-list");
  varsEl.innerHTML = "";

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
    varsEl.appendChild(item);
  }
});
