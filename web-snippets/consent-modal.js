// web-snippets/consent-modal.js
export async function ensureConsentFlow() {
  const modal = document.getElementById("consentModal");
  const acceptBtn = document.getElementById("consentAccept");
  const rejectBtn = document.getElementById("consentReject");
  const healthCheck = document.getElementById("consentHealth");
  const aiCheck = document.getElementById("consentAI");

  if (!modal || !acceptBtn || !rejectBtn) return;

  // Se il consenso è già stato dato, non mostrare più il modal
  const storedConsent = localStorage.getItem("userConsent");
  if (storedConsent === "accepted" || storedConsent === "rejected") {
    modal.classList.add("hidden");
    return;
  }

  // Mostra il modal
  modal.classList.remove("hidden");

  acceptBtn.addEventListener("click", () => {
    if (!healthCheck.checked) {
      alert("Devi accettare il trattamento dei dati sanitari per continuare.");
      return;
    }

    // Salva preferenze utente
    const consentData = {
      health: healthCheck.checked,
      ai: aiCheck.checked,
      timestamp: new Date().toISOString(),
    };

    localStorage.setItem("userConsent", "accepted");
    localStorage.setItem("userConsentData", JSON.stringify(consentData));

    modal.classList.add("hidden");
  });

  rejectBtn.addEventListener("click", () => {
    localStorage.setItem("userConsent", "rejected");
    modal.classList.add("hidden");
    alert("Non puoi proseguire senza fornire i consensi necessari.");
    window.location.href = "/"; // opzionale: torna alla home
  });
}
