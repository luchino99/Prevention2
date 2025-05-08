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
const baseSystemPrompt = {
  role: 'system',
  content: `Sei un assistente sanitario digitale esperto in prevenzione e sintomi.
Usa sempre la cronologia precedente per rispondere in modo coerente e contestuale.`
};

const messages = data.cronologia?.length > 0
  ? [baseSystemPrompt, ...data.cronologia.slice(-10)]
  : [
      baseSystemPrompt,
      { role: 'user', content: data.sintomi || 'Fornisci assistenza sanitaria' }
    ];


  const safe = (val) => val ?? "non disponibile";

  try {
    let compiledPrompt = "";

    if (data.sintomi && data.sintomi.trim() !== "") {
      compiledPrompt =  `
Sei un assistente sanitario digitale esperto. Una persona ha descritto i seguenti sintomi:

🩺 **Sintomi riportati:**
${data.sintomi}

Sulla base di questi sintomi, offri un'analisi iniziale, suggerisci possibili cause. Specifica quando è opportuno rivolgersi a un medico o andare al pronto soccorso. 
Ricorda che la tua risposta **non sostituisce una valutazione medica professionale**.`;
  
  } else if (data.dieta) {
    compiledPrompt = `
Sei un nutrizionista clinico esperto in nutrizione personalizzata. In base ai dati forniti di seguito, calcola il fabbisogno calorico giornaliero (BMR e TDEE) del paziente secondo le formule Mifflin-St Jeor e le linee guida LARN/SINU, non scrivere i vari calcoli nella risposta, ma mostra soltando il risultato. Successivamente, crea un piano alimentare settimanale variabile per ogni giorno della settimana dal lunedi fino alla domenica compresa.
Che sia completo, bilanciato basandoti sul risulatato di questi score e sugli obbiettivi del paziente (dimagrimento, mantenimento, massa), eventuali patologie, preferenze, allergie. 
Ogni giorno deve contenere:
- Colazione, spuntino mattina, pranzo, spuntino pomeriggio, cena
- Grammature indicative degli alimenti
In fondo, includi: 
- Suggerimenti per l’idratazione, attività fisica e stile di vita
Dati da utilizzare per programmare la dieta:
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

    console.log("📤 Prompt generato:", compiledPrompt);

const completeMessages = [
  {
    role: 'system',
    content: `Sei un assistente sanitario digitale esperto in prevenzione, nutrizione e allenamento.
Rispondi in modo coerente tenendo conto dell’intera conversazione. Se vengono forniti nuovi dati clinici, aggiornali nel ragionamento. Mantieni tono rassicurante, tecnico ma semplice.`
  },
  ...(messages?.slice(-10) || []) // usa solo gli ultimi 10 messaggi per contesto
];

const response = await openai.chat.completions.create({
  model: 'gpt-4-turbo',
  messages: completeMessages,
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
