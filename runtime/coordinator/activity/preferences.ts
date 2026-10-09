import { planOwns, type ActivityPlan } from '../../activity-plan.ts';

const saved = new WeakMap<object, Map<string, () => unknown>>();
/** Effective activity settings never overwrite the saved party or personal farming preferences. */
export function installActivityPreferences(state: {
  activityPlan: ActivityPlan | null; leader: string | null; followers: Record<string, boolean>;
  merchantCharacter: string | null; activeRealm: string;
}) {
  const originals = new Map<string, () => unknown>();
  saved.set(state, originals);
  function override<K extends 'leader' | 'followers' | 'merchantCharacter' | 'activeRealm'>(key: K, effective: () => typeof state[K]) {
    let preference = state[key];
    originals.set(key, () => preference);
    Object.defineProperty(state, key, { enumerable: true, configurable: true,
      get: () => planOwns(state.activityPlan) ? effective() : preference,
      set: (value: typeof state[K]) => { preference = value; } });
  }
  override('leader', () => state.activityPlan!.config.farmer);
  override('merchantCharacter', () => state.activityPlan!.config.merchant);
  override('activeRealm', () => state.activityPlan!.config.realm);
  override('followers', () => Object.fromEntries(
    ['solo', 'returning'].includes(state.activityPlan!.run!.phase) ? [] : state.activityPlan!.config.companions.map(name => [name, true])));
  return () => Object.fromEntries([...originals].map(([key, read]) => [key, read()]));
}
export function activitySavedPreferences(state: object): Record<string, unknown> {
  return Object.fromEntries([...(saved.get(state) || [])].map(([key, read]) => [key, read()]));
}
