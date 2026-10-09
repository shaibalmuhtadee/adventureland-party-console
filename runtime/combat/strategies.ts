export interface CombatStrategy {
  id: string;
  label: string;
  description: string;
  classes: readonly Character['ctype'][] | null;
  defaultEnabled: boolean;
}

/** Shared catalog for card controls, request validation and runtime defaults. */
export const combatStrategies = [
  { id: 'death-loop', label: 'Death loop', description: 'At 95% XP, die in the arena until XP reaches zero, then resume your task. Repeat whenever XP reaches 95%.', classes: ['warrior', 'priest', 'mage', 'rogue', 'ranger', 'paladin'], defaultEnabled: false },
  { id: 'kiting', label: 'Kiting', description: 'Move around attackers. When off, hold combat position and follow moving targets.', classes: null, defaultEnabled: true },
  { id: 'absorb-sins', label: 'Absorb sins', description: 'Transfer party aggro to the priest during combat.', classes: ['priest'], defaultEnabled: true },
  { id: 'rspeed', label: 'Rspeed', description: 'Keep Rogue Swiftness active on yourself and nearby party members. Recover MP before casting when needed.', classes: ['rogue'], defaultEnabled: true },
  { id: 'mentalburst', label: 'Mentalburst', description: 'Use Mental Burst whenever ready and affordable, alongside Fan of Knives. Requires 64 INT.', classes: ['rogue'], defaultEnabled: true },
] as const satisfies readonly CombatStrategy[];
export type CombatStrategyId = typeof combatStrategies[number]['id'];
export type StrategySettings = Partial<Record<CombatStrategyId, boolean>>;
export type CharacterStrategies = Record<string, StrategySettings>;

export function strategiesFor(ctype: string) {
  return combatStrategies.filter((strategy: CombatStrategy) =>
    !strategy.classes || strategy.classes.some(type => type === ctype));
}
export function strategyEnabled(settings: StrategySettings | undefined, id: CombatStrategyId): boolean {
  return settings?.[id] ?? combatStrategies.find(strategy => strategy.id === id)!.defaultEnabled;
}
export function isStrategyId(value: unknown): value is CombatStrategyId {
  return combatStrategies.some(strategy => strategy.id === value);
}
export function validStrategySettings(value: unknown): value is StrategySettings {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.entries(value).every(([id, enabled]) => isStrategyId(id) && typeof enabled === 'boolean');
}
export function validCharacterStrategies(value: unknown): value is CharacterStrategies {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.values(value).every(validStrategySettings);
}

/** Restore supported settings without letting retired strategies erase other toggles. */
export function restoreCharacterStrategies(value: unknown): CharacterStrategies {
  const restored: CharacterStrategies = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return restored;
  for (const [name, settings] of Object.entries(value)) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) continue;
    const supported = Object.fromEntries(Object.entries(settings).filter(([id]) => isStrategyId(id)));
    if (validStrategySettings(supported)) restored[name] = supported;
  }
  return restored;
}
