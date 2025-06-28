import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabase = createClient(
  'https://lwuhdgrkaoyvejmzfbtx.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3dWhkZ3JrYW95dmVqbXpmYnR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU2NzU1MDcsImV4cCI6MjA2MTI1MTUwN30.1c5iH4PYW-HeigfXkPSgnVK3t02Gv3krSeo7dDSqqsk'
);

let listenerAttached = false;

export async function calcolaEFissaADAScore() {
  const { data: { session }, error } = await supabase.auth.getSession();

  if (!session || !session.user) {
    window.location.href = "login.html";
    return;
  }

  const email = session.user.email;

  const { data: profile, error: profileError } = await supabase
    .from('anagrafica_utenti')
    .select('eta, sesso, diabete_gestazionale, familiari_diabete, ipertensione, attivo, altezza, peso')
    .eq('email', email)
    .single();

  if (profileError || !profile) {
    console.error("❌ Errore nel recupero dati ADA Score:", profileError?.message);
    return;
  }

  const iframe = document.getElementById("ada-frame");
  const doc = iframe?.contentDocument || iframe?.contentWindow?.document;
  if (!doc) return;

  // Precompilazione del form
  doc.getElementById("age").value = profile.eta || '';
  doc.getElementById("height").value = profile.altezza || '';
  doc.getElementById("weight").value = profile.peso || '';

  const gender = (profile.sesso || '').toLowerCase();
  const genderInput = doc.querySelector(`input[name="gender"][value="${gender}"]`);
  if (genderInput) genderInput.checked = true;

  const gestationalInput = doc.querySelector(`input[name="gestational"][value="${profile.diabete_gestazionale === 'si' ? 'yes' : 'no'}"]`);
  if (gestationalInput) gestationalInput.checked = true;

  const familyInput = doc.querySelector(`input[name="family_history"][value="${profile.familiari_diabete === 'si' ? 'yes' : 'no'}"]`);
  if (familyInput) familyInput.checked = true;

  const hyperInput = doc.querySelector(`input[name="hypertension"][value="${profile.ipertensione === 'si' ? 'yes' : 'no'}"]`);
  if (hyperInput) hyperInput.checked = true;

  const activeInput = doc.querySelector(`input[name="physical_activity"][value="${profile.attivo === 'si' ? 'yes' : 'no'}"]`);
  if (activeInput) activeInput.checked = true;

  if (typeof iframe.contentWindow.updateRadioStyles === 'function') {
    iframe.contentWindow.updateRadioStyles();
  }

  // Submit silenzioso
  doc.getElementById("adaForm")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

  // Listener per salvataggio
  if (!listenerAttached) {
    window.addEventListener("message", async (event) => {
      if (event.data?.type === "ada_result") {
        const { points, category } = event.data;

        const { error: updateError } = await supabase
          .from('anagrafica_utenti')
          .update({
            ada_score: points,
            ada_category: category
          })
          .eq('email', email);

        if (updateError) {
          console.error("❌ Errore salvataggio ADA Score:", updateError.message);
        } else {
          console.log("✅ ADA Score salvato:", points, category);
        }
      }
    });
    listenerAttached = true;
  }

  // Trigger postMessage per estrazione risultato
  setTimeout(() => {
    iframe.contentWindow.postMessage({ action: "extract_ada_result" }, "*");
  }, 1000);
}
