import type { Role } from "../roles/types.ts";
export const role: Partial<Role> = { name: "rogue", combat: true,
  usePotion: () => sharedRoutine.loneCrabFarm?.()
    ? sharedRoutine.useRecoveryPotion({ hpBelow: 0.5, mpBelow: 0.8, priority: 'hp' })
    : Promise.resolve(false),
  beforeTarget: () => sharedRoutine.skillSupport?.() ?? Promise.resolve(false),
  beforeAttack: target => sharedRoutine.skillOffense?.(target) ?? Promise.resolve(false),
};
