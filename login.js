import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nkkaxbmzacaxkwgtfmds.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

document.addEventListener("DOMContentLoaded", () => {
  const showSignupBtn = document.getElementById("show-signup");
  const showLoginBtn = document.getElementById("show-login");
  const loginForm = document.getElementById("login-form");
  const signupForm = document.getElementById("signup-form");

  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");

  const etaInput = document.getElementById("eta");
  const sessoInput = document.getElementById("sesso");
  const altezzaInput = document.getElementById("altezza");
  const pesoInput = document.getElementById("peso");

  // Toggle tra login e registrazione
  showSignupBtn.addEventListener("click", () => {
    loginForm.style.display = "none";
    signupForm.style.display = "block";
  });

  showLoginBtn.addEventListener("click", () => {
    signupForm.style.display = "none";
    loginForm.style.display = "block";
  });

  // Login utente
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();

    if (!email || !password) {
      alert("⚠️ Inserisci email e password.");
      return;
    }

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

    if (error) {
      alert("❌ Errore login: " + error.message);
      return;
    }

    const checkSession = async () => {
      const { data } = await supabaseClient.auth.getSession();
      if (data.session) {
        window.location.href = "chatbot.html";
      } else {
        setTimeout(checkSession, 100);
      }
    };
    checkSession();
  });

  // Registrazione utente
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    document.activeElement.blur();

    const email = document.getElementById("signup-email").value.trim();
    const password = document.getElementById("signup-password").value.trim();
    const confirmPassword = document.getElementById("confirm-password").value.trim();

    const eta = etaInput.value.trim();
    const sesso = sessoInput.value.trim();
    const altezza = altezzaInput.value.trim();
    const peso = pesoInput.value.trim();

    if (!email || !password || !eta || !sesso || !altezza || !peso) {
      alert("⚠️ Compila tutti i campi richiesti.");
      return;
    }

    if (password !== confirmPassword) {
      alert("⚠️ Le password non corrispondono.");
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

    signupForm.reset();
  });
});
