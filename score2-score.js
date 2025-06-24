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
    .select('eta, sesso, pressione_sistolica, colesterolo_totale, colesterolo_hdl_valore, fumatore, regione_rischio_cv')
    .eq('email', email)
    .single();

  if (profileError) {
    console.error("Errore nel recupero dei dati SCORE2:", profileError.message);
    return;
  }

  const iframe = document.getElementById("score2-frame");
  const doc = iframe?.contentDocument || iframe?.contentWindow?.document;
  if (!doc) return;

  // Compilazione form
  doc.getElementById("age").value = profile.eta || '';
  doc.getElementById("systolic").value = profile.pressione_sistolica || '';
  doc.getElementById("cholesterol").value = profile.colesterolo_totale || '';
  doc.getElementById("hdl").value = profile.colesterolo_hdl_valore || '';
  doc.getElementById("riskRegion").value = profile.regione_rischio_cv || 'moderate';

  const gender = profile.sesso === 'maschio' ? 'male' : 'female';
  const smoking = profile.fumatore === 'si' ? 'yes' : 'no';

const genderInput = doc.querySelector(`input[name="gender"][value="${gender}"]`);
const smokingInput = doc.querySelector(`input[name="smoking"][value="${smoking}"]`);

if (genderInput) genderInput.checked = true;
if (smokingInput) smokingInput.checked = true;


  // Aggiorna stili radio
  if (typeof iframe.contentWindow.updateRadioStyles === 'function') {
    iframe.contentWindow.updateRadioStyles();
  }

  // Submit silenzioso (bypass validazione HTML)
  doc.getElementById("score2Form")?.submit();

  // Listener risultato
  window.addEventListener("message", async (event) => {
    if (event.data?.type === "score2_result") {
      const { risk, category } = event.data;

      const { error: updateError } = await supabase
        .from('anagrafica_utenti')
        .update({
          score2_risk: risk,
          score2_category: category
        })
        .eq('email', email);

      if (updateError) {
        console.error("❌ Errore salvataggio score2:", updateError.message);
      } else {
        console.log("✅ SCORE2 salvato:", risk, category);
      }
    }
  });

  // Trigger di estrazione risultato (score2.html invierà postMessage)
  setTimeout(() => {
    iframe.contentWindow.postMessage({ action: "extract_score2" }, "*");
  }, 1000);
}
