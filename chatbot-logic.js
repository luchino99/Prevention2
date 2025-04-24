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
  { key: "pressione_valore", testo: "In media quanto misura la tua pressione arteriosa? (max/min)" },
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
  { key: "tipo_lavoro", testo: "Che tipo di lavoro svolgi? (sedentario, attivo, fisico)" },
  { key: "preferenze", testo: "Hai uno stile alimentare preferito? (es: mediterranea, vegetariana, vegana, keto, nessuna)" },
  { key: "intolleranze", testo: "Hai intolleranze o allergie alimentari? (es: glutine, lattosio, ecc.)" },
  { key: "alimenti_esclusi", testo: "Ci sono alimenti che non vuoi includere nella dieta?" },
  { key: "pasti", testo: "Quanti pasti al giorno preferisci fare? (includi colazione e spuntini)" },
  { key: "orari_pasti", testo: "Hai orari fissi per i pasti principali? (opzionale)" },
  { key: "patologie", testo: "Hai patologie diagnosticate? (es: diabete, ipertensione, gastrite, ecc.)" },
  { key: "farmaci", testo: "Stai assumendo farmaci al momento? Se si, elencali (opzionale)" },
  
];


let domande = [];
let risposte = {};
let step = -1;
let modalita = null;

function mostraMessaggio(testo, classe = "bot") {
  const div = document.createElement("div");
  div.className = `bubble ${classe}`;
  const avatar = document.createElement("div");
  avatar.className = `avatar`;
  const span = document.createElement("span");
  span.innerText = testo;
  div.appendChild(avatar);
  div.appendChild(span);
  document.getElementById("messages").appendChild(div);
  div.scrollIntoView();
}

function mostraScelteIniziali() {
  mostraMessaggio("👋 Ciao! Come posso aiutarti oggi?\n\n🔹 Hai bisogno di aiuto per ricevere consigli su una *situazione medica attuale* o sintomi?\n\n🔹 Oppure vuoi ricevere consigli per la *prevenzione della salute*?\n\n🔹 O desideri un *piano alimentare personalizzato*?");

  const btnContainer = document.createElement("div");
  btnContainer.className = "button-container";

  const sintomiBtn = document.createElement("button");
  sintomiBtn.className = "scelta-btn";
  sintomiBtn.innerText = "🩺 Ti voglio descrivere i miei sintomi";
  sintomiBtn.onclick = () => selezionaModalita("sintomi");

  const prevenzioneBtn = document.createElement("button");
  prevenzioneBtn.className = "scelta-btn";
  prevenzioneBtn.innerText = "🛡️ Voglio fare prevenzione";
  prevenzioneBtn.onclick = () => selezionaModalita("prevenzione");

  const dietaBtn = document.createElement("button"); 
  dietaBtn.className = "scelta-btn";
  dietaBtn.innerText = "🍽️ Voglio un piano alimentare su misura";
  dietaBtn.onclick = () => selezionaModalita("dieta");

  btnContainer.appendChild(sintomiBtn);
  btnContainer.appendChild(prevenzioneBtn);
  btnContainer.appendChild(dietaBtn); 

  document.getElementById("messages").appendChild(btnContainer);
}

function selezionaModalita(tipo) {
  modalita = tipo;
  document.querySelectorAll(".button-container").forEach(el => el.remove());

  if (tipo === "sintomi") {
    mostraMessaggio("🩺 Perfetto! Per aiutarti al meglio, descrivimi i tuoi sintomi o i sintomi della persona che vuoi aiutare.");
  } else if (tipo === "prevenzione") {
    domande = [...domandeBase];
    mostraMessaggio(introduzione);
  } else if (tipo === "dieta") {
    domande = [...domandePianoAlimentare];
    mostraMessaggio("🍽️ Ottimo! Per creare un piano alimentare personalizzato, rispondi alle seguenti domande:");
  }
}


function next() {
  const input = document.getElementById("input");
  const val = input.value.trim();

  if (modalita === "sintomi") {
    if (val) {
      mostraMessaggio(val, "user");
      input.value = "";
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sintomi: val })
      })
        .then(res => res.json())
        .then(data => mostraMessaggio(data.risposta || "⚠️ Nessuna risposta ricevuta."))
        .catch(err => mostraMessaggio("⚠️ Errore nella risposta."));
    }
    return;
  }

  if (step === -1 || val) {
    if (step >= 0) {
      mostraMessaggio(val, "user");
      risposte[domande[step].key] = val;
    }
    input.value = "";

    if (step >= 0 && domande[step].key === "eta") {
      const etaNum = parseInt(val);
      if (!isNaN(etaNum) && etaNum > 65) {
        domande = [...domande.slice(0, step + 1), ...domandeOver65, ...domande.slice(step + 1)];
      }
    }
    if (step >= 0 && domande[step].key === "sesso") {
      const sesso = val.toLowerCase();
      if (sesso === "femmina" || sesso === "donna") {
        domande = [...domande.slice(0, step + 1), ...domandeFemminili, ...domande.slice(step + 1)];
      }
    }
  }

  step++;
  
  while (step < domande.length && domande[step].condizione) {
    const cond = domande[step].condizione;
    const risposta = risposte[cond];
    if (risposta && risposta.toLowerCase() === "no") {
      step++;
    } else {
      break;
    }
  }

  if (step < domande.length) {
    setTimeout(() => mostraMessaggio(domande[step].testo), 500);
  } else {
    mostraMessaggio("🧐 Grazie! Sto analizzando i tuoi dati...");
    inviaOpenAI();
  }
}

function inviaOpenAI() {
  const loader = document.createElement("div");
  loader.className = "loader";
  document.getElementById("messages").appendChild(loader);
  loader.scrollIntoView();

  const payload = { ...risposte };
  if (modalita === "dieta") payload.dieta = true;
  if (modalita === "sintomi") payload.sintomi = risposte.sintomi;

  fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })
    .then(async res => {
      loader.remove();

      if (!res.ok) {
        const errorText = await res.text();
        console.error("Errore dal server:", errorText);
        mostraMessaggio("⚠️ Errore dal server: " + errorText);
        return;
      }

      const data = await res.json();
      console.log("📦 Risposta ricevuta dall'AI:", data);
      mostraMessaggio("🧐 Risposta dell'AI:");
      mostraMessaggio(data.risposta || "⚠️ Nessuna risposta valida ricevuta.");
      if (modalita === "dieta") {
      const downloadBtn = document.createElement("button");
      downloadBtn.innerText = "📄 Scarica piano alimentare in PDF";
      downloadBtn.style.marginTop = "15px";
      downloadBtn.onclick = () => generaPDF(data.risposta);
      document.getElementById("messages").appendChild(downloadBtn);
}
    })
    .catch(err => {
      loader.remove();
      mostraMessaggio("⚠️ Errore durante la comunicazione con l'AI. Riprova più tardi.");
      console.error("❌ Errore durante la fetch:", err);
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

  document.addEventListener("DOMContentLoaded", () => {
  console.log("JS caricato");
  mostraScelteIniziali();

  document.getElementById("input").addEventListener("keypress", function (e) {
  if (e.key === "Enter") {
      next();
    }
  });
  const toggleBtn = document.getElementById("theme-toggle");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      document.documentElement.classList.toggle("light-theme");
      const isLight = document.documentElement.classList.contains("light-theme");
      localStorage.setItem("theme", isLight ? "light" : "dark");
    });
  if (localStorage.getItem("theme") === "light") {
      document.documentElement.classList.add("light-theme");
    }
  }
});
