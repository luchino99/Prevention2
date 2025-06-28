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
    .select('eta, sesso, diabete_gestazionale, familiari_diabete, pressione_alta, durata_attivita, altezza, peso')
    .eq('email', email)
    .single();

  if (profileError || !profile) {
    console.error("❌ Errore nel recupero dati ADA Score:", profileError?.message);
    return;
  }

  const iframe = document.getElementById("ada-frame");
  const doc = iframe?.contentDocument || iframe?.contentWindow?.document;
  if (!doc) return;

  // Helper per selezionare e attivare radio button
  const setRadio = (name, value) => {
    const input = doc.querySelector(`input[name="${name}"][value="${value}"]`);
    if (input) {
      input.checked = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };

  // Precompilazione del form
  doc.getElementById("age").value = profile.eta || '';
  doc.getElementById("height").value = profile.altezza || '';
  doc.getElementById("weight").value = profile.peso || '';

  // Normalizzazione del sesso
const sessoRaw = (profile.sesso || '').trim().toLowerCase();
let genderVal = 'female'; // default

const maleWords = ['maschio', 'uomo', 'ragazzo', 'male', 'm', 'm.'];
const femaleWords = ['femmina', 'donna', 'ragazza', 'female', 'f', 'f.'];

if (maleWords.includes(sessoRaw)) {
  genderVal = 'male';
} else if (femaleWords.includes(sessoRaw)) {
  genderVal = 'female';
} else {
  console.warn(`⚠️ Valore sesso non riconosciuto: "${sessoRaw}", uso default "female"`);
}

// Simula clic sul radio corretto
const setRadio = (name, value) => {
  const input = doc.querySelector(`input[name="${name}"][value="${value}"]`);
  if (input) {
    input.click(); // simula selezione reale
    input.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    console.warn(`❗ Radio "${name}" con valore "${value}" non trovato`);
  }
};


  setRadio("gender", genderVal);
  setRadio("gestational", profile.diabete_gestazionale === 'si' ? 'yes' : 'no');
  setRadio("family_history", profile.familiari_diabete === 'si' ? 'yes' : 'no');
  setRadio("hypertension", profile.pressione_alta === 'si' ? 'yes' : 'no');

  // Valutazione attività fisica su base settimanale (≥150 minuti)
  let activeFlag = 'no';
  if (profile.durata_attivita !== null && !isNaN(parseInt(profile.durata_attivita))) {
    activeFlag = parseInt(profile.durata_attivita) >= 150 ? 'yes' : 'no';
  }
  setRadio("physical_activity", activeFlag);

  // Assicurati che gli stili dei radio button siano aggiornati
  if (typeof iframe.contentWindow.updateRadioStyles === 'function') {
    iframe.contentWindow.updateRadioStyles();
  }

console.log("✅ Pre-submit check:");
console.log("Gender:", doc.querySelector('input[name="gender"]:checked')?.value);
console.log("Family history:", doc.querySelector('input[name="family_history"]:checked')?.value);
console.log("Hypertension:", doc.querySelector('input[name="hypertension"]:checked')?.value);
console.log("Physical activity:", doc.querySelector('input[name="physical_activity"]:checked')?.value);

  
  // Submit silenzioso del form
  const form = doc.getElementById("adaForm");
  if (form) {
setTimeout(() => {
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}, 300); // leggero delay per sicurezza
  }

  // Listener per ricevere punteggio da ADA-score.html
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

  // Trigger postMessage per richiesta risultato ADA Score
  setTimeout(() => {
    iframe.contentWindow.postMessage({ action: "extract_ada_result" }, "*");
  }, 1000);
}
