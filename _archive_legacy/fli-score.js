import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// ✅ Inizializza Supabase
const supabase = createClient(
  'https://nkkaxbmzacaxkwgtfmds.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ra2F4Ym16YWNheGt3Z3RmbWRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Nzc3NzQsImV4cCI6MjA2OTQ1Mzc3NH0.k36sBT3jILmLXc9jcLz843uLDCHrnuvhuMmMvBNzEPo'
);

let listenerAttached = false;

export async function calcolaEFissaFLI() {
  const { data: { session }, error } = await supabase.auth.getSession();

  if (!session || !session.user) {
    window.location.href = "login.html";
    return;
  }

  const email = session.user.email;

  const { data: profile, error: profileError } = await supabase
    .from('anagrafica_utenti')
    .select('altezza, peso, circonferenza_vita, trigliceridi, ggt')
    .eq('email', email)
    .single();

  if (profileError || !profile) {
    console.error("❌ Errore nel recupero dati FLI:", profileError?.message);
    return;
  }

  const iframe = document.getElementById("fli-frame");
  const doc = iframe?.contentDocument || iframe?.contentWindow?.document;
  if (!doc) return;

  // ✅ Precompilazione form FLI
  doc.getElementById("height").value = profile.altezza || '';
  doc.getElementById("weight").value = profile.peso || '';
  doc.getElementById("waist").value = profile.circonferenza_vita || '';
  doc.getElementById("triglycerides").value = profile.trigliceridi || '';
  doc.getElementById("ggt").value = profile.ggt || '';

  // ✅ Invia il form
  doc.getElementById("fliForm")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

  // ✅ Salvataggio risultato dopo ricezione da iframe
  if (!listenerAttached) {
    window.addEventListener("message", async (event) => {
      if (event.data?.type === "fli_result") {
        const { fli, category } = event.data;

        const { error: updateError } = await supabase
          .from('anagrafica_utenti')
          .update({
            fli_score: fli,
            fli_category: category
          })
          .eq('email', email);

        if (updateError) {
          console.error("❌ Errore salvataggio FLI:", updateError.message);
        } else {
          console.log("✅ FLI salvato:", fli, category);
        }
      }
    });
    listenerAttached = true;
  }

  // ✅ Trigger postMessage verso iframe FLI
  setTimeout(() => {
    iframe.contentWindow.postMessage({ action: "extract_fli_result" }, "*");
  }, 1000);
}
