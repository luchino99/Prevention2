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
  
Sei un assistente sanitario digitale. Analizza i dati forniti per calcolare score clinici ufficiali e fornire consigli personalizzati secondo linee guida OMS, ESC, AIFA, ADA e Ministero della Salute.

📥 **DATI RACCOLTI:**
- Età: ${data.eta}
- Sesso biologico: ${data.sesso}
- Origine etnica: ${data.origine_etnica}
- Altezza: ${data.altezza} cm
- Peso: ${data.peso} kg
- Vita > soglia: ${data.vita}
- Glicemia < 100: ${data.glicemia}
- Glicemia valore: ${data.glicemia_valore}
- Colesterolo totale: ${data.colesterolo_totale}
- LDL >70: ${data.colesterolo_ldl}
- HDL basso: ${data.colesterolo_hdl}
- HDL valore: ${data.colesterolo_hdl_valore}
- Pressione < 130/85: ${data.pressione}
- Pressione valore: ${data.pressione_valore}
- Malattie croniche: ${data.malattie_croniche}
- Farmaci: ${data.farmaci}
- Dettaglio farmaci: ${data.farmaci_dettaglio}
- Interventi: ${data.interventi}
- Dettaglio interventi: ${data.interventi_dettaglio}
- Familiarità tumori: ${data.familiarita_tumori}
- Sede tumore: ${data.sede_tumore}
- Fumatore: ${data.fumatore}
- Sigarette/die: ${data.n_sigarette}
- Alcol: ${data.alcol}
- Unità alcoliche/die: ${data.unita_alcoliche}
- Attività fisica: ${data.attivita_fisica}
- Frequenza attività: ${data.frequenza_attivita_fisica}
- Tipo attività: ${data.tipo_attivita}
- Durata attività: ${data.durata_attivita}
- Alimentazione (Predimed): ${[...Array(14)].map((_, i) => `predimed_${i + 1}: ${data[`predimed_${i + 1}`]}`).join(" | ")}
- Stanchezza: ${data.stanchezza}
- Depressione: ${data.depressione}
- Insonnia: ${data.insonnia}
- Tipo insonnia: ${data.tipo_insonnia}
- Stress: ${data.stress}
- Preferenze: ${data.preferenze}

${
    data.eta > 65 ? `
🔹 **VALUTAZIONE OVER 65:**
- over_stanchezza: ${data.over_stanchezza}
- over_scale: ${data.over_scale}
- over_camminata: ${data.over_camminata}
- over_malattie: ${data.over_malattie}
- over_peso: ${data.over_peso}
- over_sollevamento: ${data.over_sollevamento}
- over_sedia: ${data.over_sedia}
- over_cadute: ${data.over_cadute}
- over_debolezza: ${data.over_debolezza}` : ""
}
${
    data.sesso.toLowerCase() === 'femmina' || data.sesso.toLowerCase() === 'donna'
      ? `
🔹 **SALUTE FEMMINILE:**
- Età menarca: ${data.eta_menarca}
- Età menopausa: ${data.eta_menopausa}
- Contraccettivi: ${data.contraccettivi}
- Gravidanze: ${data.gravidezza}
- Familiarità seno: ${data.familiarita_seno}
- Screening seno: ${data.screening_seno}
- Pap test: ${data.papsmear}` : ""
}

📊 **CALCOLA I SEGUENTI SCORE CLINICI (se disponibili):**
- BMI
- PREDIMED
- SCORE2
- ADA Diabetes Risk Score
- FRAIL (se >65 anni)
- SARC-F (se >65 anni)
- FRAX (se >50 anni)

🧠 **GENERA CONSIGLI PERSONALIZZATI:**
- Screening oncologici raccomandati
- Visite specialistiche necessarie
- Miglioramenti nello stile di vita
- Raccomandazioni su dieta, attività, stress, sonno


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
