/**
 * FRAIL Scale — independent reference implementation.
 *
 * Source:
 *   Morley JE, Malmstrom TK, Miller DK.
 *   A simple frailty questionnaire (FRAIL) predicts outcomes in
 *   middle aged African Americans.
 *   J Nutr Health Aging. 2012;16(7):601–608.
 *   doi:10.1007/s12603-012-0084-2
 *
 * 5 yes/no items (1 point per "yes"):
 *   F  Fatigue          — feeling tired more than three days/week
 *   R  Resistance       — climbing one flight of stairs is difficult
 *   A  Ambulation       — walking one block is difficult
 *   I  Illnesses        — more than five illnesses
 *   L  Loss of weight   — > 5 % body weight in the past year
 *
 * Bands (Morley 2012, Table 1):
 *   0–1 → Not Frail
 *   2   → Intermediate Frail (pre-frail)
 *   3–5 → Frail
 *
 * Per project rule, this reference is bit-equivalent to the engine: it
 * exists as an independent code path so a regression in either side
 * surfaces as a test failure rather than silently propagating.
 */

export interface FrailRefInput {
  fatigue: boolean;
  resistance: boolean;
  ambulation: boolean;
  illnesses: boolean;
  weightLoss: boolean;
}

export interface FrailRefResult {
  score: number; // 0..5
  maxScore: 5;
  category: 'Not Frail' | 'Intermediate Frail' | 'Frail';
}

export function frailReference(input: FrailRefInput): FrailRefResult {
  for (const k of ['fatigue', 'resistance', 'ambulation', 'illnesses', 'weightLoss'] as const) {
    if (typeof input[k] !== 'boolean') {
      throw new Error(`frailReference: ${k} must be boolean`);
    }
  }
  const score =
    (input.fatigue ? 1 : 0) +
    (input.resistance ? 1 : 0) +
    (input.ambulation ? 1 : 0) +
    (input.illnesses ? 1 : 0) +
    (input.weightLoss ? 1 : 0);

  let category: FrailRefResult['category'];
  if (score <= 1)      category = 'Not Frail';
  else if (score === 2) category = 'Intermediate Frail';
  else                  category = 'Frail';

  return { score, maxScore: 5, category };
}
