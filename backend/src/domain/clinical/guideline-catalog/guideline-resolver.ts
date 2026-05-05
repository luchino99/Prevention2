/**
 * Guideline Rule Catalog — server → wire adapter (WS6).
 *
 * Purpose
 *   Projects a server-side `GuidelineReference` into the public,
 *   JSON-serialisable `PublicGuidelineRef` shape shared with the frontend
 *   and PDF renderer. Exposes a single resolver that the assessment
 *   service calls to turn a legacy `guidelineSource` free-text string
 *   into structured metadata.
 *
 * Design notes
 *   - This module is the *only* place where the catalog crosses the
 *     backend-to-wire boundary. Keeping the projection centralised means
 *     any future field (e.g. `translationKey`, `supersededBy`) is added
 *     here once and every consumer inherits it.
 *   - The resolver is a total function: unknown / missing input returns
 *     `null`. This keeps legacy persisted rows (whose `guidelineSource`
 *     might predate the catalog) fully backward-compatible.
 *   - The projection strips the `readonly` modifiers from the registry
 *     type, which is necessary because JSON deserialisation on the other
 *     side cannot reconstruct readonly arrays. The returned object is
 *     still logically immutable; callers must not mutate it.
 *   - No new `GuidelineReference` instances are produced here — we only
 *     shape-convert the registry entry, so the reference graph stays
 *     auditable via `id`.
 */

import type { PublicGuidelineRef } from '../../../../../shared/types/clinical.js';
import { findGuidelineByDisplayString } from './guideline-registry.js';
import type { GuidelineReference } from './guideline-types.js';

/**
 * Project a server-side catalog entry into its wire-safe public shape.
 * Preserves byte-identical `displayString` semantics by design: the
 * string is *not* part of `PublicGuidelineRef` because downstream
 * consumers continue to read it from the existing `guidelineSource`
 * field on each item — this avoids duplicating the same value twice on
 * every payload.
 */
export function toPublicGuidelineRef(ref: GuidelineReference): PublicGuidelineRef {
  return {
    id: ref.id,
    // Spread into a fresh, mutable array to satisfy the wire type.
    families: [...ref.families],
    shortLabel: ref.shortLabel,
    year: ref.year,
    section: ref.section,
    title: ref.title,
    url: ref.url,
    evidenceLevel: ref.evidenceLevel,
    domains: [...ref.domains],
  };
}

/**
 * Resolve a legacy free-text `guidelineSource` string into the public
 * structured reference. Returns `null` for:
 *   - `null`, `undefined`, or empty input
 *   - strings that don't match any catalog `displayString`
 *
 * Callers must treat `null` as "no structured metadata available" and
 * fall back to rendering the raw `guidelineSource` string.
 */
export function resolvePublicGuidelineRef(
  guidelineSource: string | null | undefined,
): PublicGuidelineRef | null {
  if (!guidelineSource) return null;
  const ref = findGuidelineByDisplayString(guidelineSource);
  return ref ? toPublicGuidelineRef(ref) : null;
}

/**
 * Build the deduplicated "Reference framework" list for a rendered
 * assessment. Accepts any iterable of items that expose either a
 * `guideline` (already resolved) or a `guidelineSource` (raw string) —
 * typically the follow-up items, screenings, and lifestyle
 * recommendations of an `AssessmentSnapshot`.
 *
 * Dedup is by catalog `id`; items whose source is not in the catalog
 * are silently skipped (the rendered UI/PDF will show the raw
 * `guidelineSource` text instead, so nothing is lost — the framework
 * section is strictly additive transparency).
 *
 * Ordering is stable and deterministic: first appearance across the
 * input iterable wins, which matches the order in which the citations
 * were surfaced to the clinician.
 */
export function collectReferenceFramework(
  items: Iterable<{
    guideline?: PublicGuidelineRef | null;
    guidelineSource?: string | null;
  }>,
): PublicGuidelineRef[] {
  const seen = new Set<string>();
  const out: PublicGuidelineRef[] = [];
  for (const it of items) {
    const ref = it.guideline ?? resolvePublicGuidelineRef(it.guidelineSource);
    if (!ref) continue;
    if (seen.has(ref.id)) continue;
    seen.add(ref.id);
    out.push(ref);
  }
  return out;
}
