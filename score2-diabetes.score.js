import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabase = createClient(
  'https://lwuhdgrkaoyvejmzfbtx.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3dWhkZ3JrYW95dmVqbXpmYnR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU2NzU1MDcsImV4cCI6MjA2MTI1MTUwN30.1c5iH4PYW-HeigfXkPSgnVK3t02Gv3krSeo7dDSqqsk'
);

let listenerAttached = false;

export async function calcolaEFissaSCORE2Diabetes() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (!session || !session.user) {
    window.location.href = "login.html";
    return;
  }

  const email = session.user.email;

  const { data: profile, error: profileError } = await supabase
    .from('anagrafica_utenti')
    .select('eta, sesso, pressione_sistolica, colesterolo_totale, colesterolo_hdl_valore, fumatore, eta_diagnosi_diabete, hba1c, egfr, regione_rischio_cv')
    .eq('email', email)
    .single();

  if (profileError || !profile) {
    console.error("❌ Errore nel recupero dati SCORE2-Diabetes:", profileError?.message);
    return;
  }

  const iframe = document.getElementById("score2d-frame");
  const doc = iframe?.contentDocument || iframe?.contentWindow?.document;
  if (!doc) return;

  // ✅ Precompilazione form
  doc.getElementById("age").value = profile.eta || '';
  doc.getElementById("sbp").value = profile.pressione_sistolica || '';
  doc.getElementById("tchol").value = profile.colesterolo_totale || '';
  doc.getElementById("hdl").value = profile.colesterolo_hdl_valore || '';
  doc.getElementById("agediab").value = profile.eta_diagnosi_diabete || '';
  doc.getElementById("hba1c").value = profile.hba1c || '';
  doc.getElementById("egfr").value = profile.egfr || '';
  doc.getElementById("riskRegion").value = profile.regione_rischio_cv || 'moderate';

  // ✅ Normalizzazione gender
  let gender = 'female';
  const sesso = (profile.sesso || '').trim().toLowerCase();
  if (['maschio', 'uomo'].includes(sesso)) gender = 'male';

  // ✅ Normalizzazione fumatore
  let smoking = '0';
  const fumo = (profile.fumatore || '').trim().toLowerCase();
  if (['si', 'sì'].includes(fumo)) smoking = '1';

  const genderInput = doc.querySelector(`input[name="gender"][value="${gender}"]`);
  const smokingInput = doc.querySelector(`input[name="smoking"][value="${smoking}"]`);
  if (genderInput) genderInput.checked = true;
  if (smokingInput) smokingInput.checked = true;

  if (typeof iframe.contentWindow.updateRadioStyles === 'function') {
    iframe.contentWindow.updateRadioStyles();
  }

  // ✅ Invia il form
  doc.getElementById("score2Form")?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

  // ✅ Salvataggio: evitare registrazioni multiple
  if (!listenerAttached) {
    window.addEventListener("message", async (event) => {
      if (event.data?.type === "score2_diabetes_result") {
        const { risk, category } = event.data;
        const { error: updateError } = await supabase
          .from('anagrafica_utenti')
          .update({
            score2_diabetes_risk: risk,
            score2_diabetes_category: category
          })
          .eq('email', email);

        if (updateError) {
          console.error("❌ Errore salvataggio SCORE2-Diabetes:", updateError.message);
        } else {
          console.log("✅ SCORE2-Diabetes salvato:", risk, category);
        }
      }
    });
    listenerAttached = true;
  }

  // ✅ Richiesta postMessage per estrarre risultato
  setTimeout(() => {
    iframe.contentWindow.postMessage({ action: "extract_score2_diabetes" }, "*");
  }, 1000);
}
