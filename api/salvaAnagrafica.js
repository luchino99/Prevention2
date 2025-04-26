// api/salvaAnagrafica.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lwuhdgrkaoyvejmzfbtx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // ⚡ Sicuro!
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

  const dati = req.body;

  if (!dati || typeof dati !== 'object') {
    return res.status(400).json({ error: "Dati non validi" });
  }

  try {
    const { data, error } = await supabase
      .from('anagrafica_utenti')
      .insert([dati]);

    if (error) throw error;

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Errore salvataggio:", error);
    return res.status(500).json({ error: "Errore durante il salvataggio" });
  }
}
