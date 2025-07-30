// api/recuperaAnagrafica.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lwuhdgrkaoyvejmzfbtx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Metodo non permesso" });
  }

  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Email mancante" });
  }

  try {
    const { data, error } = await supabase
      .from('anagrafica_utenti')
      .select('*')
      .eq('email', email)
      .single();

    if (error) throw error;

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Errore recupero:", error);
    return res.status(500).json({ error: "Errore durante il recupero dati" });
  }
}
