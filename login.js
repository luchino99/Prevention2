const supabase = window.supabase;
const supabaseClient = supabase.createClient("https://lwuhdgrkaoyvejmzfbtx.supabase.co", "public-anon-key"); // sostituisci con la tua PUBLIC key

document.getElementById("btn-login").addEventListener("click", async () => {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    alert("❌ Errore login: " + error.message);
  } else {
    window.location.href = "chat.html"; // 👈 redirezione
  }
});

document.getElementById("btn-signup").addEventListener("click", async () => {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password
  });

  if (error) {
    alert("❌ Errore registrazione: " + error.message);
  } else {
    alert("✅ Registrazione riuscita! Controlla la tua email per confermare.");
  }
});
