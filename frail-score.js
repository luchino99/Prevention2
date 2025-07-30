import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabaseUrl = 'https://nkkaxbmzacaxkwgtfmds.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

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

  const frailFrame = document.getElementById("frail-frame");
  const frailDoc = frailFrame?.contentDocument || frailFrame?.contentWindow?.document;

  if (!frailDoc) {
    console.warn("⚠️ Impossibile accedere all'iframe frail-frame.");
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
    const input = frailDoc.querySelector(`input[name="${key}"][value="${value}"]`);
    if (input) input.checked = true;
  }

  // Aggiorna stile dentro iframe
  if (typeof frailFrame.contentWindow.updateRadioStyles === 'function') {
    frailFrame.contentWindow.updateRadioStyles();
  }

  // Simula submit
  const form = frailDoc.getElementById("frailForm");
  if (form) {
    form.requestSubmit();
  } else {
    console.warn("⚠️ Form FRAIL non trovato nell’iframe.");
  }
}
