/**
 * Search input safety unit test (audit S-02 — P2).
 *
 * The `patients.list` endpoint interpolates `search` into a PostgREST
 * `.or(...)` filter. Without sanitisation, a value containing `,` `)` `(`
 * `*` or `:` could compose extra predicates inside the OR group,
 * potentially returning rows that don't match the intended ilike search
 * (within the caller's tenant — RLS still protects cross-tenant).
 *
 * The fix is a Zod whitelist regex that rejects any character with
 * PostgREST special meaning. This test verifies the regex behaviour in
 * isolation so we can iterate on its strictness without rebooting the
 * full integration suite.
 */

import { describe, it, expect } from 'vitest';

// Mirror of the regex in api/v1/patients/index.ts. Uses a literal U+0020
// space (NOT `\s`) so newline / tab / CR are rejected.
const SEARCH_WHITELIST_RE = /^[\p{L}\p{M}\p{N} \-'.·]{1,100}$/u;

describe('search-safety — patients.list whitelist regex', () => {
  describe('accepts realistic names', () => {
    const ok = [
      'Mario Rossi',
      "D'Angelo",
      'Müller',
      'María José',
      'José L. García',
      'Łukasz',
      'O\'Brien',
      'José-Maria',
      'M.R.',
      'Smith 123',
      'BD-2024-001',
      'Bartoli·junior',
    ];
    for (const s of ok) {
      it(`accepts ${JSON.stringify(s)}`, () => {
        expect(SEARCH_WHITELIST_RE.test(s)).toBe(true);
      });
    }
  });

  describe('rejects PostgREST predicate-injection payloads', () => {
    const bad = [
      'alice,is_active.eq.true',
      'bob)',
      'charlie(',
      'eve*',
      'mallory:hash',
      'admin\\true',
      'name; DROP TABLE patients',
      // Newlines / control chars
      'foo\nbar',
      'foo\rbar',
      'foo\x00',
      // Empty
      '',
      // Length cap
      'x'.repeat(101),
    ];
    for (const s of bad) {
      it(`rejects ${JSON.stringify(s)}`, () => {
        expect(SEARCH_WHITELIST_RE.test(s)).toBe(false);
      });
    }
  });

  it('rejects unicode separators that would split the OR filter', () => {
    // Comma is the PostgREST-OR separator. Any unicode comma form must be rejected.
    expect(SEARCH_WHITELIST_RE.test('alice,bob')).toBe(false);  // U+002C
    expect(SEARCH_WHITELIST_RE.test('alice，bob')).toBe(false);  // U+FF0C fullwidth — Letters/Marks/Numbers regex rejects it correctly
  });
});
