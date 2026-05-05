/**
 * Uelfy Clinical — shared navigation header.
 * ---------------------------------------------------------------------------
 * Pure presentational ES module. Performs **zero** network calls and has
 * **zero** side effects outside the container it is given. Pages hand
 * in already-hydrated data; the module renders a three-row header:
 *
 *   1. Breadcrumb row — semantic <nav aria-label="Breadcrumb">
 *   2. Action row     — contextual back button + optional
 *                       previous/next assessment chips
 *   3. Patient chip   — sticky identity card (only when patient scope
 *                       is active)
 *
 * Refresh-safe: the component never owns URL state. Pages pass real
 * URLs as hrefs, so every affordance is a real hyperlink — mid-click,
 * open-in-new-tab, keyboard navigation, and browser back/forward all
 * behave identically to native browsing.
 *
 * Security:
 *   - All interpolated text is HTML-escaped (`escape`) before being
 *     written into innerHTML.
 *   - All interpolated URLs are escaped as attribute values AND
 *     URI-component encoded at the caller site (`encodeURIComponent`).
 *   - No third-party imports.
 */

// ---------------------------------------------------------------------------
// Tiny utilities
// ---------------------------------------------------------------------------

/** HTML-escape a string for safe insertion into element content / attrs. */
function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

/** Short, stable 8-char UUID prefix for compact display. */
function shortId(id) {
  if (!id) return '';
  return String(id).slice(0, 8);
}

/** Locale-aware short date ("Apr 24, 2026"), or '' on invalid input. */
function formatShortDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    });
  } catch {
    return '';
  }
}

/**
 * Compute whole-year age from an ISO birthdate. Returns null when the
 * input is not a parseable calendar date (we refuse to approximate).
 */
export function computeAgeFromBirthDate(isoOrYear) {
  if (!isoOrYear) return null;
  try {
    // Accept either full ISO ('1968-02-14') or a bare year ('1968').
    const s = String(isoOrYear);
    const d = /^\d{4}$/.test(s)
      ? new Date(Date.UTC(Number(s), 0, 1))
      : new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    const now = new Date();
    let years = now.getUTCFullYear() - d.getUTCFullYear();
    const m = now.getUTCMonth() - d.getUTCMonth();
    if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) years -= 1;
    if (years < 0 || years > 130) return null;
    return years;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Section renderers — each returns an HTML string or ''
// ---------------------------------------------------------------------------

function renderBreadcrumb(crumbs) {
  if (!Array.isArray(crumbs) || crumbs.length === 0) return '';
  const parts = [];
  crumbs.forEach((c, i) => {
    const last = i === crumbs.length - 1;
    const label = escape(c.label ?? '');
    const cell = last || !c.href
      ? `<span${last ? ' aria-current="page"' : ''}>${label}</span>`
      : `<a href="${escape(c.href)}">${label}</a>`;
    parts.push(`<li class="crumb">${cell}</li>`);
    if (!last) parts.push('<li class="sep" aria-hidden="true">›</li>');
  });
  return `<nav class="breadcrumb" aria-label="Breadcrumb"><ol>${parts.join('')}</ol></nav>`;
}

function renderBack(backHref, backLabel) {
  if (!backHref) return '';
  return `<a class="btn ghost sm nav-back" href="${escape(backHref)}">← ${escape(backLabel || 'Back')}</a>`;
}

function renderAssessmentNav({ assessment, prevAssessmentId, nextAssessmentId, patientId }) {
  if (!assessment) return '';
  const makeHref = (id) => {
    const qs = new URLSearchParams();
    qs.set('id', id);
    if (patientId) qs.set('patientId', patientId);
    return `./assessment-view.html?${qs.toString()}`;
  };
  const prev = prevAssessmentId
    ? `<a class="nav-chip" rel="prev" href="${escape(makeHref(prevAssessmentId))}" aria-label="Previous assessment">‹ Prev</a>`
    : `<span class="nav-chip disabled" aria-hidden="true">‹ Prev</span>`;
  const next = nextAssessmentId
    ? `<a class="nav-chip" rel="next" href="${escape(makeHref(nextAssessmentId))}" aria-label="Next assessment">Next ›</a>`
    : `<span class="nav-chip disabled" aria-hidden="true">Next ›</span>`;
  const label = assessment.createdAt
    ? `Assessment · ${escape(formatShortDate(assessment.createdAt))}`
    : `Assessment · ${escape(shortId(assessment.id))}`;
  return `
    <div class="assessment-nav-chips" role="group" aria-label="Assessment navigation">
      ${prev}
      <span class="nav-chip-label">${label}</span>
      ${next}
    </div>`;
}

function riskLevelAriaLabel(level) {
  if (!level) return 'risk not yet stratified';
  return String(level).replace('_', ' ');
}

function renderPatientChip(patient) {
  if (!patient || !patient.id) return '';
  const href = `./patient-detail.html?id=${encodeURIComponent(patient.id)}`;
  const ref = escape(patient.externalCode || shortId(patient.id) || '—');
  const name = escape(patient.displayName || '—');
  const metaBits = [];
  if (patient.sex) metaBits.push(escape(patient.sex));
  if (typeof patient.age === 'number') metaBits.push(`${patient.age}y`);
  const meta = metaBits.join(' · ');
  const level = patient.riskLevel ? escape(patient.riskLevel) : '';
  const dotAttrs = level
    ? ` data-level="${level}" title="Composite risk: ${escape(riskLevelAriaLabel(patient.riskLevel))}"`
    : ' title="Composite risk not yet available"';
  return `
    <div class="patient-chip" role="navigation" aria-label="Current patient">
      <span class="risk-dot"${dotAttrs} aria-hidden="true"></span>
      <a href="${escape(href)}" class="patient-chip__link">
        <strong class="mono">${ref}</strong>
        <span class="patient-chip__name">${name}</span>
        ${meta ? `<span class="patient-chip__meta muted">${meta}</span>` : ''}
      </a>
    </div>`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mount the navigation header inside `container`. Idempotent — calling
 * it again replaces the previous render.
 *
 * @param {Object}   p
 * @param {Element}  p.container       Required. The element to render into.
 * @param {Array}    [p.crumbs=[]]     [{label, href?}] — last crumb
 *                                     is rendered as aria-current.
 * @param {?string}  [p.backHref=null] URL for the contextual back link.
 * @param {string}   [p.backLabel='Back']
 * @param {?Object}  [p.patient=null]  {id, displayName, externalCode,
 *                                       riskLevel, sex, age}
 * @param {?Object}  [p.assessment]    {id, createdAt}
 * @param {?string}  [p.prevAssessmentId]
 * @param {?string}  [p.nextAssessmentId]
 */
export function mountNavHeader({
  container,
  crumbs = [],
  backHref = null,
  backLabel = 'Back',
  patient = null,
  assessment = null,
  prevAssessmentId = null,
  nextAssessmentId = null,
} = {}) {
  if (!container) return;
  const patientId = patient?.id || null;
  const hasActionsRow = !!backHref || !!assessment;

  const html = [
    renderBreadcrumb(crumbs),
    hasActionsRow
      ? `<div class="nav-actions">${renderBack(backHref, backLabel)}${renderAssessmentNav({
          assessment,
          prevAssessmentId,
          nextAssessmentId,
          patientId,
        })}</div>`
      : '',
    renderPatientChip(patient),
  ].filter(Boolean).join('');

  container.innerHTML = html;
  container.classList.add('nav-header');
  container.classList.toggle('nav-header--with-chip', !!patient);
}

/**
 * Pure helper — given a list of assessments and the current assessment id,
 * return `{prev, next}` neighbour ids in **chronological** order.
 *
 * "prev" = older than current (earlier createdAt).
 * "next" = newer than current (later createdAt).
 *
 * Returns `{prev:null, next:null}` if the list is empty, undefined, or
 * the current id is not found — callers hide the chips in those cases.
 */
export function resolveAssessmentNeighbours(assessments, currentId) {
  if (!Array.isArray(assessments) || !currentId) {
    return { prev: null, next: null };
  }
  const sorted = assessments
    .filter((a) => a && a.id && a.createdAt)
    .slice()
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const idx = sorted.findIndex((a) => a.id === currentId);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0 ? sorted[idx - 1].id : null,
    next: idx < sorted.length - 1 ? sorted[idx + 1].id : null,
  };
}
