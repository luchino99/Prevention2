// /web-snippets/consent-modal.js
// Modulo ESM. Unico export: ensureConsentFlow()
// Requisiti: in pagina deve esistere window.supabaseClient (lo esponi già in <head>)

// ======================
// Helper
// ======================
function getEl(id) { return document.getElementById(id); }

function readStoredConsent() {
  try { return localStorage.getItem("userConsent"); } catch { return null; }
}

function writeStoredConsent(status, data = null) {
  try {
    localStorage.setItem("userConsent", status);
    if (data) localStorage.setItem("userConsentData", JSON.stringify(data));
  } catch (e) {
    console.warn("LocalStorage non disponibile:", e);
  }
}

async function getCurrentUserId() {
  try {
    const supabase = window?.supabaseClient;
    if (!supabase) return null;
    const { data } = await supabase.auth.getUser();
    return data?.user?.id || null;
  } catch { return null; }
}

async function logConsentToSupabase(consentData) {
  // È ok chiamarla anche se l’utente non è loggato: salviamo user_id = null
  try {
    const supabase = window?.supabaseClient;
    if (!supabase) {
      console.warn("Supabase non disponibile in window.supabaseClient: salto log remoto");
      return;
    }

    const userId = await getCurrentUserId();

    // Adatta il nome tabella/colonne se usi naming diverso
    const { error } = await supabase.from("consents").insert({
      user_id: userId,                          // UUID o null
      policy_version: consentData.policyVersion,
      consent_health: consentData.health,       // boolean
      consent_ai: consentData.ai,               // boolean
      timestamp: consentData.ts                 // ISO string
    });

    if (error) {
      console.error("Log consenso su Supabase fallito:", error);
    }
  } catch (e) {
    console.error("Eccezione log consenso su Supabase:", e);
  }
}

// ======================
// Export main
// ======================
export async function ensureConsentFlow() {
  const modal       = getEl("consentModal");
  const acceptBtn   = getEl("consentAccept");
  const rejectBtn   = getEl("consentReject");
  const healthCheck = getEl("consentHealth");
  const aiCheck     = getEl("consentAI");

  // Se il markup non c’è, esci silenziosamente
  if (!modal || !acceptBtn || !rejectBtn || !healthCheck) return;

  // Se l’utente ha già espresso una scelta, non riproporre
  const stored = readStoredConsent();
  if (stored === "accepted" || stored === "rejected") {
    modal.classList.add("hidden");
    return;
  }

  // Mostra il modale
  modal.classList.remove("hidden");

  // Evita doppio binding in caso di re-inizializzazione
  acceptBtn.replaceWith(acceptBtn.cloneNode(true));
  rejectBtn.replaceWith(rejectBtn.cloneNode(true));

  const _acceptBtn = getEl("consentAccept");
  const _rejectBtn = getEl("consentReject");

  _acceptBtn.addEventListener("click", async () => {
    // Consenso sanitario obbligatorio
    if (!healthCheck.checked) {
      alert("Devi accettare il trattamento dei dati sanitari per continuare.");
      return;
    }

    const consentData = {
      health: true,
      ai: !!aiCheck?.checked,
      policyVersion: window?.env?.POLICY_VERSION || "1.0.0",
      ts: new Date().toISOString(),
    };

    // 1) Persisti localmente (blocca ripresentazione)
    writeStoredConsent("accepted", consentData);
    modal.classList.add("hidden");

    // 2) (Consigliato) Log remoto per audit GDPR
    await logConsentToSupabase(consentData);

    // 3) Se serve, emetti un evento globale
    window.dispatchEvent(new CustomEvent("consent:accepted", { detail: consentData }));
  });

  _rejectBtn.addEventListener("click", () => {
    writeStoredConsent("rejected");
    modal.classList.add("hidden");
    alert("Non puoi proseguire senza i consensi necessari.");
    // opzionale: redirect o logout
    // window.location.href = "/";
  });
}
