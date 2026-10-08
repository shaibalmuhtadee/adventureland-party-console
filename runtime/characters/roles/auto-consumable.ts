import { isRenewableConsumable } from '../../consumables.ts';
import { errorReason, type CombatRoot } from './types.ts';

/** Run independently of combat and travel, but yield to inventory mutations. */
export function installAutoConsumable(root: CombatRoot) {
  let active = true, busy = false, retryAt = 0;
  function ready() { return active && !busy && Date.now() >= retryAt; }
  function blocked() {
    return character.rip || root.sharedRoutine.itemSwapMutationBlocked?.() ||
      root.partyItemSwaps?.busy() || root.partyItemSwaps?.ownsEquipment();
  }
  function elixirActive() {
    const elixir = character.slots.elixir;
    // Unknown expiry is still an occupied slot. Never overwrite an active drink.
    return !!elixir && (!elixir.expires || !(Date.parse(elixir.expires) <= Date.now()));
  }
  async function tick() {
    const name = root.sharedRoutine.autoConsumable?.();
    if (!name || !ready() || blocked() || elixirActive()) return;
    const slot = character.items.findIndex(item => item?.name === name);
    const item = character.items[slot];
    if (!item) return;
    if (!isRenewableConsumable(G.items[item.name])) return;
    busy = true;
    // Native acknowledgement can arrive before the reactive elixir-slot update.
    retryAt = Date.now() + 5000;
    // Verified native runner contract: 0.0.57 types consume as void, but it
    // returns parent.push_deferred('equip'). Promise.resolve adopts that reply.
    try { await Promise.resolve(consume(slot)); }
    catch (error) {
      retryAt = Date.now() + 30000;
      game_log('Automatic consumable failed: ' + name + ': ' + errorReason(error), 'red');
    } finally { busy = false; }
  }
  const timer = setInterval(() => { void tick(); }, 500);
  return { stop() { active = false; clearInterval(timer); } };
}
