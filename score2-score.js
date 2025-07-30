import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabase = supabase.createClient(
  'https://nkkaxbmzacaxkwgtfmds.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ra2F4Ym16YWNheGt3Z3RmbWRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Nzc3NzQsImV4cCI6MjA2OTQ1Mzc3NH0.k36sBT3jILmLXc9jcLz843uLDCHrnuvhuMmMvBNzEPo'
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

  console.log("[DEBUG] Valori inseriti SCORE2:", {
  eta: profile.eta,
  sesso: gender,
  pressione: profile.pressione_sistolica,
  colesterolo: profile.colesterolo_totale,
  hdl: profile.colesterolo_hdl_valore,
  fumatore: smoking,
  regione: profile.regione_rischio_cv
});



  // Aggiorna stili radio
  if (typeof iframe.contentWindow.updateRadioStyles === 'function') {
    iframe.contentWindow.updateRadioStyles();
  }

  // Submit silenzioso (bypass validazione HTML)
 doc.getElementById("score2Form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));


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
