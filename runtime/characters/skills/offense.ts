import { blocked, cost } from './eligibility.ts';
import { damage, usefulDamage, purifiable } from './damage.ts';
import { decision, type Combatant, type SkillDecision, type SkillId, type SkillWorld } from './types.ts';
import { strategyEnabled } from '../../combat/strategies.ts';

export function mentalburstDecision(w: SkillWorld, primary: Combatant | null): SkillDecision | null {
  if (w.actor.ctype !== 'rogue' || !strategyEnabled(w.context.strategies, 'mentalburst')) return null;
  const targets = w.context.farmingScript ? w.context.monsters.filter(target =>
    w.context.farmingScript === 'lone-crab' ? target.mtype === 'crab' : w.context.farmingFocus?.includes(target.mtype)) :
    primary ? [primary] : [];
  const eligible = targets.filter(target => target.visible !== false && target.hp > w.incoming(target) &&
    (!w.context.farmingScript || !w.range(target, 'fanofknives')) &&
    !blocked(w, decision('mentalburst', [target])));
  // Prefer a finishing blow for the native mana refund, but cast on healthy
  // targets too when no finisher is available. Never predict refund mana.
  const finisher = (target: Combatant) => damage(w, 'mentalburst', target, true) >= target.hp;
  eligible.sort((a, b) => Number(finisher(b)) - Number(finisher(a)) ||
    Number(b.id === primary?.id) - Number(a.id === primary?.id) || a.hp - b.hp || a.id.localeCompare(b.id));
  return eligible[0] ? decision('mentalburst', [eligible[0]], 'damage', 'independent Mentalburst strategy') : null;
}

export function attackChoices(w: SkillWorld, primary: Combatant): SkillDecision[] {
  const ids: SkillId[] = w.actor.ctype === 'ranger' ? ['piercingshot', '3shot', '5shot'] :
    w.actor.ctype === 'rogue' ? ['fanofknives'] : [];
  return ids.map(id => {
    const cap = w.skills[id]?.max_targets || (id === '5shot' || id === 'fanofknives' ? 5 : id === '3shot' ? 3 : 1);
    const targets = [primary, ...w.context.monsters.filter(t => t.id !== primary.id)]
      .filter(t => !blocked(w, decision(id, [t])))
      .sort((a, b) => Number(b.id === primary.id) - Number(a.id === primary.id) ||
        usefulDamage(w, id, b) - usefulDamage(w, id, a) || a.id.localeCompare(b.id)).slice(0, cap);
    return decision(id, targets);
  }).filter(d => d.targets.some(t => t.id === primary.id));
}
export function bestAttack(w: SkillWorld, primary: Combatant, affordable: (d: SkillDecision) => boolean): SkillDecision | null {
  const baseline = usefulDamage(w, 'attack', primary);
  const options = attackChoices(w, primary).filter(affordable).map(d => ({ d,
    score: d.targets.reduce((sum, t) => sum + usefulDamage(w, d.skill, t), 0) }));
  options.sort((a, b) => b.score - a.score || cost(w, a.d.skill) - cost(w, b.d.skill));
  return options[0]?.score > baseline ? options[0].d : null;
}
function purifyUseful(w: SkillWorld, target: Combatant): boolean {
  if (damage(w, 'purify', target, true) >= target.hp) return true;
  // Purify strips debuffs too. Do not erase another player's damage setup.
  return !purifiable(w, target).some(id => w.condition(id)?.debuff || w.condition(id)?.bad);
}
function independentUseful(w: SkillWorld, id: SkillId, target: Combatant): boolean {
  const remaining = target.hp - w.incoming(target);
  if (remaining <= 0) return false;
  if (id === 'purify') return purifyUseful(w, target);
  if (id === 'huntersmark') return markUseful(w, target, remaining);
  if (id === 'supershot') return remaining >= damage(w, id, target) * .5;
  return true;
}
function markUseful(w: SkillWorld, target: Combatant, remaining: number): boolean {
  const owner = w.context.allies.filter(a => a.ctype === 'ranger' && a.mp >= cost(w, 'huntersmark') && w.range(a, 'huntersmark'))
    .sort((a, b) => a.name.localeCompare(b.name))[0];
  return owner?.name === w.actor.name && !target.s?.marked &&
    remaining >= damage(w, 'attack', target) * Math.max(1, w.actor.frequency) * 3;
}
export function damageChoices(w: SkillWorld, target: Combatant): SkillDecision[] {
  const classes: Partial<Record<ActorClass, SkillId[]>> = {
    ranger: ['huntersmark', 'supershot'], rogue: ['quickstab', 'quickpunch'],
    paladin: ['purify', 'shield_slam', 'smash'],
  };
  const choices = (classes[w.actor.ctype] || []).filter(id => independentUseful(w, id, target))
    .map(id => decision(id, [target])).filter(d => !blocked(w, d));
  const score = (d: SkillDecision) => {
    if (d.skill === 'huntersmark') return Number.MAX_SAFE_INTEGER;
    const divisor = w.context.mode === 'event' ? (w.skills[d.skill]?.cooldown || 1000) / 1000 : Math.max(1, cost(w, d.skill));
    return usefulDamage(w, d.skill, target) / divisor;
  };
  return choices.sort((a, b) => score(b) - score(a));
}
type ActorClass = SkillWorld['actor']['ctype'];
