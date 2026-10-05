import { blocked } from '../skills/eligibility.ts';
import { decision, type SkillDecision, type SkillWorld } from '../skills/types.ts';

/** The native skill shares the attack cooldown. Keep every ready cast for crabs. */
export function loneCrabAttack(w: SkillWorld): SkillDecision | null {
  const cap = w.skills.fanofknives?.max_targets || 5;
  const targets = w.context.monsters.filter(t => t.mtype === 'crab' &&
    !blocked(w, decision('fanofknives', [t])))
    .sort((a, b) => Math.hypot(a.x-w.actor.x,a.y-w.actor.y) -
      Math.hypot(b.x-w.actor.x,b.y-w.actor.y) || a.id.localeCompare(b.id))
    .slice(0, cap);
  return targets.length ? decision('fanofknives', targets, 'damage', 'lone crab farm') : null;
}
