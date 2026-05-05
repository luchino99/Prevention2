/**
 * patients.js — page logic for patients.html
 *
 * Extracted from the inline <script type="module"> block by
 * scripts/extract-inline-scripts.mjs to satisfy the strict CSP
 * (script-src 'self') declared in vercel.json. Loaded by the page
 * via <script type="module" src="./patients.js"></script>.
 *
 * Depends on window.__UELFY_CONFIG__ being populated by
 * assets/js/public-config.js, which the page MUST include with a
 * non-module <script> tag BEFORE this module.
 */

import { api, requireAuth } from '../assets/js/api-client.js';
import { mountNavHeader } from '../components/nav-header.js';

await requireAuth();

// Root-level list page — single breadcrumb, no patient chip.
mountNavHeader({
  container: document.getElementById('nav-header-mount'),
  crumbs: [
    { label: 'Dashboard', href: './dashboard.html' },
    { label: 'Patients' },
  ],
  backHref: './dashboard.html',
  backLabel: 'Back to dashboard',
});

const PAGE_SIZE = 20;
const state = { page: 1, search: '', role: null };

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);

try {
  const { user, tenant } = await api.me();
  state.role = user.role;
  document.getElementById('tenant-label').textContent = tenant?.name || '—';
  if (user.role === 'tenant_admin' || user.role === 'platform_admin') {
    document.getElementById('nav-audit').classList.remove('hidden');
  }
  // Only clinicians, tenant_admin, platform_admin can create patients.
  if (!['clinician', 'tenant_admin', 'platform_admin'].includes(user.role)) {
    document.getElementById('new-patient-btn').style.display = 'none';
  }
} catch (e) { console.error(e); }

async function render() {
  const wrap = document.getElementById('patients-table-wrap');
  wrap.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    const { patients, pagination } = await api.listPatients({
      page: state.page,
      pageSize: PAGE_SIZE,
      search: state.search || undefined,
    });

    if (!patients?.length) {
      wrap.innerHTML = `<p class="muted">No patients match your filter.</p>`;
      document.getElementById('pagination-wrap').innerHTML = '';
      return;
    }

    const rows = patients.map(p => `
      <tr>
        <td class="mono">${escapeHtml(p.external_code ?? (p.id || '').substring(0, 8))}</td>
        <td>${escapeHtml(p.display_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || '—')}</td>
        <td>${escapeHtml(p.sex ?? '—')}</td>
        <td>${escapeHtml(p.birth_date ?? (p.birth_year ? String(p.birth_year) : '—'))}</td>
        <td>${p.is_active === false
          ? '<span class="badge muted">inactive</span>'
          : '<span class="badge ok">active</span>'}</td>
        <td><a href="./patient-detail.html?id=${encodeURIComponent(p.id)}">Open</a></td>
      </tr>
    `).join('');

    wrap.innerHTML = `
      <table class="table">
        <thead>
          <tr>
            <th>Ref</th><th>Name</th><th>Sex</th><th>DOB</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;

    const totalPages = Math.max(1, Math.ceil((pagination?.total || 0) / PAGE_SIZE));
    document.getElementById('pagination-wrap').innerHTML = `
      <div class="muted">Page ${state.page} / ${totalPages} · ${pagination?.total ?? '—'} patients</div>
      <div class="flex gap-8">
        <button class="btn secondary" id="prev-page" ${state.page <= 1 ? 'disabled' : ''}>Prev</button>
        <button class="btn secondary" id="next-page" ${state.page >= totalPages ? 'disabled' : ''}>Next</button>
      </div>`;
    document.getElementById('prev-page').onclick = () => { state.page--; render(); };
    document.getElementById('next-page').onclick = () => { state.page++; render(); };
  } catch (e) {
    console.error(e);
    wrap.innerHTML = `<div class="inline-alert danger">Failed to load patients: ${escapeHtml(e.message)}</div>`;
  }
}

let searchTimer = null;
document.getElementById('search-input').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.page = 1;
    state.search = e.target.value.trim();
    render();
  }, 250);
});

// ── New patient dialog ─────────────────────────────────────────────
const dialog = document.getElementById('new-patient-dialog');
document.getElementById('new-patient-btn').onclick = () => dialog.showModal();
document.getElementById('np-cancel').onclick = () => dialog.close();

document.getElementById('new-patient-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById('np-error');
  errorEl.classList.add('hidden');
  const submitBtn = document.getElementById('np-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating…';
  try {
    const dobIso = form.dateOfBirth.value
      ? new Date(form.dateOfBirth.value + 'T00:00:00Z').toISOString()
      : null;
    if (!dobIso) throw new Error('Date of birth is required');
    const body = {
      demographics: {
        firstName:    form.firstName.value.trim(),
        lastName:     form.lastName.value.trim(),
        dateOfBirth:  dobIso,
        sex:          form.sex.value,
        externalCode: form.externalCode.value.trim(),
      },
      contact: (form.email.value.trim() || form.phoneNumber.value.trim()) ? {
        email:       form.email.value.trim() || null,
        phoneNumber: form.phoneNumber.value.trim() || null,
      } : undefined,
      notes: form.notes.value.trim() || undefined,
      consentGiven: !!form.consentGiven.checked,
    };
    const { patient } = await api.createPatient(body);
    dialog.close();
    window.location.href = `./patient-detail.html?id=${encodeURIComponent(patient.id)}`;
  } catch (err) {
    errorEl.textContent = err?.details
      ? `${err.message} — ${JSON.stringify(err.details)}`
      : (err.message || 'Failed to create patient');
    errorEl.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create patient';
  }
});

document.getElementById('signout-link').addEventListener('click', async (e) => {
  e.preventDefault();
  await api.signOut();
  window.location.href = './login.html';
});

render();
