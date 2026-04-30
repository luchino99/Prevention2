/**
 * audit.js — page logic for audit.html
 *
 * Audit log browser for tenant_admin / platform_admin.
 *
 * Loaded by the page via:
 *   <script src="../assets/js/public-config.js"></script>
 *   <script type="module" src="./audit.js"></script>
 *
 * Filters supported (Tier 2 / M-09):
 *   - action (text, debounced 250ms)
 *   - actor user id (uuid, debounced 250ms)
 *   - resource type (dropdown, instant)
 *   - outcome (success / failure, instant)
 *   - from / to date range (datetime-local, instant)
 *
 * Plus CSV export of the current filter set (no pagination — server
 * caps at 5000 rows). The export hits the same /api/v1/admin/audit
 * endpoint with `?format=csv`, so the operator sees exactly the rows
 * the table would have shown across all pages of the same filter.
 *
 * Earlier version of this file had a contract drift: it destructured
 * `{ events, pagination }` but the backend returned `{ logs, pagination }`,
 * so the table silently rendered empty. The backend is now aligned to
 * `events` (see api/v1/admin/audit.ts header note).
 */

import { api, requireAuth, supabase } from '../assets/js/api-client.js';

await requireAuth();

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);

const PAGE_SIZE = 50;
const state = {
  page: 1,
  action: '',
  actor: '',
  resourceType: '',
  outcome: '',
  from: '',
  to: '',
};

/* ───────────────────────── role gate ─────────────────────────────── */

try {
  const { user, tenant } = await api.me();
  document.getElementById('tenant-label').textContent = tenant?.name || '—';
  if (!['tenant_admin', 'platform_admin'].includes(user.role)) {
    document.querySelector('main').innerHTML = `
      <div class="inline-alert danger">
        The audit log is accessible only to tenant_admin or platform_admin roles.
      </div>`;
    throw new Error('forbidden');
  }
} catch (e) {
  console.error(e);
  if (e.message === 'forbidden') throw e;
}

/* ───────────────────────── helpers ───────────────────────────────── */

function buildQuery(extra = {}) {
  const q = { page: state.page, pageSize: PAGE_SIZE, ...extra };
  if (state.action)       q.action       = state.action;
  if (state.actor)        q.actorUserId  = state.actor;
  if (state.resourceType) q.resourceType = state.resourceType;
  if (state.outcome)      q.outcome      = state.outcome;
  if (state.from)         q.from         = new Date(state.from).toISOString();
  if (state.to)           q.to           = new Date(state.to).toISOString();
  return q;
}

/* ───────────────────────── renderer ──────────────────────────────── */

async function render() {
  const wrap = document.getElementById('audit-table-wrap');
  wrap.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    const { events, pagination } = await api.listAudit(buildQuery());

    if (!events?.length) {
      wrap.innerHTML = `<p class="muted">No audit events match the current filter.</p>`;
      document.getElementById('pagination-wrap').innerHTML = '';
      return;
    }

    const rows = events.map((e) => `
      <tr>
        <td>${escapeHtml(new Date(e.created_at).toLocaleString())}</td>
        <td class="mono">${escapeHtml(e.action)}</td>
        <td class="mono">${escapeHtml(e.entity_type ?? '—')}</td>
        <td class="mono">${escapeHtml((e.entity_id ?? '').substring(0, 8) || '—')}</td>
        <td class="mono">${escapeHtml((e.actor_user_id ?? '').substring(0, 8) || '—')}</td>
        <td>
          <span class="badge ${e.outcome === 'failure' ? 'danger' : ''}">
            ${escapeHtml(e.outcome ?? 'success')}
          </span>
        </td>
        <td class="mono" style="max-width:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(e.metadata_json ? JSON.stringify(e.metadata_json) : '')}">
          ${escapeHtml(e.metadata_json ? JSON.stringify(e.metadata_json) : '—')}
        </td>
      </tr>`).join('');

    wrap.innerHTML = `
      <table class="table">
        <thead>
          <tr>
            <th>At</th><th>Action</th><th>Resource</th><th>Resource id</th>
            <th>Actor</th><th>Outcome</th><th>Metadata</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;

    const totalPages = Math.max(1, Math.ceil((pagination?.total || 0) / PAGE_SIZE));
    document.getElementById('pagination-wrap').innerHTML = `
      <div class="muted">Page ${state.page} / ${totalPages} · ${pagination?.total ?? '—'} events</div>
      <div class="flex gap-8">
        <button class="btn secondary" id="prev-page" ${state.page <= 1 ? 'disabled' : ''}>Prev</button>
        <button class="btn secondary" id="next-page" ${state.page >= totalPages ? 'disabled' : ''}>Next</button>
      </div>`;
    document.getElementById('prev-page').onclick = () => { state.page--; render(); };
    document.getElementById('next-page').onclick = () => { state.page++; render(); };
  } catch (e) {
    wrap.innerHTML = `<div class="inline-alert danger">Failed to load audit events: ${escapeHtml(e.message)}</div>`;
  }
}

/* ───────────────────────── CSV export ────────────────────────────── */

async function exportCsv() {
  const btn = document.getElementById('export-csv-btn');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Exporting…';
  try {
    // Build the same filter shape the table uses, but request a single
    // big page (server caps at 5000) and CSV format. We bypass apiFetch
    // because the body is text/csv, not JSON.
    const q = buildQuery({ pageSize: 5000, format: 'csv' });
    delete q.page; // server pages from 1 by default
    const params = new URLSearchParams(q).toString();

    // Reuse the SDK's auth session to get an access token.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('No active session — please sign in again.');

    const res = await fetch(`/api/v1/admin/audit?${params}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody?.error?.message || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const isoDate = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `uelfy-audit-${isoDate}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(`Export failed: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

/* ───────────────────────── filter wiring ─────────────────────────── */

let actionTimer = null, actorTimer = null;

document.getElementById('filter-action').addEventListener('input', (e) => {
  clearTimeout(actionTimer);
  actionTimer = setTimeout(() => {
    state.action = e.target.value.trim();
    state.page = 1;
    render();
  }, 250);
});

document.getElementById('filter-actor').addEventListener('input', (e) => {
  clearTimeout(actorTimer);
  actorTimer = setTimeout(() => {
    const v = e.target.value.trim();
    state.actor = /^[0-9a-fA-F-]{36}$/.test(v) ? v : '';
    state.page = 1;
    render();
  }, 250);
});

document.getElementById('filter-resource-type').addEventListener('change', (e) => {
  state.resourceType = e.target.value;
  state.page = 1;
  render();
});

document.getElementById('filter-outcome').addEventListener('change', (e) => {
  state.outcome = e.target.value;
  state.page = 1;
  render();
});

document.getElementById('filter-from').addEventListener('change', (e) => {
  state.from = e.target.value;
  state.page = 1;
  render();
});

document.getElementById('filter-to').addEventListener('change', (e) => {
  state.to = e.target.value;
  state.page = 1;
  render();
});

document.getElementById('export-csv-btn').addEventListener('click', exportCsv);

document.getElementById('signout-link').addEventListener('click', async (e) => {
  e.preventDefault();
  await api.signOut();
  window.location.href = './login.html';
});

render();
