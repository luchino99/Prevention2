/**
 * Clinical boundary derivations.
 *
 * This module is responsible for enriching the raw assessment input with
 * values that can be deterministically derived from other inputs BEFORE
 * the score engine runs. Today we handle:
 *
 *   - Albumin-Creatinine Ratio (ACR) from urinary albumin + creatinine.
 *
 * Design rules:
 *   - Never overwrite a value the clinician supplied directly.
 *   - Never touch any validated score formula.
 *   - Return a *new* AssessmentInput object; the original stays intact.
 *   - Log every derivation in a trace array so the audit log / PDF can
 *     explain where the derived value came from.
 *
 * Zero side effects — pure orchestration of other pure helpers.
 */

import type { AssessmentInput } from '../../../../../shared/types/clinical.js';
import { deriveAcrFromUrine } from './acr-derive.js';

export interface LabDerivationTrace {
  field: string;
  source: string;
  value: number;
  note: string;
}

export interface LabDerivationsResult {
  /** A copy of the input with derivable values filled in. */
  input: AssessmentInput;
  /** Audit-friendly record of every value the derivation layer produced. */
  trace: LabDerivationTrace[];
}

/**
 * Enrich the assessment input with boundary-derived lab values.
 *
 * Pure function — the caller receives a new object.
 */
export function applyLabDerivations(input: AssessmentInput): LabDerivationsResult {
  const trace: LabDerivationTrace[] = [];

  // Start from a shallow clone so we can rewrite `labs` safely.
  const enriched: AssessmentInput = {
    ...input,
    labs: { ...input.labs },
  };

  // --- ACR derivation -----------------------------------------------------
  // If ACR was supplied directly, keep it — clinician intent wins.
  if (enriched.labs.albuminCreatinineRatio === undefined) {
    const acr = deriveAcrFromUrine({
      urineAlbuminMgL: enriched.labs.urineAlbuminMgL,
      urineCreatinineMgDl: enriched.labs.urineCreatinineMgDl,
    });
    if (acr.acrMgG !== undefined) {
      enriched.labs.albuminCreatinineRatio = acr.acrMgG;
      trace.push({
        field: 'labs.albuminCreatinineRatio',
        source: 'derived_from_urine_spot',
        value: acr.acrMgG,
        note: acr.reason,
      });
    }
  }

  return { input: enriched, trace };
}

export { deriveAcrFromUrine } from './acr-derive.js';
export type {
  AcrDerivationInput,
  AcrDerivationResult,
} from './acr-derive.js';
