/**
 * login.js — page logic for login.html
 *
 * Extracted from the inline <script type="module"> block by
 * scripts/extract-inline-scripts.mjs to satisfy the strict CSP
 * (script-src 'self') declared in vercel.json. Loaded by the page
 * via <script type="module" src="./login.js"></script>.
 *
 * Depends on window.__UELFY_CONFIG__ being populated by
 * assets/js/public-config.js, which the page MUST include with a
 * non-module <script> tag BEFORE this module.
 *
 * Sprint 8 task 8.2: dynamic strings emitted via the i18n helper
 * `t()`; static HTML strings annotated with `data-i18n` and
 * translated by `bootstrapI18n()` on DOMContentLoaded.
 */

import { api, supabase } from '../assets/js/api-client.js';
import { t, bootstrapI18n } from '../i18n/index.js';

bootstrapI18n();

const form    = document.getElementById('login-form');
const banner  = document.getElementById('error-banner');
const button  = document.getElementById('submit-btn');

// If already authenticated, send them to the dashboard
(async () => {
  const { data } = await supabase.auth.getSession();
  if (data?.session) window.location.href = './dashboard.html';
})();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  banner.classList.add('hidden');
  button.disabled = true;
  button.textContent = t('login.submitting');
  try {
    await api.signIn(
      form.email.value.trim(),
      form.password.value
    );
    window.location.href = './dashboard.html';
  } catch (err) {
    banner.textContent = err?.message || t('login.error_signin_failed');
    banner.classList.remove('hidden');
  } finally {
    button.disabled = false;
    button.textContent = t('login.submit');
  }
});
