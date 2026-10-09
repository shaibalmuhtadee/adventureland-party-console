import {passiveStopRequired} from '../../combat/passive-travel.ts';
import {installCombatTrace} from "../../combat/trace.ts";
import {createEntityRefresh} from "../../combat/entity-refresh.ts";
import { installPorcupineEquipment } from "./porcupine-equipment-runtime.ts";
import { installItemSwaps } from './item-swaps-runtime.ts';
import { installAutoConsumable } from './auto-consumable.ts';
import { merchantAnniversaryControl } from "../../coordinator/merchant/anniversary-control.ts";
import { createAttackController } from "./attack-controller.ts";
import { installSkillRuntime } from '../skills/runtime.ts';
import {installQueueClient} from '../../combat/client.ts';
import {installQueueMarkers} from '../../combat/markers.ts';
import {installLootClient} from '../../combat/departure-loot.ts';
import { createDeathRecovery } from "./death-recovery.ts";
import { installDeathLoop } from './death-loop.ts';
import { defaultRole } from "./default.ts";
import { targetRejection, eligibleSelection } from "./target-state.ts";
import { errorReason, type Role, type CombatRoot, type Target } from "./types.ts";

export function installRoleRunner(
  classRole: Partial<Role>,
  root = globalThis as unknown as CombatRoot,
) {
  (root as any).partyPassiveStopRequired = passiveStopRequired;
  (root as any).partyMerchantAnniversaryControl = merchantAnniversaryControl;
  root.partyRoleRunner?.stop();
  let equipment: ReturnType<typeof installPorcupineEquipment> | null = null;
  let itemSwaps: ReturnType<typeof installItemSwaps> | null = null;
  let autoConsumable: ReturnType<typeof installAutoConsumable> | null = null;
  function resolvedRole(): Role {
    return { ...defaultRole, ...classRole };
  }
  let timer: ReturnType<typeof setInterval> | null = null,
    respawnTimer: ReturnType<typeof setInterval> | null = null,
    movementTimer: ReturnType<typeof setInterval> | null = null,
    targetTimer: ReturnType<typeof setInterval> | null = null;
  let lootTimer: ReturnType<typeof setInterval> | undefined;
  let looting = false;
  let working = false,
    selecting = false,
    active = true,
    generation = 0;
  let selectedTarget: string | null = null;
  let invalidated = true, missingSince = 0;
  const entityRefresh = createEntityRefresh({
    now: () => Date.now(),
    request: () => {
      const host = parent as unknown as { socket?: { connected: boolean; emit(event: string, data: object): void } };
      if (!host.socket?.connected) return false;
      host.socket.emit('send_updates', {});
      return true;
    },
    report: diagnostic => { root.partyCombatState.entityRefresh = diagnostic; },
  });
  const queueClient=typeof sharedRoutine!=='undefined' && (sharedRoutine as any).queueReport ? installQueueClient(root,sharedRoutine) : null;
  const queueMarkers=typeof sharedRoutine!=='undefined' && (sharedRoutine as any).queueMarkers ? installQueueMarkers(root,sharedRoutine) : null;
  const trace=typeof sharedRoutine!=='undefined' && (sharedRoutine as any).combatTraceSnapshot?installCombatTrace(root,sharedRoutine):null;
  const lootClient=typeof sharedRoutine!=='undefined' ? installLootClient(root,sharedRoutine) : null;
  const killed = new Map<string, number>();
  let skills: ReturnType<typeof installSkillRuntime> | null = null;
  const attacks = createAttackController({
    target: attackTarget, selected: () => attackTarget()?.id || null, epoch: () => generation,
    active: () => active, allowed: () => combatAllowed() || !!passingTarget(),
    passing: target => target.id !== currentTarget()?.id && target.id === passingTarget()?.id,
    preparePassing: target => queueClient?.preparePassing(target) ?? false, state: () => root.partyCombatState,
    equipmentBusy: () => !!equipment?.busy() || !!itemSwaps?.busy(),
    skillAttack: target => skills?.attack(target) ?? null,
    skillBusy: () => skills?.busy() ?? false,
    report: reportError,
  });
  const recoverFromDeath = createDeathRecovery({
    isDead: () => !!character.rip,
    blocked: () => !!sharedRoutine.dungeonOwned?.() || !!sharedRoutine.deathLoopActive?.(),
    respawn: () => sharedRoutine.dungeonOwned?.() ? Promise.reject(Error('Dungeon owns revival')) : Promise.resolve(respawn()),
    releaseCombat: () => {
      working = false;
    },
    publish: (state) => {
      Object.assign(root.partyCombatState, state);
    },
    rejoinEvent: async () =>
      typeof sharedRoutine.rejoinActiveEventAfterRespawn === "function"
        ? await sharedRoutine.rejoinActiveEventAfterRespawn() : { status: "not-applicable" },
    rejoinFarm: () => sharedRoutine.beginFarmReunion?.(),
    log: (message) => game_log(message, "red"),
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeout: (timer) => globalThis.clearTimeout(timer),
  });
  function combatAllowed() {
    return (
      active &&
      !character.rip &&
      resolvedRole().combat &&
      (character.ctype !== "merchant" || !!sharedRoutine.merchantEventCombatActive?.()) &&
      !sharedRoutine.isOccupied() &&
      ["pending", "feed"].indexOf(sharedRoutine.getAbtestingMode()) < 0
    );
  }
  function passingTarget(): Target | null {
    if (sharedRoutine.deathLoopActive?.()) return null;
    if (sharedRoutine.dungeonOwned?.()) return null;
    if (character.ctype === "merchant" || !active || character.rip || !resolvedRole().combat || ["pending","feed"].includes(sharedRoutine.getAbtestingMode())) return null;
    if (sharedRoutine.frankyCombatActive?.()) return sharedRoutine.getWalkingPassiveTarget?.() || null;
    return (sharedRoutine as any).getPassingTarget?.() || null;
  }
  function attackTarget(): Target | null {
    const focus = sharedRoutine.getMonsterFocus?.();
    if (focus?.length === 1 && focus[0] === 'crab' && sharedRoutine.rogueKnifeFarm?.()) {
      // Crab respawns must be eligible on this attack tick, without waiting for
      // the ordinary one-second selection refresh after the previous batch dies.
      return eligibleSelection(sharedRoutine.getRogueKnifeTarget?.() || null);
    }
    const current = currentTarget(), passing = passingTarget();
    if (!current) return passing;
    if (!passing) return current;
    const priority = sharedRoutine.monsterPriority;
    return priority && priority(passing) > priority(current) ? passing : current;
  }
  function currentTarget() {
    if(sharedRoutine.returnCombatActive?.())return combatAllowed() ? sharedRoutine.returnDefenseTarget?.() || null : null;
    let reason: string | null = null;
    const target = selectedTarget ? get_entity(selectedTarget) : null;
    if (!combatAllowed()) reason = "combat paused by movement or activity owner";
    else if (!selectedTarget) reason = "no selected target";
    else reason = killed.has(selectedTarget) ? "confirmed dead" : targetRejection(target);
    if (root.partyCombatState) {
      root.partyCombatState.targetRejection = reason;
      root.partyCombatState.selectedTarget = selectedTarget || null;
    }
    return reason ? null : target || null;
  }
  function reportError(error: unknown) {
    const reason = errorReason(error);
    if (reason !== "cooldown") {
      root.partyCombatState.error = String(reason);
      root.partyCombatState.errorAt = Date.now();
    }
  }
  function currentEpoch(epoch: number): boolean { return active && epoch === generation; }
  function supportAllowed(epoch: number): boolean {
    return currentEpoch(epoch) && !character.rip && !sharedRoutine.isOccupied();
  }
  function chooseTarget() {
    if (sharedRoutine.rogueKnifeFarm?.()) return sharedRoutine.getRogueKnifeTarget?.() || null;
    if (sharedRoutine.dungeonOwned?.()) return sharedRoutine.getDungeonTarget?.() || null;
    if(sharedRoutine.returnCombatActive?.())return sharedRoutine.returnDefenseTarget?.() || null;
    if (sharedRoutine.frankyCombatActive?.()) return sharedRoutine.getEventTarget();
    if (character.ctype === "merchant") return resolvedRole().chooseTarget();
    if (sharedRoutine.usesLeaderTarget?.()) return sharedRoutine.getGroupedTarget();
    const rare = sharedRoutine.getRareTarget?.();
    if (rare) return rare;
    return resolvedRole().chooseTarget();
  }
  function exclusiveCombat(): boolean {
    return !!sharedRoutine.dungeonOwned?.() || !!sharedRoutine.returnCombatActive?.() || !!sharedRoutine.frankyCombatActive?.();
  }
  async function publishSelection(target: Target | null): Promise<void> {
    selectedTarget = target?.id || (!exclusiveCombat() && sharedRoutine.sharedTargetId?.()) || null;
    sharedRoutine.setCombatTarget(target);
    if (!target && !exclusiveCombat() && sharedRoutine.getFarmingMode() !== "scatter" && !sharedRoutine.usesGroupedCombat?.())
      await sharedRoutine.followLeaderIfFar(150);
  }
  function retainCurrentTarget(current: Target | null, priority: Target | null | undefined): boolean {
    if (!current || invalidated || sharedRoutine.returnCombatActive?.()) return false;
    if (priority && priority.id !== selectedTarget) return false;
    return !encounterTargetChanged();
  }
  function encounterTargetChanged(): boolean {
    const dungeon = sharedRoutine.dungeonOwned?.();
    const rare = dungeon ? null : sharedRoutine.getRareTarget?.();
    if (rare && rare.id !== selectedTarget) return true;
    return formationTargetChanged(dungeon);
  }
  function formationTargetChanged(dungeon: boolean | undefined): boolean {
    if (dungeon) return sharedRoutine.getDungeonTarget?.()?.id !== selectedTarget;
    if (sharedRoutine.usesLeaderTarget?.()) return sharedRoutine.getGroupedTarget()?.id !== selectedTarget;
    return false;
  }
  async function selectTarget() {
    if (selecting || !active) return;
    if (!combatAllowed()) {
      selectedTarget = null;
      sharedRoutine.setCombatTarget(null);
      if (sharedRoutine.clearCombatSelection) sharedRoutine.clearCombatSelection();
      return;
    }
    const current = currentTarget();
    const priorityEventTarget = sharedRoutine.getPriorityEventTarget?.();
    const closer = !exclusiveCombat() && current && !attacks.hasStarted(current.id) && sharedRoutine.getCloserHuntTarget?.(current);
    if (closer) {
      root.sharedRoutine?.resetCombatMovement?.();
      await publishSelection(closer);
      attacks.wake();
      return;
    }
    if (retainCurrentTarget(current, priorityEventTarget)) return;
    invalidated = false;
    selecting = true;
    const epoch = generation;
    try {
      const selected = priorityEventTarget || chooseTarget();
      if (!currentEpoch(epoch) || !combatAllowed()) return;
      const target = selected && !killed.has(selected.id) ? eligibleSelection(selected) : null;
      await publishSelection(target);
      attacks.wake();
    } catch (error) {
      reportError(error);
    } finally {
      if (epoch === generation) { selecting = false; if (invalidated && active) void selectTarget(); }
    }
  }
  function idleMovement(): void {
    if (combatAllowed() && sharedRoutine.defensiveFormationMove?.()) return;
    root.sharedRoutine?.resetCombatMovement?.();
  }
  function equipmentTick() {
    itemSwaps?.tick(!character.rip && combatAllowed());
    if (itemSwaps?.busy() || itemSwaps?.ownsEquipment()) return;
    const actor = character as typeof character & { damage_type?: string };
    const target = sharedRoutine.equipmentTarget ? sharedRoutine.equipmentTarget() : currentTarget();
    equipment?.tick(target, actor.damage_type, Number(character.range), combatAllowed());
  }
  function frankyMovement(): boolean {
    if (!sharedRoutine.frankyCombatActive?.()) return false;
    if (selectedTarget && !currentTarget()) { invalidated = true; void selectTarget(); }
    if (combatAllowed()) sharedRoutine.frankyMovementTick?.(currentTarget());
    attacks.wake();
    return true;
  }
  function movementTick() {
    if (sharedRoutine.deathLoopActive?.()) return;
    const dungeon = !!sharedRoutine.dungeonOwned?.();
    try {
      equipmentTick();
      // This pass follows the independent skill cooldown, never the attack
      // scheduler's pending Fan of Knives cast or attack-family deadline.
      if (character.ctype === 'rogue' && combatAllowed() && !equipment?.busy() && !itemSwaps?.busy())
        void skills?.mentalburst(attackTarget()).catch(reportError);
      if (dungeon && !combatAllowed()) { root.sharedRoutine?.resetCombatMovement?.(); return; }
      if (!dungeon) {
        if(sharedRoutine.returnCombatActive?.()) {
          sharedRoutine.returnMovementTick?.();
          attacks.wake();
          return;
        }
        if (frankyMovement()) return;
        if (sharedRoutine.pollRareHunting?.()) return;
        if (sharedRoutine.pollFarmingCombatHandoff) sharedRoutine.pollFarmingCombatHandoff();
        if (sharedRoutine.pollFarmingSpawnRecovery) sharedRoutine.pollFarmingSpawnRecovery();
      }
      if (selectedTarget && !currentTarget()) { invalidated = true; void selectTarget(); }
      const target = currentTarget();
      entityRefresh.tick({ enabled: combatAllowed(), context: JSON.stringify([character.map, character.in]),
        target: selectedTarget, accepted: root.partyCombatState.attackTiming?.accepted || 0 });
      if (target) missingSince = 0;
      else if (!missingSince) missingSince = Date.now();
      attacks.wake();
      if (combatAllowed() && skills?.farmMovement()) return;
      if (!dungeon && sharedRoutine.groupedMovement?.()) return;
      if (!dungeon && (target || Date.now() - missingSince >= 750) && sharedRoutine.recoverFarmApproach && sharedRoutine.recoverFarmApproach(target)) return;
      if (dungeon && sharedRoutine.caveRecoveryMove?.()) return;
      if (!target) {
        if (dungeon) root.sharedRoutine?.resetCombatMovement?.();
        else idleMovement();
        return;
      }
      if (sharedRoutine.formationMove && sharedRoutine.formationMove(target)) return;
      // These helpers emit collision-checked moves without awaiting arrival.
      // Combat attacks and support continue while the destination is updated.
      Promise.resolve(sharedRoutine.kiteIfNeeded(target))
        .then(function (kiting) {
          if (!kiting && currentTarget() === target)
            return sharedRoutine.approachCombatTarget(target);
        })
        .catch(reportError);
    } catch (error) {
      reportError(error);
    }
  }
  async function supportTick(role: Role, epoch: number): Promise<void> {
    if (!supportAllowed(epoch)) return;
    if (!(await role.usePotion())) await sharedRoutine.regenerateHpOrMp();
    if (!supportAllowed(epoch)) return;
    if (await role.beforeTarget()) return;
    if (!supportAllowed(epoch)) return;
    if (sharedRoutine.caveRecoveryReserved?.() && attacks.pending()) return;
    if (await sharedRoutine.caveRecoveryTick?.()) return;
    if (sharedRoutine.caveRecoveryReserved?.()) return;
    if (!supportAllowed(epoch)) return;
    const target = currentTarget();
    if (target && (!sharedRoutine.groupedAttackAllowed || sharedRoutine.groupedAttackAllowed(target)) &&
        (target.mtype !== "tinyp" || sharedRoutine.rareAttackAllowed?.(target, "support")))
      await role.beforeAttack(target);
  }
  async function lootTick(): Promise<void> {
    if (sharedRoutine.deathLoopActive?.()) return;
    if (looting || !active || character.rip || ["pending", "feed"].includes(sharedRoutine.getAbtestingMode())) return;
    looting = true;
    try {
      // Nearby chest collection must keep running while movement owns the character.
      // smartLoot only opens reachable chests; it never changes the destination.
      await sharedRoutine.smartLoot();
    } catch (error) {
      reportError(error);
    } finally {
      looting = false;
    }
  }
  async function tick() {
    if (working || !active) return;
    working = true;
    const epoch = generation;
    try {
      const role = resolvedRole();
      await root.partyDeathLoop?.tick();
      if (sharedRoutine.deathLoopActive?.()) return;
      if (character.rip) return;
      if (character.ctype === 'rogue') await skills?.maintainRspeed();
      if (!currentEpoch(epoch) || character.rip || sharedRoutine.isOccupied()) return;
      const mode = sharedRoutine.getAbtestingMode();
      if (mode === "pending") return;
      if (mode === "feed") {
        await sharedRoutine.runAbtestingSabotage();
        return;
      }
      await supportTick(role, epoch);
    } catch (error) {
      reportError(error);
    } finally {
      if (epoch === generation) working = false;
    }
  }
  return (root.partyRoleRunner = {
    isKnownDead(id: string) { return killed.has(id); },
    invalidateTarget(id?: string) {
      if (id) killed.set(id, Date.now());
      if (!id || id === selectedTarget) {
        invalidated = true;
        void selectTarget();
      }
      attacks.wake();
    },
    wake() { void selectTarget(); attacks.wake(); },
    advanceTarget() {generation++;selectedTarget=null;invalidated=true;selecting=false;working=false;},
    resetTargeting() {generation++;selectedTarget=null;invalidated=true;selecting=false;working=false;attacks.reset();skills?.reset();queueClient?.reset();},
    role: function () {
      return resolvedRole();
    },
    start: function () {
      if (!root.sharedRoutine || typeof root.sharedRoutine.isOccupied !== "function")
        throw new Error("Shared party code is not ready; refusing to start combat timers");
      if (timer) return;
      skills = installSkillRuntime(root);
      root.partyDeathLoop = installDeathLoop(root);
      equipment = installPorcupineEquipment(root);
      itemSwaps = installItemSwaps(root);
      autoConsumable = installAutoConsumable(root);
      game_log(character.name + " loaded generic " + resolvedRole().name + " behavior", "#51D2E1");
      active = true;
      root.partyCombatState = { at: Date.now(), stage: "start", error: null };
      timer = setInterval(tick, 250);
      lootTimer = setInterval(() => { void lootTick(); }, 250);
      targetTimer = setInterval(() => {
        for (const [id, at] of killed) if (Date.now() - at > 10000) killed.delete(id);
        void selectTarget();
      }, 1000);
      attacks.start();
      movementTimer = setInterval(movementTick, 100);
      void selectTarget();
      respawnTimer = setInterval(function () {
        if (sharedRoutine.deathLoopActive?.()) return;
        if (character.rip) {
          generation += 1;
          selectedTarget = null;
          attacks.reset();
          skills?.reset();
          working = false;
          selecting = false;
        }
        void recoverFromDeath();
      }, 250);
      void recoverFromDeath();
    },
    stop: function () {
      root.partyDeathLoop?.stop();
      skills?.stop();
      equipment?.stop();
      itemSwaps?.stop();
      autoConsumable?.stop();
      queueClient?.stop();queueMarkers?.stop();
      lootClient?.stop();trace?.stop();
      active = false;
      generation += 1;
      selectedTarget = null;
      attacks.reset();
      attacks.stop();
      if (movementTimer) clearInterval(movementTimer);
      if (targetTimer) clearInterval(targetTimer);
      if (root.sharedRoutine && root.sharedRoutine.resetCombatMovement)
        root.sharedRoutine.resetCombatMovement();
      if (timer) clearInterval(timer);
      clearInterval(lootTimer);
      lootTimer = undefined;
      if (respawnTimer) clearInterval(respawnTimer);
      timer = null;
      respawnTimer = null;
      working = false;
    },
  });
}
