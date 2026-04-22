/**
 * Uelfy API Client — thin typed wrapper around the /api/v1 endpoints.
 * Uses Supabase Auth for token management, attaches Bearer tokens to
 * every call, and exposes typed helpers for the main B2B flows.
 *
 * The client is intentionally framework-agnostic (plain ES modules) so it
 * works in vanilla HTML pages during the incremental refactor.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * SECURITY: Anon key + project URL are injected at build time into
 * window.__UELFY_CONFIG__. They are PUBLIC values by design (safe to ship
 * to browsers) — never the service-role key.
 */
const cfg = (typeof window !== 'undefined' ? window.__UELFY_CONFIG__ : null) || {};

if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
  console.error('[api-client] Missing window.__UELFY_CONFIG__.supabaseUrl / supabaseAnonKey');
}

export const supabase = createClient(cfg.supabaseUrl || '', cfg.supabaseAnonKey || '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

async function currentAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
}

/**
 * On any 401 we defensively sign the user out and redirect to login so that
 * a stale/invalid Supabase session does not keep pages in a half-broken
 * state. This also catches cases where the public.users profile is missing
 * (USER_PROFILE_NOT_FOUND) — see backend/src/middleware/auth-middleware.ts.
 */
async function forceReauth(reason) {
  try { await supabase.auth.signOut(); } catch { /* ignore */ }
  // Avoid redirect loops if we are already on the login page.
  if (!window.location.pathname.endsWith('/login.html')) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/pages/login.html?reason=${encodeURIComponent(reason || 'session_expired')}&next=${next}`;
  }
}

async function apiFetch(path, { method = 'GET', body, query } = {}) {
  const token = await currentAccessToken();
  if (!token) {
    await forceReauth('no_token');
    throw new Error('Not authenticated');
  }
  let url = path;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) qs.append(k, String(v));
    }
    url += '?' + qs.toString();
  }
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let err;
    try { err = await res.json(); } catch { err = { error: { code: 'HTTP_' + res.status, message: res.statusText } }; }

    // 401 always means: the token is gone, expired, or the server-side
    // profile row is missing. Either way the only safe recovery is to
    // re-authenticate; otherwise the UI displays "User profile not found"
    // forever without actionable recovery.
    if (res.status === 401) {
      await forceReauth(err?.error?.code || 'unauthorized');
    }

    const e = new Error(err?.error?.message || 'API error');
    e.status = res.status;
    e.code = err?.error?.code;
    e.details = err?.error?.details;
    throw e;
  }
  if (res.status === 204) return null;
  return await res.json();
}

/* ───────────────────────── API helpers ───────────────────────── */

export const api = {
  // Auth & profile
  me:            () => apiFetch('/api/v1/me'),
  signIn:        async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    // confirm session with the server
    await apiFetch('/api/v1/auth/session', { method: 'POST' });
    return data;
  },
  signOut:       async () => { await supabase.auth.signOut(); },

  // Patients
  listPatients:  (query) => apiFetch('/api/v1/patients', { query }),
  createPatient: (body)  => apiFetch('/api/v1/patients', { method: 'POST', body }),
  getPatient:    (id)    => apiFetch(`/api/v1/patients/${encodeURIComponent(id)}`),
  updatePatient: (id, body) => apiFetch(`/api/v1/patients/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  deletePatient: (id)    => apiFetch(`/api/v1/patients/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Assessments
  listAssessments:   (patientId, query) =>
    apiFetch(`/api/v1/patients/${encodeURIComponent(patientId)}/assessments`, { query }),
  createAssessment:  (patientId, body) =>
    apiFetch(`/api/v1/patients/${encodeURIComponent(patientId)}/assessments`, { method: 'POST', body }),
  getAssessment:     (id) => apiFetch(`/api/v1/assessments/${encodeURIComponent(id)}`),

  // Reports
  generateReport:    (assessmentId) =>
    apiFetch(`/api/v1/assessments/${encodeURIComponent(assessmentId)}/report`, { method: 'POST' }),
  getReportUrl:      (assessmentId) =>
    apiFetch(`/api/v1/assessments/${encodeURIComponent(assessmentId)}/report`),

  // Alerts
  listAlerts:        (query) => apiFetch('/api/v1/alerts', { query }),
  listPatientAlerts: (patientId, query) =>
    apiFetch(`/api/v1/patients/${encodeURIComponent(patientId)}/alerts`, { query }),
  ackAlert:          (alertId, action, note) =>
    apiFetch(`/api/v1/alerts/${encodeURIComponent(alertId)}/ack`, {
      method: 'POST',
      body: { action, note },
    }),

  // Consents
  listConsents:      (patientId) => apiFetch('/api/v1/consents', { query: { patientId } }),
  recordConsent:     (body) => apiFetch('/api/v1/consents', { method: 'POST', body }),

  // Admin
  listAudit:         (query) => apiFetch('/api/v1/admin/audit', { query }),
};

/* Utility: guard page access — redirect to login if unauthenticated. */
export async function requireAuth() {
  const { data } = await supabase.auth.getSession();
  if (!data?.session) {
    window.location.href = '/pages/login.html';
    throw new Error('Redirecting to login');
  }
  return data.session;
}
