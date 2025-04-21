// backend-openai.js (Node.js/Express backend da usare su Vercel, Render o simili)

import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { config } from 'dotenv';
import { OpenAI } from 'openai';

config();

const app = express();
const port = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors());
app.use(bodyParser.json());

// Prompt base da combinare con le risposte dell'utente
const basePrompt = `Sei un assistente sanitario digitale progettato per analizzare dati raccolti tramite un modulo di prevenzione, calcolare gli score clinici e restituire consigli personalizzati secondo le linee guida ufficiali (OMS, ESC, AIFA, ADA, Ministero della Salute). 

📥 Di seguito ci sono i dati raccolti:

- Nome: {{nome}}
- Età: {{età}}
- Sesso biologico: {{sesso}}
- Origine etnica (inclusa eventuale razza nera): {{origine_etnica}}

🔹 ANTROPOMETRIA
- Altezza (cm): {{altezza}}
- Peso (kg): {{peso}}
- BMI = peso / (altezza in m)^2
- Circonferenza vita: {{circonferenza_vita}}
- Glicemia: {{glicemia}}
- Colesterolo totale: {{colesterolo_totale}}
- Colesterolo LDL >70: {{colesterolo_ldl}}
- Colesterolo HDL basso (valori sesso-specifici): {{colesterolo_hdl}}
- Pressione arteriosa (inferiore a 130/85?): {{pressione}}

🔹 STORIA CLINICA
- Malattie croniche: {{malattie_croniche}}
- Assunzione farmaci: {{farmaci}}
- Dettaglio farmaci: {{farmaci_dettaglio}}
- Interventi chirurgici rilevanti: {{interventi}}
- Dettaglio interventi: {{interventi_dettaglio}}

🔹 STORIA FAMILIARE E TUMORI
- Familiarità con tumori: {{familiarita_tumori}}
- Tipo e sede tumore famigliare: {{sede_tumore}}

🔹 STILE DI VITA
- Fumatore: {{fumatore}}
- Quante sigarette: {{n_sigarette}}
- Consumo alcolici: {{alcol}}
- Quante unità alcoliche al giorno: {{unita_alcoliche}}
- Attività fisica: {{attivita_fisica}}
- Tipo di attività fisica: {{tipo_attivita}}
- Durata allenamenti (minuti): {{durata_attivita}}
- Alimentazione: {{alimentazione}}

🔹 SALUTE FEMMINILE (se applicabile)
- Età menarca: {{eta_menarca}}
- Età menopausa: {{eta_menopausa}}
- Uso contraccettivi ormonali: {{contraccettivi}}
- Gravidanze: {{gravidezza}}
- Familiarità tumore al seno: {{familiarita_seno}}
- Hai fatto mammografia/ecografia mammaria?: {{screening_seno}}
- Svolgi regolarmente Pap test?: {{papsmear}}

🔹 PREVENZIONE - SCREENING
- Screening già effettuati: {{screening_effettuati}}
- Data ultimo screening: {{data_ultimo_screening}}

🔹 STATO PSICOFISICO
- Ti senti spesso stanco/a?: {{stanchezza}}
- Episodi depressivi: {{depressione}}
- Difficoltà a dormire: {{insonnia}}
- Tipo di disturbo del sonno: {{tipo_insonnia}}
- Livello percepito di stress (1-10): {{stress}}

🔹 VALUTAZIONE DI FRAGILITÀ (score)
- Riesci a salire una rampa di scale?: {{scale}}
- Cammini almeno 100m?: {{camminata}}
- Hai >5 patologie croniche?: {{malattie_multiple}}
- Perdita involontaria di peso >5kg?: {{perdita_peso}}
- Difficoltà a sollevare oggetti pesanti?: {{sollevamento}}
- Problemi ad alzarti da sedia?: {{alzarsi_sedia}}
- Cadute frequenti?: {{cadute}}
- Ti senti debole?: {{debolezza}}

---

📊 CALCOLA I SEGUENTI SCORE (dove i dati lo permettono):

- **BMI** → Classifica peso (OMS)
- **FRAIL scale** (0-5): Fatigue, Resistance, Ambulation, Illness, Loss of weight
- **SARC-F** (0-10): Forza, camminata, sedersi, scale, cadute
- **SCORE2** (prevenzione cardiovascolare europea)
- **Rischio diabete (ADA Risk Score)**: Glicemia, vita, attività, familiarità
- **QRISK3 (se applicabile)**
- **FRAX** (valutazione rischio frattura ossea, solo se età >50)
- **Indice di fragilità geriatrica (screening soggetti >65 anni)**

---

🧠 GENERA CONSIGLI PERSONALIZZATI:

- Screening oncologici raccomandati per età/sesso/storia
- Visite specialistiche consigliate (es. cardiologica, metabolica, ginecologica, geriatrica)
- Miglioramenti dello stile di vita (dieta, attività fisica, sonno, stress)
- Strategie di prevenzione attiva (es. dieta DASH, attività aerobica, controllo glicemico)
- Quando è opportuno effettuare follow-up o controlli

Usa un linguaggio semplice, empatico, ma tecnico. Comunica con tono rassicurante, motivante, professionale. Se i dati sono incompleti, suggerisci di rivolgersi al medico curante. Termina con un messaggio positivo motivazionale.

---

🎯 SEZIONE FINALE:
> "Grazie per aver compilato questo strumento di prevenzione. Ricorda che la prevenzione è il primo passo verso una vita lunga e in salute. Per qualunque dubbio, parlane con il tuo medico."
`;

app.post('/api/openai', async (req, res) => {
  const { risposte } = req.body;

  if (!risposte) {
    return res.status(400).json({ errore: 'Dati mancanti' });
  }

  const datiUtente = Object.entries(risposte)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  const messaggioFinale = `${basePrompt}\n\n📥 Di seguito i dati inseriti dall'utente:\n${datiUtente}\n\n📊 Fornisci analisi, calcola score, e genera raccomandazioni personalizzate.`;

  try {
    const completion = await openai.chat.completions.create({
      messages: [
        { role: 'system', content: basePrompt },
        { role: 'user', content: messaggioFinale }
      ],
      model: 'gpt-4',
      temperature: 0.7
    });

    const risposta = completion.choices[0].message.content;
    res.json({ risposta });
  } catch (err) {
    console.error('Errore OpenAI:', err);
    res.status(500).json({ errore: 'Errore generazione AI' });
  }
});

app.listen(port, () => {
  console.log(`🧠 Backend AI attivo sulla porta ${port}`);
});
