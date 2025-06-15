// frail-score.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabase = createClient(
  'https://lwuhdgrkaoyvejmzfbtx.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3dWhkZ3JrYW95dmVqbXpmYnR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU2NzU1MDcsImV4cCI6MjA2MTI1MTUwN30.1c5iH4PYW-HeigfXkPSgnVK3t02Gv3krSeo7dDSqqsk'
);

export async function calcolaEFissaFrail() {
  const { data: { session }, error } = await supabase.auth.getSession();

  if (!session || !session.user) {
    console.warn("Utente non autenticato. Reindirizzamento al login...");
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
    console.error("❌ Errore nel recupero dei dati utente:", profileError.message);
    return;
  }

  const fields = {
    fatigue: profile.stanchezza === "si" ? "yes" : "no",
    resistance: profile.sedia === "si" ? "yes" : "no",
    ambulation: profile.camminata === "no" ? "yes" : "no",
    illnesses: profile.malattie_croniche === "si" ? "yes" : "no",
    loss: profile.perdita_peso === "si" ? "yes" : "no"
  };

  for (const [key, value] of Object.entries(fields)) {
    const input = document.querySelector(`input[name="${key}"][value="${value}"]`);
    if (input) input.checked = true;
  }

  // Aggiorna stile dei radio button se necessario
  if (typeof updateRadioStyles === 'function') {
    updateRadioStyles();
  }

  // ✅ Ecco dove va questo blocco:
  const form = document.getElementById("frailForm");
  if (form) {
    form.requestSubmit(); // simula il click su "submit", attiva l'event listener esistente
  } else {
    console.warn("⚠️ Form FRAIL non trovato nel DOM.");
  }
}
