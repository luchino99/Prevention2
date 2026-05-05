/**
 * Guideline Rule Catalog — public entry point (WS5).
 *
 * Single import surface for the clinical rule engines. Engines pull
 * `GUIDELINES.<ID>.displayString` to populate the legacy
 * `guidelineSource` string on their output items while keeping the
 * structured metadata available for downstream consumers.
 */

export type {
  ClinicalDomain,
  EvidenceLevel,
  GuidelineFamily,
  GuidelineReference,
} from './guideline-types.js';

export {
  GUIDELINES,
  evidenceLevelOf,
  findGuidelineByDisplayString,
  getGuideline,
  guidelineSource,
  listGuidelinesByFamily,
} from './guideline-registry.js';

export type { GuidelineId } from './guideline-registry.js';

export {
  collectReferenceFramework,
  resolvePublicGuidelineRef,
  toPublicGuidelineRef,
} from './guideline-resolver.js';
