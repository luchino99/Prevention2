import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabase = createClient(
  'https://lwuhdgrkaoyvejmzfbtx.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3dWhkZ3JrYW95dmVqbXpmYnR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU2NzU1MDcsImV4cCI6MjA2MTI1MTUwN30.1c5iH4PYW-HeigfXkPSgnVK3t02Gv3krSeo7dDSqqsk'
);

export async function calcolaEFissaScore2() {
  const { data: { session }, error } = await supabase.auth.getSession();

  if (!session || !session.user) {
    console.warn("Utente non autenticato. Reindirizzamento al login...");
    window.location.href = "login.html";
    return;
  }

  const email = session.user.email;

  const { data: profile, error: profileError } = await supabase
    .from('anagrafica_utenti')
    .select('eta, sesso, fumatore, pressione_sistolica, colesterolo_totale, colesterolo_hdl_valore, regione_rischio_cv')
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

  // Mappa i dati del profilo sui campi del form SCORE2
  const fields = {
    age: profile.eta || '',
    gender: profile.sesso === 'maschio' ? 'male' : profile.sesso === 'femmina' ? 'female' : '',
    smoking: profile.fumatore === 'sì' ? '1' : '0',
    sbp: profile.pressione_sistolica || '',
    tchol: profile.colesterolo_totale || '',
    hdl: profile.colesterolo_hdl_valore || '',
    riskRegion: profile.regione_rischio_cv || 'moderate'
  };

  // Compila il form nell'iframe
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'gender' && value) {
      const input = score2Doc.querySelector(`input[name="gender"][value="${value}"]`);
      if (input) input.checked = true;
    } else if (key === 'smoking' && value) {
      const input = score2Doc.querySelector(`input[name="smoking"][value="${value}"]`);
      if (input) input.checked = true;
    } else if (key === 'riskRegion') {
      const select = score2Doc.getElementById(key);
      if (select) select.value = value;
    } else {
      const input = score2Doc.getElementById(key);
      if (input && value) input.value = value;
    }
  }

  // Aggiorna stile dentro iframe (se disponibile)
  if (typeof score2Frame.contentWindow.updateRadioStyles === 'function') {
    score2Frame.contentWindow.updateRadioStyles();
  }

  // Simula submit del form
  const form = score2Doc.getElementById("score2Form");
  if (form) {
    form.requestSubmit();
  } else {
    console.warn("⚠️ Form SCORE2 non trovato nell'iframe.");
  }
}
