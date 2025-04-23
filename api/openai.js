import { OpenAI } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  // ✅ CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // ✅ Risposta alle richieste preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Solo richieste POST sono accettate' });
  }

  const data = req.body;

  const compiledPrompt = `
Sei un assistente sanitario digitale progettato per analizzare dati raccolti tramite un modulo di prevenzione, calcolare gli score clinici e restituire consigli personalizzati secondo le linee guida ufficiali (OMS, ESC, AIFA, ADA, Ministero della Salute).

📥 Di seguito ci sono i dati raccolti:

- Nome: {{nome}}
- Età: {{età}}
- Sesso biologico: {{sesso}}
- Origine etnica (inclusa eventuale razza nera): {{origine_etnica}}

🔹 ANTROPOMETRIA
- Altezza (cm): {{altezza}}
- Peso (kg): {{peso}}
- BMI = peso / (altezza in m)^2
- Circonferenza vita aumentata: {{vita}}
- Circonferenza vita (valore): {{circonferenza_vita}}
- Glicemia <100 mg/dL: {{glicemia}}
- Valore glicemia: {{glicemia_valore}}
- Colesterolo totale: {{colesterolo_totale}}
- Colesterolo LDL >70: {{colesterolo_ldl}}
- Colesterolo HDL basso: {{colesterolo_hdl}}
- Valore colesterolo HDL: {{colesterolo_hdl_valore}}
- Pressione arteriosa <130/85: {{pressione}}
- Pressione arteriosa (valore): {{pressione_valore}}

🔹 STORIA CLINICA
- Malattie croniche: {{malattie_croniche}}
- Assunzione farmaci: {{farmaci}}
- Dettaglio farmaci: {{farmaci_dettaglio}}
- Interventi chirurgici: {{interventi}}
- Dettaglio interventi: {{interventi_dettaglio}}

🔹 STORIA FAMILIARE E TUMORI
- Familiarità con tumori: {{familiarita_tumori}}
- Tipo/sede tumore: {{sede_tumore}}

🔹 STILE DI VITA
- Fumatore: {{fumatore}}
- Quante sigarette: {{n_sigarette}}
- Alcol: {{alcol}}
- Unità alcoliche al giorno: {{unita_alcoliche}}
- Attività fisica: {{attivita_fisica}}
- Frequenza attività fisica: {{frequenza_attivita_fisica}}
- Tipo attività fisica: {{tipo_attivita}}
- Durata attività fisica (minuti): {{durata_attivita}}

🔹 ALIMENTAZIONE (PREDIMED)
- predimed_1: {{predimed_1}}
- predimed_2: {{predimed_2}}
- predimed_3: {{predimed_3}}
- predimed_4: {{predimed_4}}
- predimed_5: {{predimed_5}}
- predimed_6: {{predimed_6}}
- predimed_7: {{predimed_7}}
- predimed_8: {{predimed_8}}
- predimed_9: {{predimed_9}}
- predimed_10: {{predimed_10}}
- predimed_11: {{predimed_11}}
- predimed_12: {{predimed_12}}
- predimed_13: {{predimed_13}}
- predimed_14: {{predimed_14}}

🔹 SALUTE FEMMINILE (se applicabile)
- Età menarca: {{eta_menarca}}
- Età menopausa: {{eta_menopausa}}
- Contraccettivi ormonali: {{contraccettivi}}
- Gravidanze: {{gravidezza}}
- Familiarità tumore seno: {{familiarita_seno}}
- Mammografia/ecografia: {{screening_seno}}
- Pap test: {{papsmear}}

🔹 SCREENING
- Screening effettuati: {{screening_effettuati}}
- Data ultimo screening: {{data_ultimo_screening}}

🔹 STATO PSICOFISICO
- Stanchezza: {{stanchezza}}
- Episodi depressivi: {{depressione}}
- Insonnia: {{insonnia}}
- Tipo insonnia: {{tipo_insonnia}}
- Stress (1–10): {{stress}}

🔹 VALUTAZIONE DI FRAGILITÀ (score)
- Scale: {{scale}}
- Camminata: {{camminata}}
- >5 patologie croniche: {{malattie_multiple}}
- Perdita peso >5kg: {{perdita_peso}}
- Difficoltà sollevamento: {{sollevamento}}
- Alzarsi da sedia: {{alzarsi_sedia}}
- Cadute frequenti: {{cadute}}
- Debolezza: {{debolezza}}

📊 JSON STRUCTURED SCORE INPUT:

[{
    "nome": "BMI",
    "descrizione": "Indice di massa corporea",
    "requisiti": ["peso", "altezza"],
    "formula": "peso / (altezza in metri)^2",
    "soglie": {
      "Sottopeso": "<18.5",
      "Normopeso": "18.5–24.9",
      "Sovrappeso": "25–29.9",
      "Obeso": ">=30"
    },
    "linee_guida": "OMS"
  },
  {
    "nome": "FRAIL scale",
    "descrizione": "Valutazione della fragilità fisica",
    "requisiti": ["over_stanchezza", "over_scale", "over_malattie", "over_peso", "over_sedia"],
    "formula": "1 punto per ogni risposta negativa",
    "soglie": {
      "Robusto": 0,
      "Pre-frail": "1–2",
      "Frail": "3–5"
    },
    "età_minima": 65,
    "linee_guida": "Geriatric Research Society"
  },
  {
    "nome": "SARC-F",
    "descrizione": "Valutazione del rischio di sarcopenia",
    "requisiti": ["over_scale", "over_sollevamento", "over_camminata", "over_sedia", "over_cadute"],
    "formula": "1–2 punti per ogni funzione compromessa",
    "soglie": {
      "Basso rischio": "<4",
      "Alto rischio": ">=4"
    },
    "età_minima": 65,
    "linee_guida": "EWGSOP2"
  },
  {
    "nome": "FRAX",
    "descrizione": "Rischio di frattura osteoporotica",
    "requisiti": ["eta", "sesso", "peso", "altezza", "familiarita_tumori", "farmaci_dettaglio", "over_cadute", "over_sollevamento"],
    "condizione": "età >= 50",
    "output": ["Probabilità frattura maggiore", "Probabilità frattura femore"],
    "linee_guida": "OMS"
  },
  {
    "nome": "SCORE2",
    "descrizione": "Rischio cardiovascolare a 10 anni",
    "requisiti": ["eta", "sesso", "fumatore", "pressione_valore", "colesterolo_totale", "colesterolo_hdl"],
    "condizione": "età >= 40 e <= 69",
    "output": "Percentuale rischio 10 anni",
    "linee_guida": "ESC 2021"
  },
  {
    "nome": "ADA Diabetes Risk Score",
    "descrizione": "Probabilità di sviluppare il diabete di tipo 2",
    "requisiti": ["eta", "sesso", "vita", "attivita_fisica", "alimentazione", "familiarita_tumori"],
    "output": "Punteggio da 0 a 11",
    "soglie": {
      "Rischio basso": "0–4",
      "Rischio moderato": "5–8",
      "Rischio alto": "9–11"
    },
    "linee_guida": "American Diabetes Association"
  },
  {
    "nome": "PREDIMED",
    "descrizione": "Aderenza alla dieta mediterranea",
    "requisiti": [
      "predimed_1", "predimed_2", "predimed_3", "predimed_4", "predimed_5",
      "predimed_6", "predimed_7", "predimed_8", "predimed_9", "predimed_10",
      "predimed_11", "predimed_12", "predimed_13", "predimed_14"
    ],
    "formula": "1 punto per ogni risposta positiva (max 14)",
    "soglie": {
      "Bassa aderenza": "0–5",
      "Media aderenza": "6–9",
      "Alta aderenza": "10–14"
    },
    "linee_guida": "PREDIMED Study – España"
  }
]
]

🧠 GENERA CONSIGLI PERSONALIZZATI:
- Screening oncologici raccomandati per età/sesso/storia
- Visite specialistiche consigliate (es. cardiologica, metabolica, ginecologica, geriatrica)
- Miglioramenti dello stile di vita (dieta, attività fisica, sonno, stress)
- Strategie di prevenzione attiva (es. dieta DASH, attività aerobica, controllo glicemico)
- Quando è opportuno effettuare follow-up o controlli

Usa un linguaggio semplice, empatico, ma tecnico. Comunica con tono rassicurante, motivante, professionale. Se i dati sono incompleti, suggerisci di rivolgersi al medico curante. Termina con un messaggio positivo motivazionale.

🎯 SEZIONE FINALE:
> "Grazie per aver compilato questo strumento di prevenzione. Ricorda che la prevenzione è il primo passo verso una vita lunga e in salute. Per qualunque dubbio, parlane con il tuo medico."
;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'Sei un assistente sanitario esperto in prevenzione e analisi dati clinici.' },
        { role: 'user', content: compiledPrompt }
      ],
      temperature: 0.7
    });

    const result = response?.choices?.[0]?.message?.content;

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
