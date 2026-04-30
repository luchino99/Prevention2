/**
 * tenant-settings.js — page logic for tenant-settings.html (M-02 / Tier 3).
 *
 * Loaded by the page via:
 *   <script src="../assets/js/public-config.js"></script>
 *   <script type="module" src="./tenant-settings.js"></script>
 *
 * What the page does
 * ------------------
 *   - Reads the caller's tenant from `/api/v1/admin/tenant` (GET)
 *   - Renders the General card (read-only) + Retention overrides form
 *   - On submit, PATCHes only the changed fields. Empty strings are
 *     sent as `null` so the backend resets the field to the platform
 *     default (this is the documented contract).
 *
 * Why: M-02 lets a tenant_admin edit retention windows without filing
 * a ticket with Uelfy. The cron-side honouring of these overrides is
 * Tier 4 (the inline notice on the page tells the admin so) — but the
 * persistence + audit trail is live today.
 */

import { api, requireAuth, supabase } from '../assets/js/api-client.js';

await requireAuth();

const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);

/* ───────────────────────── role gate ─────────────────────────────── */

let me;
try {
  me = await api.me();
} catch (e) {
  // requireAuth above already covers the unauthenticated case; this
  // catch handles the rare DB error path.
  $('forbidden-banner').textContent = 'Could not load your profile.';
  $('forbidden-banner').style.display = 'block';
  throw e;
}
const role = me?.user?.role;
$('tenant-label').textContent = me?.tenant?.name ?? '—';

if (!['tenant_admin', 'platform_admin'].includes(role)) {
  $('forbidden-banner').style.display = 'block';
  throw new Error('forbidden');
}

/* ───────────────────────── load tenant ───────────────────────────── */

async function loadTenant() {
  // The api-client doesn't expose admin/tenant yet; call apiFetch directly.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('No active session');

  const res = await fetch('/api/v1/admin/tenant', {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
  const json = await res.json();
  return json.tenant;
}

async function patchTenant(patch) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('No active session');

  const res = await fetch('/api/v1/admin/tenant', {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
  const json = await res.json();
  return json.tenant;
}

function paint(t) {
  $('t-name').textContent    = t.name ?? '—';
  $('t-slug').textContent    = t.slug ?? '—';
  $('t-plan').textContent    = t.plan ?? '—';
  $('t-status').textContent  = t.status ?? '—';
  $('t-created').textContent = t.created_at ? new Date(t.created_at).toLocaleString() : '—';

  // Numeric fields — empty input means "platform default" (NULL).
  $('rd-audit').value  = t.retention_days_audit ?? '';
  $('rd-grace').value  = t.retention_days_anonymize_grace ?? '';
  $('rd-alerts').value = t.retention_days_alerts_resolved ?? '';
  $('rd-notif').value  = t.retention_days_notifications ?? '';

  $('general-card').style.display = '';
  $('retention-card').style.display = '';
}

try {
  const t = await loadTenant();
  paint(t);
} catch (e) {
  $('general-card').style.display = '';
  $('general-card').innerHTML = `<div class="inline-alert danger">Failed to load tenant: ${escapeHtml(e.message)}</div>`;
  throw e;
}

/* ───────────────────────── submit handler ────────────────────────── */

$('retention-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const status = $('save-status');
  const btn = $('save-btn');

  const formData = new FormData(ev.target);
  const patch = {};
  for (const [k, raw] of formData.entries()) {
    const trimmed = String(raw).trim();
    if (trimmed === '') {
      patch[k] = null; // explicit reset to platform default
    } else {
      const n = Number.parseInt(trimmed, 10);
      if (!Number.isFinite(n)) {
        status.textContent = `Invalid number for ${k}`;
        status.style.color = '#b3261e';
        return;
      }
      patch[k] = n;
    }
  }
  if (Object.keys(patch).length === 0) {
    status.textContent = 'Nothing to save.';
    return;
  }

  btn.disabled = true;
  status.style.color = '';
  status.textContent = 'Saving…';
  try {
    const t = await patchTenant(patch);
    paint(t);
    status.style.color = '#1f7a1f';
    status.textContent = 'Saved.';
  } catch (e) {
    status.style.color = '#b3261e';
    status.textContent = `Failed: ${e.message}`;
  } finally {
    btn.disabled = false;
  }
});

/* ───────────────────────── nav ────────────────────────────────────── */

$('signout-link').addEventListener('click', async (e) => {
  e.preventDefault();
  await api.signOut();
  window.location.href = './login.html';
});
