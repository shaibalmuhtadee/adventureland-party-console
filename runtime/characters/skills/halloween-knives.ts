import { blocked, cost, reserve, unlocked } from './eligibility.ts';
import { decision, type SkillDecision, type SkillWorld } from './types.ts';

/** Keep using knives just before and after each of Mr. Pumpkin's add waves. */
export function halloweenKnifeWindow(w: SkillWorld): boolean {
  if (w.actor.ctype !== 'rogue' || w.context.mode !== 'event' || w.context.event !== 'halloween') return false;
  if (w.context.monsters.some(t => t.mtype === 'jr' && !t.dead && t.hp > 0 &&
      w.range(t, 'fanofknives') && w.allowed(t, 'fanofknives'))) return true;
  const pumpkin = w.context.monsters.find(t => t.mtype === 'mrpumpkin' && !t.dead && t.hp > 0);
  if (!pumpkin) return false;
  const hp = pumpkin.hp / pumpkin.max_hp;
  return [.75, .5, .25].some(threshold => hp <= threshold + .02 && hp >= threshold - .03);
}

export function halloweenKnifeAttack(w: SkillWorld): SkillDecision | null {
  if (!halloweenKnifeWindow(w)) return null;
  const targets = w.context.monsters.filter(t => t.mtype === 'jr' || t.mtype === 'mrpumpkin')
    .filter(t => !blocked(w, decision('fanofknives', [t])))
    .sort((a, b) => Number(b.mtype === 'jr') - Number(a.mtype === 'jr') ||
      Math.hypot(a.x - w.actor.x, a.y - w.actor.y) - Math.hypot(b.x - w.actor.x, b.y - w.actor.y) ||
      a.id.localeCompare(b.id))
    .slice(0, w.skills.fanofknives?.max_targets || 5);
  return targets.length ? decision('fanofknives', targets, 'damage', 'Mr. Pumpkin add-wave knives') : null;
}

export function halloweenKnifePriority(w: SkillWorld): boolean {
  return halloweenKnifeWindow(w) && unlocked(w, 'fanofknives') &&
    w.actor.mp >= cost(w, 'fanofknives') + reserve(w);
}
