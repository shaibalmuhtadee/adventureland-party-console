import type { CombatRoot, Target } from '../roles/types.ts';
import { monsterAttackBlock } from '../roles/monster-attack-policy.ts';
import { createSkillEngine } from './engine.ts';
import { decision, type Actor, type Combatant, type CombatContext, type SkillDefinition, type SkillDecision, type SkillId, type SkillWorld } from './types.ts';
import { incomingDps } from './damage.ts';
import { createProjectileTracker } from './projectiles.ts';
import { createRogueKnifePositioner, stationaryCrabFarm } from '../farming/rogue-knives.ts';
import { strategyEnabled } from '../../combat/strategies.ts';
import { stationaryPosition } from '../../combat/stationary-position.ts';

interface Host {
  damage_multiplier?(this: void, defense: number): number;
  is_disabled?(actor: Actor): boolean;
  next_skill?: Partial<Record<SkillId, Date>>;
  pings?: number[];
  socket?: { connected: boolean;
    on?(event: string, listener: (data: object) => void): void;
    off?(event: string, listener: (data: object) => void): void;
  };
  entities: Record<string, Combatant>;
  // Native distance uses these visual dimensions; upstream omits the helpers.
  get_width(entity: Actor | Combatant): number;
  get_height(entity: Actor | Combatant): number;
  G: typeof G;
  use_skill(id: SkillId, target?: string | string[]): Promise<unknown>;
}
export function mitigation(defense: number): number {
  const rates = [.001, .001, .00095, .0009, .00082, .0007, .0006, .0005];
  const reduction = rates.reduce((sum, rate, i) => sum + Math.max(0, Math.min(100, defense - i * 100)) * rate, 0) + Math.max(0, defense - 800) * .0004;
  const piercing = [.001, .00075, .0005].reduce((sum, rate, i) => sum + Math.max(0, Math.min(50, -defense - i * 50)) * rate, 0) + Math.max(0, -defense - 150) * .00025;
  return Math.min(1.32, Math.max(.05, 1 - reduction + piercing));
}
export function installSkillRuntime(root: CombatRoot) {
  const host = parent as unknown as Host;
  const shared = root.sharedRoutine;
  shared.combatStrategyEnabled = id => strategyEnabled(shared.combatStrategySettings?.(), id);
  shared.stationaryCombatDestination = (target, priest, desiredRange) => stationaryPosition({
    actor: character, target, priest, desiredRange,
    distance: point => distance({ ...character, x: point.x, y: point.y, real_x: point.x, real_y: point.y }, target),
    canMove: point => can_move_to(point.x, point.y),
  });
  const projectiles = createProjectileTracker(world);
  function world(skill?: SkillId): SkillWorld {
    const actor: Actor = character;
    // Friendly buff upkeep can run while navigation owns combat movement.
    const context: CombatContext = skill === 'rspeed' ? {
      leader: actor.name, allies: shared.partyBuffTargets?.() || [], monsters: [],
      strategies: shared.combatStrategySettings?.(), mode: host.socket?.connected ? 'grouped' : 'blocked',
      event: null, observedAt: Date.now(),
    } : shared.combatContext?.() || {
      leader: '', allies: [], monsters: [], mode: 'blocked', event: null, observedAt: 0,
    };
    if (host.is_disabled?.(actor)) context.mode = 'blocked';
    const skills: Partial<Record<SkillId, SkillDefinition>> = G.skills;
    const result: SkillWorld = {
      actor, context, skills, now: Date.now(),
      item: name => (G.items as Record<string, { wtype?: string; type?: string; charge?: number }>)[name],
      condition: name => (G.conditions as Record<string, ReturnType<SkillWorld['condition']>>)[name],
      cooldown: id => id === 'invis' && !!shared.merchantVisibilityActive?.() || Number(host.next_skill?.[id]) > Date.now(),
      damageMultiplier: host.damage_multiplier || mitigation,
      incoming: t => projectiles.incoming(t.id, Date.now()),
      range: (t, id) => skillRange(actor, t, skills[id]),
      allowed: (t, id) => authorized(result, t, id),
    };
    return result;
  }
  function authorized(w: SkillWorld, t: Combatant, id: SkillId): boolean {
    if(returnTargetBlocked(t,id) || frankySkillBlocked(id, [t]))return false;
    const type = w.skills[id]?.damage_type || 'physical';
    if (id !== 'taunt' && monsterAttackBlock(t.mtype, type, w.actor.range)) return false;
    if (!targetAuthorized(t, id)) return false;
    if (t.target || w.context.mode !== 'scatter') return true;
    const added = { ...w.context, monsters: w.context.monsters.map(m => m.id === t.id ? { ...m, target: w.actor.name } : m) };
    return w.actor.hp - 2 * incomingDps({ ...w, context: added }, w.actor) > w.actor.max_hp * .3;
  }
  function targetAuthorized(t: Combatant, id: SkillId): boolean {
    return !!shared.skillTargetAllowed?.(t as Target) && shared.rareAttackAllowed?.(t as Target, id) !== false;
  }
  const returnExcluded = new Set<string>(['taunt','agitate','charge','dash','blink','scare','stomp','cleave','fanofknives']);
  function returnTargetBlocked(t:Combatant,id:SkillId):boolean {
    return !!shared.returnCombatActive?.() && (returnExcluded.has(id) || !shared.returnAttacker?.(t as Target));
  }
  function returnCastBlocked(d:SkillDecision):boolean {
    if(!shared.returnCombatActive?.())return false;
    if(returnExcluded.has(d.skill))return true;
    return !!world().skills[d.skill]?.hostile && d.targets.some(t=>!shared.returnAttacker?.(t as Target));
  }
  // Area effects and movement skills cannot honor strict boss-only, hold-position combat.
  const frankyExcluded = new Set<string>(['agitate','charge','dash','blink','scare','stomp','cleave','fanofknives']);
  function frankySkillBlocked(id: SkillId, targets: Combatant[]): boolean {
    if (!shared.frankyCombatActive?.()) return false;
    return frankyExcluded.has(id) || !!world().skills[id]?.hostile &&
      targets.some(t => t.type !== 'monster' || t.mtype !== 'franky' || !shared.skillTargetAllowed?.(t as Target));
  }
  function compensateCrabCooldown() {
    if (!stationaryCrabFarm(world().context) || typeof reduce_cooldown !== 'function') return;
    const samples = (host.pings || []).filter(p => Number.isFinite(p) && p >= 0);
    const remaining = Math.max(0, Number(host.next_skill?.attack) - Date.now()) || 0;
    // Native skill_timeout updates the whole attack family. Compensate once,
    // after acknowledgement, using the lowest observed round-trip time.
    if (samples.length) reduce_cooldown('attack', Math.min(remaining, Math.min(...samples)));
  }
  async function castSkill(d:SkillDecision):Promise<unknown> {
    if (shared.deathLoopActive?.()) return Promise.reject(new Error('Death loop owns combat'));
    if (d.skill === 'absorb' && !shared.combatStrategyEnabled?.('absorb-sins'))
      return Promise.reject(new Error('Absorb sins strategy is disabled'));
    if (d.skill === 'rspeed' && !shared.combatStrategyEnabled?.('rspeed'))
      return Promise.reject(new Error('Rspeed strategy is disabled'));
    if (d.skill === 'mentalburst' && !shared.combatStrategyEnabled?.('mentalburst'))
      return Promise.reject(new Error('Mentalburst strategy is disabled'));
    if (frankySkillBlocked(d.skill, d.targets)) return Promise.reject(new Error('Skill conflicts with Franky-only combat'));
    if(returnCastBlocked(d))return Promise.reject(new Error('Skill conflicts with return movement or attacker-only policy'));
    const argument=d.argument ?? (d.targets.length>1 || world().skills[d.skill]?.multi ? d.targets.map(t=>t.id) : d.targets[0]?.id || d.targets[0]?.name);
    const compensate = d.skill === 'fanofknives' && stationaryCrabFarm(world().context);
    const result = await host.use_skill(d.skill,argument);
    if (compensate) compensateCrabCooldown();
    return result;
  }
  const knifePositioner = createRogueKnifePositioner({
    world,
    center: () => shared.rogueKnifeFarm?.() || null,
    contains: point => shared.rogueKnifeFarmContains?.(point) ?? false,
    canMove: point => can_move_to(point.x, point.y),
    move: point => shared.rogueKnifeFarmMove?.(point) ?? false,
    cooldownRemaining: () => Math.max(0, Number(host.next_skill?.attack) - Date.now()) || 0,
    report: diagnostic => { if (root.partyCombatState) root.partyCombatState.crabFarm = diagnostic; },
  });
  const engine = createSkillEngine({
    rogueKnifeAttackHeld: () => knifePositioner.held(),
    world,
    recoverMana: () => shared.useRecoveryPotion({ hpBelow: 0.5, mpBelow: 1, priority: 'hp' }),
    cast:castSkill,
    evidence: (t, state, action) => shared.queueEvidence?.(t as Target, state, action) || null,
    diagnostic: d => { if (root.partyCombatState) root.partyCombatState.skill = d; },
  });
  shared.skillSupport = () => engine.support();
  shared.skillOffense = t => engine.offense(t);
  shared.absorbLeaderAggro = () => engine.absorb();
  if (shared.combatContext) {
    shared.combatSkillReady = (id, target, category) => engine.ready(decision(id, [target], category));
    shared.castCombatSkill = (id, target, category) => engine.cast(decision(id, [target], category));
  }
  const action = (data: object) => projectiles.action(data);
  const hit = (data: object) => projectiles.hit(data);
  host.socket?.on?.('action', action);
  host.socket?.on?.('hit', hit);
  return { ...engine,
    farmMovement: () => {
      if (!shared.combatStrategyEnabled?.('kiting') && !stationaryCrabFarm(world().context)) {
        knifePositioner.reset(); return false;
      }
      return knifePositioner.tick();
    },
    reset() { engine.reset(); projectiles.clear(); knifePositioner.reset(); },
    stop() {
      engine.stop(); projectiles.clear(); knifePositioner.reset();
      host.socket?.off?.('action', action); host.socket?.off?.('hit', hit);
    },
  };
}
export function skillRange(actor: Actor, target: Combatant, s?: SkillDefinition): boolean {
  if (!s) return false;
  const base = s.use_range ? actor.range : s.range || actor.range;
  const range = base * (s.range_multiplier || 1) + (s.range_bonus || 0);
  const distanceTo = typeof distance === 'function' ? distance(actor, target) : Math.hypot(actor.x - target.x, actor.y - target.y);
  return distanceTo <= range;
}
