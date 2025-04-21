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

const basePrompt = `Sei un assistente sanitario digitale progettato per analizzare dati raccolti tramite un modulo di prevenzione, calcolare gli score clinici e restituire consigli personalizzati secondo le linee guida ufficiali (OMS, ESC, AIFA, ADA, Ministero della Salute).

... (testo abbreviato per spazio, già incluso nel documento) ...
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