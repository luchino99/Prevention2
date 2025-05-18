document.addEventListener("DOMContentLoaded", () => {
const input = document.getElementById("message-input");
const endpoint = "https://prevention2.vercel.app/api/openai";

const introduzione = "Benvenuto! Questo è un test di prevenzione sanitaria completo, progettato per aiutarti a valutare il tuo stato di salute e identificare possibili fattori di rischio. Compilare il test richiederà circa 20 minuti, ma potrebbe davvero fare la differenza nella tua vita. Le tue risposte saranno utilizzate per fornirti consigli personalizzati secondo le linee guida sanitarie ufficiali. Iniziamo quando sei pronto!";

const domandeBase = [
  { key: "eta", testo: "Quanti anni hai?" },
  { key: "sesso", testo: "Qual è il tuo sesso biologico? (maschio/femmina)" },
  { key: "origine_etnica", testo: "Qual è la tua origine etnica? (es: caucasica, africana, asiatica, ispanica, araba, indiana, mista, altra)" },
  { key: "altezza", testo: "Quanto sei alto/a in cm?" },
  { key: "peso", testo: "Quanto pesi in kg?" },
  { key: "vita", testo: "La misura del tuo giro vita è maggiore di 88 cm (se sei donna) o maggiore di 102 cm (se sei uomo)?" },
  { key: "glicemia", testo: "La tua glicemia è inferiore a 100 mg/dL?" },
  { key: "glicemia_valore", testo: "Sai a quanto corrisponde il valore della tua glicemia a digiuno?" },
  { key: "colesterolo_totale", testo: "Qual è il valore del tuo colesterolo totale (mg/dL)?" },
  { key: "colesterolo_ldl", testo: "Il tuo colesterolo LDL supera il valore di 70 mg/dL?" },
  { key: "colesterolo_hdl", testo: "Il tuo colesterolo HDL è inferiore a 50 mg/dL (se sei donna) o inferiore a 40 mg/dL (se sei uomo)?" },
  { key: "colesterolo_hdl_valore", testo: "Qual è il valore del tuo colesterolo HDL (se lo conosci)?" },
  { key: "pressione", testo: "La tua pressione arteriosa media è inferiore a 130/85 mmHg?" },
  { key: "pressione_sistolica", testo: "Qual è la tua pressione sistolica (massima) in mmHg?" },
  { key: "pressione_diastolica", testo: "Qual è la tua pressione diastolica (minima) in mmHg?" },
  { key: "malattie_croniche", testo: "Hai malattie croniche diagnosticate (es. diabete, ipertensione)?" },
  { key: "farmaci", testo: "Assumi farmaci?" },
  { key: "farmaci_dettaglio", testo: "Se assumi farmaci, elencali nella casella di testo sottostante.", condizione: "farmaci" },
  { key: "interventi", testo: "Hai subito interventi chirurgici rilevanti?" },
  { key: "interventi_dettaglio", testo: "Se hai subito interventi chirurgici rilevanti, elencali nella casella di testo sottostante." , condizione: "interventi" },
  { key: "familiarita_tumori", testo: "Ci sono stati casi di tumore in famiglia?" },
  { key: "sede_tumore", testo: "Da quale tipo di tumore è stato affetto il tuo familiare?" , condizione: "familiarita_tumori" },
  { key: "fumatore", testo: "Fumi?" },
  { key: "n_sigarette", testo: "Quante sigarette fumi al giorno?" , condizione: "fumatore" },
  { key: "alcol", testo: "Consumi bevande alcoliche?" },
  { key: "unita_alcoliche", testo: "Quante unità alcoliche bevi al giorno? (1 unità = 1 bicchiere di vino / birra / shot)" , condizione: "alcol" },
  { key: "attivita_fisica", testo: "Svolgi attività fisica settimanale?" },
  { key: "frequenza_attivita_fisica", testo: "Con quale frequenza svogli questa attività" , condizione: "attivita_fisica" },
  { key: "tipo_attivita", testo: "Che tipo di attività fisica svolgi? (aerobica, rafforzamento muscolare, rafforzamento osseo e stretching)" , condizione: "attivita_fisica" },
  { key: "durata_attivita", testo: "Quanto dura ogni allenamento? (in minuti)" , condizione: "attivita_fisica" },
  { key: "predimed_1", testo: "Usi l’olio extravergine di oliva come condimento principale (es. per cucinare, condire insalate)?" },
  { key: "predimed_2", testo: "Ne usi più di 4 cucchiai al giorno?" },
  { key: "predimed_3", testo: "Mangi almeno 2 porzioni di verdura al giorno? (1 porzione = 200g circa)" },
  { key: "predimed_4", testo: "Mangi almeno 3 porzioni di frutta al giorno? (1 porzione = 1 frutto medio o 100g circa)" },
  { key: "predimed_5", testo: "Mangi meno di 1 porzione al giorno di carne rossa o salumi?" },
  { key: "predimed_6", testo: "Bevi meno di 1 bevanda zuccherata al giorno?" },
  { key: "predimed_7", testo: "Bevi vino in quantità moderate? (1-7 bicchieri/settimana per le donne, 1-14 per gli uomini)" },
  { key: "predimed_8", testo: "Mangi almeno 3 porzioni di legumi alla settimana?" },
  { key: "predimed_9", testo: "Mangi almeno 3 porzioni di pesce o frutti di mare alla settimana?" },
  { key: "predimed_10", testo: "Consumai dolci industriali meno di 3 volte a settimana?" },
  { key: "predimed_11", testo: "Preferisci carni bianche rispetto a carni rosse?" },
  { key: "predimed_12", testo: "Mangi frutta secca almeno 3 volte a settimana?" },
  { key: "predimed_13", testo: "Usi soffritti con pomodoro, cipolla, aglio e olio d’oliva almeno 2 volte a settimana?" },
  { key: "predimed_14", testo: "Pensi che la tua alimentazione sia vicina alla dieta mediterranea?" },
  { key: "stanchezza", testo: "In genere ti senti stanco/a?" },
  { key: "depressione", testo: "Hai mai avuto episodi di depressione?" },
  { key: "insonnia", testo: "Hai difficoltà a dormire?" },
  { key: "tipo_insonnia", testo: "Se hai difficoltà a dormire, descrivi la difficoltà (es. fatica ad addormentarti, risvegli notturni...)" },
  { key: "stress", testo: "Livello percepito di stress (da 1 = niente stress a 10 = stress molto elevato)" },
  { key: "preferenze", testo: "C'è qualcosa di specifico sulla tua salute che ti interessa approfondire? (es: alimentazione, cuore, sonno, stress, screening oncologici, attività fisica, benessere mentale)" }

];

const domandeOver65 = [
  { key: "over_stanchezza", testo: "Ti senti stanco/a frequentemente?" },
  { key: "over_scale", testo: "Riesci a salire una rampa di scale?" },
  { key: "over_camminata", testo: "Riesci a camminare un isolato (circa 100 metri)?" },
  { key: "over_malattie", testo: "Hai più di 5 malattie croniche?" },
  { key: "over_peso", testo: "Hai perso più di 5 kg nell’ultimo anno senza volerlo?" },
  { key: "over_sollevamento", testo: "Hai difficoltà a sollevare oggetti pesanti (>4.5 kg)?" },
  { key: "over_sedia", testo: "Hai problemi ad alzarti da una sedia?" },
  { key: "over_cadute", testo: "Hai cadute frequenti?" },
  { key: "over_debolezza", testo: "Ti senti debole?" }
];

const domandeFemminili = [
  { key: "eta_menarca", testo: "A che età hai avuto il primo ciclo mestruale?" },
  { key: "contraccettivi", testo: "Hai mai usato contraccettivi ormonali?" },
  { key: "gravidezza", testo: "Hai avuto una o più gravidanze?" },
  { key: "eta_menopausa", testo: "A che età sei andata in menopausa? (facoltativo)" },
  { key: "familiarita_seno", testo: "Tua madre o tua nonna hanno avuto un tumore al seno?" },
  { key: "screening_seno", testo: "Hai mai svolto una mammografia o un'ecografia mammaria? (se hai più di 25 anni)" },
  { key: "papsmear", testo: "Svolgi regolarmente il Pap test? (se hai più di 25 anni)" }
];

const domandePianoAlimentare = [
  { key: "eta", testo: "Quanti anni hai?" },
  { key: "sesso", testo: "Qual è il tuo sesso biologico? (maschio/femmina)" },
  { key: "altezza", testo: "Quanto sei alto/a in cm?" },
  { key: "peso", testo: "Quanto pesi in kg?" },
  { key: "obiettivo", testo: "Qual è il tuo obiettivo? (dimagrimento / mantenimento / aumento massa muscolare)" },
  { key: "attivita_fisica", testo: "Che livello di attività fisica hai? (sedentario / leggero / moderato / intenso)" },
  { key: "tipo_lavoro", testo: "Che tipo di lavoro svolgi? (Sedentario, Leggermente attivo, Moderatamente attivo, Molto attivo, Estremamente attivo)" },
  { key: "preferenze", testo: "Hai uno stile alimentare preferito? (es: mediterranea, vegetariana, vegana, keto, nessuna)" },
  { key: "intolleranze", testo: "Hai intolleranze o allergie alimentari? (es: glutine, lattosio, ecc.)" },
  { key: "alimenti_esclusi", testo: "Ci sono alimenti che non vuoi includere nella dieta?" },
  { key: "pasti", testo: "Quanti pasti al giorno preferisci fare? (includi colazione e spuntini)" },
  { key: "orari_pasti", testo: "Hai orari fissi per i pasti principali? (opzionale)" },
  { key: "patologie", testo: "Hai patologie diagnosticate? (es: diabete, ipertensione, gastrite, ecc.)" },
  { key: "farmaci", testo: "Stai assumendo farmaci al momento? Se si, elencali (opzionale)" }, 
  ];

  const domandeAllenamento = [
  { key: "eta", testo: "Quanti anni hai?" },
  { key: "sesso", testo: "Qual è il tuo sesso biologico? (maschio/femmina)" },
  { key: "altezza", testo: "Quanto sei alto/a in cm?" },
  { key: "peso", testo: "Quanto pesi in kg?" },
  { key: "obiettivo", testo: "Qual è il tuo obiettivo principale? (dimagrimento/aumento massa/definizione/resistenza/postura/preparazione atletica)" },
  { key: "esperienza", testo: "Che livello di esperienza hai? (principiante/intermedio/avanzato)" },
  { key: "frequenza", testo: "Quanti allenamenti a settimana vuoi fare? (1-2/3-4/5-6)" },
  { key: "durata", testo: "Quanto tempo dedichi a ogni sessione? (20 min/30-45 min/1 ora o più)" },
  { key: "luogo", testo: "Dove ti alleni? (palestra/casa/all'aperto)" },
  { key: "attrezzatura", testo: "Quali attrezzi hai? (manubri/bilanciere/elastici/kettlebell/tappetino/nessuno)" },
  { key: "cardio", testo: "Vuoi includere esercizi cardio? (sì/no)" },
  { key: "focus", testo: "Preferisci forza muscolare, resistenza cardio o entrambi?" },
  { key: "infortuni", testo: "Hai infortuni o limitazioni fisiche? (es. schiena/ginocchia/spalle)" },
  { key: "patologie", testo: "Hai patologie croniche? (diabete/ipertensione/altre)" },
  { key: "pushups", testo: "Quanti piegamenti consecutivi riesci a fare?" },
  { key: "squats", testo: "Quanti squat a corpo libero completi senza pausa?" },
  { key: "plank", testo: "Quanto tempo mantieni la posizione plank?" },
  { key: "step_test", testo: "Dopo 3 minuti di step, misura il battito cardiaco (opzionale)" }
];
  


let domande = [];
let risposte = {};

let ultimaDomandaUtente = "";
let ultimaRispostaBot = "";
  
  
const aliasCondivisi = {
  eta: ["eta"],
  sesso: ["sesso"],
  altezza: ["altezza"],
  peso: ["peso"],
  attivita_fisica: ["attivita_fisica", "attivo30"],
  tipo_lavoro: ["tipo_lavoro"],
  preferenze: ["preferenze"],
  patologie: ["patologie"],
  farmaci_dettaglio: ["farmaci_dettaglio"],
  intolleranze: ["intolleranze"],
  alimenti_esclusi: ["alimenti_esclusi"],
  colesterolo_totale: ["colesterolo_totale"],
  colesterolo_hdl_valore: ["colesterolo_hdl_valore"],
  colesterolo_ldl_valore: ["colesterolo_ldl", "colesterolo_ldl_valore"],
  glicemia_valore: ["glicemia_valore"],
  pressione_sistolica: ["pressione_sistolica"],
  pressione_diastolica: ["pressione_diastolica"],
  fumatore: ["fumatore"],
  diabete: ["diabete"],
  pressione_alta: ["pressione", "pressione_valore", "pressione_alta"],
  familiari_diabete: ["familiari_diabete"],
  frattura: ["frattura", "over_cadute", "cadute"],
  famiglia_frattura_anca: ["famiglia_frattura_anca"],
  corticosteroidi: ["corticosteroidi"],
  alcol_eccessivo: ["alcol_eccessivo", "unita_alcoliche"],
  artrite: ["artrite"],
  stanchezza: ["stanchezza", "over_stanchezza"],
  camminata: ["camminata", "over_camminata"],
  sollevamento: ["sollevamento", "over_sollevamento"],
  sedia: ["sedia", "over_sedia"],
  cadute: ["cadute", "over_cadute"]
};
  function haRispostaCondivisa(domandaKey) {
  for (const [profiloKey, domandeKeys] of Object.entries(aliasCondivisi)) {
    if (domandeKeys.includes(domandaKey) && risposte[profiloKey]) {
      return true;
    }
  }
  return false;
}


let step = -1;
let modalita = null;
let modalitaConclusa = false;


function mostraMessaggio(testo, classe = "bot") {
  if (classe === "bot") removeTypingIndicator(); // Rimuove se presente

  const message = document.createElement("div");
  message.className = `message-bubble ${classe === "bot" ? "bot-message" : "user-message"}`;

  if (classe === "bot") {
    message.innerHTML = marked.parse(testo);
  } else {
    message.textContent = testo;
  }

  const container = document.getElementById("chat-messages");
  if (!container) {
    console.error("❌ Errore: #chat-messages non trovato nel DOM.");
    return;
  }

  container.appendChild(message);
  message.scrollIntoView({ behavior: "smooth" });
}




function selezionaModalita(tipo) {
  domandeOver65Aggiunte = false;
domandeFemminiliAggiunte = false;


  modalita = tipo;
  step = -1; 
  risposte = { ...risposte, email: emailUtente }; 

  
  document.querySelectorAll(".button-container").forEach(el => el.remove());
  document.getElementById("welcome-banner")?.classList.add("hidden");
  document.getElementById("chat-interface")?.classList.add("active");


  switch (tipo) {
  case "sintomi":
      domande = [];
      mostraMessaggio("🩺 Ciao! Sono qui per aiutarti con i tuoi sintomi. Descrivimi cosa stai provando e cercherò di fornirti alcune informazioni utili.");
      break;

  case "prevenzione":
  domande = [...domandeBase];

  
  const etaNum = parseInt(risposte.eta);
  if (!isNaN(etaNum) && etaNum > 65 && !domandeOver65Aggiunte) {
    domande.push(...domandeOver65);
    domandeOver65Aggiunte = true;
  }


  const sesso = risposte.sesso?.toLowerCase();
  if ((sesso === "femmina" || sesso === "donna") && !domandeFemminiliAggiunte) {
    domande.push(...domandeFemminili);
    domandeFemminiliAggiunte = true;
  }

  mostraMessaggio(introduzione);
  setTimeout(() => next(), 500);
  break;


    case "dieta":
      domande = [...domandePianoAlimentare];
      mostraMessaggio("🍽️ Un'alimentazione equilibrata è fondamentale per la salute! Rispondi a queste domande e dimmi qualcosa sulle tue abitudini alimentari attuali, eventuali restrizioni e obiettivi che vorresti raggiungere!");
      setTimeout(() => next(), 500);
      break;

    case "allenamento":
      domande = [...domandeAllenamento];
      mostraMessaggio("🏋️‍♂️ Pronto per un piano di allenamento personalizzato? Rispondi a queste domande e raccontami della tua routine attuale, obiettivi fitness e se hai particolari limitazioni fisiche!");
      setTimeout(() => next(), 500);
      break;

    default:
      mostraMessaggio("❗ Modalità non riconosciuta.");
      return;
  }

}
window.selezionaModalita = selezionaModalita;


let domandeOver65Aggiunte = false;
let domandeFemminiliAggiunte = false;

async function next() {
  
  const val = input.value.trim();

  if (modalita === "aggiorna" && step >= domande.length) {
  await salvaAnagraficaNelDatabase(risposte);
  mostraMessaggio("✅ Dati aggiornati con successo! Ora puoi scegliere un'opzione per continuare.");

  const datiAggiornati = { ...risposte };
  risposte = { ...datiAggiornati };
  modalita = null;
  step = -1;
  mostraScelteIniziali();
  return;
}

  
  if (modalita === "sintomi") {
    if (!val) {
      mostraMessaggio("❗ Per favore descrivi i tuoi sintomi prima di premere invio.");
      return;
    }

    mostraMessaggio(val, "user");
    await salvaMessaggioChat(emailUtente, "user", val);
    
    ultimaDomandaUtente = val;


    input.value = "";
    risposte.sintomi = val;

    showTypingIndicator();

    const payload = {
  sintomi: val,
  email: risposte.email
};

if (ultimaDomandaUtente && ultimaRispostaBot) {
  payload.contesto_chat = {
    ultima_domanda: ultimaDomandaUtente,
    ultima_risposta: ultimaRispostaBot,
    nuova_domanda: val
  };
}

fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload)
})

      .then(res => res.json())
      .then(async data => {
  const risposta = data.risposta || "⚠️ Nessuna risposta ricevuta.";
  mostraMessaggio(risposta);
  ultimaRispostaBot = risposta;
  ultimaDomandaUtente = val;


  try {
    await salvaMessaggioChat(emailUtente, "assistant", risposta);
    console.log("✅ Risposta AI salvata da modalità sintomi.");
  } catch (e) {
    console.error("❌ Errore salvataggio risposta AI (sintomi):", e);
  }
})

     .catch(err => {
  console.error("❌ Errore fetch sintomi:", err);
  // Solo se non è già stata ricevuta una risposta
  if (!ultimaRispostaBot || ultimaRispostaBot.trim() === "") {
    mostraMessaggio("⚠️ Errore nella comunicazione col server.");
  }
});

    return;
  }

  if (step === -1 && (!modalita || !domande || domande.length === 0)) {
    console.warn("⛔ Avanzamento bloccato: modalità non scelta o domande non inizializzate.");
    input.value = "";
    return;
  }

if (step >= 0 && val) {
  mostraMessaggio(val, "user");
  await salvaMessaggioChat(emailUtente, "user", val);

  if (step >= domande.length || !domande[step]) {
  console.warn("🚫 Nessuna domanda valida per questo step:", step);

  // Fine del questionario: analizza i dati
  if (modalita && modalita !== "aggiorna") {
    await salvaAnagraficaNelDatabase(risposte);
    await salvaCompilazioneNelDatabase(risposte, modalita);
    showTypingIndicator();
    inviaOpenAI(val);
  }

  return;
}



  const currentKey = domande[step].key;

  // 🔁 Salva la risposta su tutte le chiavi condivise
  let chiaveSalvata = false;
  for (const [profiloKey, domandeKeys] of Object.entries(aliasCondivisi)) {
    if (domandeKeys.includes(currentKey)) {
      risposte[profiloKey] = val;
      chiaveSalvata = true;
      break;
    }
  }

  // Se la chiave non è condivisa, salvala normalmente
  if (!chiaveSalvata) {
    risposte[currentKey] = val;
  }

  // Salvataggio condizionale se abbiamo i dati principali
  if (
    risposte.email &&
    risposte.eta &&
    risposte.sesso &&
    risposte.altezza &&
    risposte.peso
  ) {
    await salvaAnagraficaNelDatabase(risposte);
  }

  // Verifica età per over65
  if (
    modalita !== "aggiorna" &&
    currentKey === "eta" &&
    !domandeOver65Aggiunte
  ) {
    const etaNum = parseInt(val);
    if (!isNaN(etaNum) && etaNum > 65) {
      domande.splice(step + 1, 0, ...domandeOver65);
      domandeOver65Aggiunte = true;
    }
  }

  // Verifica sesso per domande femminili
  if (
    modalita !== "aggiorna" &&
    currentKey === "sesso" &&
    !domandeFemminiliAggiunte
  ) {
    const sesso = val.toLowerCase();
    if (sesso === "femmina" || sesso === "donna") {
      domande.splice(step + 1, 0, ...domandeFemminili);
      domandeFemminiliAggiunte = true;
    }
  }

  step++;
  
  } else if (step === -1) {
    step = 0; // primo avanzamento dopo scelta modalità
  }

  while (step < domande.length) {
    const domanda = domande[step];
    const rispostaPrecompilata = risposte[domanda.key];

    if (domanda.condizione) {
      const condizioneRisposta = risposte[domanda.condizione];
      if (condizioneRisposta && condizioneRisposta.toLowerCase() === "no") {
        step++;
        continue;
      }
    }

if (
  modalita !== "aggiorna" &&
  (
    (typeof rispostaPrecompilata === "string" && rispostaPrecompilata.trim() !== "") ||
    (typeof rispostaPrecompilata === "number" && !isNaN(rispostaPrecompilata)) ||
    haRispostaCondivisa(domanda.key)
  )
) {
  step++;
  continue;
}


  break;
  }

  input.value = "";


if (step < domande.length) {
  setTimeout(() => mostraMessaggio(domande[step].testo), 500);
} else {
  await salvaAnagraficaNelDatabase(risposte);

  if (modalita === "aggiorna") {
    mostraMessaggio("✅ Dati aggiornati! Scegli ora cosa vuoi fare.");
    modalita = null;
    step = -1;
    mostraScelteIniziali();
    return; // 🛑 BLOCCA la chiamata a OpenAI
  }

  if (modalita) {
    await salvaCompilazioneNelDatabase(risposte, modalita);
  } else {
    console.error("⚠️ Modalità non definita, non salvo la compilazione.");
  }

  showTypingIndicator();
  modalitaConclusa = true;
  inviaOpenAI();
  }

}

function inviaOpenAI(nuovaDomandaUtente = null) {
  showTypingIndicator();
  const loader = document.createElement("div");
  loader.className = "loader";
  document.getElementById("chat-messages").appendChild(loader);
  loader.scrollIntoView();

  const payload = {
    email: risposte.email
  };

  if (modalita === "prevenzione") payload.prevenzione = true;
  if (modalita === "dieta") payload.dieta = true;
  if (modalita === "sintomi") payload.sintomi = risposte.sintomi;
  if (modalita === "allenamento") payload.allenamento = true;

  Object.assign(payload, risposte);

  // ✅ SOLO per sintomi attiva la chat continua con contesto
  if (
    modalita === "sintomi" &&
    modalitaConclusa &&
    nuovaDomandaUtente &&
    ultimaDomandaUtente &&
    ultimaRispostaBot
  ) {
    payload.contesto_chat = {
      ultima_domanda: ultimaDomandaUtente,
      ultima_risposta: ultimaRispostaBot,
      nuova_domanda: nuovaDomandaUtente
    };
  }

  fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })
    .then(async res => {
      loader.remove();
      removeTypingIndicator();

      if (!res.ok) {
        const errorText = await res.text();
        console.error("Errore dal server:", errorText);
        mostraMessaggio("⚠️ Errore dal server: " + errorText);
        return;
      }

      const data = await res.json();
      const risposta = data.risposta || "⚠️ Nessuna risposta valida ricevuta.";
      mostraMessaggio(risposta);

      ultimaRispostaBot = risposta;

      try {
        await salvaMessaggioChat(emailUtente, "assistant", risposta);
        console.log("✅ Risposta AI salvata.");
      } catch (e) {
        console.error("❌ Errore salvataggio risposta AI:", e);
      }
    })
    .catch(err => {
      loader.remove();
      removeTypingIndicator();
      console.error("❌ Errore fetch:", err);
      if (!modalitaConclusa) {
        mostraMessaggio("⚠️ Errore nella comunicazione col server.");
      }
    });
}

  


function generaPDF(contenuto) {
  const pdfElement = document.getElementById("pdf-content");
  pdfElement.innerHTML = `
    <div style="font-family: Arial, sans-serif; padding: 30px; max-width: 800px; margin: auto; line-height: 1.6;">
      <h1 style="text-align: center; color: #2c3e50;">🧾 Piano Alimentare Personalizzato</h1>
      <div style="margin: 30px 0; font-size: 15px; color: #34495e;">
        ${contenuto
          .split("\n")
          .map(par => par.trim() !== "" ? `<p style="margin-bottom: 10px;">${par}</p>` : "<hr style='margin: 20px 0;'>")
          .join("")}
      </div>
      <footer style="margin-top: 40px; text-align: center; font-size: 12px; color: #95a5a6;">
        Generato automaticamente da ChatBot Sanitario | Non sostituisce una consulenza medica
      </footer>
    </div>
  `;
  
  html2pdf().set({
    margin: 10,
    filename: 'Piano_Alimentare_Personalizzato.pdf',
    html2canvas: { scale: 2 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  }).from(pdfElement).save();
}
  const supabaseUrl = 'https://lwuhdgrkaoyvejmzfbtx.supabase.co';  // ➔ Cambia con la tua URL
  const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3dWhkZ3JrYW95dmVqbXpmYnR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU2NzU1MDcsImV4cCI6MjA2MTI1MTUwN30.1c5iH4PYW-HeigfXkPSgnVK3t02Gv3krSeo7dDSqqsk';                  // ➔ Cambia con la tua API KEY
  
const supabase = window.supabase;  // caricato da CDN
const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);
supabaseClient.auth.getSession().then(({ data }) => {
  if (!data.session) {
    window.location.href = "login.html";
    return;
  }

  emailUtente = data.session.user.email;
  risposte.email = emailUtente;

recuperaAnagraficaDalDatabase(emailUtente).then((dati) => {
  if (dati) {
    risposte = { ...risposte, ...dati };

    // ✅ Normalizza i campi per evitare domande duplicate
    risposte.eta = String(risposte.eta || "").trim();
    risposte.sesso = String(risposte.sesso || "").trim();
    risposte.altezza = String(risposte.altezza || "").trim();
    risposte.peso = String(risposte.peso || "").trim();

    console.log("✅ Anagrafica precompilata:", risposte);
  }

 // mostraScelteIniziali(); //
});

      const profiloBtn = document.getElementById("btn-profilo");
      if (profiloBtn) {
        console.log("🎯 Bottone Profilo trovato");
        profiloBtn.addEventListener("click", () => {
          console.log("🧪 Clic su Profilo");
          mostraProfiloUtente();
        });
      }
  
  const logoutBtn = document.getElementById("btn-logout");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await supabaseClient.auth.signOut();
      window.location.href = "login.html";
    });
  }
});


  
async function salvaAnagraficaNelDatabase(dati) {
  try {
    if (!dati.email) {
      console.warn("⚠️ Email non presente, salto il salvataggio anagrafica.");
      return;
    }

    // ✅ Elenco dei soli campi presenti nella tabella reale
    const campiValidi = [
      "email", "eta", "sesso", "altezza", "peso",
      "origine_etnica", "vita", "glicemia", "glicemia_valore",
      "colesterolo_totale", "colesterolo_hdl_valore", "colesterolo_ldl_valore",
      "colesterolo_ldl", "pressione_sistolica", "pressione_diastolica",
      "pressione", "pressione_valore", "pressione_alta",
      "attivita_fisica", "attivo30", "tipo_lavoro", "patologie",
      "farmaci", "farmaci_dettaglio", "interventi", "interventi_dettaglio",
      "fumatore", "diabete", "unita_alcoliche", "alcol_eccessivo",
      "familiari_diabete", "frattura", "famiglia_frattura_anca",
      "corticosteroidi", "artrite", "stanchezza", "over_stanchezza",
      "camminata", "over_camminata", "sollevamento", "over_sollevamento",
      "sedia", "over_sedia", "cadute", "over_cadute",
      "intolleranze", "alimenti_esclusi", "preferenze",
      "malattie_croniche", "familiarita_tumori", "sede_tumore",
      "predimed_1", "predimed_2", "predimed_3", "predimed_4",
      "predimed_5", "predimed_6", "predimed_7", "predimed_8",
      "predimed_9", "predimed_10", "predimed_11", "predimed_12",
      "predimed_13", "predimed_14", "depressione", "insonnia",
      "tipo_insonnia", "stress"
    ];

    // ✅ Filtra i soli campi validi prima di salvarli
    const payload = {};
    for (const chiave of campiValidi) {
      if (chiave in dati) {
        payload[chiave] = dati[chiave];
      }
    }

    // 🔄 Salva nel DB
    const { data, error } = await supabaseClient
      .from("anagrafica_utenti")
      .upsert([payload], { onConflict: "email" });

    if (error) {
      console.error("Errore API salvataggio:", error);
    } else {
      console.log("✅ Dati anagrafici completi salvati:", data);
    }
  } catch (error) {
    console.error("❌ Errore di rete salvataggio:", error);
  }
}



async function salvaCompilazioneNelDatabase(risposte, modalita) {
  try {
    if (!modalita) {
      console.warn("⚠️ Modalità non definita, non salvo la compilazione.");
      return;
    }
    if (!risposte.email) {
      console.warn("⚠️ Email non presente, non salvo la compilazione.");
      return;
    }

    const { data, error } = await supabaseClient
      .from('compilazioni')
      .insert([{
        email: risposte.email,
        modalita: modalita,
        risposte: risposte
      }]);

    if (error) {
      console.error("Errore salvataggio compilazione:", error);
    } else {
      console.log("✅ Compilazione salvata:", data);
    }
  } catch (error) {
    console.error("❌ Errore di rete salvataggio compilazione:", error);
  }
}

async function salvaMessaggioChat(email, ruolo, messaggio) {
  try {
    const { data, error } = await supabaseClient
      .from('chat_storico')
      .insert([{ email, ruolo, messaggio }]);

    if (error) {
      console.error("❌ Errore salvataggio messaggio chat:", error);
    } else {
      console.log("💾 Messaggio salvato correttamente.");
    }
  } catch (err) {
    console.error("❌ Errore di rete salvataggio messaggio:", err);
  }
}


function showTypingIndicator() {
  const container = document.getElementById("chat-messages");
  if (!container) return;

  const typingElement = document.createElement("div");
  typingElement.className = "typing-indicator";
  typingElement.id = "typing-indicator";

  for (let i = 0; i < 3; i++) {
    const dot = document.createElement("div");
    dot.className = "typing-dot";
    typingElement.appendChild(dot);
  }

  container.appendChild(typingElement);
  typingElement.scrollIntoView({ behavior: "smooth" });
}

function removeTypingIndicator() {
  const typingElement = document.getElementById("typing-indicator");
  if (typingElement) typingElement.remove();
}





async function recuperaAnagraficaDalDatabase(email) {
  try {
    const { data, error } = await supabaseClient
      .from('anagrafica_utenti')
      .select('*')
      .eq('email', email.trim().toLowerCase())
      .single();
    if (error && error.code !== 'PGRST116') {
      console.error("Errore API recupero:", error);
      return null;
    }
    if (!data) {
      console.log("ℹ️ Nessun dato trovato per questa email.");
      return null;
    }
    console.log("✅ Dati recuperati:", data);
    return data;
  } catch (error) {
    console.error("❌ Errore di rete recupero:", error);
    return null;
  }
}

let emailUtente = "";
let emailInserita = false;
let attesaConfermaAggiornamento = false;

const toggleBtn = document.getElementById("theme-toggle");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      document.body.classList.toggle("light-theme");
      const isLight = document.body.classList.contains("light-theme");
      localStorage.setItem("theme", isLight ? "light" : "dark");
    });
    if (localStorage.getItem("theme") === "light") {
  document.body.classList.add("light-theme");
    }

}

async function mostraProfiloUtente() {
  const container = document.getElementById("chat-messages");
  container.innerHTML = "🔄 Caricamento profilo...";

  try {
    const res = await fetch("profilo.html");
    const htmlText = await res.text();

    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = htmlText;

    const nuovoContenuto = tempDiv.querySelector("main");
    if (!nuovoContenuto) {
      container.innerHTML = "⚠️ Errore: struttura HTML non valida.";
      return;
    }

    container.innerHTML = "";
    container.appendChild(nuovoContenuto);

    // Attiva accordion
    document.querySelectorAll(".accordion-header").forEach(header => {
      header.addEventListener("click", () => {
        header.parentElement.classList.toggle("active");
      });
    });

    // Riempie i campi se presenti
    const campiBase = ["email", "eta", "sesso", "altezza", "peso"];
    campiBase.forEach(k => {
      const el = document.getElementById(`profilo-${k}`);
      if (el && risposte[k]) el.value = risposte[k];
    });

    const extra = [
      "attivita_fisica", "tipo_lavoro", "patologie", "farmaci_dettaglio",
      "intolleranze", "alimenti_esclusi", "preferenze",
      "pressione_sistolica", "pressione_diastolica",
      "colesterolo_totale", "colesterolo_hdl_valore", "colesterolo_ldl_valore",
      "fumatore", "diabete",
      "glicemia_valore", "attivo30", "pressione_alta", "familiari_diabete",
      "frattura", "famiglia_frattura_anca", "corticosteroidi",
      "alcol_eccessivo", "artrite",
      "stanchezza", "camminata", "sollevamento", "sedia", "cadute"
    ];

    extra.forEach(key => {
      const el = document.getElementById(`profilo-${key}`);
      if (el && risposte[key] != null) {
        el.value = risposte[key];
      }
    });

    // Salva
    const salvaBtn = document.getElementById("salva-profilo-btn");
    if (salvaBtn) {
      salvaBtn.addEventListener("click", async () => {
        const nuoviDati = {
          email: risposte.email,
          eta: document.getElementById("profilo-eta")?.value.trim(),
          sesso: document.getElementById("profilo-sesso")?.value.trim(),
          altezza: document.getElementById("profilo-altezza")?.value.trim(),
          peso: document.getElementById("profilo-peso")?.value.trim()
        };

        const integerFields = ["eta", "altezza", "peso", "pressione_sistolica", "pressione_diastolica", "colesterolo_totale", "colesterolo_hdl_valore", "colesterolo_ldl_valore", "glicemia_valore"];

        extra.forEach(key => {
          const el = document.getElementById(`profilo-${key}`);
          if (!el) return;
          const val = el.value.trim();
          if (val === "") {
            nuoviDati[key] = null;
          } else if (integerFields.includes(key)) {
            const parsed = parseInt(val);
            nuoviDati[key] = isNaN(parsed) ? null : parsed;
          } else {
            nuoviDati[key] = val;
          }
        });

        await salvaAnagraficaNelDatabase(nuoviDati);
        Object.assign(risposte, nuoviDati);

        alert("✅ Profilo aggiornato!");
      });
    }

  } catch (error) {
    console.error("❌ Errore caricamento profilo:", error);
    container.innerHTML = "⚠️ Impossibile caricare il profilo.";
  }
}


const form = document.getElementById("input-form");
if (form) {
  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    
    const val = input.value.trim();
    if (!val) return;

    /*if (!emailInserita) {
      const emailRegex = /^[^\s@]+@[^\s@]+$/;
      if (!emailRegex.test(val)) {
        mostraMessaggio("⚠️ Inserisci un indirizzo email valido (esempio@email.com).");
        input.value = "";
        return;
      }

      emailUtente = val;
      risposte.email = emailUtente;
      risposte.email = emailUtente;
      mostraMessaggio(emailUtente, "user");
      input.value = "";

      const datiRecuperati = await recuperaAnagraficaDalDatabase(emailUtente);

      if (datiRecuperati) {
        risposte = datiRecuperati;
        mostraMessaggio(`✅ Bentornato! Abbiamo trovato questi dati:\n
- Età: ${risposte.eta}
- Sesso: ${risposte.sesso}
- Altezza: ${risposte.altezza} cm
- Peso: ${risposte.peso} kg\n
Vuoi aggiornarli? (sì / no)`);
        attesaConfermaAggiornamento = true;
      } else {
        mostraMessaggio("👋 Non abbiamo trovato dati salvati. Procediamo con un nuovo profilo.");
        risposte = { email: emailUtente };
        mostraScelteIniziali();
      }

      emailInserita = true;
      return;
    }
    */

    if (attesaConfermaAggiornamento) {
      const risposta = val.toLowerCase();
      if (risposta === "no") {
        mostraMessaggio("👌 Perfetto, manteniamo i dati esistenti.");
        mostraScelteIniziali();
        attesaConfermaAggiornamento = false;
      } else if (risposta === "sì" || risposta === "si") {
  mostraMessaggio("✏️ Procediamo ad aggiornare i tuoi dati.");
  domande = [
    { key: "eta", testo: "Aggiorna la tua età:" },
    { key: "sesso", testo: "Aggiorna il tuo sesso biologico:" },
    { key: "altezza", testo: "Aggiorna la tua altezza in cm:" },
    { key: "peso", testo: "Aggiorna il tuo peso in kg:" }
  ];
  modalita = "aggiorna";
  step = -1; // ✅ questo è fondamentale per attivare la prima domanda
  attesaConfermaAggiornamento = false;
  input.value = "";
  next();
  return;
} else {
        mostraMessaggio("❗ Per favore rispondi 'sì' o 'no'.");
      }
      input.value = "";
      return;
    }
    

    if (modalitaConclusa) {
  mostraMessaggio(val, "user");
  await salvaMessaggioChat(emailUtente, "user", val);
  inviaOpenAI(val); // passa la nuova domanda
  modalitaConclusa = false;
  input.value = "";
  return;
}

    if (!modalita) {
      mostraMessaggio("❗ Seleziona prima una modalità cliccando uno dei bottoni.");
      input.value = "";
      return;
    }
   
    next();
  });
}

});

