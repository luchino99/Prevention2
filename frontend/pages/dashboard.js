/**
 * dashboard.js — page logic for dashboard.html
 *
 * Extracted from the inline <script type="module"> block by
 * scripts/extract-inline-scripts.mjs to satisfy the strict CSP
 * (script-src 'self') declared in vercel.json. Loaded by the page
 * via <script type="module" src="./dashboard.js"></script>.
 *
 * Depends on window.__UELFY_CONFIG__ being populated by
 * assets/js/public-config.js, which the page MUST include with a
 * non-module <script> tag BEFORE this module.
 */

import { api, requireAuth } from '../assets/js/api-client.js';

await requireAuth();

// Hydrate user + tenant
try {
  const { user, tenant } = await api.me();
  document.getElementById('user-meta').textContent = `${user.full_name || user.email} · ${user.role}`;
  document.getElementById('tenant-label').textContent = tenant?.name || '—';
  if (user.role === 'tenant_admin' || user.role === 'platform_admin') {
    document.getElementById('nav-audit').classList.remove('hidden');
  }
} catch (e) {
  console.error(e);
}

// KPIs: total patients, open alerts
try {
  const [{ patients, pagination }, alertsResp] = await Promise.all([
    api.listPatients({ page: 1, pageSize: 5 }),
    api.listAlerts({ status: 'open', severity: 'critical', pageSize: 10 })
      .catch(() => ({ alerts: [], pagination: { total: 0 } })),
  ]);

  document.getElementById('kpi-row').innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Total patients</div>
      <div class="kpi-value">${pagination.total ?? '—'}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Last sign-in</div>
      <div class="kpi-value" style="font-size:var(--fs-md); font-weight:var(--fw-medium);">${new Date().toLocaleString()}</div>
    </div>
  `;

  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);

  const rows = (patients || []).map(p => {
    const ref   = escapeHtml(p.external_code ?? (p.id ? p.id.substring(0, 8) : '—'));
    const name  = escapeHtml(p.display_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || '—');
    const dob   = escapeHtml(p.birth_date ?? (p.birth_year ? String(p.birth_year) : '—'));
    const sex   = escapeHtml(p.sex ?? '—');
    const id    = encodeURIComponent(p.id);
    return `
      <tr>
        <td class="mono">${ref}</td>
        <td>${name}</td>
        <td>${dob}</td>
        <td>${sex}</td>
        <td><a href="./patient-detail.html?id=${id}">Open</a></td>
      </tr>`;
  }).join('');

  document.getElementById('patients-table-wrap').innerHTML = patients?.length ? `
    <table class="table">
      <thead>
        <tr><th>Ref</th><th>Name</th><th>DOB</th><th>Sex</th><th></th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  ` : `<p class="muted">No patients yet.</p>`;

  const openCritical = alertsResp?.alerts ?? [];
  if (openCritical.length === 0) {
    document.getElementById('alerts-wrap').innerHTML =
      `<p class="muted">No open critical alerts.</p>`;
  } else {
    document.getElementById('alerts-wrap').innerHTML = `
      <ul class="list-plain">
        ${openCritical.slice(0, 6).map((a) => `
          <li>
            <span class="badge danger">${escapeHtml(a.severity)}</span>
            <strong>${escapeHtml(a.title ?? a.type ?? 'Alert')}</strong>
            <span class="muted"> · ${escapeHtml(a.patient?.display_name || a.patient?.external_code || 'Patient')}</span>
            <a class="ml-8" href="./patient-detail.html?id=${encodeURIComponent(a.patient_id)}">Open</a>
          </li>
        `).join('')}
      </ul>
      <p class="muted" style="margin-top:8px;">
        <a href="./alerts.html">View all alerts →</a>
      </p>`;
  }
} catch (e) {
  console.error(e);
  document.getElementById('patients-table-wrap').innerHTML =
    `<div class="inline-alert danger">Failed to load patients: ${e.message}</div>`;
}

document.getElementById('signout-link').addEventListener('click', async (e) => {
  e.preventDefault();
  await api.signOut();
  window.location.href = './login.html';
});
