import { OpenAI } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  const allowedOrigins = [
    "https://luchino99.github.io",
    "https://prevention2.vercel.app"
  ];

  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigins[1]); // fallback
    console.warn("⚠️ Origin non autorizzato:", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Solo richieste POST sono accettate" });

  const data = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const safe = (val) => val ?? "non disponibile";
  const escape = (str) => (str || "").toString().replace(/[`$]/g, "");
  console.log("📥 Body ricevuto:", req.body);
console.log("📥 Data parse:", data);

  try {
    let prompt = "";

    // 1. SUGGERIMENTI PRIORITARI
    if (data.suggerimenti_prioritari) {
      prompt = `
Hai accesso ai dati clinici e anagrafici di un paziente.
Età: ${data.eta}
Sesso: ${data.sesso}
Peso: ${data.peso} kg
Altezza: ${data.altezza} cm
Pressione: ${data.pressione_sistolica}/${data.pressione_diastolica}
Glicemia: ${data.glicemia_valore} mg/dL
HbA1c: ${data.hba1c} %
Colesterolo Totale: ${data.colesterolo_totale}
HDL: ${data.colesterolo_hdl_valore}
Trigliceridi: ${data.trigliceridi}
BMI: ${data.bmi}
Attività fisica: ${data.attivita_fisica}
Insonnia: ${data.insonnia}
Stress: ${data.stress}

Genera **3 consigli prioritari** personalizzati per migliorare la salute generale.
Devono essere pratici, comprensibili, e basati su linee guida cliniche.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4-turbo",
        messages: [
          { role: "system", content: "Sei un assistente sanitario esperto in prevenzione, alimentazione e stile di vita." },
          { role: "user", content: prompt }
        ],
        temperature: 0.7
      });

      const result = response?.choices?.[0]?.message?.content;
      return res.status(200).json({
        suggerimenti: result || "⚠️ Nessuna risposta valida."
      });
    }

if (data.screening_ai) {
  const prompt = `
Hai accesso ai dati clinici di un paziente. In base ai seguenti dati:
- Età: ${data.eta}
- Sesso: ${data.sesso}
- Patologie: ${data.patologie}
- Farmaci: ${data.farmaci}
- Colesterolo Totale: ${data.colesterolo_totale}
- HDL: ${data.colesterolo_hdl_valore}
- Pressione arteriosa: ${data.pressione_sistolica}/${data.pressione_diastolica}
- BMI: ${data.bmi}
- Fumatore: ${data.fumatore}
- Score cardiovascolare: ${data.score2_risk} (${data.score2_category})
- Score diabete: ${data.ada_score} (${data.ada_category})
- FIB4: ${data.fib4}
- Sindrome metabolica presente: ${data.metabolicSyndrome ? 'Sì' : 'No'}

Genera una lista di **screening preventivi consigliati** per questo paziente, secondo le linee guida italiane (Ministero della Salute, OMS, ecc.).

Per ogni screening includi:
- **Nome dello screening**
- **Motivazione**
- **Frequenza consigliata**
- **Grado di priorità** (es. alta, media, bassa)
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4-turbo",
    messages: [
      { role: "system", content: "Sei un medico esperto in medicina preventiva, screening oncologici e cardiovascolari." },
      { role: "user", content: prompt }
    ],
    temperature: 0.7
  });

  const result = response?.choices?.[0]?.message?.content;
  return res.status(200).json({
    screening: result || "⚠️ Nessuna risposta generata."
  });
}

if (data.consigli_benessere) {
  if (!data.stress || !data.umore || !data.sonno_qualita) {
    return res.status(400).json({ errore: "Dati mancanti per generare i consigli." });
  }

  const prompt = data.prompt || `
Fornisci tre consigli pratici per migliorare il benessere psicologico dell'utente.
- Uno per ridurre lo stress (livello: ${data.stress}/10)
- Uno per migliorare l'umore (livello: ${data.umore}/10)
- Uno per la qualità del sonno (livello: ${data.sonno_qualita}/10)
I consigli devono essere chiari, applicabili nella vita quotidiana e basati su evidenze scientifiche.
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4-turbo",
    messages: [
      { role: "system", content: "Sei un esperto in benessere psicologico." },
      { role: "user", content: prompt }
    ],
    temperature: 0.7
  });

  const suggerimenti = response?.choices?.[0]?.message?.content;

  return res.status(200).json({ suggerimenti: suggerimenti || "⚠️ Nessun suggerimento generato." });
}



// 3. PIANO ALIMENTARE PERSONALIZZATO
if (data.piano_alimentare) {
  const safe = (v) => v || "Non specificato";
  console.log("📥 Richiesta ricevuta per piano alimentare:", data);

  const prompt = `
Crea un piano alimentare settimanale personalizzato e sicuro in base ai seguenti dati dell'utente:

📋 **DATI ANAGRAFICI E FISICI**
- Età: ${safe(data.eta)}
- Sesso: ${safe(data.sesso)}
- Altezza: ${safe(data.altezza)} cm
- Peso: ${safe(data.peso)} kg

🎯 **OBIETTIVO NUTRIZIONALE**
- Obiettivo: ${safe(data.obiettivo)}
- Livello di attività fisica: ${safe(data.attivita_fisica)}

🍽 **PREFERENZE E RESTRIZIONI**
- Preferenze alimentari: ${safe(data.preferenze_alimentari)}
- Intolleranze o allergie: ${safe(data.intolleranze)}
- Alimenti da escludere: ${safe(data.alimenti_esclusi)}

🕒 **ORGANIZZAZIONE PASTI**
- Numero pasti giornalieri: ${safe(data.numero_pasti)}
- Orari abituali dei pasti: ${safe(data.orari_pasti)}

🏥 **SALUTE**
- Patologie diagnosticate: ${safe(data.patologie)}
- Farmaci assunti: ${safe(data.farmaci)}

---

📌 **REQUISITI DEL PIANO**
1. Il piano deve coprire **7 giorni** (lunedì-domenica).
2. Ogni giorno deve includere i pasti previsti (colazione, spuntini, pranzo, cena, ecc. in base a ${safe(data.numero_pasti)} pasti).
3. Includere alimenti variati, equilibrati e facilmente reperibili.
4. Specificare quantità indicative (in grammi o porzioni) per ogni alimento.
5. Adattare calorie e macronutrienti all'obiettivo e al livello di attività fisica.
6. Evitare cibi nelle liste di intolleranze o alimenti esclusi.
7. Tenere conto di eventuali patologie e farmaci, evitando interazioni alimentari potenzialmente rischiose.
8. Presentare il piano in **formato tabellare** ordinato, con colonne:
   - Giorno
   - Pasto
   - Alimenti e quantità
   - Note nutrizionali

💡 **Esempio di formato atteso**
Giorno | Pasto | Alimenti e Quantità | Note
Lunedì | Colazione | Yogurt greco 150g + Mirtilli 50g + Avena 40g | Ricco di proteine e fibre
...
  `;

  const response = await openai.chat.completions.create({
    model: "gpt-4-turbo",
    messages: [
      { role: "system", content: "Sei un nutrizionista certificato. Genera solo piani alimentari sicuri e bilanciati secondo linee guida internazionali." },
      { role: "user", content: prompt }
    ],
    temperature: 0.7
  });
  console.log("📤 Risposta grezza GPT:", JSON.stringify(response, null, 2));

  const result = response?.choices?.[0]?.message?.content || null;
  

  return res.status(200).json({
    piano: result || "⚠️ Nessuna risposta valida dal modello."
  });
}



    // 2. FOLLOW-UP CONTESTUALE
    if (data.contesto_chat) {
      const { ultima_domanda, ultima_risposta, nuova_domanda } = data.contesto_chat;

      prompt = `
Sei un assistente sanitario digitale. Un utente ha già posto una domanda, a cui hai risposto. Ora ha inviato una nuova domanda di approfondimento.

🧠 Domanda precedente: ${ultima_domanda}
🤖 Tua risposta: ${ultima_risposta}
❓ Nuova domanda: ${nuova_domanda}

Fornisci una risposta coerente e utile, empatica e professionale.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4-turbo",
        messages: [
          { role: "system", content: "Sei un assistente esperto in prevenzione e medicina dello stile di vita." },
          { role: "user", content: prompt }
        ],
        temperature: 0.7
      });

      const result = response?.choices?.[0]?.message?.content;
      return res.status(200).json({
        risposta: result || "⚠️ Nessuna risposta valida."
      });
    }

    // 3. PROMPT PER DIETA, ALLENAMENTO, SINTOMI, ANALISI GENERALE
    const fattoriLavoro = {
      "sedentario": 1.2,
      "leggermente attivo": 1.375,
      "moderatamente attivo": 1.55,
      "molto attivo": 1.725,
      "estremamente attivo": 1.9
    };

    const tipo = data.tipo_lavoro?.trim();
    const tdeeFactor = fattoriLavoro[tipo];

    if (data.dieta && !tdeeFactor) {
      return res.status(400).json({
        errore: `Tipo di lavoro non valido o mancante: "${tipo}". Valori accettati: ${Object.keys(fattoriLavoro).join(", ")}.`
      });
    }

    if (data.sintomi && data.sintomi.trim() !== "") {
      prompt = `
Una persona ha descritto i seguenti sintomi:
${escape(data.sintomi)}
Sulla base di questi sintomi, offri un'analisi iniziale, suggerisci possibili cause. Specifica quando è opportuno rivolgersi a un medico o andare al pronto soccorso. 
Ricorda che la tua risposta **non sostituisce una valutazione medica professionale**.
`;
    } else if (data.dieta) {
      prompt = `Sei un nutrizionista clinico esperto in nutrizione personalizzata. In base ai dati forniti di seguito, calcola il fabbisogno calorico giornaliero (BMR e TDEE) del paziente secondo le formule Mifflin-St Jeor e le linee guida LARN/SINU, non scrivere i vari calcoli nella risposta, ma mostra soltando il risultato. Successivamente, crea un piano alimentare settimanale variabile per ogni giorno della settimana dal lunedi fino alla domenica compresa.
Che sia completo, bilanciato basandoti sul risulatato di questi score e sugli obbiettivi del paziente (dimagrimento, mantenimento, massa), eventuali patologie, preferenze, allergie. 
Ogni giorno deve contenere:
- Colazione, spuntino mattina, pranzo, spuntino pomeriggio, cena
- Grammature indicative degli alimenti
Per il TDEE, calcola il TDEE moltiplicando il BMR per il coefficiente ${tdeeFactor} in base all'obiettivo: ${safe(data.obiettivo)}.
In fondo, includi: 
- Suggerimenti per l’idratazione, attività fisica e stile di vita
Dati da utilizzare per programmare la dieta in base ai vari dati forniti dall'utente e  anche in base al risultato del TDEE:
- Età: ${data.eta}
- Sesso: ${data.sesso}
- Altezza: ${data.altezza} cm
- Peso: ${data.peso} kg
- Obiettivo: ${data.obiettivo}
- Attività fisica: ${data.attivita_fisica}
- Tipo di lavoro: ${data.tipo_lavoro}
- Intolleranze/allergie: ${data.intolleranze}
- Alimenti esclusi: ${data.alimenti_esclusi}
- Patologie: ${data.patologie}

inoltre devi creare il programma alimentare consigliando piatti non troppo complessi, e che permettano di evitare sprechi, quindi anche alimenti che si possono combinare fra loro se mai in giorni diversi, per creare piatti diversi ma che evitano sprechi.
Il piano sarà usato per essere trasformato in PDF.`;
    } else if (data.allenamento) {
      prompt = `Sei un personal trainer certificato NSCA, ACSM e NASM. In base ai dati raccolti crea un programma di allenamento settimanale altamente personalizzato.

Dati utente:
- Età: ${safe(data.eta)}
- Sesso: ${safe(data.sesso)}
- Altezza: ${safe(data.altezza)} cm
- Peso: ${safe(data.peso)} kg
- Obiettivo: ${safe(data.obiettivo)}
- Livello di esperienza: ${safe(data.esperienza)}
- Frequenza allenamenti/settimana: ${safe(data.frequenza)}
- Durata sessioni: ${safe(data.durata)}
- Luogo allenamento: ${safe(data.luogo)}
- Attrezzatura disponibile: ${safe(data.attrezzatura)}
- Vuole cardio: ${safe(data.cardio)}
- Focus principale: ${safe(data.focus)}
- Infortuni o limitazioni: ${safe(data.infortuni)}
- Patologie croniche: ${safe(data.patologie)}
- Test funzionali:
  - Pushups: ${safe(data.pushups)}
  - Squats: ${safe(data.squats)}
  - Plank: ${safe(data.plank)}
  - Step Test (frequenza cardiaca): ${safe(data.step_test)}

Crea:
- Allenamenti divisi per giorno
- Esercizi specifici, serie, ripetizioni
- Consigli di progressione
- Modifiche per eventuali infortuni
- Programmazione cardio se richiesto

Tono: motivante, preciso, chiaro per utenti non esperti.`;
    } else {
      prompt =    `
Sei un assistente sanitario digitale. Analizza i dati forniti per calcolare score clinici ufficiali e fornire consigli personalizzati secondo linee guida OMS, ESC, AIFA, ADA e Ministero della Salute.

 **DATI RACCOLTI:**
- Età: ${safe(data.eta)}
- Sesso biologico: ${safe(data.sesso)}
- Origine etnica: ${safe(data.origine_etnica)}
- Altezza: ${safe(data.altezza)} cm
- Peso: ${safe(data.peso)} kg
- Vita > soglia: ${safe(data.vita)}
- Glicemia < 100: ${safe(data.glicemia)}
- Glicemia valore per ADA Diabetes Risk Score: ${safe(data.glicemia_valore)}
- Colesterolo totale: ${safe(data.colesterolo_totale)}
- LDL >70: ${safe(data.colesterolo_ldl)}
- HDL basso: ${safe(data.colesterolo_hdl)}
- HDL colesterolo per SCORE2 (mg/dL): ${safe(data.colesterolo_hdl_valore)}
- Pressione arteriosa (sistolica/diastolica): ${safe(data.pressione_sistolica)}/${safe(data.pressione_diastolica)} mmHg
- Malattie croniche: ${safe(data.malattie_croniche)}
- Farmaci: ${safe(data.farmaci)}
- Dettaglio farmaci: ${safe(data.farmaci_dettaglio)}
- Interventi: ${safe(data.interventi)}
- Dettaglio interventi: ${safe(data.interventi_dettaglio)}
- Familiarità tumori: ${safe(data.familiarita_tumori)}
- Sede tumore: ${safe(data.sede_tumore)}
- Fumatore: ${safe(data.fumatore)}
- Sigarette/die: ${safe(data.n_sigarette)}
- Alcol: ${safe(data.alcol)}
- Unità alcoliche/die: ${safe(data.unita_alcoliche)}
- Attività fisica: ${safe(data.attivita_fisica)}
- Frequenza attività: ${safe(data.frequenza_attivita_fisica)}
- Tipo attività: ${safe(data.tipo_attivita)}
- Durata attività: ${safe(data.durata_attivita)}
- Alimentazione (Predimed): ${[...Array(14)].map((_, i) => `predimed_${i + 1}: ${safe(data[`predimed_${i + 1}`])}`).join(" | ")}
- Stanchezza: ${safe(data.stanchezza)}
- Depressione: ${safe(data.depressione)}
- Insonnia: ${safe(data.insonnia)}
- Tipo insonnia: ${safe(data.tipo_insonnia)}
- Stress: ${safe(data.stress)}
- Preferenze: ${safe(escape(data.preferenze))}

${data.eta > 65 ? `
🔹 **VALUTAZIONE OVER 65:**
- over_stanchezza: ${safe(data.over_stanchezza)}
- over_scale: ${safe(data.over_scale)}
- over_camminata: ${safe(data.over_camminata)}
- over_malattie: ${safe(data.over_malattie)}
- over_peso: ${safe(data.over_peso)}
- over_sollevamento: ${safe(data.over_sollevamento)}
- over_sedia: ${safe(data.over_sedia)}
- over_cadute: ${safe(data.over_cadute)}
- over_debolezza: ${safe(data.over_debolezza)}` : ""}

${data.sesso && (data.sesso.toLowerCase() === 'femmina' || data.sesso.toLowerCase() === 'donna') ? `
🔹 **SALUTE FEMMINILE:**
- Età menarca: ${safe(data.eta_menarca)}
- Età menopausa: ${safe(data.eta_menopausa)}
- Contraccettivi: ${safe(data.contraccettivi)}
- Gravidanze: ${safe(data.gravidezza)}
- Familiarità seno: ${safe(data.familiarita_seno)}
- Screening seno: ${safe(data.screening_seno)}
- Pap test: ${safe(data.papsmear)}` : ""}

📊 **CALCOLA I SEGUENTI SCORE CLINICI (se disponibili):**
- BMI
- PREDIMED
- SCORE2 – Calcolo del rischio cardiovascolare a 10 anni**
Usa i seguenti dati per calcolare o stimare il punteggio SCORE2 secondo le linee guida ESC 2021:
- Età: ${safe(data.eta)}
- Sesso: ${safe(data.sesso)}
- Pressione arteriosa sistolica: ${safe(data.pressione_sistolica)} mmHg
- Colesterolo totale: ${safe(data.colesterolo_totale)} mg/dL
- Colesterolo HDL: ${safe(data.colesterolo_hdl_valore)} mg/dL
- Fumatore: ${safe(data.fumatore)}
- Diabete diagnosticato: ${safe(data.diabete)}
Stima: 
- Il rischio cardiovascolare a 10 anni in **percentuale approssimativa** (es. "2.3%")
- La **fascia di rischio** corrispondente secondo SCORE2 (basso, moderato, alto, molto alto)
- I **fattori principali che contribuiscono** al rischio
- Come **migliorare o abbassare** il rischio con interventi su stile di vita o terapia
- FRAIL (se >65 anni)
- SARC-F (se >65 anni)
- FRAX (se >50 anni)
- **FIB4 (Fibrosis-4 Index)**: Se disponibili AST, ALT e piastrine
  Formula: (età × AST) / (piastrine × √ALT)
  - AST: ${safe(data.ast)} U/L
  - ALT: ${safe(data.alt)} U/L
  - Piastrine: ${safe(data.piastrine)} x10^9/L
  Interpretazione: <1.45 basso rischio, 1.45-3.25 intermedio, >3.25 alto rischio
- **FNI (Functional Nutritional Index)**: Se disponibili albumina e linfociti
  Formula: (10 × albumina g/dL) + (0.005 × linfociti/mm³)
  - Albumina: ${safe(data.albumina)} g/dL
  - Linfociti: ${safe(data.linfociti)} /mm³
  Interpretazione: ≥45 normale, 35-45 malnutrizione lieve, <35 severa
- **SCORE2-Diabete**: Per pazienti diabetici, calcola il rischio CV specifico
  - HbA1c: ${safe(data.hba1c)} %
  - Usa gli stessi parametri di SCORE2 ma con algoritmo specifico per diabetici
**Istruzioni importanti per il calcolo degli score:**
Se l’età è **≥ 65 anni**, calcola sempre **FRAIL** e **SARC-F** se sono presenti i dati richiesti.
Se l’età è **≥ 50 anni**, calcola sempre **FRAX** se i dati sono disponibili.
Se uno score non è calcolabile, spiega **quale dato manca**.
Specifica in modo dettagliato il significato di ogni risultato per ogni risultato dei vari score, e cosa potrebbe fare il paziente per migliorare la propria condizione di salute. 
Inoltre prendi in considerazione la presenza di sindrome metabolica nel caso in cui tre di questi cinque criteri sono soddisfatti dai dati inseriti: Circonferenza vita aumentata Uomini: > 102 cm, Donne: > 88 cm; Trigliceridi elevati ≥ 150 mg/dL; Colesterolo HDL basso Uomini: < 40 mg/dL, Donne: < 50 mg/dL; Pressione arteriosa elevata ≥ 130/85 mmHg; Glicemia a digiuno elevata ≥ 100 mg/dL.
Se è presente chiarisci il significato di sindrome metabolica e indica al paziente tutte le problematiche correlate ad essa come : aumentata probabilità di sviluppare diabete di tipo 2, malattie cardiovascolari e ictus.
E dai dei suggerimenti specifici e consigli su iniziative da intraprendere per far si di risolvere questa consizione.

 **GENERA CONSIGLI PERSONALIZZATI:**
- Screening oncologici raccomandati prendendo in considerazione l'età del paziente, andando ad elencare gli screening che dovrebbe svolgere o dovrebbe aver svolto il paziente specifici per l'età di questo.
- Visite specialistiche necessarie in base ai risultati ottenuti dalla comilazione del test.
- Miglioramenti nello stile di vita, con consigli specifici in base ai vari risultati del test, in tutti i campi come: dieta, attività, stress, sonno. I consigli devono essere specifici per il paziente, devono prendere in considerazione tutti i dati inseriti.


Usa un linguaggio semplice, empatico, ma tecnico. Comunica con tono rassicurante, motivante, professionale. Se i dati sono incompleti, suggerisci di rivolgersi al medico curante. Termina con un messaggio positivo motivazionale.

 SEZIONE FINALE:
> "Grazie per aver compilato questo strumento di prevenzione. Ricorda che la prevenzione è il primo passo verso una vita lunga e in salute. Per qualunque dubbio, parlane con il tuo medico."
`;

    }
 
    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [
        { role: "system", content: "Sei un assistente sanitario digitale esperto." },
        { role: "user", content: prompt }
      ],
      temperature: 0.7
    });

    const result = response?.choices?.[0]?.message?.content;
    return res.status(200).json({
      risposta: result || "⚠️ Nessuna risposta valida."
    });

  } catch (error) {
    console.error("❌ Errore OpenAI:", error);
    return res.status(500).json({
      errore: "⚠️ Si è verificato un errore nella comunicazione con OpenAI. Riprova più tardi."
    });
  }
}

