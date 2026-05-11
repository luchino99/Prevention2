/**
 * i18n/index.js — runtime internationalisation helper for Uelfy Clinical.
 *
 * Sprint 8 task 8.1
 * ---------------------------------------------------------------------------
 * Vanilla-JS, dependency-free dictionary lookup. Designed for a small B2B
 * clinical app (5-10 medici privati target) where adding a framework just
 * for i18n would be over-engineered.
 *
 * Design choices
 * ==============
 *   * Single hardcoded locale (it-IT) for now. The plumbing supports
 *     multi-locale (Map of locale -> dictionary, setLocale(), getCurrentLocale())
 *     but the launch scope is Italian-only — every test/translation pair
 *     lives in `frontend/i18n/it.js`. When inglese serves, add an `en.js`
 *     and flip the active locale; no refactor needed.
 *
 *   * Dot-notation keys for nested lookup: `t('login.submit')` walks
 *     `dictionary.login.submit`. Missing keys log a single dev-mode warning
 *     and fall back to the key itself (so "login.submit" appears in UI —
 *     ugly, but the bug is immediately visible without breaking the page).
 *
 *   * `{param}` interpolation: `t('alerts.title', { count: 3 })` replaces
 *     `{count}` in "Hai {count} alert" → "Hai 3 alert". No advanced
 *     ICU / pluralisation logic; pluralised strings are pre-resolved by
 *     calling sites (e.g. choose between `alerts.title_one` /
 *     `alerts.title_other` via a small helper).
 *
 *   * DOM application via attribute conventions:
 *       <h1 data-i18n="login.title">Sign in</h1>
 *           → element.textContent = t('login.title')
 *       <input data-i18n-attr="placeholder:login.email,aria-label:login.email">
 *           → element.setAttribute('placeholder', t('login.email'))
 *           → element.setAttribute('aria-label',  t('login.email'))
 *       <p data-i18n-html="legal.intro_html">…</p>
 *           → element.innerHTML = t('legal.intro_html')
 *     The `_html` variant exists for legal copy that needs anchors / strong;
 *     CSP-safe because the dictionary is shipped as code, not user input.
 *
 * Bundle budget
 * =============
 *   index.js + it.js together aim for < 25 KB raw / ~6 KB gzipped. Tracked
 *   in scripts/check-bundle-budget.mjs after Sprint 8 task 8.1.
 *
 * CSP
 * ===
 *   No eval / Function / new Function. Static lookup only. Compatible with
 *   the strict `script-src 'self'; script-src-attr 'none'` policy in
 *   vercel.json.
 */

import { translations as itTranslations } from './it.js';

/**
 * Active dictionary. Single-locale at the moment; a future setLocale()
 * helper would swap this reference at runtime (cheap — module-level
 * variable, all `t()` calls re-read it).
 */
let activeDictionary = itTranslations;
let activeLocale = 'it-IT';

/**
 * Track which missing keys we've already warned about, so a missing key
 * inside a loop (e.g. a 100-row table) doesn't flood the console.
 */
const warnedMissing = new Set();

/**
 * Walk a dictionary by dot-notation key.
 *
 * Returns the matched string, OR undefined when:
 *   * an intermediate segment is missing,
 *   * the terminal value is not a string (object / array / null).
 *
 * Exported for unit testing — production callers should use `t()`.
 *
 * @param {string} key  e.g. 'login.submit' or 'patients.empty.body'
 * @param {object} dict
 * @returns {string|undefined}
 */
export function lookupKey(key, dict) {
  if (typeof key !== 'string' || key.length === 0) return undefined;
  if (!dict || typeof dict !== 'object') return undefined;
  let cursor = dict;
  for (const segment of key.split('.')) {
    if (cursor == null || typeof cursor !== 'object') return undefined;
    cursor = cursor[segment];
  }
  return typeof cursor === 'string' ? cursor : undefined;
}

/**
 * Interpolate {param} placeholders in a template string.
 *
 * Exported for unit testing.
 *
 *   interpolate('Hai {count} alert', { count: 3 })  →  'Hai 3 alert'
 *   interpolate('Ciao {nome}', { nome: 'Luca' })    →  'Ciao Luca'
 *
 * Unknown placeholders are left in-place (visible bug → fast feedback).
 * Values are coerced to string via `String(v)`.
 *
 * @param {string} template
 * @param {Record<string, unknown>} params
 * @returns {string}
 */
export function interpolate(template, params) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    if (Object.prototype.hasOwnProperty.call(params, name)) {
      return String(params[name]);
    }
    return match;
  });
}

/**
 * Translate a key to its localized string.
 *
 *   t('login.submit')                       → 'Accedi'
 *   t('alerts.title', { count: 3 })         → 'Hai 3 alert'
 *   t('does.not.exist')                     → 'does.not.exist' (+ console.warn once)
 *
 * @param {string} key
 * @param {Record<string, unknown>} [params]
 * @returns {string}
 */
export function t(key, params) {
  const raw = lookupKey(key, activeDictionary);
  if (raw === undefined) {
    if (!warnedMissing.has(key)) {
      warnedMissing.add(key);
      // Single warn per missing key per page load. Surfaces a missing
      // translation immediately without flooding logs.
      // eslint-disable-next-line no-console
      console.warn(`[i18n] missing key "${key}" in locale "${activeLocale}"`);
    }
    return key;
  }
  return interpolate(raw, params);
}

/**
 * Return the active locale string (e.g. 'it-IT'). Useful for
 * `<html lang>` synchronisation and for Intl.DateTimeFormat calls.
 *
 * @returns {string}
 */
export function getCurrentLocale() {
  return activeLocale;
}

/**
 * Switch active locale. No-op stub today (it-IT only); kept exported
 * so callers can be written future-proof and Sprint 8 doesn't need
 * to be revisited when English is added.
 *
 * @param {string} locale
 * @param {object} dictionary
 */
export function setLocale(locale, dictionary) {
  activeLocale = locale;
  activeDictionary = dictionary;
  warnedMissing.clear();
  setHtmlLang(locale);
}

/**
 * Set the <html lang="…"> attribute so screen readers / browsers know
 * the page language. Idempotent; safe to call multiple times.
 *
 * @param {string} [locale]  defaults to the active locale
 */
export function setHtmlLang(locale) {
  if (typeof document === 'undefined') return;
  const target = locale ?? activeLocale;
  if (document.documentElement && document.documentElement.lang !== target) {
    document.documentElement.lang = target;
  }
}

/**
 * Apply translations to every `data-i18n*` element under `root`.
 *
 *   * data-i18n="key"            → element.textContent = t(key)
 *   * data-i18n-attr="a:k,b:k"   → element.setAttribute(a, t(k)) + setAttribute(b, t(k))
 *   * data-i18n-html="key"       → element.innerHTML = t(key)   (trusted dictionary only)
 *
 * Returns the number of elements processed (per category) — useful for
 * sanity logging at boot time, e.g. `console.debug('[i18n]', applyI18n(...))`.
 *
 * SAFE: textContent and setAttribute do not execute markup. innerHTML
 * is reserved for the legal-copy keys whose values WE author in `it.js`;
 * we never pass user input through this path.
 *
 * @param {ParentNode|Document} [root]  defaults to `document`
 * @returns {{text:number, attr:number, html:number}}
 */
export function applyI18n(root) {
  // Default to the global document when present; otherwise no-op.
  // Allows unit tests to pass a fake-DOM root without jsdom.
  const target =
    root ??
    (typeof document !== 'undefined' ? document : null);
  if (!target || typeof target.querySelectorAll !== 'function') {
    return { text: 0, attr: 0, html: 0 };
  }

  let text = 0;
  let attr = 0;
  let html = 0;

  for (const el of target.querySelectorAll('[data-i18n]')) {
    const key = el.getAttribute('data-i18n');
    if (key) {
      el.textContent = t(key);
      text += 1;
    }
  }

  for (const el of target.querySelectorAll('[data-i18n-attr]')) {
    const spec = el.getAttribute('data-i18n-attr');
    if (!spec) continue;
    for (const pair of spec.split(',')) {
      const idx = pair.indexOf(':');
      if (idx < 0) continue;
      const attrName = pair.slice(0, idx).trim();
      const key = pair.slice(idx + 1).trim();
      if (attrName && key) {
        el.setAttribute(attrName, t(key));
        attr += 1;
      }
    }
  }

  for (const el of target.querySelectorAll('[data-i18n-html]')) {
    const key = el.getAttribute('data-i18n-html');
    if (key) {
      el.innerHTML = t(key);
      html += 1;
    }
  }

  return { text, attr, html };
}

/**
 * Convenience: install on DOMContentLoaded. Pages can either call
 * `applyI18n()` directly in their existing init code, or rely on this
 * one-liner from the page's <script type="module">.
 */
export function bootstrapI18n() {
  if (typeof document === 'undefined') return;
  setHtmlLang();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => applyI18n(), { once: true });
  } else {
    applyI18n();
  }
}
