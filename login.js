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

  loginBtn.addEventListener("click", async () => {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: emailInput.value.trim(),
      password: passwordInput.value.trim(),
    });

    if (error) {
      alert("❌ Errore login: " + error.message);
    } else {
      window.location.href = "index.html"; // ✅ Redirezione al chatbot
    }
  });

  signupBtn.addEventListener("click", async () => {
    const { data, error } = await supabaseClient.auth.signUp({
      email: emailInput.value.trim(),
      password: passwordInput.value.trim(),
    });

    if (error) {
      alert("❌ Errore registrazione: " + error.message);
    } else {
      alert("✅ Registrazione completata! Controlla la tua email per confermare.");
    }
  });
});


