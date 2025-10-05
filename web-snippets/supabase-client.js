// /web-snippets/supabase-client.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

if (!window.env?.SUPABASE_URL || !window.env?.SUPABASE_ANON_KEY) {
  throw new Error("Variabili PUBLIC Supabase mancanti: assicurati che window.env sia caricato prima.");
}

export const supabase = createClient(window.env.SUPABASE_URL, window.env.SUPABASE_ANON_KEY);
