import type { Role } from "../roles/types.ts";
export const role: Partial<Role> = { name: "rogue", combat: true,
  usePotion: () => {
    if (character.mp < 1500) return sharedRoutine.useRecoveryPotion({ force: 'mp' });
    return sharedRoutine.rogueKnifeFarm?.()
      ? sharedRoutine.useRecoveryPotion({ hpBelow: 0.5, mpBelow: 0.5, priority: 'hp' })
      : Promise.resolve(false);
  },
  beforeTarget: () => sharedRoutine.skillSupport?.() ?? Promise.resolve(false),
  beforeAttack: target => sharedRoutine.skillOffense?.(target) ?? Promise.resolve(false),
};
