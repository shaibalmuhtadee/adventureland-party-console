import type { Role } from "../roles/types.ts";
export const role: Partial<Role> = {
  name: "mage",
  combat: true,
  beforeAttack: async function () {
    return await sharedRoutine.energizeLowestMana(0.35);
  },
  usePotion: async function () {
    return await sharedRoutine.useRecoveryPotion({ hpBelow: 0.5, mpBelow: 0.5, priority: "hp" });
  },
};
