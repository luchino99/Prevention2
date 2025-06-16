import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabase = createClient(
  'https://lwuhdgrkaoyvejmzfbtx.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3dWhkZ3JrYW95dmVqbXpmYnR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU2NzU1MDcsImV4cCI6MjA2MTI1MTUwN30.1c5iH4PYW-HeigfXkPSgnVK3t02Gv3krSeo7dDSqqsk'
);

export async function calcolaEFissaSCORE2() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (!session || !session.user) {
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
    console.error("Errore nel recupero dei dati utente:", profileError.message);
    return;
  }

  const score2Frame = document.getElementById("score2-frame");
  const score2Doc = score2Frame?.contentDocument || score2Frame?.contentWindow?.document;
  if (!score2Doc) return;

  score2Doc.getElementById("age").value = profile.eta || '';
  score2Doc.getElementById("systolic").value = profile.pressione_sistolica || '';
  score2Doc.getElementById("cholesterol").value = profile.colesterolo_totale || '';
  score2Doc.getElementById("hdl").value = profile.colesterolo_hdl_valore || '';

  const gender = profile.sesso === 'maschio' ? 'male' : 'female';
  const smoking = profile.fumatore === 'si' ? 'yes' : 'no';

  score2Doc.querySelector(`input[name="gender"][value="${gender}"]`).checked = true;
  score2Doc.querySelector(`input[name="smoking"][value="${smoking}"]`).checked = true;

  if (typeof score2Frame.contentWindow.updateRadioStyles === 'function') {
    score2Frame.contentWindow.updateRadioStyles();
  }

  score2Doc.getElementById("score2Form")?.requestSubmit();
}
