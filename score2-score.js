import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabase = createClient(
  'https://lwuhdgrkaoyvejmzfbtx.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3dWhkZ3JrYW95dmVqbXpmYnR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU2NzU1MDcsImV4cCI6MjA2MTI1MTUwN30.1c5iH4PYW-HeigfXkPSgnVK3t02Gv3krSeo7dDSqqsk'
);

export async function calcolaEFissaSCORE2() {
  const { data: { session }, error } = await supabase.auth.getSession();

  if (!session || !session.user) {
    console.warn("Utente non autenticato. Reindirizzamento al login...");
    window.location.href = "login.html";
    return;
  }

  const email = session.user.email;

  const { data: profile, error: profileError } = await supabase
    .from('anagrafica_utenti')
    .select('eta, sesso, pressione_sistolica, colesterolo_totale, colesterolo_hdl_valore, fumatore')
    .eq('email', email)
    .single();

  if (profileError) {
    console.error("❌ Errore nel recupero dei dati utente:", profileError.message);
    return;
  }

  const score2Frame = document.getElementById("score2-frame");
  const score2Doc = score2Frame?.contentDocument || score2Frame?.contentWindow?.document;

  if (!score2Doc) {
    console.warn("⚠️ Impossibile accedere all'iframe score2-frame.");
    return;
  }

  // Compila i campi nel modulo SCORE2
  const ageInput = score2Doc.getElementById("age");
  const systolicInput = score2Doc.getElementById("systolic");
  const cholesterolInput = score2Doc.getElementById("cholesterol");
  const hdlInput = score2Doc.getElementById("hdl");
  
  if (ageInput) ageInput.value = profile.eta || '';
  if (systolicInput) systolicInput.value = profile.pressione_sistolica || '';
  if (cholesterolInput) cholesterolInput.value = profile.colesterolo_totale || '';
  if (hdlInput) hdlInput.value = profile.colesterolo_hdl_valore || '';

  // Gestisci radio buttons per sesso e fumo
  const genderRadio = score2Doc.querySelector(`input[name="gender"][value="${profile.sesso === 'maschio' ? 'male' : 'female'}"]`);
  if (genderRadio) genderRadio.checked = true;

  const smokingRadio = score2Doc.querySelector(`input[name="smoking"][value="${profile.fumatore === 'si' ? 'yes' : 'no'}"]`);
  if (smokingRadio) smokingRadio.checked = true;

  // Aggiorna stili se disponibili
  if (typeof score2Frame.contentWindow.updateRadioStyles === 'function') {
    score2Frame.contentWindow.updateRadioStyles();
  }

  // Simula submit
  const form = score2Doc.getElementById("score2Form");
  if (form) {
    form.requestSubmit();
  } else {
    console.warn("⚠️ Form SCORE2 non trovato nell'iframe.");
  }
}
