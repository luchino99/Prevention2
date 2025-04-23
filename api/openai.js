import { OpenAI } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Solo richieste POST sono accettate' });
  }

  const data = req.body;
  const safe = (val) => val ?? "non disponibile";

  try {
    const compiledPrompt = `
Sei un assistente sanitario digitale. Analizza i dati forniti per calcolare score clinici ufficiali e fornire consigli personalizzati secondo linee guida OMS, ESC, AIFA, ADA e Ministero della Salute.

📥 **DATI RACCOLTI:**
- Età: ${safe(data.eta)}
- Sesso biologico: ${safe(data.sesso)}
- Origine etnica: ${safe(data.origine_etnica)}
- Altezza: ${safe(data.altezza)} cm
- Peso: ${safe(data.peso)} kg
- Vita > soglia: ${safe(data.vita)}
- Glicemia < 100: ${safe(data.glicemia)}
- Glicemia valore: ${safe(data.glicemia_valore)}
- Colesterolo totale: ${safe(data.colesterolo_totale)}
- LDL >70: ${safe(data.colesterolo_ldl)}
- HDL basso: ${safe(data.colesterolo_hdl)}
- HDL colesterolo per SCORE2 (mg/dL): ${safe(data.colesterolo_hdl_valore)}
- Pressione arteriosa (sistolica/diastolica): ${safe(data.pressione_valore)} 
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
- Preferenze: ${safe(data.preferenze)}

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
- SCORE2
- ADA Diabetes Risk Score
- FRAIL (se >65 anni)
- SARC-F (se >65 anni)
- FRAX (se >50 anni)
**Istruzioni importanti per il calcolo degli score:**
Se l’età è **≥ 65 anni**, calcola sempre **FRAIL** e **SARC-F** se sono presenti i dati richiesti.
Se l’età è **≥ 50 anni**, calcola sempre **FRAX** se i dati sono disponibili.
Se uno score non è calcolabile, spiega **quale dato manca**.
Specifica in modo dettagliato il significato di ogni risultato per ogni risultato dei vari score, e cosa potrebbe fare il paziente per migliorare la propria condizione di salute. 

🧠 **GENERA CONSIGLI PERSONALIZZATI:**
- Screening oncologici raccomandati prendendo in considerazione l'età del paziente, andando ad elencare gli screening che dovrebbe svolgere o dovrebbe aver svolto il paziente specifici per l'età di questo.
- Visite specialistiche necessarie in base ai risultati ottenuti dalla comilazione del test.
- Miglioramenti nello stile di vita, con consigli specifici in base ai vari risultati del test, in tutti i campi come: dieta, attività, stress, sonno. I consigli devono essere specifici per il paziente, devono prendere in considerazione tutti i dati inseriti.


Usa un linguaggio semplice, empatico, ma tecnico. Comunica con tono rassicurante, motivante, professionale. Se i dati sono incompleti, suggerisci di rivolgersi al medico curante. Termina con un messaggio positivo motivazionale.

🎯 SEZIONE FINALE:
> "Grazie per aver compilato questo strumento di prevenzione. Ricorda che la prevenzione è il primo passo verso una vita lunga e in salute. Per qualunque dubbio, parlane con il tuo medico."
`;

    console.log("📤 Prompt generato:", compiledPrompt);

    const response = await openai.chat.completions.create({
      model: 'gpt-4-turbo',
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
