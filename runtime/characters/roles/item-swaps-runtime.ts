import type { Entity, DamageType } from 'typed-adventureland';
import { itemSwapSlots, swapIdentity, type ItemSwap, type SwapItem, type SwapSlot } from '../../item-swaps.ts';
import { createItemSwapController, validSwapSession, type SwapMemory, type SwapSession, type SwapTrigger } from './item-swap-controller.ts';
import { mitigation } from '../skills/runtime.ts';
import { monsterAttackBlock } from './monster-attack-policy.ts';
import type { CombatRoot } from './types.ts';

// Verified CODE contract: 0.0.57 omits equip_batch. A resolved batch may be partial.
declare global { function equip_batch(entries: { num: number; slot: SwapSlot }[]): Promise<unknown>; }
// Character/Entity omit live damage_type, output and the new co-op flag.
type Fighter = Entity & { damage_type?: DamageType; output?: number; rpiercing?: number };
type Monster = Entity & { cooperative?: boolean; for?: number; incdmgamp?: number };
interface Host {
  __partyInventorySwaps?: SwapMemory;
  party_list?: string[];
  entities: Record<string, Monster>;
  damage_multiplier?(defense: number): number;
}

/** A cycle is one basic attack per living, in-range member of the actual game party. */
function partyCycleDamage(target: Monster, host: Host): number {
  const party = host.party_list || Object.keys(get_party() || {});
  const names = [...new Set([...party, character.name])];
  const multiply = host.damage_multiplier || mitigation;
  return names.reduce((total, name) => {
    const actor: Fighter | null = name === character.name ? character : get_player(name);
    if (!actor || actor.rip || actor.map && actor.map !== character.map || actor.in != null && actor.in !== character.in ||
      distance(actor, target) > actor.range || monsterAttackBlock(target.mtype, actor.damage_type || G.classes[actor.ctype]?.damage_type, actor.range)) return total;
    const type = actor.damage_type || G.classes[actor.ctype]?.damage_type;
    const defense = type === 'magical' ? (target.resistance || 0) - (actor.rpiercing || 0) : target.armor - (actor.apiercing || 0);
    const crit = 1 + Math.min(1, (actor.crit || 0) / 100) * (1 + (actor.critdamage || 0) / 100);
    const output = (actor.output ?? G.classes[actor.ctype]?.output ?? 100) / 100;
    return total + actor.attack * output * crit * (type === 'pure' ? 1 : multiply(defense)) *
      multiply((target.for || 0) * 5) * (1 + (target.incdmgamp || 0) / 100);
  }, 0);
}
export type ItemSwapRuntime = Omit<ReturnType<typeof createItemSwapController>, 'tick'> & { tick(allowed: boolean): void };
export function installItemSwaps(root: CombatRoot): ItemSwapRuntime {
  const host = parent as unknown as Host;
  const memory = host.__partyInventorySwaps ??= {};
  const key = 'party-inventory-swap:' + character.name;
  const storage = globalThis.localStorage;
  if (!memory.loaded) {
    memory.loaded = true;
    try {
      const saved: unknown = JSON.parse(storage.getItem(key) || 'null');
      if (!memory.session && validSwapSession(saved)) { memory.session = saved; saved.phase = 'restoring'; }
    } catch { /* An invalid journal is never equipment authority. */ }
  }
  const item = (slot: SwapSlot): SwapItem | null => character.slots[slot] || null;
  const definitions: Partial<Record<string, typeof G.items[keyof typeof G.items]>> = G.items;
  const controller = createItemSwapController({
    now: Date.now, equipped: item, inventory: () => character.items,
    batch: entries => equip_batch(entries), unequip: slot => Promise.resolve(unequip(slot)),
    save: session => session ? storage.setItem(key, JSON.stringify(session)) : storage.removeItem(key),
    report: value => { root.partyCombatState.itemSwap = { ...value,
      reserved: memory.session?.slots.flatMap(entry => [entry.original, entry.desired].filter((item): item is SwapItem => !!item)) || [] }; },
    prepare(swap, trigger): SwapSession {
      const slots: SwapSession['slots'] = swap.items.map(selection => {
        const definition = definitions[selection.item.name];
        const choices = itemSwapSlots(definition?.type);
        const cls = G.classes[character.ctype];
        const weapon = definition && 'wtype' in definition ? definition.wtype : undefined;
        const handCompatible = weapon && (selection.slot === 'mainhand' ?
          !!cls.mainhand[weapon] || !!cls.doublehand[weapon] : weapon in cls.offhand);
        const offhandCompatible = weapon ? handCompatible : definition && definition.type in cls.offhand;
        if (!definition || !choices.includes(selection.slot) ||
          definition.class && !definition.class.includes(character.ctype) ||
          selection.slot === 'mainhand' && !handCompatible ||
          selection.slot === 'offhand' && !offhandCompatible)
          throw Error('Cannot equip ' + selection.item.name + ' in ' + selection.slot);
        return { slot: selection.slot, original: item(selection.slot) && swapIdentity(item(selection.slot)!),
          desired: swapIdentity(selection.item), inventorySlot: selection.inventorySlot };
      });
      const mainhand = slots.find(entry => entry.slot === 'mainhand')?.desired || item('mainhand');
      const definition = mainhand && definitions[mainhand.name];
      const weapon = definition && 'wtype' in definition ? definition.wtype : undefined;
      if (weapon && G.classes[character.ctype].doublehand?.[weapon]) {
        if (slots.some(entry => entry.slot === 'offhand')) throw Error('Two-handed weapon conflicts with offhand selection');
        if (slots.some(entry => entry.slot === 'mainhand') && item('offhand'))
          slots.push({ slot: 'offhand', original: swapIdentity(item('offhand')!), desired: null, inventorySlot: -1 });
        else if (swap.items.some(entry => entry.slot === 'offhand')) throw Error('Current weapon requires both hands');
      }
      // Mainhand restoration must precede offhand restoration in the native batch.
      slots.sort((a, b) => Number(b.slot === 'mainhand') - Number(a.slot === 'mainhand'));
      return { strategy: swap.strategy, configuration: JSON.stringify(swap), target: trigger.target,
        threshold: trigger.threshold, phase: 'equipping', slots };
    },
  }, memory);
  function trigger(swap: ItemSwap): SwapTrigger | null {
    switch (swap.strategy) {
      case 'luck-before-kill': {
        const monsters = Object.values(host.entities).filter(target => target.type === 'monster' && !target.dead &&
          target.hp > 0 && target.target === character.name && !root.partyRoleRunner?.isKnownDead(target.id));
        monsters.sort((a, b) => Number(b.id === memory.session?.target) - Number(a.id === memory.session?.target) || a.hp - b.hp);
        for (const target of monsters) {
          const coop = target.cooperative || target.mtype && G.monsters[target.mtype]?.cooperative;
          const threshold = coop ? target.max_hp * .05 : memory.session?.target === target.id ?
            memory.session.threshold : partyCycleDamage(target, host) * 2;
          if (target.hp <= threshold) return { target: target.id, threshold };
        }
        return null;
      }
    }
  }
  return root.partyItemSwaps = {
    ...controller,
    tick(allowed: boolean) {
      if (character.rip || root.sharedRoutine.itemSwapMutationBlocked?.()) return;
      if (root.partyPorcupineEquipment?.busy()) return;
      const swaps = root.sharedRoutine.itemSwapSettings?.() || [];
      const handConflict = root.partyPorcupineEquipment?.ownsHands() && swaps.some(swap => swap.enabled &&
        swap.items.some(selection => selection.slot === 'mainhand' || selection.slot === 'offhand'));
      controller.tick(swaps, trigger, allowed && !handConflict);
    },
  };
}
