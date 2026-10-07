import { sameSwapItem, validSwapItem, isSwapSlot, type ItemSwap, type SwapItem, type SwapSlot,
  type SwapStrategy } from '../../item-swaps.ts';

export interface SwapSession {
  strategy: SwapStrategy;
  target: string;
  threshold: number;
  configuration: string;
  phase: 'equipping' | 'equipped' | 'restoring';
  slots: { slot: SwapSlot; original: SwapItem | null; desired: SwapItem | null; inventorySlot: number }[];
}
export interface SwapMemory { loaded?: boolean; session?: SwapSession; pending?: Promise<void>; retryAt?: number; suppressed?: string }
export interface SwapDiagnostic {
  reserved?: SwapItem[];
  phase: 'idle' | SwapSession['phase'] | 'blocked'; strategy?: SwapStrategy; target?: string;
  threshold?: number; error?: string;
}
export interface SwapTrigger { target: string; threshold: number }
interface Ports {
  now(): number;
  equipped(slot: SwapSlot): SwapItem | null;
  inventory(): (SwapItem | null)[];
  prepare(swap: ItemSwap, trigger: SwapTrigger): SwapSession;
  batch(entries: { num: number; slot: SwapSlot }[]): Promise<unknown>;
  unequip(slot: SwapSlot): Promise<unknown>;
  save(session: SwapSession | null): void;
  report(value: SwapDiagnostic): void;
}
export function validSwapSession(value: unknown): value is SwapSession {
  if (!value || typeof value !== 'object' || !('strategy' in value) || value.strategy !== 'luck-before-kill' ||
    !('target' in value) || typeof value.target !== 'string' || !('threshold' in value) || typeof value.threshold !== 'number' ||
    !('configuration' in value) || typeof value.configuration !== 'string' ||
    !('phase' in value) || !['equipping', 'equipped', 'restoring'].includes(String(value.phase)) ||
    !('slots' in value) || !Array.isArray(value.slots)) return false;
  return value.slots.every(entry => entry && typeof entry === 'object' && isSwapSlot(entry.slot) &&
    (entry.original === null || validSwapItem(entry.original)) && (entry.desired === null || validSwapItem(entry.desired)) &&
    Number.isInteger(entry.inventorySlot)) && new Set(value.slots.map(entry => entry.slot)).size === value.slots.length;
}
/** One owner serializes all strategies and keeps the pre-swap loadout until restoration succeeds. */
export function createItemSwapController(ports: Ports, memory: SwapMemory) {
  let active = true;
  function checkpoint(session: SwapSession) { ports.save(session); }
  function run(operation: () => Promise<void>) {
    if (!active || memory.pending || ports.now() < (memory.retryAt || 0)) return;
    const pending = operation().catch(error => {
      memory.retryAt = ports.now() + 1500;
      ports.report({ phase: 'blocked', strategy: memory.session?.strategy, target: memory.session?.target,
        error: String(error && typeof error === 'object' && 'message' in error ? error.message : error) });
    }).finally(() => { if (memory.pending === pending) delete memory.pending; });
    memory.pending = pending;
  }
  function find(item: SwapItem, preferred: number, used: Set<number>) {
    const items = ports.inventory();
    const index = !used.has(preferred) && sameSwapItem(items[preferred], item) ? preferred :
      items.findIndex((candidate, i) => !used.has(i) && sameSwapItem(candidate, item));
    if (index < 0) throw Error('Swap gear missing from inventory: ' + item.name);
    used.add(index);
    return index;
  }
  async function apply(session: SwapSession, restoring: boolean) {
    const field = restoring ? 'original' : 'desired';
    const used = new Set<number>();
    // Resolve every item before any mutation so missing gear cannot cause a partial swap.
    const entries = session.slots.filter(entry => entry[field] && !sameSwapItem(ports.equipped(entry.slot), entry[field]))
      .map(entry => ({ num: find(entry[field]!, entry.inventorySlot, used), slot: entry.slot }));
    for (const entry of session.slots) {
      if (!entry[field] && ports.equipped(entry.slot)) {
        if (!ports.inventory().some(item => !item)) throw Error('Inventory space needed to restore empty equipment slot');
        await ports.unequip(entry.slot);
      }
    }
    if (entries.length) await ports.batch(entries);
    // Native equip promises can precede the reactive player update.
    const deadline = ports.now() + 1000;
    while (ports.now() < deadline && session.slots.some(entry => !sameSwapItem(ports.equipped(entry.slot), entry[field])))
      await new Promise<void>(resolve => setTimeout(resolve, 25));
    const failed = session.slots.filter(entry => !sameSwapItem(ports.equipped(entry.slot), entry[field]));
    if (failed.length) throw Error('Equipment batch incomplete: ' + failed.map(entry => entry.slot).join(', '));
  }
  async function restore(session: SwapSession) {
    session.phase = 'restoring';
    checkpoint(session);
    ports.report({ phase: 'restoring', strategy: session.strategy, target: session.target });
    // A manual change made outside the console transfers that slot's ownership.
    session.slots = session.slots.filter(entry => sameSwapItem(ports.equipped(entry.slot), entry.original) ||
      sameSwapItem(ports.equipped(entry.slot), entry.desired));
    checkpoint(session);
    await apply(session, true);
    ports.save(null);
    delete memory.session;
    ports.report({ phase: 'idle' });
  }
  async function restoreForActivity() {
    await memory.pending;
    const session = memory.session;
    if (!session) return;
    memory.retryAt = 0;
    const pending = restore(session);
    memory.pending = pending;
    try { await pending; }
    finally { if (memory.pending === pending) delete memory.pending; }
  }
  return {
    tick(swaps: ItemSwap[], trigger: (swap: ItemSwap) => SwapTrigger | null, allowed: boolean) {
      if (!active || memory.pending) return;
      const winner = allowed ? swaps.find(swap => swap.enabled && swap.items.length && trigger(swap)) : undefined;
      const next = winner && trigger(winner);
      const session = memory.session;
      if (session) {
        if (session.phase !== 'equipped' || !winner || winner.strategy !== session.strategy ||
          JSON.stringify(winner) !== session.configuration || !next)
          run(() => restore(session));
        else if (next.target !== session.target) {
          session.target = next.target; session.threshold = next.threshold;
          checkpoint(session);
          ports.report({ phase: 'equipped', strategy: session.strategy, target: session.target, threshold: session.threshold });
        }
        return;
      }
      if (!winner || !next || memory.suppressed === next.target) return;
      run(async () => {
        const created = ports.prepare(winner, next);
        memory.session = created;
        checkpoint(created);
        ports.report({ phase: 'equipping', strategy: created.strategy, target: created.target, threshold: created.threshold });
        try {
          await apply(created, false);
          created.phase = 'equipped';
          checkpoint(created);
          ports.report({ phase: 'equipped', strategy: created.strategy, target: created.target, threshold: created.threshold });
        } catch (error) {
          created.phase = 'restoring';
          checkpoint(created);
          throw error;
        }
      });
    },
    async manual() {
      if (memory.session) memory.suppressed = memory.session.target;
      await restoreForActivity();
    },
    restoreForActivity,
    reserved(item: SwapItem) { return !!memory.session?.slots.some(entry =>
      sameSwapItem(item, entry.original) || sameSwapItem(item, entry.desired)); },
    busy: () => !!memory.pending,
    ownsEquipment: () => !!memory.session,
    stop() { active = false; },
  };
}
