// frail-score.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabase = createClient(
  'https://lwuhdgrkaoyvejmzfbtx.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3dWhkZ3JrYW95dmVqbXpmYnR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU2NzU1MDcsImV4cCI6MjA2MTI1MTUwN30.1c5iH4PYW-HeigfXkPSgnVK3t02Gv3krSeo7dDSqqsk'
);

export async function calcolaEFissaFrail(emailOverride = null) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const email = emailOverride || sessionData?.session?.user?.email;

  if (!email) {
    console.warn("Email mancante, impossibile procedere.");
    return;
  }

  const { data: profile, error: profileError } = await supabase
    .from('anagrafica_utenti')
    .select('stanchezza, camminata, malattie_croniche, sedia, perdita_peso')
    .eq('email', email)
    .single();

  if (profileError || !profile) {
    console.error("Errore nel recupero del profilo:", profileError?.message);
    return;
  }

  const fields = {
    fatigue: profile.stanchezza === "si" ? "yes" : "no",
    resistance: profile.sedia === "si" ? "yes" : "no",
    ambulation: profile.camminata === "no" ? "yes" : "no",
    illnesses: profile.malattie_croniche === "si" ? "yes" : "no",
    loss: profile.perdita_peso === "si" ? "yes" : "no",
  };

  const score = Object.values(fields).filter(v => v === "yes").length;
  let category = "robust";
  if (score >= 3) category = "frail";
  else if (score >= 1) category = "pre-frail";

  const { data: updateData, error: updateError } = await supabase
    .from("anagrafica_utenti")
    .update({
      frail_score: parseInt(score),
      frail_category: category.toLowerCase().trim()
    })
    .eq("email", email)
    .select();

  if (updateError) {
    console.error("❌ Errore salvataggio:", updateError.message);
  } else if (!updateData || updateData.length === 0) {
    console.warn("⚠️ Nessuna riga aggiornata. Controlla l'email.");
  } else {
    console.log("✅ Score FRAIL aggiornato:", updateData);
  }
}
