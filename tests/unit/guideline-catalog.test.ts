/**
 * Unit tests for the guideline rule catalog (WS5).
 *
 * Role
 *   The catalog replaces a scatter of inline `guidelineSource: '…'` strings
 *   in the clinical rule engines with a single registry of typed references.
 *   Because clinician-visible wording and any persisted `guidelineSource`
 *   rows depend on those strings being byte-identical to their pre-refactor
 *   values, these tests are written as behavioural invariants, not
 *   implementation snapshots.
 *
 * What this suite asserts
 *   1. Registry shape — every entry has the fields the engines rely on,
 *      ids are stable UPPER_SNAKE_CASE, no duplicated `displayString`.
 *   2. Public helpers — `guidelineSource`, `getGuideline`,
 *      `findGuidelineByDisplayString`, `listGuidelinesByFamily`,
 *      `evidenceLevelOf` behave consistently with the registry.
 *   3. Frozen wording — the full set of `displayString` values is pinned.
 *      Any accidental wording change will fail this test and force an
 *      explicit snapshot/fixture review (as required by the module's
 *      compatibility contract).
 *   4. No regression to inline citation strings — the engine source files
 *      must not re-introduce free-text `guidelineSource: '…'` literals;
 *      every citation flows through `GUIDELINES.<id>.displayString`.
 *
 * What this suite does NOT do
 *   - It does not validate the medical accuracy of the citations. That is
 *     a reviewer/clinical-lead concern.
 *   - It does not exercise the engines themselves. Engine wiring is
 *     covered by `clinical-engine.test.ts` and `score-equivalence.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GUIDELINES,
  collectReferenceFramework,
  evidenceLevelOf,
  findGuidelineByDisplayString,
  getGuideline,
  guidelineSource,
  listGuidelinesByFamily,
  resolvePublicGuidelineRef,
  toPublicGuidelineRef,
} from '../../backend/src/domain/clinical/guideline-catalog';
import type {
  GuidelineId,
} from '../../backend/src/domain/clinical/guideline-catalog/guideline-registry';
import type {
  ClinicalDomain,
  EvidenceLevel,
  GuidelineFamily,
  GuidelineReference,
} from '../../backend/src/domain/clinical/guideline-catalog/guideline-types';
import type { PublicGuidelineRef } from '../../shared/types/clinical';

// ────────────────────────────────────────────────────────────────────────────
// Fixtures / constants
// ────────────────────────────────────────────────────────────────────────────

const ALLOWED_FAMILIES = new Set<GuidelineFamily>([
  'ESC',
  'EASL',
  'ADA',
  'KDIGO',
  'WHO',
  'NCEP',
  'FRAIL',
  'PREDIMED',
  'ESC_ESH',
  'ESC_EAS',
  'INTERNAL',
]);

const ALLOWED_DOMAINS = new Set<ClinicalDomain>([
  'cardiovascular',
  'renal',
  'hepatic',
  'metabolic',
  'frailty',
  'lifestyle',
  'composite',
]);

const ALLOWED_EVIDENCE_LEVELS = new Set<EvidenceLevel>([
  'A',
  'B',
  'C',
  'consensus',
  'policy',
]);

/**
 * Frozen legacy wording. Every entry here MUST equal the pre-WS5 inline
 * `guidelineSource: '…'` string the engines used to emit. Changing any
 * value is a behavior-visible action: it alters persisted rows and the
 * clinician-facing PDF, and must be paired with a snapshot/fixture review.
 *
 * Adding a new catalog entry is allowed (the "ids covered" assertion
 * below uses the registry as the reference for expected count); adding
 * here without adding to the registry (or vice-versa) will fail the
 * round-trip assertion.
 */
const FROZEN_DISPLAY_STRINGS: ReadonlyArray<readonly [GuidelineId, string]> = [
  ['ADA_SOC', 'ADA Standards of Care'],
  ['ADA_SOC_2024_S2', 'ADA Standards of Care 2024 §2'],
  ['ADA_SOC_2024_S2_CLASSIFICATION', 'ADA Standards of Care 2024 §2 (Classification & Diagnosis)'],
  ['ADA_SOC_2024_S5', 'ADA Standards of Care 2024 §5'],
  ['ADA_SOC_2024_S6', 'ADA Standards of Care 2024 §6'],
  ['ADA_SOC_2024_S6_GLYCEMIC', 'ADA Standards of Care 2024 §6 (Glycemic Targets)'],
  ['ADA_SOC_2024_S11_KDIGO', 'ADA Standards of Care 2024 §11 + KDIGO 2024'],
  ['ADA_SOC_2024_S12', 'ADA Standards of Care 2024 §12'],
  ['EASL_2024_MASLD', 'EASL 2024 MASLD'],
  ['ESC_2021_PREVENTION', 'ESC 2021 CVD prevention'],
  ['ESC_2021_PREVENTION_S3', 'ESC 2021 CVD prevention §3'],
  ['ESC_2021_PREVENTION_S4', 'ESC 2021 CVD prevention §4'],
  ['ESC_2021_NCEP', 'ESC 2021 + NCEP ATP III'],
  ['ESC_2024_PAD', 'ESC 2024 PAD'],
  ['ESC_ESH_2023_HTN', 'ESC/ESH 2023 Hypertension'],
  ['ESC_EAS_2019_LIPIDS', 'ESC/EAS 2019 Dyslipidaemia'],
  ['FRAIL_SCALE_CONSENSUS', 'FRAIL scale consensus'],
  ['INTERNAL_CADENCE', 'Internal cadence policy'],
  ['KDIGO_2024_CKD', 'KDIGO 2024 CKD'],
  ['NCEP_ATP_III', 'NCEP ATP III'],
  ['PREDIMED_ESC_2021', 'Estruch et al. PREDIMED (NEJM 2018) + ESC 2021'],
  ['WHO_2020_ACTIVITY', 'WHO 2020 Physical Activity'],
];

// ────────────────────────────────────────────────────────────────────────────
// 1. Registry shape
// ────────────────────────────────────────────────────────────────────────────

describe('GUIDELINES registry — shape', () => {
  const entries = Object.entries(GUIDELINES) as Array<[GuidelineId, GuidelineReference]>;

  it('is non-empty', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('has every key in UPPER_SNAKE_CASE', () => {
    for (const [key] of entries) {
      expect(key).toMatch(/^[A-Z0-9][A-Z0-9_]*$/);
    }
  });

  it('has matching `id` field on every entry', () => {
    for (const [key, ref] of entries) {
      expect(ref.id).toBe(key);
    }
  });

  it('populates every required field with the expected type', () => {
    for (const [key, ref] of entries) {
      expect(typeof ref.shortLabel, `shortLabel of ${key}`).toBe('string');
      expect(ref.shortLabel.length, `shortLabel of ${key}`).toBeGreaterThan(0);

      expect(typeof ref.title, `title of ${key}`).toBe('string');
      expect(ref.title.length, `title of ${key}`).toBeGreaterThan(0);

      expect(typeof ref.displayString, `displayString of ${key}`).toBe('string');
      expect(ref.displayString.length, `displayString of ${key}`).toBeGreaterThan(0);

      expect(ref.year === null || typeof ref.year === 'number', `year of ${key}`).toBe(true);
      if (typeof ref.year === 'number') {
        expect(ref.year, `year of ${key}`).toBeGreaterThanOrEqual(1990);
        expect(ref.year, `year of ${key}`).toBeLessThanOrEqual(2100);
      }

      expect(ref.section === null || typeof ref.section === 'string', `section of ${key}`).toBe(true);
      expect(ref.url === null || typeof ref.url === 'string', `url of ${key}`).toBe(true);
      if (typeof ref.url === 'string') {
        expect(ref.url, `url of ${key}`).toMatch(/^https?:\/\//);
      }

      expect(Array.isArray(ref.families), `families of ${key}`).toBe(true);
      expect(ref.families.length, `families of ${key}`).toBeGreaterThan(0);
      for (const fam of ref.families) {
        expect(ALLOWED_FAMILIES.has(fam), `family ${fam} of ${key}`).toBe(true);
      }

      expect(Array.isArray(ref.domains), `domains of ${key}`).toBe(true);
      expect(ref.domains.length, `domains of ${key}`).toBeGreaterThan(0);
      for (const d of ref.domains) {
        expect(ALLOWED_DOMAINS.has(d), `domain ${d} of ${key}`).toBe(true);
      }

      expect(ALLOWED_EVIDENCE_LEVELS.has(ref.evidenceLevel), `evidenceLevel of ${key}`).toBe(true);
    }
  });

  it('has unique `displayString` values (no citation collisions)', () => {
    const counts = new Map<string, string[]>();
    for (const [key, ref] of entries) {
      const bucket = counts.get(ref.displayString) ?? [];
      bucket.push(key);
      counts.set(ref.displayString, bucket);
    }
    const duplicates = [...counts.entries()].filter(([, ids]) => ids.length > 1);
    expect(duplicates, 'displayString must be unique across the catalog').toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. Public helpers — contract
// ────────────────────────────────────────────────────────────────────────────

describe('catalog helpers', () => {
  const ids = Object.keys(GUIDELINES) as GuidelineId[];

  it('guidelineSource(id) returns the registered displayString', () => {
    for (const id of ids) {
      expect(guidelineSource(id)).toBe(GUIDELINES[id].displayString);
    }
  });

  it('getGuideline(id) returns the exact registry entry (reference-equal)', () => {
    for (const id of ids) {
      expect(getGuideline(id)).toBe(GUIDELINES[id]);
    }
  });

  it('findGuidelineByDisplayString(s) is a round-trip for every registered entry', () => {
    for (const id of ids) {
      const ref = GUIDELINES[id];
      const found = findGuidelineByDisplayString(ref.displayString);
      expect(found, `round-trip for ${id}`).toBe(ref);
    }
  });

  it('findGuidelineByDisplayString(s) returns null for unknown input', () => {
    expect(findGuidelineByDisplayString('')).toBeNull();
    expect(findGuidelineByDisplayString('NOT A REAL CITATION')).toBeNull();
    // Near-miss: existing label with trailing whitespace should not match.
    expect(findGuidelineByDisplayString('ESC 2021 CVD prevention ')).toBeNull();
  });

  it('evidenceLevelOf(id) mirrors the registry field', () => {
    for (const id of ids) {
      expect(evidenceLevelOf(id)).toBe(GUIDELINES[id].evidenceLevel);
    }
  });

  it('listGuidelinesByFamily returns only entries that include the family', () => {
    const esc = listGuidelinesByFamily(['ESC']);
    expect(esc.length).toBeGreaterThan(0);
    for (const ref of esc) {
      expect(ref.families).toContain('ESC');
    }

    const kdigo = listGuidelinesByFamily(['KDIGO']);
    expect(kdigo.length).toBeGreaterThan(0);
    for (const ref of kdigo) {
      expect(ref.families).toContain('KDIGO');
    }
  });

  it('listGuidelinesByFamily unions across families without duplicates', () => {
    const unionFamilies: GuidelineFamily[] = ['ESC', 'KDIGO'];
    const union = listGuidelinesByFamily(unionFamilies);
    const uniqueIds = new Set(union.map((r) => r.id));
    expect(uniqueIds.size).toBe(union.length);
    for (const ref of union) {
      expect(ref.families.some((f) => unionFamilies.includes(f))).toBe(true);
    }
  });

  it('listGuidelinesByFamily([]) returns an empty list', () => {
    expect(listGuidelinesByFamily([])).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. Frozen wording — behavioural invariant
//
// This is the hard safety net. If anyone changes the `displayString` of
// an existing catalog entry (or adds/removes an entry without updating
// `FROZEN_DISPLAY_STRINGS`), this test will fail and force an explicit
// review of persisted rows, PDF snapshots, and UI fixtures.
// ────────────────────────────────────────────────────────────────────────────

describe('GUIDELINES — frozen display strings', () => {
  it('every pinned (id, displayString) pair matches the registry', () => {
    for (const [id, expected] of FROZEN_DISPLAY_STRINGS) {
      const ref = GUIDELINES[id];
      expect(ref, `registry missing ${id}`).toBeDefined();
      expect(ref.displayString, `displayString drift on ${id}`).toBe(expected);
    }
  });

  it('the registry has exactly the pinned set of ids (no orphan additions)', () => {
    const pinned = new Set(FROZEN_DISPLAY_STRINGS.map(([id]) => id));
    const registry = new Set(Object.keys(GUIDELINES));
    const onlyInRegistry = [...registry].filter((id) => !pinned.has(id as GuidelineId));
    const onlyInPinned = [...pinned].filter((id) => !registry.has(id));
    expect(
      { onlyInRegistry, onlyInPinned },
      'FROZEN_DISPLAY_STRINGS must stay in sync with GUIDELINES',
    ).toEqual({ onlyInRegistry: [], onlyInPinned: [] });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. No regression: engine files must not re-introduce inline citation
//    strings. Every citation has to flow through
//    `GUIDELINES.<id>.displayString`.
// ────────────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const ENGINE_FILES: ReadonlyArray<string> = [
  'backend/src/domain/clinical/score-engine/index.ts',
  'backend/src/domain/clinical/followup-engine/followup-plan.ts',
  'backend/src/domain/clinical/screening-engine/required-screenings.ts',
  'backend/src/domain/clinical/lifestyle-recommendation-engine/lifestyle-recommendations.ts',
];

describe('engine sources — no inline guidelineSource literals', () => {
  it.each(ENGINE_FILES)('%s routes every citation through the catalog', (relPath) => {
    const abs = path.join(REPO_ROOT, relPath);
    const src = readFileSync(abs, 'utf8');

    // Match any `guidelineSource:` followed by a free-text string literal
    // (single or double quotes, backticks). Lines that reference the
    // catalog use `guidelineSource: GUIDELINES.<id>.displayString` and so
    // never match this pattern.
    const offenders = [...src.matchAll(/guidelineSource\s*:\s*(['"`])/g)];
    expect(
      offenders.map((m) => ({ index: m.index, snippet: src.slice(m.index ?? 0, (m.index ?? 0) + 80) })),
      `${relPath} must not hard-code citation strings`,
    ).toEqual([]);
  });

  it('every engine that cites guidelines imports the catalog', () => {
    for (const relPath of ENGINE_FILES) {
      const abs = path.join(REPO_ROOT, relPath);
      const src = readFileSync(abs, 'utf8');
      if (src.includes('guidelineSource')) {
        expect(src, `${relPath} cites guidelines but does not import GUIDELINES`).toMatch(
          /from\s+['"][^'"]*guideline-catalog[^'"]*['"]/,
        );
      }
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 5. WS6 resolver — server → wire projection
//
// The resolver is the sole choke point between the server-side catalog
// entry and the JSON-serialisable `PublicGuidelineRef` consumed by the
// frontend and PDF renderer. These tests lock its contract.
// ────────────────────────────────────────────────────────────────────────────

describe('toPublicGuidelineRef', () => {
  const sample: GuidelineId = 'ESC_2021_PREVENTION';

  it('projects every public field with matching values', () => {
    const src = GUIDELINES[sample];
    const pub = toPublicGuidelineRef(src);
    expect(pub.id).toBe(src.id);
    expect(pub.shortLabel).toBe(src.shortLabel);
    expect(pub.year).toBe(src.year);
    expect(pub.section).toBe(src.section);
    expect(pub.title).toBe(src.title);
    expect(pub.url).toBe(src.url);
    expect(pub.evidenceLevel).toBe(src.evidenceLevel);
    expect([...pub.families]).toEqual([...src.families]);
    expect([...pub.domains]).toEqual([...src.domains]);
  });

  it('returns a JSON-round-trippable object (no functions, no symbols)', () => {
    for (const id of Object.keys(GUIDELINES) as GuidelineId[]) {
      const pub = toPublicGuidelineRef(GUIDELINES[id]);
      const round = JSON.parse(JSON.stringify(pub)) as PublicGuidelineRef;
      expect(round).toEqual(pub);
    }
  });

  it('decouples `families` / `domains` arrays from the registry (no aliasing)', () => {
    const src = GUIDELINES[sample];
    const pub = toPublicGuidelineRef(src);
    expect(pub.families).not.toBe(src.families);
    expect(pub.domains).not.toBe(src.domains);
  });

  it('does not expose the legacy `displayString` (deliberate omission)', () => {
    const pub = toPublicGuidelineRef(GUIDELINES[sample]);
    // The legacy string continues to live on the owning item's
    // `guidelineSource` field. Duplicating it on the public ref would
    // be a second source of truth and invite drift.
    expect((pub as unknown as { displayString?: unknown }).displayString).toBeUndefined();
  });
});

describe('resolvePublicGuidelineRef', () => {
  it('returns null for null / undefined / empty input', () => {
    expect(resolvePublicGuidelineRef(null)).toBeNull();
    expect(resolvePublicGuidelineRef(undefined)).toBeNull();
    expect(resolvePublicGuidelineRef('')).toBeNull();
  });

  it('returns null for unknown strings', () => {
    expect(resolvePublicGuidelineRef('NOT A REAL CITATION')).toBeNull();
    // Trailing whitespace must not match — the catalog is exact-string only.
    expect(resolvePublicGuidelineRef('ESC 2021 CVD prevention ')).toBeNull();
  });

  it('resolves every registered displayString to its public ref', () => {
    for (const id of Object.keys(GUIDELINES) as GuidelineId[]) {
      const src = GUIDELINES[id];
      const pub = resolvePublicGuidelineRef(src.displayString);
      expect(pub, `resolver missed ${id}`).not.toBeNull();
      expect(pub!.id).toBe(id);
      expect(pub!.title).toBe(src.title);
    }
  });
});

describe('collectReferenceFramework', () => {
  it('returns an empty list for an empty iterable', () => {
    expect(collectReferenceFramework([])).toEqual([]);
  });

  it('dedupes by id, preserving first-appearance order', () => {
    const items = [
      { guidelineSource: 'ESC 2021 CVD prevention' },
      { guidelineSource: 'KDIGO 2024 CKD' },
      { guidelineSource: 'ESC 2021 CVD prevention' }, // dup of 1st
      { guidelineSource: 'EASL 2024 MASLD' },
      { guidelineSource: 'KDIGO 2024 CKD' },          // dup of 2nd
    ];
    const out = collectReferenceFramework(items);
    expect(out.map((r) => r.id)).toEqual([
      'ESC_2021_PREVENTION',
      'KDIGO_2024_CKD',
      'EASL_2024_MASLD',
    ]);
  });

  it('skips items whose source is not in the catalog', () => {
    const items = [
      { guidelineSource: 'ESC 2021 CVD prevention' },
      { guidelineSource: 'made up source' },
      { guidelineSource: null },
      { guidelineSource: undefined },
    ];
    const out = collectReferenceFramework(items);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('ESC_2021_PREVENTION');
  });

  it('prefers a pre-resolved `guideline` over re-resolving from `guidelineSource`', () => {
    const preResolved = toPublicGuidelineRef(GUIDELINES.KDIGO_2024_CKD);
    const out = collectReferenceFramework([
      {
        // Source string is wrong on purpose — the resolver would return
        // null for it; the pre-resolved `guideline` must win.
        guidelineSource: 'totally wrong',
        guideline: preResolved,
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('KDIGO_2024_CKD');
  });
});
