/**
 * audit.js — page logic for audit.html
 *
 * Extracted from the inline <script type="module"> block by
 * scripts/extract-inline-scripts.mjs to satisfy the strict CSP
 * (script-src 'self') declared in vercel.json. Loaded by the page
 * via <script type="module" src="./audit.js"></script>.
 *
 * Depends on window.__UELFY_CONFIG__ being populated by
 * assets/js/public-config.js, which the page MUST include with a
 * non-module <script> tag BEFORE this module.
 */

import { api, requireAuth } from '../assets/js/api-client.js';

await requireAuth();

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);

const PAGE_SIZE = 50;
const state = { page: 1, action: '', actor: '' };

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

async function render() {
  const wrap = document.getElementById('audit-table-wrap');
  wrap.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    const query = {
      page: state.page,
      pageSize: PAGE_SIZE,
    };
    if (state.action) query.action = state.action;
    if (state.actor)  query.actorUserId = state.actor;
    const { events, pagination } = await api.listAudit(query);

    if (!events?.length) {
      wrap.innerHTML = `<p class="muted">No audit events match the current filter.</p>`;
      document.getElementById('pagination-wrap').innerHTML = '';
      return;
    }

    const rows = events.map((e) => `
      <tr>
        <td>${escapeHtml(new Date(e.created_at).toLocaleString())}</td>
        <td class="mono">${escapeHtml(e.action)}</td>
        <td class="mono">${escapeHtml(e.resource_type ?? '—')}</td>
        <td class="mono">${escapeHtml((e.resource_id ?? '').substring(0, 8) || '—')}</td>
        <td class="mono">${escapeHtml((e.actor_user_id ?? '').substring(0, 8) || '—')}</td>
        <td>${escapeHtml(e.outcome ?? '—')}</td>
        <td class="mono" style="max-width:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
          ${escapeHtml(e.metadata ? JSON.stringify(e.metadata) : '—')}
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

document.getElementById('signout-link').addEventListener('click', async (e) => {
  e.preventDefault();
  await api.signOut();
  window.location.href = './login.html';
});

render();
