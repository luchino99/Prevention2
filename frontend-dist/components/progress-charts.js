/**
 * Uelfy Clinical — longitudinal progress chart component.
 * ---------------------------------------------------------------------------
 * Pure presentational ES module. Zero I/O, zero third-party imports, zero
 * framework. Pages hand in a hydrated `trends` object (same shape as
 * `GET /api/v1/patients/:id/trends`) and this module renders a suite of
 * per-domain enhanced sparkline cards:
 *
 *   ┌ Cardiovascular ───────────────────────────────────────────────┐
 *   │ [SCORE2 card]   [SCORE2-Diabetes card]                        │
 *   └───────────────────────────────────────────────────────────────┘
 *   ┌ Metabolic ─── Renal ─── Hepatic ─── Lifestyle ─── Composite ──┘
 *
 * Each card shows:
 *   - Latest value + unit + tier badge (current threshold band)
 *   - Delta vs previous assessment (colour derived from threshold.direction)
 *   - SVG plot with:
 *       · Threshold band shading (published cutoffs — display-only)
 *       · Y-axis min / max tick labels
 *       · Dashed threshold reference lines within the y-range
 *       · Line path with domain-specific stroke colour
 *       · Data-point dots — each carries a native SVG <title> tooltip
 *         ("YYYY-MM-DD — value unit"). Native tooltips are keyboard-
 *         accessible, print-friendly and require no JS, so this works
 *         under strict CSP and even with JS disabled post-render.
 *   - Date range footer (first → last point · N pts)
 *   - Threshold legend pills with guideline citation
 *
 * Security:
 *   - All interpolated text is HTML-escaped before touching innerHTML.
 *   - Threshold data is frozen at import time; callers cannot mutate it.
 *   - No inline event handlers, no arbitrary string injection into
 *     attributes (numbers are `.toFixed`'d; strings are escaped).
 *
 * Protected logic discipline:
 *   The component NEVER computes clinical values. All numeric data flows
 *   from the trends endpoint unchanged. Threshold bands are visual
 *   context only.
 * ---------------------------------------------------------------------------
 */

import { getThreshold } from './progress-thresholds.js';

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

function fmt(v, digits = 1) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  if (digits === 0) return String(Math.round(v));
  return v.toFixed(digits);
}

function shortDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString(undefined, {
      year: '2-digit',
      month: 'short',
      day: '2-digit',
    });
  } catch {
    return String(iso);
  }
}

/**
 * Pick the tier the latest value falls into. Tier boundaries are
 * `[prev, max)` — a value equal to `max` falls into the next tier.
 */
function tierForValue(threshold, value) {
  if (!threshold?.tiers?.length || typeof value !== 'number') return null;
  for (const t of threshold.tiers) {
    if (t.max == null || value < t.max) return t;
  }
  return threshold.tiers[threshold.tiers.length - 1];
}

/**
 * Compute a y-domain that shows the data clearly AND, when possible,
 * the nearest reference threshold above and below the data range.
 *
 * Rationale:
 *   The clinical point of the threshold bands is to let a clinician
 *   see, at a glance, how close the patient is to the next tier.
 *   A purely data-scaled axis can hide the nearest cutoff entirely —
 *   e.g. a stable eGFR in the 68–72 range would never show the G3
 *   cutoff at 60. We therefore always try to include the nearest
 *   cutoff on each side, but cap the axis expansion at 2× the data
 *   range so a faraway cutoff cannot squash a small but clinically
 *   relevant change in the data.
 */
function computeYDomain(points, threshold) {
  const values = points.map((p) => p.value).filter(Number.isFinite);
  if (values.length === 0) return { yMin: 0, yMax: 1 };
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    // Synthetic band so a single data point still renders legibly.
    const base = Math.abs(min) || 1;
    min -= base * 0.1;
    max += base * 0.1;
  }

  if (threshold?.tiers?.length) {
    const cutoffs = threshold.tiers
      .map((t) => t.max)
      .filter((v) => typeof v === 'number');
    const dataRange = max - min;
    const cap = Math.max(dataRange * 2, dataRange + 1);

    // Nearest cutoff strictly below current min.
    const below = cutoffs
      .filter((c) => c < min)
      .sort((a, b) => b - a)[0];
    if (below !== undefined && (min - below) <= cap) {
      min = below;
    }

    // Nearest cutoff strictly above current max.
    const above = cutoffs
      .filter((c) => c > max)
      .sort((a, b) => a - b)[0];
    if (above !== undefined && (above - max) <= cap) {
      max = above;
    }
  }

  const pad = (max - min) * 0.12 || 1;
  return { yMin: min - pad, yMax: max + pad };
}

// ---------------------------------------------------------------------------
// SVG primitives
// ---------------------------------------------------------------------------

const CHART = {
  width: 260,
  height: 96,
  plot: { x: 40, y: 12, w: 208, h: 66 },
};

function renderBands(threshold, yForValue, plot) {
  if (!threshold?.tiers?.length) return '';
  // Bottom-up rectangles — each tier covers [prev, max).
  const rects = [];
  let prev = -Infinity;
  for (const t of threshold.tiers) {
    const top = t.max == null ? Infinity : t.max;
    rects.push({ lo: prev, hi: top, band: t.band });
    prev = top;
  }
  return rects.map((r) => {
    const lo = r.lo === -Infinity ? (plot.y + plot.h) : yForValue(r.lo);
    const hi = r.hi === Infinity  ? plot.y            : yForValue(r.hi);
    const y = Math.min(lo, hi);
    const h = Math.abs(hi - lo);
    if (!Number.isFinite(y) || h <= 0) return '';
    return `<rect class="chart-band chart-band--${escape(r.band)}"
      x="${plot.x}" y="${y.toFixed(2)}" width="${plot.w}" height="${h.toFixed(2)}"></rect>`;
  }).join('');
}

function renderAxis(threshold, yForValue, plot, yMin, yMax, digits) {
  // Subtle axis line at left of plot.
  let out = `<line class="chart-axis" x1="${plot.x}" x2="${plot.x}" y1="${plot.y}" y2="${plot.y + plot.h}"></line>`;

  // Min / max y-axis labels.
  out += `<text class="chart-axis-label" x="${plot.x - 4}" y="${yForValue(yMax).toFixed(2)}" text-anchor="end" dominant-baseline="middle">${escape(fmt(yMax, digits))}</text>`;
  out += `<text class="chart-axis-label" x="${plot.x - 4}" y="${yForValue(yMin).toFixed(2)}" text-anchor="end" dominant-baseline="middle">${escape(fmt(yMin, digits))}</text>`;

  // Dashed threshold reference lines, labelled on the right edge.
  if (threshold?.tiers?.length) {
    threshold.tiers.forEach((t) => {
      if (t.max == null) return;
      if (t.max < yMin || t.max > yMax) return;
      const y = yForValue(t.max).toFixed(2);
      out += `<line class="chart-threshold-line" x1="${plot.x}" x2="${plot.x + plot.w}" y1="${y}" y2="${y}"></line>`;
      out += `<text class="chart-threshold-tick" x="${plot.x + plot.w + 2}" y="${y}" dominant-baseline="middle">${escape(fmt(t.max, digits))}</text>`;
    });
  }
  return out;
}

function renderPathAndDots(points, xForIndex, yForValue, strokeVar, digits, unit) {
  if (points.length === 0) return '';
  const d = points.map((p, i) => {
    const x = xForIndex(i).toFixed(2);
    const y = yForValue(p.value).toFixed(2);
    return `${i === 0 ? 'M' : 'L'}${x},${y}`;
  }).join(' ');

  const path = `<path class="chart-path" d="${d}" fill="none" stroke="${strokeVar}"></path>`;

  const dots = points.map((p, i) => {
    const isLast = i === points.length - 1;
    const cx = xForIndex(i).toFixed(2);
    const cy = yForValue(p.value).toFixed(2);
    const r = isLast ? 3.5 : 2.2;
    const tooltip = `${shortDate(p.date)} — ${fmt(p.value, digits)}${unit ? ' ' + unit : ''}`;
    return `<g class="chart-dot${isLast ? ' chart-dot--last' : ''}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${strokeVar}"></circle>
      <title>${escape(tooltip)}</title>
    </g>`;
  }).join('');

  return path + dots;
}

function renderChartSvg({ points, threshold, domainKey, digits, unit, titleForAria }) {
  const { width, height, plot } = CHART;
  if (!Array.isArray(points) || points.length === 0) {
    return `
      <svg class="chart-svg chart-svg--empty" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(titleForAria + ' — no data')}">
        <text x="${width / 2}" y="${height / 2 + 4}" text-anchor="middle" class="chart-empty-label">no data yet</text>
      </svg>`;
  }

  const { yMin, yMax } = computeYDomain(points, threshold);
  const range = yMax - yMin || 1;
  const xForIndex = points.length === 1
    ? () => plot.x + plot.w / 2
    : (i) => plot.x + (i / (points.length - 1)) * plot.w;
  const yForValue = (v) => plot.y + plot.h - ((v - yMin) / range) * plot.h;

  const bands = renderBands(threshold, yForValue, plot);
  const axis  = renderAxis(threshold, yForValue, plot, yMin, yMax, digits);
  const stroke = `var(--c-domain-${domainKey}, var(--c-primary))`;
  const line  = renderPathAndDots(points, xForIndex, yForValue, stroke, digits, unit);

  return `
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img"
         aria-label="${escape(titleForAria + ' — longitudinal trend')}">
      ${bands}
      ${axis}
      ${line}
    </svg>`;
}

// ---------------------------------------------------------------------------
// Card + group renderers
// ---------------------------------------------------------------------------

function deltaClassFor(delta, threshold) {
  if (delta === null || delta === 0) return 'chart-delta chart-delta--neutral';
  if (!threshold) return 'chart-delta chart-delta--neutral';
  const favourable = threshold.direction === 'higher-is-worse'
    ? delta < 0
    : delta > 0;
  return favourable
    ? 'chart-delta chart-delta--ok'
    : 'chart-delta chart-delta--warn';
}

function renderThresholdLegend(threshold) {
  if (!threshold?.tiers?.length) return '';
  const pills = threshold.tiers.map((t, i) => {
    const prev = i === 0 ? null : threshold.tiers[i - 1].max;
    let range;
    if (prev === null && t.max !== null) range = `< ${t.max}`;
    else if (prev !== null && t.max === null) range = `≥ ${prev}`;
    else range = `${prev}–${t.max}`;
    return `<span class="chart-legend-pill chart-legend-pill--${escape(t.band)}">
      <span class="chart-legend-pill__range">${escape(range)}</span>
      <span class="chart-legend-pill__label">${escape(t.label)}</span>
    </span>`;
  }).join('');
  const note = threshold.note
    ? `<div class="chart-legend-note">${escape(threshold.note)}</div>`
    : '';
  return `
    <div class="chart-legend" aria-label="Reference threshold bands">
      <div class="chart-legend-pills">${pills}</div>
      <div class="chart-legend-source">Ref: ${escape(threshold.source)}</div>
      ${note}
    </div>`;
}

function renderCard({ title, unit, points, thresholdKey, digits = 1, domainKey }) {
  const threshold = getThreshold(thresholdKey);
  const pts = Array.isArray(points) ? points : [];
  const n = pts.length;
  const latest = n > 0 ? pts[n - 1].value : null;
  const prev   = n > 1 ? pts[n - 2].value : null;
  const delta  = (latest !== null && prev !== null) ? latest - prev : null;

  const tier = tierForValue(threshold, latest);
  const tierBadge = tier
    ? `<span class="chart-tier chart-tier--${escape(tier.band)}">${escape(tier.label)}</span>`
    : '';

  const deltaSign = delta !== null && delta > 0 ? '+' : '';
  const deltaBlock = delta !== null
    ? `<div class="chart-card__delta">
         <span class="${deltaClassFor(delta, threshold)}">${escape(deltaSign + fmt(delta, digits))}</span>
         <span class="chart-card__delta-label">vs prev</span>
       </div>`
    : '';

  const dateLeft  = n > 0 ? shortDate(pts[0].date) : '';
  const dateRight = n > 1 ? shortDate(pts[n - 1].date) : '';
  const dateRange = [
    dateLeft,
    n > 1 ? `→ ${dateRight}` : '',
  ].filter(Boolean).join(' ');

  const latestHtml = n > 0
    ? `<span class="chart-card__latest">${escape(fmt(latest, digits))}</span>`
    : `<span class="chart-card__latest muted">—</span>`;

  const unitHtml = unit
    ? `<span class="chart-card__unit">${escape(unit)}</span>`
    : '';

  return `
    <article class="chart-card" data-domain="${escape(domainKey)}">
      <header class="chart-card__header">
        <div class="chart-card__title">
          <span class="kpi-label">${escape(title)}</span>
          <div class="chart-card__value-row">
            ${latestHtml}
            ${unitHtml}
            ${tierBadge}
          </div>
        </div>
        ${deltaBlock}
      </header>
      <div class="chart-card__plot">
        ${renderChartSvg({
          points: pts,
          threshold,
          domainKey,
          digits,
          unit: unit || '',
          titleForAria: title,
        })}
      </div>
      <footer class="chart-card__footer">
        <span class="chart-card__daterange muted">${escape(dateRange || '—')}</span>
        ${n > 0 ? `<span class="chart-card__count muted">${n} pt${n === 1 ? '' : 's'}</span>` : ''}
      </footer>
      ${renderThresholdLegend(threshold)}
    </article>`;
}

function renderGroup(heading, domainKey, entries) {
  const visible = entries.filter((e) => Array.isArray(e.points));
  if (visible.length === 0) return '';
  return `
    <section class="chart-group" data-domain="${escape(domainKey)}">
      <header class="chart-group__header">
        <h4 class="chart-group__title">${escape(heading)}</h4>
      </header>
      <div class="chart-group__grid">
        ${visible.map((e) => renderCard({ ...e, domainKey })).join('')}
      </div>
    </section>`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render the full longitudinal progress section.
 *
 * @param {Object}  p
 * @param {Element} p.container   Required. The element to render into.
 * @param {?Object} p.trends      Response from `api.getPatientTrends(patientId)`.
 *                                Shape: { timeline: [...], series: {...} }.
 *                                Null / empty values render an empty-state message.
 * @returns {{assessmentCount: number}}   Basic stats for callers that want
 *                                        to populate a subline (e.g.
 *                                        "4 assessments plotted").
 */
export function mountProgressCharts({ container, trends }) {
  if (!container) return { assessmentCount: 0 };
  const s = trends?.series ?? {};
  const tl = Array.isArray(trends?.timeline) ? trends.timeline : [];
  if (tl.length === 0) {
    container.innerHTML = `
      <p class="muted">No completed assessments yet — progress charts will
      populate after the first assessment is recorded.</p>`;
    return { assessmentCount: 0 };
  }

  const html = [
    renderGroup('Cardiovascular', 'cardiovascular', [
      { title: 'SCORE2',          unit: '% 10-yr', points: s.cardiovascular?.score2,          thresholdKey: 'score2',         digits: 1 },
      { title: 'SCORE2-Diabetes', unit: '% 10-yr', points: s.cardiovascular?.score2Diabetes,  thresholdKey: 'score2Diabetes', digits: 1 },
    ]),
    renderGroup('Metabolic', 'metabolic', [
      { title: 'HbA1c',              unit: '%',        points: s.metabolic?.hba1c,             thresholdKey: 'hba1c',             digits: 1 },
      { title: 'Fasting glucose',    unit: 'mg/dL',    points: s.metabolic?.glucose,           thresholdKey: 'glucose',           digits: 0 },
      { title: 'Metabolic syndrome', unit: 'criteria', points: s.metabolic?.metabolicSyndrome, thresholdKey: 'metabolicSyndrome', digits: 0 },
    ]),
    renderGroup('Renal', 'renal', [
      { title: 'eGFR', unit: 'mL/min/1.73m²', points: s.renal?.egfr, thresholdKey: 'egfr', digits: 1 },
      { title: 'ACR',  unit: 'mg/g',          points: s.renal?.acr,  thresholdKey: 'acr',  digits: 1 },
    ]),
    renderGroup('Hepatic', 'hepatic', [
      { title: 'FIB-4', unit: '', points: s.hepatic?.fib4, thresholdKey: 'fib4', digits: 2 },
      { title: 'FLI',   unit: '', points: s.hepatic?.fli,  thresholdKey: 'fli',  digits: 0 },
    ]),
    renderGroup('Lifestyle', 'lifestyle', [
      { title: 'PREDIMED',     unit: '/14',        points: s.lifestyle?.predimed,          thresholdKey: 'predimed',          digits: 0 },
      { title: 'MET-min/week', unit: 'MET-min/wk', points: s.lifestyle?.metMinutesPerWeek, thresholdKey: 'metMinutesPerWeek', digits: 0 },
    ]),
    renderGroup('Composite', 'composite', [
      { title: 'Composite score', unit: '', points: s.composite?.composite, thresholdKey: null, digits: 2 },
    ]),
  ].filter(Boolean).join('');

  container.innerHTML = html || `<p class="muted">No numeric series available for the current assessments.</p>`;
  return { assessmentCount: tl.length };
}
