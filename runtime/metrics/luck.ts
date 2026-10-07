function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** Encouragement is a separate contribution-based reward. Ordinary buffs are
 * already included in luckm and must not be added twice.
 * Native fields: node/logic/encouragement.js, encouragement_update/share/loot.
 */
export function encouragementLuck(summary: unknown, conditions: unknown): number | null {
  if (object(summary) && object(summary.totals)) {
    const luck = summary.totals.luck;
    if (typeof luck === 'number' && Number.isFinite(luck) && luck >= 1) return luck;
  }
  if (!object(conditions)) return null;
  let multiplier = 1;
  for (const [id, condition] of Object.entries(conditions)) {
    if (!id.startsWith('encouragement_') || !object(condition)) continue;
    const luck = condition.luck_multiplier;
    if (typeof luck === 'number' && Number.isFinite(luck) && luck >= 1) multiplier *= luck;
  }
  return multiplier;
}

export interface DropProjectionInputs {
  baseRate: number; luck: number; share: number; contribution: number;
  encouragement: number; level: number; modifier: number; rolls: number;
}
/** Ordinary table rolls and the native reserved Encouragement roll are
 * independent Bernoulli trials. Contribution is not the party loot share.
 */
export function projectDirectDrop(input: DropProjectionInputs) {
  const ordinary = Math.min(1, input.baseRate * input.luck * input.share * input.level * input.modifier);
  const bonus = Math.min(1, input.baseRate * input.luck * input.contribution * (input.encouragement - 1) * input.level * input.modifier);
  const probability = ordinary === 1 || bonus === 1 ? 1
    : -Math.expm1(input.rolls * Math.log1p(-ordinary) + Math.log1p(-bonus));
  return { probability, expectedRewards: input.rolls * ordinary + bonus };
}
