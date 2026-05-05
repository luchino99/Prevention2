/**
 * alerts.js — page logic for alerts.html
 *
 * Extracted from the inline <script type="module"> block by
 * scripts/extract-inline-scripts.mjs to satisfy the strict CSP
 * (script-src 'self') declared in vercel.json. Loaded by the page
 * via <script type="module" src="./alerts.js"></script>.
 *
 * Depends on window.__UELFY_CONFIG__ being populated by
 * assets/js/public-config.js, which the page MUST include with a
 * non-module <script> tag BEFORE this module.
 */

import { api, requireAuth } from '../assets/js/api-client.js';
import { mountNavHeader } from '../components/nav-header.js';

await requireAuth();

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);

// Render the breadcrumb immediately — this page is a global inbox,
// so no patient chip is attached. Back goes to the dashboard.
mountNavHeader({
  container: document.getElementById('nav-header-mount'),
  crumbs: [
    { label: 'Dashboard', href: './dashboard.html' },
    { label: 'Alerts' },
  ],
  backHref: './dashboard.html',
  backLabel: 'Back to dashboard',
});

const PAGE_SIZE = 30;
const state = { page: 1, status: 'open', severity: '' };

try {
  const { user, tenant } = await api.me();
  document.getElementById('tenant-label').textContent = tenant?.name || '—';
  if (user.role === 'tenant_admin' || user.role === 'platform_admin') {
    document.getElementById('nav-audit').classList.remove('hidden');
  }
} catch (e) { console.error(e); }

const dialog = document.getElementById('action-dialog');
let currentAction = { alertId: null, action: null };

function openAction(alertId, action) {
  currentAction = { alertId, action };
  document.getElementById('action-title').textContent =
    action === 'acknowledge' ? 'Acknowledge alert'
    : action === 'resolve' ? 'Resolve alert'
    : 'Dismiss alert';
  document.getElementById('action-error').classList.add('hidden');
  document.getElementById('action-form').reset();
  dialog.showModal();
}
document.getElementById('action-cancel').onclick = () => dialog.close();

document.getElementById('action-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const note = e.target.note.value.trim() || undefined;
  const err = document.getElementById('action-error');
  const btn = document.getElementById('action-submit');
  btn.disabled = true;
  try {
    await api.ackAlert(currentAction.alertId, currentAction.action, note);
    dialog.close();
    render();
  } catch (ex) {
    err.textContent = ex.message || 'Action failed';
    err.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
});

async function render() {
  const wrap = document.getElementById('alerts-table-wrap');
  wrap.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    const { alerts, pagination } = await api.listAlerts({
      status: state.status,
      severity: state.severity || undefined,
      page: state.page,
      pageSize: PAGE_SIZE,
    });
    if (!alerts?.length) {
      wrap.innerHTML = `<p class="muted">No alerts match the current filter.</p>`;
      document.getElementById('pagination-wrap').innerHTML = '';
      return;
    }
    const rows = alerts.map((a) => {
      const patientName =
        a.patient?.display_name || a.patient?.external_code || '—';
      const pid = a.patient_id;
      const actions = state.status === 'open' ? `
        <button class="btn secondary" data-id="${a.id}" data-action="acknowledge">Ack</button>
        <button class="btn secondary" data-id="${a.id}" data-action="resolve">Resolve</button>
        <button class="btn secondary" data-id="${a.id}" data-action="dismiss">Dismiss</button>
      ` : state.status === 'acknowledged' ? `
        <button class="btn secondary" data-id="${a.id}" data-action="resolve">Resolve</button>
      ` : '';
      return `
        <tr>
          <td><span class="badge ${escapeHtml(a.severity)}">${escapeHtml(a.severity)}</span></td>
          <td>${escapeHtml(a.title ?? a.type ?? 'Alert')}</td>
          <td>
            ${pid
              ? `<a href="./patient-detail.html?id=${encodeURIComponent(pid)}">${escapeHtml(patientName)}</a>`
              : escapeHtml(patientName)}
          </td>
          <td class="mono">${escapeHtml(a.type ?? '—')}</td>
          <td>${escapeHtml(new Date(a.created_at).toLocaleString())}</td>
          <td class="flex gap-8">${actions}</td>
        </tr>`;
    }).join('');

    wrap.innerHTML = `
      <table class="table">
        <thead>
          <tr><th>Severity</th><th>Title</th><th>Patient</th><th>Type</th><th>Opened</th><th>Actions</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;

    wrap.querySelectorAll('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => openAction(btn.dataset.id, btn.dataset.action));
    });

    const totalPages = Math.max(1, Math.ceil((pagination?.total || 0) / PAGE_SIZE));
    document.getElementById('pagination-wrap').innerHTML = `
      <div class="muted">Page ${state.page} / ${totalPages} · ${pagination?.total ?? '—'} alerts</div>
      <div class="flex gap-8">
        <button class="btn secondary" id="prev-page" ${state.page <= 1 ? 'disabled' : ''}>Prev</button>
        <button class="btn secondary" id="next-page" ${state.page >= totalPages ? 'disabled' : ''}>Next</button>
      </div>`;
    document.getElementById('prev-page').onclick = () => { state.page--; render(); };
    document.getElementById('next-page').onclick = () => { state.page++; render(); };
  } catch (e) {
    wrap.innerHTML = `<div class="inline-alert danger">Failed to load alerts: ${escapeHtml(e.message)}</div>`;
  }
}

document.getElementById('filter-status').addEventListener('change', (e) => {
  state.status = e.target.value;
  state.page = 1;
  render();
});
document.getElementById('filter-severity').addEventListener('change', (e) => {
  state.severity = e.target.value;
  state.page = 1;
  render();
});

document.getElementById('signout-link').addEventListener('click', async (e) => {
  e.preventDefault();
  await api.signOut();
  window.location.href = './login.html';
});

render();
