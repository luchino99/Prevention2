// login.js
const supabaseClient = window.supabase.createClient(
  'https://lwuhdgrkaoyvejmzfbtx.supabase.co',
  'public-anon-key' // sostituisci con la tua PUBLIC KEY
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
      window.location.href = "chat.html"; // Redirezione al chatbot
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

  } else {
    alert("✅ Registrazione riuscita! Controlla la tua email per confermare.");
  }
});
