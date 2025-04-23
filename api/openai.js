import { OpenAI } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Solo richieste POST sono accettate' });
  }

  const data = req.body;

  const compiledPrompt = `
Sei un assistente sanitario digitale progettato per analizzare dati raccolti tramite un modulo di prevenzione, calcolare gli score clinici e restituire consigli personalizzati secondo le linee guida ufficiali (OMS, ESC, AIFA, ADA, Ministero della Salute).

📥 Di seguito ci sono i dati raccolti:

- Nome: ${data.nome || "-"}
- Età: ${data.eta || "-"}
- Sesso biologico: ${data.sesso || "-"}
- Origine etnica: ${data.origine_etnica || "-"}

🔹 ANTROPOMETRIA
- Altezza (cm): ${data.altezza || "-"}
- Peso (kg): ${data.peso || "-"}
- Circonferenza vita: ${data.vita || "-"}
- Glicemia: ${data.glicemia || "-"}
- Colesterolo totale: ${data.colesterolo_totale || "-"}
- Colesterolo LDL >70: ${data.colesterolo_ldl || "-"}
- Colesterolo HDL basso: ${data.colesterolo_hdl || "-"}
- Pressione arteriosa (inferiore a 130/85?): ${data.pressione || "-"}

🔹 STORIA CLINICA
- Malattie croniche: ${data.malattie_croniche || "-"}
- Assunzione farmaci: ${data.farmaci || "-"}
- Dettaglio farmaci: ${data.farmaci_dettaglio || "-"}
- Interventi chirurgici rilevanti: ${data.interventi || "-"}
- Dettaglio interventi: ${data.interventi_dettaglio || "-"}

🔹 STORIA FAMILIARE E TUMORI
- Familiarità con tumori: ${data.familiarita_tumori || "-"}
- Tipo e sede tumore famigliare: ${data.sede_tumore || "-"}

🔹 STILE DI VITA
- Fumatore: ${data.fumatore || "-"}
- Quante sigarette: ${data.n_sigarette || "-"}
- Consumo alcolici: ${data.alcol || "-"}
- Quante unità alcoliche al giorno: ${data.unita_alcoliche || "-"}
- Attività fisica: ${data.attivita_fisica || "-"}
- Tipo di attività fisica: ${data.tipo_attivita || "-"}
- Durata allenamenti: ${data.durata_attivita || "-"}
- Alimentazione: ${data.alimentazione || "-"}

🔹 SALUTE FEMMINILE (se applicabile)
- Età menarca: ${data.eta_menarca || "-"}
- Età menopausa: ${data.eta_menopausa || "-"}
- Uso contraccettivi ormonali: ${data.contraccettivi || "-"}
- Gravidanze: ${data.gravidezza || "-"}
- Familiarità tumore al seno: ${data.familiarita_seno || "-"}
- Hai fatto mammografia/ecografia mammaria?: ${data.screening_seno || "-"}
- Svolgi regolarmente Pap test?: ${data.papsmear || "-"}

🔹 PREVENZIONE - SCREENING
- Screening già effettuati: ${data.screening_effettuati || "-"}
- Data ultimo screening: ${data.data_ultimo_screening || "-"}

🔹 STATO PSICOFISICO
- Ti senti spesso stanco/a?: ${data.stanchezza || "-"}
- Episodi depressivi: ${data.depressione || "-"}
- Difficoltà a dormire: ${data.insonnia || "-"}
- Tipo di disturbo del sonno: ${data.tipo_insonnia || "-"}
- Livello percepito di stress: ${data.stress || "-"}

🔹 VALUTAZIONE DI FRAGILITÀ (score)
- Riesci a salire una rampa di scale?: ${data.over_scale || "-"}
- Cammini almeno 100m?: ${data.over_camminata || "-"}
- Hai >5 patologie croniche?: ${data.over_malattie || "-"}
- Perdita involontaria di peso >5kg?: ${data.over_peso || "-"}
- Difficoltà a sollevare oggetti pesanti?: ${data.over_sollevamento || "-"}
- Problemi ad alzarti da sedia?: ${data.over_sedia || "-"}
- Cadute frequenti?: ${data.over_cadute || "-"}
- Ti senti debole?: ${data.over_debolezza || "-"}

---

📊 CALCOLA I SEGUENTI SCORE (se applicabili):

- BMI = peso / (altezza in m)^2 → Classifica peso (OMS)
- FRAIL scale (0-5)
- SARC-F (0-10)
- SCORE2 (cardiovascolare europeo)
- ADA Risk Score
- QRISK3 (se applicabile)
- FRAX (se età >50)
- Indice di fragilità geriatrica (>65)

---

🧠 GENERA CONSIGLI PERSONALIZZATI:

- Screening oncologici raccomandati
- Visite specialistiche consigliate
- Miglioramenti dello stile di vita
- Strategie di prevenzione attiva
- Follow-up consigliati

Tono semplice, empatico, professionale. Se mancano dati, suggerisci visita dal medico.

---

🎯 MESSAGGIO FINALE:
"Grazie per aver compilato questo strumento di prevenzione. Ricorda che la prevenzione è il primo passo verso una vita lunga e in salute. Per qualunque dubbio, parlane con il tuo medico."
`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4-turbo',
      messages: [
        { role: 'system', content: 'Sei un assistente sanitario esperto in prevenzione e analisi dati clinici.' },
        { role: 'user', content: compiledPrompt }
      ],
      temperature: 0.7,
    });

    const result = response.choices[0].message.content;
    res.status(200).json({ risposta: result });

  } catch (error) {
    console.error("Errore OpenAI:", error);
    res.status(500).json({ error: 'Errore nella richiesta a OpenAI' });
  }
}
