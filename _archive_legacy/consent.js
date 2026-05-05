
// /api/consent.js
// Vercel/Node serverless endpoint to record explicit & separate consents
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // CORS (adjust origins)
  const origin = req.headers.origin || '';
  const allowed = [process.env.APP_ORIGIN, process.env.ADMIN_ORIGIN].filter(Boolean);
  if (!allowed.includes(origin)) {
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Missing token' });

    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

    const { type, granted, policyVersion, jurisdiction, evidence } = req.body || {};
    const validTypes = ['health_data','ai_processing','cookies','marketing','age_parental'];
    if (!validTypes.includes(type)) return res.status(400).json({ error: 'Invalid type' });
    if (typeof granted !== 'boolean') return res.status(400).json({ error: 'Invalid granted flag' });

    // capture IP & UA
    const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    const userAgent = req.headers['user-agent'] || '';

    // pull profile to get email if needed
    const { data: profile } = await supabaseAdmin
      .from('anagrafica_utenti')
      .select('user_id, email')
      .eq('email', user.email)
      .single();

    const pUserId = profile?.user_id || user.id;
    const pEmail = profile?.email || user.email;

    // call Postgres function (ensures atomicity & audit)
    const { error: fnErr } = await supabaseAdmin.rpc('record_consent', {
      p_user_id: pUserId,
      p_email: pEmail,
      p_type: type,
      p_granted: granted,
      p_policy_version: policyVersion || process.env.POLICY_VERSION || '1.0.0',
      p_jurisdiction: jurisdiction || 'IT',
      p_ip: ip || null,
      p_user_agent: userAgent || null,
      p_evidence: evidence || {}
    });

    if (fnErr) {
      console.error(fnErr);
      return res.status(500).json({ error: 'Failed to record consent' });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
