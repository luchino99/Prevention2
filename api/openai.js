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
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");


 if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Solo richieste POST sono accettate' });
  }

  const data = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

  const fattoriLavoro = {
    "sedentario": 1.2,
    "leggermente attivo": 1.375,
    "moderatamente attivo": 1.55,
    "molto attivo": 1.725,
    "estremamente attivo": 1.9
  };

  const tipo = data.tipo_lavoro?.trim();
  const tdeeFactor = fattoriLavoro[tipo];

  if (!tdeeFactor) {
    return res.status(400).json({
      errore: `Tipo di lavoro non valido o mancante: "${tipo}". I valori accettati sono: ${Object.keys(fattoriLavoro).join(", ")}.`
    });
  }


  const safe = (val) => val ?? "non disponibile";
  const escape = (str) => (str || "").toString().replace(/[`$]/g, "");


  try {
    let compiledPrompt = "";

    if (data.sintomi && data.sintomi.trim() !== "") {
      compiledPrompt =  `
Sei un assistente sanitario digitale esperto in triage clinico.

Un utente ha descritto i seguenti sintomi:
- Sintomi: {{sintomi}}

Profilo utente:
- Età: {{eta}} anni
- Sesso biologico: {{sesso}}
- Altezza/Peso: {{altezza}} cm / {{peso}} kg
- Patologie note: {{patologie}}
- Farmaci attualmente assunti: {{farmaci_dettaglio}}
- Abitudini: Fumatore: {{fumatore}} | Alcol: {{alcol}} | Attività fisica: {{attivita_fisica}}

📋 **Analisi richiesta:**
1. Elenca le possibili cause (ipotetiche) in ordine di gravità.
2. Specifica sintomi campanello d’allarme per cui rivolgersi subito a un medico o al pronto soccorso.
3. Offri consigli temporanei basati su linee guida cliniche internazionali (OMS, NICE, AIFA).

*Il tuo linguaggio deve essere chiaro, empatico e professionale. Ricorda: questa è una valutazione iniziale e non una diagnosi definitiva.*


🩺 **Sintomi riportati:**
${escape(data.sintomi)}

Sulla base di questi sintomi, offri un'analisi iniziale, suggerisci possibili cause. Specifica quando è opportuno rivolgersi a un medico o andare al pronto soccorso. 
Ricorda che la tua risposta **non sostituisce una valutazione medica professionale**.`;
  
  } else if (data.dieta) {
    compiledPrompt = `
Sei un nutrizionista clinico esperto in nutrizione personalizzata. In base ai dati forniti di seguito, calcola il fabbisogno calorico giornaliero (BMR e TDEE) del paziente secondo le formule Mifflin-St Jeor e le linee guida LARN/SINU, non scrivere i vari calcoli nella risposta, ma mostra soltando il risultato. Successivamente, crea un piano alimentare settimanale variabile per ogni giorno della settimana dal lunedi fino alla domenica compresa.
Che sia completo, bilanciato basandoti sul risulatato di questi score e sugli obbiettivi del paziente (dimagrimento, mantenimento, massa), eventuali patologie, preferenze, allergie. 
Ogni giorno deve contenere:
- Colazione, spuntino mattina, pranzo, spuntino pomeriggio, cena
- Grammature indicative degli alimenti
Prendi in considerazione per stabilire il tipo di dieta, quello che  è ${data.obiettivo}, per far si che si adatti ad esso.
Per il TDEE, calcola il TDEE moltiplicando il BMR per il coefficiente ${tdeeFactor}
In fondo, includi: 
- Suggerimenti per l’idratazione , attività fisica e stile di vita specifi per i dati da lui forniti.
Dati da utilizzare per programmare la dieta:
- Età: {{eta}}, Sesso: {{sesso}}, Altezza: {{altezza}} cm, Peso: {{peso}} kg
- Obiettivo: {{obiettivo}} (es. dimagrimento, massa, mantenimento)
- Attività fisica: {{attivita_fisica}}, Tipo lavoro: {{tipo_lavoro}}
- Patologie: {{patologie}}, Farmaci: {{farmaci_dettaglio}}
- Allergie/intolleranze: {{intolleranze}}, Alimenti esclusi: {{alimenti_esclusi}}
- Preferenze alimentari: {{preferenze}}
- Pasti/die: {{pasti}}, Orari pasti: {{orari_pasti}}

Il piano sarà usato per essere trasformato in PDF.`;

 

  } else if (data.allenamento) {
      compiledPrompt = `
Sei un personal trainer certificato NSCA, ACSM e NASM. In base ai dati raccolti crea un programma di allenamento settimanale altamente personalizzato.

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
    compiledPrompt =   `
Sei un assistente sanitario digitale esperto in prevenzione, epidemiologia clinica e medicina predittiva.

Analizza i seguenti dati raccolti da un paziente per valutare il rischio di patologie, calcolare score clinici ufficiali e fornire raccomandazioni su screening, stili di vita e follow-up medico.

👤 **Anagrafica:**
- Età: {{eta}}
- Sesso biologico: {{sesso}}
- Altezza: {{altezza}} cm
- Peso: {{peso}} kg
- Origine etnica: {{origine_etnica}}
- Circonferenza vita aumentata: {{vita}}

🩺 **Rilevazioni e biomarcatori:**
- Pressione sistolica: {{pressione_sistolica}} mmHg
- Pressione diastolica: {{pressione_diastolica}} mmHg
- Colesterolo totale: {{colesterolo_totale}} mg/dL
- HDL: {{colesterolo_hdl_valore}} mg/dL
- LDL: {{colesterolo_ldl_valore}} mg/dL
- Glicemia a digiuno: {{glicemia_valore}} mg/dL

🧬 **Storia clinica e familiare:**
- Patologie croniche: {{patologie}}
- Farmaci: {{farmaci_dettaglio}}
- Interventi subiti: {{interventi_dettaglio}}
- Tumori in famiglia: {{familiarita_tumori}} (sede: {{sede_tumore}})
- Fumatore: {{fumatore}} – Sigarette/die: {{n_sigarette}}
- Alcol: {{alcol}} – Unità/die: {{unita_alcoliche}}

🏃‍♂️ **Attività e stile di vita:**
- Tipo lavoro: {{tipo_lavoro}}
- Attività fisica: {{attivita_fisica}}, Frequenza: {{frequenza_attivita_fisica}}, Tipo: {{tipo_attivita}}, Durata: {{durata_attivita}}
- Preferenze salute: {{preferenze}}

🥗 **Alimentazione (score PREDIMED):**
- Domande 1–14: {{predimed_1}} → {{predimed_14}}

🧠 **Benessere psicologico:**
- Stanchezza: {{stanchezza}}
- Depressione: {{depressione}}
- Insonnia: {{insonnia}} (tipo: {{tipo_insonnia}})
- Stress percepito: {{stress}}

👵 **Valutazione geriatrica (se età ≥ 65):**
- Stanchezza: {{over_stanchezza}}
- Camminata 100m: {{over_camminata}}
- Sollevamento oggetti: {{over_sollevamento}}
- Alzarsi da sedia: {{over_sedia}}
- Cadute frequenti: {{over_cadute}}
- Altri item: {{over_scale}}, {{over_malattie}}, {{over_peso}}, {{over_debolezza}}

🎗 **Salute femminile (se femmina):**
- Menarca: {{eta_menarca}}, Menopausa: {{eta_menopausa}}
- Contraccettivi: {{contraccettivi}}, Gravidanze: {{gravidezza}}
- Familiarità seno: {{familiarita_seno}}, Screening seno: {{screening_seno}}, Pap test: {{papsmear}}

---

🔍 **Obiettivi del prompt:**

1. Calcola i seguenti **score clinici**, specificando formula, soglie e significato:
   - BMI
   - PREDIMED
   - ADA Diabetes Risk Score
   - SCORE2 (rischio cardiovascolare)
   - FRAIL e SARC-F (se età ≥ 65)
   - FRAX (se età ≥ 50)

2. Verifica la **presenza di sindrome metabolica** se almeno 3 dei seguenti criteri sono soddisfatti:
   - Circonferenza vita aumentata: Uomo > 102 cm, Donna > 88 cm
   - Trigliceridi ≥ 150 mg/dL (non disponibili, segnalare)
   - Colesterolo HDL basso (Uomo < 40, Donna < 50 mg/dL)
   - Pressione ≥ 130/85 mmHg
   - Glicemia a digiuno ≥ 100 mg/dL

3. Elenca eventuali **screening oncologici raccomandati** in base ad età e sesso:
   - Mammografia, Pap Test, PSA, Sangue occulto, Colonscopia, ecc.

4. Suggerisci eventuali **visite specialistiche o follow-up** da considerare in base ai dati.

5. Fornisci **raccomandazioni personalizzate** su:
   - Dieta (es. migliorare punteggio PREDIMED)
   - Esercizio fisico
   - Sonno, stress, dipendenze (fumo/alcol)

🧠 Usa linguaggio semplice ma accurato, con tono empatico e motivante. Se mancano dati per uno score, segnalalo.
Termina con un messaggio di incoraggiamento sulla prevenzione.

> "Grazie per aver completato il test di prevenzione. Ricorda: ogni piccolo cambiamento può fare una grande differenza per la tua salute. Parlane con il tuo medico di fiducia."


    }

    console.log("📤 Prompt generato:", compiledPrompt);

    const response = await openai.chat.completions.create({
      model: 'gpt-4-turbo',
      messages: [
        { role: 'system', content: 'Sei un assistente sanitario esperto in prevenzione e analisi dati clinici, nutrizione e allenamento.' },
        { role: 'user', content: compiledPrompt }
      ],
      temperature: 0.7
    });

    const result = response?.choices?.[0]?.message?.content;
    if (!response?.choices || !response.choices.length) {
  throw new Error("Nessuna risposta valida da OpenAI");
}


    if (!result) {
      return res.status(200).json({
        risposta: "⚠️ L'intelligenza artificiale non ha restituito una risposta valida. Riprova più tardi o contatta un professionista sanitario."
      });
    }

    res.status(200).json({ risposta: result });

  } catch (error) {
    console.error("❌ Errore OpenAI:", error);
    res.status(500).json({
      risposta: "⚠️ Si è verificato un errore nella comunicazione con il sistema. Verifica la connessione o riprova più tardi."
    });
  }
}
