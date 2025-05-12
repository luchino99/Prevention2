import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lwuhdgrkaoyvejmzfbtx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non permesso" });

  const { email, tipo, risposta } = req.body;

  if (!email || !tipo || !risposta) {
    return res.status(400).json({ error: "Dati mancanti per il salvataggio" });
  }

  const campo = {
    sintomi: "risposta_sintomi",
    prevenzione: "risposta_test",
    dieta: "risposta_dieta",
    allenamento: "risposta_allenamento"
  }[tipo];

  if (!campo) {
    return res.status(400).json({ error: `Tipo non valido: ${tipo}` });
  }

  try {
    const payload = {
      email,
      [campo]: risposta,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('risposte_chatbot_utenti')
      .upsert([payload], { onConflict: 'email' });

    if (error) throw error;

    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error("Errore salvataggio risposta:", err);
    return res.status(500).json({ error: "Errore interno" });
  }
}
