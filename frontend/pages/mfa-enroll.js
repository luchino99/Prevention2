/**
 * mfa-enroll.js — page logic for mfa-enroll.html
 *
 * Extracted from the inline <script type="module"> block by
 * scripts/extract-inline-scripts.mjs to satisfy the strict CSP
 * (script-src 'self') declared in vercel.json. Loaded by the page
 * via <script type="module" src="./mfa-enroll.js"></script>.
 *
 * Depends on window.__UELFY_CONFIG__ being populated by
 * assets/js/public-config.js, which the page MUST include with a
 * non-module <script> tag BEFORE this module.
 */

import { supabase } from '../assets/js/api-client.js';

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

function showError(msg) {
  const el = $('error-banner');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function clearError() {
  $('error-banner').classList.add('hidden');
}
function showSuccess(msg) {
  const el = $('success-banner');
  el.textContent = msg;
  el.classList.remove('hidden');
}

// ---------------------------------------------------------------------
// Guard: must be authenticated
// ---------------------------------------------------------------------
const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
if (sessErr || !sessionData.session) {
  window.location.replace('./login.html');
  throw new Error('not-authenticated');
}

// ---------------------------------------------------------------------
// If TOTP is already enrolled → skip to step 3
// ---------------------------------------------------------------------
let factorId = null;
let challengeId = null;
try {
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verified = (factors?.totp ?? []).find((f) => f.status === 'verified');
  if (verified) {
    $('step-enroll').classList.add('hidden');
    $('step-verify').classList.add('hidden');
    $('step-done').classList.remove('hidden');
    showSuccess('Two-factor authentication is already active on this account.');
    throw new Error('already-enrolled');
  }

  // ---------------------------------------------------------------------
  // Step 1: enroll a new TOTP factor
  // ---------------------------------------------------------------------
  const { data: enrollData, error: enrollErr } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Uelfy Clinical TOTP',
  });
  if (enrollErr) throw enrollErr;

  factorId = enrollData.id;
  const totpUri = enrollData.totp?.uri;
  const totpSecret = enrollData.totp?.secret;

  // Supabase already returns the QR as a data URI (svg xml) via totp.qr_code.
  // If the SDK doesn't return the rendered QR, render via an open-source
  // CDN fallback. The URI contains issuer + label + secret — no extra PII.
  const qrData = enrollData.totp?.qr_code;
  if (qrData) {
    $('qr-image').src = qrData;
    $('qr-image').style.display = 'block';
    $('qr-loading').style.display = 'none';
  } else if (totpUri) {
    const svgUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(totpUri)}&size=220x220`;
    $('qr-image').src = svgUrl;
    $('qr-image').style.display = 'block';
    $('qr-loading').style.display = 'none';
  }
  if (totpSecret) {
    $('qr-secret').textContent = totpSecret;
  }
} catch (e) {
  if (String(e?.message) !== 'already-enrolled') {
    showError(e?.message ?? 'Failed to start MFA enrolment');
  }
}

// ---------------------------------------------------------------------
// Step 2: verify with a 6-digit code
// ---------------------------------------------------------------------
$('verify-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  clearError();
  const code = String($('code').value ?? '').trim();
  if (!/^[0-9]{6}$/.test(code)) {
    showError('Code must be 6 digits.');
    return;
  }
  if (!factorId) {
    showError('Enrolment not initialised. Please refresh and try again.');
    return;
  }
  $('verify-btn').disabled = true;
  try {
    const { data: challengeData, error: challengeErr } = await supabase.auth.mfa.challenge({
      factorId,
    });
    if (challengeErr) throw challengeErr;
    challengeId = challengeData.id;

    const { error: verifyErr } = await supabase.auth.mfa.verify({
      factorId,
      challengeId,
      code,
    });
    if (verifyErr) throw verifyErr;

    $('step-enroll').classList.add('hidden');
    $('step-verify').classList.add('hidden');
    $('step-done').classList.remove('hidden');
    showSuccess('Two-factor authentication enabled for your account.');
  } catch (e) {
    showError(e?.message ?? 'Verification failed. Please try again.');
  } finally {
    $('verify-btn').disabled = false;
  }
});
