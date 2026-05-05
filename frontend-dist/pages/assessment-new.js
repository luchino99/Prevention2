/**
 * assessment-new.js — page logic for assessment-new.html
 *
 * Extracted from the inline <script type="module"> block by
 * scripts/extract-inline-scripts.mjs to satisfy the strict CSP
 * (script-src 'self') declared in vercel.json. Loaded by the page
 * via <script type="module" src="./assessment-new.js"></script>.
 *
 * Depends on window.__UELFY_CONFIG__ being populated by
 * assets/js/public-config.js, which the page MUST include with a
 * non-module <script> tag BEFORE this module.
 */

import { api, requireAuth } from '../assets/js/api-client.js';
import {
  mountNavHeader,
  computeAgeFromBirthDate,
} from '../components/nav-header.js';

await requireAuth();

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);

const params = new URLSearchParams(window.location.search);
const patientId = params.get('patientId');
if (!patientId || !/^[0-9a-fA-F-]{36}$/.test(patientId)) {
  document.body.innerHTML = '<main class="app-main"><div class="inline-alert danger">Invalid patient id.</div></main>';
  throw new Error('invalid id');
}

const backUrl = `./patient-detail.html?id=${encodeURIComponent(patientId)}`;
document.getElementById('cancel-link').href = backUrl;

/**
 * Nav-header state. Breadcrumb is rendered immediately with what we
 * already know (Dashboard › Patients › … › New assessment); the patient
 * chip fills in once `api.getPatient` lands. No risk level is shown on
 * this page because the chip here represents context, not a new result.
 */
const navState = { patient: null };
function renderNavHeader() {
  const mount = document.getElementById('nav-header-mount');
  if (!mount) return;
  const p = navState.patient;
  const chipRef = p?.external_code || patientId.slice(0, 8);
  mountNavHeader({
    container: mount,
    crumbs: [
      { label: 'Dashboard', href: './dashboard.html' },
      { label: 'Patients',  href: './patients.html' },
      { label: chipRef,     href: backUrl },
      { label: 'New assessment' },
    ],
    backHref: backUrl,
    backLabel: 'Back to patient',
    patient: {
      id: patientId,
      displayName:
        p?.display_name ||
        [p?.first_name, p?.last_name].filter(Boolean).join(' ') ||
        '—',
      externalCode: p?.external_code || null,
      riskLevel: null,
      sex: p?.sex || null,
      age: computeAgeFromBirthDate(p?.birth_date ?? p?.birth_year),
    },
  });
}
renderNavHeader();

const errorBanner = document.getElementById('error-banner');
function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.classList.remove('hidden');
}

try {
  const { user } = await api.me();
  if (!['clinician', 'tenant_admin', 'platform_admin'].includes(user.role)) {
    document.body.innerHTML = '<main class="app-main"><div class="inline-alert danger">Your role cannot create clinical assessments.</div></main>';
    throw new Error('forbidden');
  }
} catch (e) { if (e.message === 'forbidden') throw e; }

try {
  const { patient } = await api.getPatient(patientId);
  navState.patient = patient;
  renderNavHeader();
  const label = patient.display_name || [patient.first_name, patient.last_name].filter(Boolean).join(' ') || '—';
  document.getElementById('patient-subline').textContent = `${label} · ${patient.external_code ?? '—'}`;
  // Prefill age & sex from patient profile when available.
  if (patient.sex) {
    const sexSel = document.querySelector('select[name="sex"]');
    sexSel.value = patient.sex;
  }
  const birthYear = patient.birth_year ?? (patient.birth_date ? new Date(patient.birth_date).getUTCFullYear() : null);
  if (birthYear) {
    document.querySelector('input[name="age"]').value =
      String(new Date().getUTCFullYear() - birthYear);
  }
} catch (e) {
  showError(`Patient load failed: ${e.message}`);
}

function num(form, name) {
  const v = form[name]?.value;
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// Number of items in the validated PREDIMED MEDAS questionnaire. Kept
// here so the frontend stays aligned with the `PREDIMED_MAX_SCORE`
// constant exported from the backend nutrition engine.
const PREDIMED_ITEM_COUNT = 14;

/**
 * Collect the 14 PREDIMED MEDAS answers if the clinician has opted
 * into the questionnaire. Otherwise return `undefined` so the key
 * is omitted from the request body — the backend then emits the
 * canonical PREDIMED_INCOMPLETE completeness warning instead of
 * computing a biased score from a partial response.
 */
function collectPredimedAnswers(form) {
  const enabled = form.predimedEnabled?.checked === true;
  if (!enabled) return undefined;
  const answers = [];
  for (let i = 1; i <= PREDIMED_ITEM_COUNT; i += 1) {
    const field = form[`predimed_${i}`];
    answers.push(field?.checked === true);
  }
  return answers;
}

document.getElementById('assessment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  errorBanner.classList.add('hidden');
  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  btn.textContent = 'Computing…';
  try {
    const labs = {};
    ['totalCholMgDl','hdlMgDl','ldlMgDl','triglyceridesMgDl','glucoseMgDl','hba1cPct',
     'eGFR','creatinineMgDl','ggtUL','astUL','altUL','plateletsGigaL','albuminCreatinineRatio',
     'urineAlbuminMgL','urineCreatinineMgDl']
      .forEach((k) => { const v = num(form, k); if (v !== undefined) labs[k] = v; });

    const anyFrail = ['fatigue','resistance','ambulation','illnesses','weightLoss']
      .some((k) => form[k].checked);
    const frailty = anyFrail ? {
      fatigue:      form.fatigue.checked,
      resistance:   form.resistance.checked,
      ambulation:   form.ambulation.checked,
      illnesses:    form.illnesses.checked,
      weightLoss:   form.weightLoss.checked,
    } : null;

    const payload = {
      demographics: {
        age: num(form, 'age'),
        sex: form.sex.value,
      },
      vitals: {
        heightCm: num(form, 'heightCm'),
        weightKg: num(form, 'weightKg'),
        waistCm:  num(form, 'waistCm'),
        sbpMmHg:  num(form, 'sbpMmHg'),
        dbpMmHg:  num(form, 'dbpMmHg'),
      },
      labs,
      clinicalContext: {
        smoking:                form.smoking.checked,
        hasDiabetes:            form.hasDiabetes.checked,
        ageAtDiabetesDiagnosis: num(form, 'ageAtDiabetesDiagnosis'),
        hypertension:           form.hypertension.checked,
        familyHistoryDiabetes:  form.familyHistoryDiabetes.checked,
        familyHistoryCvd:       form.familyHistoryCvd.checked,
        gestationalDiabetes:    form.gestationalDiabetes.checked,
        cvRiskRegion:           form.cvRiskRegion.value,
        medications:            [],
        diagnoses:              [],
      },
      lifestyle: {
        weeklyActivityMinutes:    num(form, 'weeklyActivityMinutes'),
        moderateActivityMinutes:  num(form, 'moderateActivityMinutes'),
        vigorousActivityMinutes:  num(form, 'vigorousActivityMinutes'),
        sedentaryHoursPerDay:     num(form, 'sedentaryHoursPerDay'),
        sedentaryLevel:           form.sedentaryLevel.value || undefined,
        // PREDIMED MEDAS: submitted only when the clinician has
        // explicitly enabled the questionnaire. An omitted array lets
        // the backend emit a PREDIMED_INCOMPLETE completeness warning
        // (desired), while a partial array would be interpreted as
        // "not adherent" and would bias the adherence band.
        predimedAnswers: collectPredimedAnswers(form),
      },
      frailty,
      meta: {
        cvAssessmentFocus: form.cvAssessmentFocus?.checked === true,
      },
    };

    const { snapshot } = await api.createAssessment(patientId, payload);
    const assessmentId = snapshot?.assessment?.id || snapshot?.id;
    if (!assessmentId) {
      showError('Assessment created, but response missing id.');
      return;
    }
    window.location.href = `./assessment-view.html?id=${encodeURIComponent(assessmentId)}`;
  } catch (err) {
    const msg = err?.details
      ? `${err.message} — ${JSON.stringify(err.details).substring(0, 400)}`
      : (err.message || 'Assessment creation failed');
    showError(msg);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Compute assessment';
  }
});

// -----------------------------------------------------------------
// Readiness preview
// -----------------------------------------------------------------
// Mirrors the backend completeness-checker heuristics, expressed as a
// lightweight client-side estimate. Server-side validation remains the
// source of truth — this panel only helps the clinician spot obvious
// data gaps before submitting.
//
// We check availability (not clinical correctness): e.g. SCORE2 is
// marked "ready" if age is in range and all required inputs are
// present; we do NOT run the actual ESC 2021 risk formula here.
// -----------------------------------------------------------------
function readinessSnapshot(form) {
  const g = (k) => num(form, k);
  const b = (k) => form[k]?.checked === true;
  const sex = form.sex?.value || '';
  const age = g('age');
  const hasDiabetes = b('hasDiabetes');
  const cvFocus = b('cvAssessmentFocus');

  const bmiReady =
    Number.isFinite(g('heightCm')) &&
    Number.isFinite(g('weightKg')) &&
    g('heightCm') > 0;

  const score2Ready =
    !hasDiabetes &&
    Number.isFinite(age) && age >= 40 && age <= 69 &&
    (sex === 'male' || sex === 'female') &&
    Number.isFinite(g('sbpMmHg')) &&
    Number.isFinite(g('totalCholMgDl')) &&
    Number.isFinite(g('hdlMgDl'));

  const score2DmReady =
    hasDiabetes &&
    Number.isFinite(age) && age >= 40 && age <= 69 &&
    (sex === 'male' || sex === 'female') &&
    Number.isFinite(g('sbpMmHg')) &&
    Number.isFinite(g('totalCholMgDl')) &&
    Number.isFinite(g('hdlMgDl'));

  const egfrReady =
    Number.isFinite(g('eGFR')) ||
    (Number.isFinite(g('creatinineMgDl')) && Number.isFinite(age) && (sex === 'male' || sex === 'female'));

  const acrDirect = Number.isFinite(g('albuminCreatinineRatio'));
  const acrDerived =
    Number.isFinite(g('urineAlbuminMgL')) &&
    Number.isFinite(g('urineCreatinineMgDl')) &&
    g('urineCreatinineMgDl') > 0;
  const acrReady = acrDirect || acrDerived;

  const fib4Ready =
    Number.isFinite(age) &&
    Number.isFinite(g('astUL')) &&
    Number.isFinite(g('altUL')) &&
    Number.isFinite(g('plateletsGigaL'));

  const fliReady =
    bmiReady &&
    Number.isFinite(g('waistCm')) &&
    Number.isFinite(g('ggtUL')) &&
    Number.isFinite(g('triglyceridesMgDl'));

  const metsReady =
    Number.isFinite(g('waistCm')) &&
    Number.isFinite(g('sbpMmHg')) &&
    Number.isFinite(g('dbpMmHg')) &&
    Number.isFinite(g('hdlMgDl')) &&
    Number.isFinite(g('triglyceridesMgDl')) &&
    Number.isFinite(g('glucoseMgDl'));

  const frailtyExpected = Number.isFinite(age) && age >= 65;
  const anyFrail = ['fatigue','resistance','ambulation','illnesses','weightLoss']
    .some((k) => b(k));

  // PREDIMED MEDAS is considered ready only when the clinician has
  // enabled the questionnaire AND all 14 item checkboxes are present
  // in the DOM (the answers themselves are always booleans, so a
  // "ready" state just means: submission will produce a 14-element
  // array, which is what `computeAllScores` requires to emit the
  // PREDIMED ScoreResultEntry).
  const predimedEnabled = b('predimedEnabled');
  const predimedReady = predimedEnabled && (() => {
    for (let i = 1; i <= PREDIMED_ITEM_COUNT; i += 1) {
      if (!form[`predimed_${i}`]) return false;
    }
    return true;
  })();

  return {
    cvFocus,
    items: [
      { key: 'SCORE2',          label: 'SCORE2 (non-diabetic)',            ready: score2Ready,   applicable: !hasDiabetes && Number.isFinite(age) && age >= 40 && age <= 69 },
      { key: 'SCORE2-Diabetes', label: 'SCORE2-Diabetes',                   ready: score2DmReady, applicable: hasDiabetes && Number.isFinite(age) && age >= 40 && age <= 69 },
      { key: 'eGFR',            label: 'eGFR (CKD-EPI 2021)',               ready: egfrReady,     applicable: true },
      { key: 'ACR',             label: 'ACR (direct or urine-derived)',    ready: acrReady,      applicable: true },
      { key: 'FIB-4',           label: 'FIB-4 (liver fibrosis)',            ready: fib4Ready,     applicable: true },
      { key: 'FLI',             label: 'Fatty Liver Index',                 ready: fliReady,      applicable: true },
      { key: 'MetS',            label: 'Metabolic syndrome (ATP III)',      ready: metsReady,     applicable: true },
      { key: 'FRAIL',           label: 'FRAIL scale',                       ready: anyFrail,      applicable: frailtyExpected },
      { key: 'PREDIMED',        label: 'PREDIMED MEDAS (14 items)',         ready: predimedReady, applicable: true },
    ],
  };
}

function renderReadiness() {
  const form = document.getElementById('assessment-form');
  const wrap = document.getElementById('readiness-wrap');
  if (!form || !wrap) return;
  const snap = readinessSnapshot(form);
  const lines = snap.items
    .filter((it) => it.applicable)
    .map((it) => {
      const cls = it.ready ? 'r-ok' : 'r-missing';
      const mark = it.ready ? '✓' : '◌';
      return `<div class="r-item ${cls}">${mark} <code>${escapeHtml(it.key)}</code> — ${escapeHtml(it.label)}${it.ready ? '' : ' <span class="muted">(inputs missing)</span>'}</div>`;
    });
  if (snap.cvFocus) {
    lines.unshift('<div class="r-item muted">Scope: cardiovascular-focused visit</div>');
  }
  wrap.innerHTML = lines.length
    ? lines.join('')
    : '<div class="muted">Fill in the form to see readiness…</div>';
}

(() => {
  const form = document.getElementById('assessment-form');
  if (!form) return;
  form.addEventListener('input',  renderReadiness);
  form.addEventListener('change', renderReadiness);
  renderReadiness();
})();

// Reveal the 14 PREDIMED MEDAS checkboxes only when the clinician
// enables the questionnaire. This encodes the "all-or-nothing" policy
// on the UI side: the answers container is not even in the DOM flow
// until the opt-in is made, so partial responses cannot be submitted
// by accident.
(() => {
  const toggle = document.getElementById('predimed-enabled');
  const block  = document.getElementById('predimed-items');
  if (!toggle || !block) return;
  const sync = () => block.classList.toggle('hidden', !toggle.checked);
  toggle.addEventListener('change', sync);
  sync();
})();

document.getElementById('signout-link').addEventListener('click', async (e) => {
  e.preventDefault();
  await api.signOut();
  window.location.href = './login.html';
});
