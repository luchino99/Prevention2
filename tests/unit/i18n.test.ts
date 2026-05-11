/**
 * tests/unit/i18n.test.ts
 *
 * Sprint 8 task 8.1 — unit tests for the dependency-free i18n helper
 * shipped at `frontend/i18n/index.js`.
 *
 * What this file does NOT do
 * --------------------------
 * It does NOT load jsdom (kept out of devDependencies — we don't want
 * to add a 25 MB dep just to test a tiny helper). DOM mutation
 * (`applyI18n`) is exercised via a hand-rolled fake-DOM that implements
 * the bare minimum surface the helper touches: `querySelectorAll`,
 * `getAttribute`, `setAttribute`, `textContent`, `innerHTML`. This
 * keeps the test fast (vitest node environment) and the assertions
 * extremely explicit about which DOM hooks the helper depends on —
 * any future refactor that breaks the contract surfaces immediately.
 */
import { describe, it, expect, beforeEach } from 'vitest';

// @ts-expect-error — JS module import in TS test
import {
  t,
  lookupKey,
  interpolate,
  applyI18n,
  getCurrentLocale,
  setLocale,
} from '../../frontend/i18n/index.js';
// @ts-expect-error — JS module import in TS test
import { translations as itTranslations } from '../../frontend/i18n/it.js';

// ─────────────────────────────────────────────────────────────────────
// Helpers — fake DOM that satisfies the contract used by applyI18n.
// ─────────────────────────────────────────────────────────────────────

interface FakeAttrs {
  [name: string]: string;
}

class FakeElement {
  private attrs: FakeAttrs;
  public textContent: string = '';
  public innerHTML: string = '';

  constructor(attrs: FakeAttrs) {
    this.attrs = { ...attrs };
  }
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }
}

class FakeRoot {
  private byKey: Map<string, FakeElement[]>;
  constructor(opts: {
    text?: FakeElement[];
    attr?: FakeElement[];
    html?: FakeElement[];
  }) {
    this.byKey = new Map([
      ['data-i18n', opts.text ?? []],
      ['data-i18n-attr', opts.attr ?? []],
      ['data-i18n-html', opts.html ?? []],
    ]);
  }
  querySelectorAll(selector: string): FakeElement[] {
    // Selector form: `[data-i18n]`, `[data-i18n-attr]`, `[data-i18n-html]`
    const m = selector.match(/^\[([\w-]+)\]$/);
    if (!m) return [];
    return this.byKey.get(m[1]) ?? [];
  }
}

// ─────────────────────────────────────────────────────────────────────
// lookupKey — dot-notation walker
// ─────────────────────────────────────────────────────────────────────

describe('i18n / lookupKey', () => {
  const dict = {
    common: { cancel: 'Annulla' },
    nested: { a: { b: { c: 'Deep' } } },
    notAString: { still: { object: { here: true } } },
  };

  it('returns the string at a flat key', () => {
    expect(lookupKey('common.cancel', dict)).toBe('Annulla');
  });

  it('returns the string at a deeply-nested key', () => {
    expect(lookupKey('nested.a.b.c', dict)).toBe('Deep');
  });

  it('returns undefined for a missing leaf', () => {
    expect(lookupKey('common.nope', dict)).toBeUndefined();
  });

  it('returns undefined when an intermediate segment is missing', () => {
    expect(lookupKey('does.not.exist', dict)).toBeUndefined();
  });

  it('returns undefined when the terminal value is not a string', () => {
    // notAString.still.object → an object, not a string. Caller must
    // never receive an object pretending to be a translation.
    expect(lookupKey('notAString.still.object', dict)).toBeUndefined();
  });

  it('handles empty / null key gracefully', () => {
    expect(lookupKey('', dict)).toBeUndefined();
    expect(lookupKey('common', dict)).toBeUndefined(); // object, not string
  });

  it('handles null / non-object dict gracefully', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(lookupKey('a.b', null as any)).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(lookupKey('a.b', 'oops' as any)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// interpolate — {param} substitution
// ─────────────────────────────────────────────────────────────────────

describe('i18n / interpolate', () => {
  it('returns the template unchanged when no params are passed', () => {
    expect(interpolate('Hello world', undefined)).toBe('Hello world');
  });

  it('substitutes a single {param}', () => {
    expect(interpolate('Hai {count} alert', { count: 3 })).toBe('Hai 3 alert');
  });

  it('substitutes multiple params', () => {
    expect(interpolate('{a} e {b}', { a: 'uno', b: 'due' })).toBe('uno e due');
  });

  it('coerces non-string values via String(v)', () => {
    expect(interpolate('n={n}', { n: 7 })).toBe('n=7');
    expect(interpolate('v={v}', { v: true })).toBe('v=true');
    expect(interpolate('v={v}', { v: null })).toBe('v=null');
  });

  it('leaves unknown placeholders in-place (visible bug)', () => {
    expect(interpolate('Ciao {nome}!', { other: 'x' })).toBe('Ciao {nome}!');
  });

  it('does not substitute partial matches', () => {
    expect(interpolate('{notAPlaceholder', { notAPlaceholder: 'x' })).toBe(
      '{notAPlaceholder',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// t — primary public API
// ─────────────────────────────────────────────────────────────────────

describe('i18n / t', () => {
  beforeEach(() => {
    // Reset to the canonical it-IT dictionary before each test.
    setLocale('it-IT', itTranslations);
  });

  it('translates a known key from it.js', () => {
    expect(t('common.cancel')).toBe('Annulla');
  });

  it('translates a nested key', () => {
    expect(t('login.title')).toBe('Uelfy Clinical');
  });

  it('interpolates params', () => {
    // dashboard.welcome contains "{nome}"
    expect(t('dashboard.welcome', { nome: 'Luca' })).toBe('Buongiorno, Luca');
  });

  it('falls back to the key itself when missing', () => {
    expect(t('nope.does.not.exist')).toBe('nope.does.not.exist');
  });

  it('keeps the fallback contract for adjacent missing keys', () => {
    // Two missing keys both fall back. We don't assert on console.warn
    // here — that's a logging detail. Behaviour contract is the return.
    expect(t('foo.bar')).toBe('foo.bar');
    expect(t('foo.baz')).toBe('foo.baz');
  });

  it('reports getCurrentLocale correctly', () => {
    expect(getCurrentLocale()).toBe('it-IT');
  });
});

// ─────────────────────────────────────────────────────────────────────
// applyI18n — DOM application via attribute conventions
// ─────────────────────────────────────────────────────────────────────

describe('i18n / applyI18n', () => {
  beforeEach(() => {
    setLocale('it-IT', itTranslations);
  });

  it('sets textContent for elements with data-i18n', () => {
    const el = new FakeElement({ 'data-i18n': 'common.cancel' });
    const root = new FakeRoot({ text: [el] });
    // Cast to a permissive type because the fake root mimics the
    // ParentNode contract only loosely.
    const counts = applyI18n(root as unknown as ParentNode);
    expect(el.textContent).toBe('Annulla');
    expect(counts.text).toBe(1);
    expect(counts.attr).toBe(0);
    expect(counts.html).toBe(0);
  });

  it('sets multiple attributes for data-i18n-attr (comma-separated pairs)', () => {
    const el = new FakeElement({
      'data-i18n-attr': 'placeholder:patients.search_placeholder,aria-label:patients.search_placeholder',
    });
    const root = new FakeRoot({ attr: [el] });
    const counts = applyI18n(root as unknown as ParentNode);
    expect(el.getAttribute('placeholder')).toBe(
      'Cerca per cognome, codice paziente…',
    );
    expect(el.getAttribute('aria-label')).toBe(
      'Cerca per cognome, codice paziente…',
    );
    expect(counts.attr).toBe(2);
  });

  it('sets innerHTML for data-i18n-html (trusted dictionary)', () => {
    const el = new FakeElement({ 'data-i18n-html': 'common.skip_to_content' });
    const root = new FakeRoot({ html: [el] });
    applyI18n(root as unknown as ParentNode);
    expect(el.innerHTML).toBe('Vai al contenuto principale');
  });

  it('falls back to the key for missing translations (visible bug)', () => {
    const el = new FakeElement({ 'data-i18n': 'does.not.exist' });
    const root = new FakeRoot({ text: [el] });
    applyI18n(root as unknown as ParentNode);
    expect(el.textContent).toBe('does.not.exist');
  });

  it('returns zero counts on a root with no i18n-attributed elements', () => {
    const root = new FakeRoot({});
    const counts = applyI18n(root as unknown as ParentNode);
    expect(counts).toEqual({ text: 0, attr: 0, html: 0 });
  });

  it('returns zero counts on a null root and no global document', () => {
    // Node test environment has no `document`. Pass null explicitly to
    // exercise the early-return path without depending on env.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const counts = applyI18n(null as any);
    expect(counts).toEqual({ text: 0, attr: 0, html: 0 });
  });

  it('skips malformed data-i18n-attr pairs', () => {
    const el = new FakeElement({
      // "missing-colon-key" has no colon → skip; valid pair after it is applied.
      'data-i18n-attr': 'malformed,title:common.save',
    });
    const root = new FakeRoot({ attr: [el] });
    const counts = applyI18n(root as unknown as ParentNode);
    expect(el.getAttribute('title')).toBe('Salva');
    expect(counts.attr).toBe(1);
  });
});
