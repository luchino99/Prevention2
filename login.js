const supabaseClient = window.supabase.createClient(
  'https://lwuhdgrkaoyvejmzfbtx.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3dWhkZ3JrYW95dmVqbXpmYnR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU2NzU1MDcsImV4cCI6MjA2MTI1MTUwN30.1c5iH4PYW-HeigfXkPSgnVK3t02Gv3krSeo7dDSqqsk'
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

  const loginForm = document.getElementById("login-form");

  let signupMode = false;

  signupBtn.addEventListener("click", () => {
    if (!signupMode) {
      extraFields.style.display = "block";
      signupBtn.innerText = "✅ Conferma registrazione";
      signupMode = true;
    }
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();
    const eta = etaInput.value.trim();
    const sesso = sessoInput.value.trim();
    const altezza = altezzaInput.value.trim();
    const peso = pesoInput.value.trim();

    // ✅ Se è attiva la modalità registrazione, ma i campi extra sono vuoti, esegui login
    if (
      signupMode &&
      (!eta || !sesso || !altezza || !peso)
    ) {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) {
        alert("❌ Errore login: " + error.message);
        return;
      }

      const checkSession = async () => {
        const { data } = await supabaseClient.auth.getSession();
        if (data.session) {
          window.location.href = "index.html";
        } else {
          setTimeout(checkSession, 100);
        }
      };
      checkSession();
      return;
    }

    // 📝 Altrimenti, registrazione
    if (!email || !password || !eta || !sesso || !altezza || !peso) {
      alert("⚠️ Inserisci tutti i dati richiesti per registrarti.");
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
      console.error("Errore salvataggio anagrafica:", dbError);
      alert("Registrazione riuscita, ma errore nel salvataggio anagrafica.");
    } else {
      alert("✅ Registrazione completata! Controlla la tua email per confermare.");
    }

    signupMode = false;
    extraFields.style.display = "none";
    signupBtn.innerText = "📝 Registrati";
    loginForm.reset();
  });
});
