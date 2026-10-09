import { strategyEnabled } from '../../combat/strategies.ts';
import { errorReason, type CombatRoot } from './types.ts';

/** Latch the 95% trigger through deaths and runner reloads until zero XP. */
export function installDeathLoop(root: CombatRoot) {
  const shared = root.sharedRoutine;
  // The CODE parent survives runner reloads; upstream omits application state.
  const host: Window & { __partyDeathLoopRunning?: boolean } = parent;
  let entered = false, busy = false, stopped = false, returning = false, retryAt = 0;
  let travelling = false;
  function enabled() {
    return !stopped && character.ctype !== 'merchant' &&
      strategyEnabled(shared.combatStrategySettings?.(), 'death-loop');
  }
  function active(): boolean {
    if (!entered && shared.activityReserved?.()) return false;
    if (!enabled()) {
      if (!stopped && !entered) host.__partyDeathLoopRunning = false;
      return entered;
    }
    const required = G.levels[character.level];
    return entered || !!host.__partyDeathLoopRunning ||
      required > 0 && character.xp / required >= .95;
  }
  function stage(value: string) {
    Object.assign(root.partyCombatState, { at: Date.now(), stage: value });
    set_message(value);
  }
  async function finish() {
    // Release ownership before the saved activity's recovery requests movement.
    entered = false;
    host.__partyDeathLoopRunning = false;
    returning = true;
    stage('death-loop-returning');
    await shared.deathLoopLeave?.();
    returning = false;
    stage('death-loop-complete');
  }
  async function tick() {
    if (stopped || busy || !active() && !returning || Date.now() < retryAt) return;
    busy = true;
    try {
      if (returning) { await finish(); return; }
      if (!enabled()) { await finish(); return; }
      if (!entered) {
        entered = true;
        host.__partyDeathLoopRunning = true;
        await shared.deathLoopEnter?.();
      }
      if (!enabled()) return;
      if (character.rip) {
        stage('death-loop-respawning');
        retryAt = Date.now() + 2000;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([respawn(), new Promise<void>(resolve => {
            timeout = setTimeout(resolve, 3000);
          })]);
        } finally { clearTimeout(timeout); }
        return;
      }
      if (character.xp <= 0) { await finish(); return; }
      if (character.map !== 'arena') {
        stage('death-loop-arena');
        if (!travelling) {
          travelling = true;
          void Promise.resolve(shared.deathLoopMove?.('arena')).catch(error => {
            if (!stopped && entered && enabled()) { report(error); retryAt = Date.now() + 1000; }
          }).finally(() => { travelling = false; });
        }
        return;
      }
      const target = get_nearest_monster({ min_xp: 100, path_check: true, target: character.name }) ||
        get_nearest_monster({ min_xp: 100, path_check: true, no_target: true });
      if (!target) { stage('death-loop-no-monsters'); return; }
      stage('death-loop');
      change_target(target);
      // Walk into the monster rather than kiting or restoring HP. Only provoke
      // it while unclaimed; repeated damage would earn XP and delay completion.
      if (Math.hypot(target.x - character.x, target.y - character.y) > 8)
        void Promise.resolve(move(character.x + (target.x - character.x) / 6,
          character.y + (target.y - character.y) / 6)).catch(report);
      if (!target.target && can_attack(target)) await attack(target);
    } catch (error) {
      report(error);
      retryAt = Date.now() + 1000;
    } finally { busy = false; }
  }
  function report(error: unknown) {
    const reason = errorReason(error);
    if (reason === 'cooldown' || reason === 'cant_respawn') return;
    Object.assign(root.partyCombatState, { error: reason, errorAt: Date.now() });
    game_log('Death loop: ' + reason, 'red');
  }
  return { active, tick, stop() { stopped = true; } };
}
