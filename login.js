// login.js
const supabaseClient = window.supabase.createClient(
  'https://lwuhdgrkaoyvejmzfbtx.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3dWhkZ3JrYW95dmVqbXpmYnR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU2NzU1MDcsImV4cCI6MjA2MTI1MTUwN30.1c5iH4PYW-HeigfXkPSgnVK3t02Gv3krSeo7dDSqqsk' // sostituisci con la tua PUBLIC KEY 
);

document.addEventListener("DOMContentLoaded", () => {
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const loginBtn = document.getElementById("btn-login");
  const signupBtn = document.getElementById("btn-signup");
  const extraFields = document.getElementById("extra-fields");
const etaInput = document.getElementById("eta");
const sessoInput = document.getElementById("sesso");
const altezzaInput = document.getElementById("altezza");
const pesoInput = document.getElementById("peso");

let signupMode = false;


loginBtn.addEventListener("click", async () => {
  const { error } = await supabaseClient.auth.signInWithPassword({
    email: emailInput.value.trim(),
    password: passwordInput.value.trim(),
  });

  if (error) {
    alert("❌ Errore login: " + error.message);
    return;
  }

  // Aspetta che Supabase aggiorni la sessione
  const checkSession = async () => {
    const { data } = await supabaseClient.auth.getSession();
    if (data.session) {
      window.location.href = "index.html"; // ✅ Redirezione corretta
    } else {
      // Riprova tra 100ms
      setTimeout(checkSession, 100);
    }
  };

  checkSession();
});


signupBtn.addEventListener("click", async () => {
  // Mostra i campi extra al primo clic
  if (!signupMode) {
    const extraFields = document.getElementById("extra-fields");
    if (!extraFields) {
      alert("⚠️ Errore interno: non trovo il contenitore dei campi extra.");
      return;
    }

    extraFields.style.display = "block";
    signupBtn.innerText = "✅ Conferma registrazione";
    signupMode = true;
    return;
  }

  // Secondo clic → invia la registrazione
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();
  const eta = etaInput.value.trim();
  const sesso = sessoInput.value.trim();
  const altezza = altezzaInput.value.trim();
  const peso = pesoInput.value.trim();

  if (!email || !password || !eta || !sesso || !altezza || !peso) {
    alert("⚠️ Compila tutti i campi per registrarti.");
    return;
  }

  const { error } = await supabaseClient.auth.signUp({ email, password });

  if (error) {
    alert("❌ Errore registrazione: " + error.message);
    return;
  }

  const { error: dbError } = await supabaseClient
    .from("anagrafica_utenti")
    .insert([{ email, eta, sesso, altezza, peso }]);

  if (dbError) {
    console.error("Errore anagrafica:", dbError);
    alert("⚠️ Registrazione riuscita, ma errore nel salvataggio dati anagrafici.");
  } else {
    alert("✅ Registrazione completata! Controlla la tua email.");
  }

  signupMode = false;
  extraFields.style.display = "none";
  signupBtn.innerText = "📝 Registrati";
 });

});


