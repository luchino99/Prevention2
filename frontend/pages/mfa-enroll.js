/**
 * mfa-enroll.js — page logic for /pages/mfa-enroll.html
 *
 * Two distinct flows live behind the same URL:
 *
 *   FLOW 1 — ENROLLMENT
 *     The user has logged in but has no verified TOTP factor yet. We
 *     show the QR code + secret + code input. After mfa.verify() the
 *     access token is auto-rotated by Supabase and gains aal: 'aal2'.
 *
 *   FLOW 2 — CHALLENGE
 *     The user already has a verified TOTP factor on file (e.g. they
 *     enrolled previously, then logged in fresh from another browser).
 *     Their session is currently aal1, the backend is rejecting calls
 *     with `403 MFA_REQUIRED`, and the only path forward is a regular
 *     mfa.challenge → mfa.verify against the existing factor. We MUST
 *     NOT call mfa.enroll() in this case — that would create another
 *     unverified factor on every reload (acceptance criterion #10).
 *
 * The dispatcher at the bottom of this file picks the flow based on
 *   - the current session's AAL (via getAuthenticatorAssuranceLevel())
 *   - the list of factors (to find any verified TOTP)
 *
 * Once a verify call succeeds, we re-read the AAL to confirm the new
 * token is `aal2` before redirecting back to the dashboard. Skipping
 * that confirmation is the bug that produced the
 *   MFA_REQUIRED → mfa-enroll → dashboard → MFA_REQUIRED
 * loop in production.
 *
 * Extracted from an inline <script type="module"> block by
 * scripts/extract-inline-scripts.mjs to satisfy the strict CSP
 * (script-src 'self') declared in vercel.json.
 *
 * Depends on window.__UELFY_CONFIG__ being populated by
 * assets/js/public-config.js, which the page MUST include with a
 * non-module <script> tag BEFORE this module.
 */

import { supabase } from '../assets/js/api-client.js';

// ---------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

function show(id) { $(id)?.classList.remove('hidden'); }
function hide(id) { $(id)?.classList.add('hidden'); }

function showError(msg) {
  const el = $('error-banner');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}
function clearError() {
  $('error-banner')?.classList.add('hidden');
}
function showSuccess(msg) {
  const el = $('success-banner');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function setHeader(title, subtitle) {
  if (title) $('page-title').textContent = title;
  if (subtitle) $('page-subtitle').textContent = subtitle;
}

function safeRedirect(href) {
  // Ensure a single redirect even if multiple async paths converge.
  if (window.__uelfyMfaRedirected) return;
  window.__uelfyMfaRedirected = true;
  window.location.replace(href);
}

// ---------------------------------------------------------------------
// AAL helpers
// ---------------------------------------------------------------------
async function readCurrentAal() {
  // getAuthenticatorAssuranceLevel reads the parsed claim from the live
  // session — it does NOT make a network call, so this is cheap to use
  // both as a dispatcher input and as a post-verify confirmation.
  try {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) return { current: null, next: null };
    return {
      current: data?.currentLevel ?? null,
      next: data?.nextLevel ?? null,
    };
  } catch {
    return { current: null, next: null };
  }
}

async function listMfaFactors() {
  try {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) return { verified: [], unverified: [] };
    const all = data?.totp ?? [];
    return {
      verified: all.filter((f) => f.status === 'verified'),
      unverified: all.filter((f) => f.status !== 'verified'),
    };
  } catch {
    return { verified: [], unverified: [] };
  }
}

// ---------------------------------------------------------------------
// FLOW 1 — ENROLLMENT
// ---------------------------------------------------------------------
let enrollFactorId = null;

async function startEnrollFlow(existingUnverified) {
  setHeader(
    'Enable two-factor authentication',
    'Clinical accounts must be protected with a TOTP authenticator app.',
  );
  hide('mode-loading');
  hide('mode-challenge');
  hide('mode-done');
  show('mode-enroll');

  try {
    let enrollData;
    if (existingUnverified) {
      // L-09 / acceptance #10 — never call mfa.enroll() if an unverified
      // factor already exists, otherwise we leave a trail of orphan
      // factors on every reload. Re-read the QR/secret for that factor
      // by re-enrolling against its id is not exposed by the SDK; we
      // unenroll the stale unverified factor first and then enroll a
      // fresh one. This keeps the count bounded at one unverified +
      // one verified per user.
      try {
        await supabase.auth.mfa.unenroll({ factorId: existingUnverified.id });
      } catch {
        // Best-effort cleanup; if unenroll fails we proceed and let the
        // user complete the new enrollment — Supabase tolerates multiple
        // unverified factors but the operator should reconcile manually.
      }
    }

    const res = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'Uelfy Clinical TOTP',
    });
    if (res.error) throw res.error;
    enrollData = res.data;

    enrollFactorId = enrollData.id;
    const totpUri = enrollData.totp?.uri;
    const totpSecret = enrollData.totp?.secret;
    const qrData = enrollData.totp?.qr_code;

    if (qrData) {
      $('qr-image').src = qrData;
      $('qr-image').style.display = 'block';
      $('qr-loading').style.display = 'none';
    } else if (totpUri) {
      // Supabase usually returns qr_code as an inline SVG data-URI; the
      // CDN fallback is only used if the SDK omits it. The TOTP URI
      // contains issuer + label + secret — no extra PII.
      const svgUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(totpUri)}&size=220x220`;
      $('qr-image').src = svgUrl;
      $('qr-image').style.display = 'block';
      $('qr-loading').style.display = 'none';
    }
    if (totpSecret) {
      $('qr-secret').textContent = totpSecret;
    }
  } catch (e) {
    showError(e?.message ?? 'Failed to start MFA enrolment');
  }

  $('enroll-verify-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    clearError();
    const code = String($('enroll-code').value ?? '').trim();
    if (!/^[0-9]{6}$/.test(code)) {
      showError('Code must be 6 digits.');
      return;
    }
    if (!enrollFactorId) {
      showError('Enrolment not initialised. Please refresh and try again.');
      return;
    }
    const btn = $('enroll-verify-btn');
    btn.disabled = true;
    try {
      const ch = await supabase.auth.mfa.challenge({ factorId: enrollFactorId });
      if (ch.error) throw ch.error;
      const ver = await supabase.auth.mfa.verify({
        factorId: enrollFactorId,
        challengeId: ch.data.id,
        code,
      });
      if (ver.error) throw ver.error;

      await onMfaVerified('Two-factor authentication enabled for your account.');
    } catch (e) {
      showError(e?.message ?? 'Verification failed. Please try again.');
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------
// FLOW 2 — CHALLENGE
// ---------------------------------------------------------------------
async function startChallengeFlow(verifiedFactor) {
  setHeader(
    'Enter your authenticator code',
    'Open your authenticator app and enter the current 6-digit code.',
  );
  hide('mode-loading');
  hide('mode-enroll');
  hide('mode-done');
  show('mode-challenge');

  $('challenge-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    clearError();
    const code = String($('challenge-code').value ?? '').trim();
    if (!/^[0-9]{6}$/.test(code)) {
      showError('Code must be 6 digits.');
      return;
    }
    const btn = $('challenge-btn');
    btn.disabled = true;
    try {
      const ch = await supabase.auth.mfa.challenge({ factorId: verifiedFactor.id });
      if (ch.error) throw ch.error;
      const ver = await supabase.auth.mfa.verify({
        factorId: verifiedFactor.id,
        challengeId: ch.data.id,
        code,
      });
      if (ver.error) throw ver.error;

      await onMfaVerified('Verified — your session is now MFA-protected.');
    } catch (e) {
      showError(e?.message ?? 'Verification failed. Please try again.');
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------
// Post-verify confirmation + redirect
// ---------------------------------------------------------------------
async function onMfaVerified(successMsg) {
  // Supabase rotates the access token in-place when mfa.verify() succeeds
  // (the new JWT carries `aal: 'aal2'` and amr including 'totp'). Confirm
  // before redirecting so the dashboard's first /api/v1/me call doesn't
  // loop us straight back here.
  showSuccess(successMsg);

  // Defensive double-check: read the aal claim from the live session.
  // If for any reason the token wasn't rotated, refresh once and re-read.
  let aal = (await readCurrentAal()).current;
  if (aal !== 'aal2') {
    try { await supabase.auth.refreshSession(); } catch { /* ignore */ }
    aal = (await readCurrentAal()).current;
  }

  if (aal === 'aal2') {
    hide('mode-enroll');
    hide('mode-challenge');
    show('mode-done');
    // Auto-advance to the dashboard after a short beat so the success
    // banner is visible. The CTA is also rendered for the keyboard /
    // a11y path.
    const target = './dashboard.html';
    $('done-cta').setAttribute('href', target);
    setTimeout(() => safeRedirect(target), 600);
    return;
  }

  // If we get here, mfa.verify() reported success but the token didn't
  // pick up aal2. This is rare but observable in offline test doubles.
  // Surface it to the user instead of redirecting into a 403 loop.
  showError(
    'Verification reported success but the session is still single-factor. ' +
    'Please sign out and sign back in, then re-enter the code.',
  );
}

// ---------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------
async function dispatch() {
  // Guard 1 — must be authenticated (have a Supabase session). The
  // enrolment page is otherwise reachable to anonymous users via direct
  // URL, which would just produce a confusing "no factors" state.
  const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
  if (sessErr || !sessionData?.session) {
    safeRedirect('./login.html');
    return;
  }

  // Guard 2 — already aal2: nothing to do, send the user back to where
  // they were trying to go.
  const { current } = await readCurrentAal();
  if (current === 'aal2') {
    safeRedirect('./dashboard.html');
    return;
  }

  // Guard 3 — pick the flow based on the user's existing factors.
  const { verified, unverified } = await listMfaFactors();

  if (verified.length > 0) {
    // FLOW 2 — Challenge against the most recently created verified
    // factor. There should normally be only one; we pick the first.
    await startChallengeFlow(verified[0]);
    return;
  }

  // FLOW 1 — Enrollment. If we still have an unverified factor lying
  // around (typical when a previous enrolment was abandoned half-way),
  // pass it in so we can clean it up before creating a new one.
  await startEnrollFlow(unverified[0] ?? null);
}

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------
dispatch().catch((e) => {
  // Last-resort guard: never leave the user on the loading state.
  showError(e?.message ?? 'Could not initialise the MFA page. Please refresh.');
  hide('mode-loading');
});
