import { monsterAttackBlock } from "./monster-attack-policy.ts";

export type WeaponItem = { name: string; level?: number; [key: string]: unknown };
type Hands = { mainhand: WeaponItem | null; offhand: WeaponItem | null };
export interface WeaponSession {
  original: Hands;
  expected: Hands;
  bow: WeaponItem;
  restoring: boolean;
}
export interface WeaponMemory {
  session?: WeaponSession;
  pending?: Promise<void>;
  suppressedTarget?: string;
  target?: string;
  retryAt?: number;
}
export interface WeaponPorts {
  now(): number;
  hands(): Hands;
  items(): (WeaponItem | null)[];
  usableBow(item: WeaponItem): boolean;
  twoHanded(item: WeaponItem): boolean;
  fingerprint(item: WeaponItem | null): WeaponItem | null;
  same(item: WeaponItem | null, wanted: WeaponItem | null): boolean;
  equip(index: number, slot: "mainhand" | "offhand"): Promise<unknown>;
  unequip(slot: "offhand"): Promise<unknown>;
  report(message: string): void;
}

/** Shared state lives on the game host so CODE replacement cannot lose the loadout. */
export function createPorcupineEquipment(ports: WeaponPorts, memory: WeaponMemory = {}) {
  let active = true;
  const copyHands = (): Hands => ({
    mainhand: ports.fingerprint(ports.hands().mainhand),
    offhand: ports.fingerprint(ports.hands().offhand),
  });
  const matches = (hands: Hands) => ports.same(ports.hands().mainhand, hands.mainhand) &&
    ports.same(ports.hands().offhand, hands.offhand);
  function relinquish() {
    memory.suppressedTarget = memory.target;
    delete memory.session;
  }
  function owned(session: WeaponSession): boolean {
    if (!active || memory.session !== session) return false;
    if (matches(session.expected)) return true;
    relinquish();
    return false;
  }
  function find(item: WeaponItem): number {
    const index = ports.items().findIndex(candidate => ports.same(candidate, item));
    if (index < 0) throw new Error("Saved porcupine equipment is missing from inventory: " + item.name);
    return index;
  }
  async function equip(item: WeaponItem, slot: "mainhand" | "offhand", session: WeaponSession) {
    if (!owned(session)) return;
    await ports.equip(find(item), slot);
    session.expected = copyHands();
    if (!ports.same(ports.hands()[slot], item)) throw new Error("Game did not equip " + item.name);
  }
  async function swap(session: WeaponSession) {
    if (!owned(session) || session.restoring) return;
    if (ports.twoHanded(session.bow) && ports.hands().offhand) {
      if (!ports.items().some(item => !item)) throw new Error("Porcupine bow needs inventory space for offhand");
      await ports.unequip("offhand");
      session.expected = copyHands();
      if (ports.hands().offhand) throw new Error("Game did not clear offhand for porcupine bow");
    }
    if (owned(session) && !session.restoring) await equip(session.bow, "mainhand", session);
  }
  async function restore(session: WeaponSession) {
    if (!owned(session)) return;
    if (session.original.mainhand && !ports.same(ports.hands().mainhand, session.original.mainhand))
      await equip(session.original.mainhand, "mainhand", session);
    if (!owned(session)) return;
    if (session.original.offhand && !ports.same(ports.hands().offhand, session.original.offhand))
      await equip(session.original.offhand, "offhand", session);
    if (owned(session) && matches(session.original)) delete memory.session;
  }
  function run(operation: () => Promise<void>) {
    if (!active || memory.pending || ports.now() < (memory.retryAt || 0)) return;
    const pending = operation().catch(error => {
      memory.retryAt = ports.now() + 2000;
      ports.report(String(error instanceof Error ? error.message : error));
    }).finally(() => { if (memory.pending === pending) delete memory.pending; });
    memory.pending = pending;
  }
  function needsBow(target: { id: string; mtype?: string } | null, damageType: string | undefined, range: number, allowed: boolean) {
    return allowed && !!target && target.id !== memory.suppressedTarget && target.mtype === "porcupine" &&
      !!ports.hands().mainhand && !!monsterAttackBlock(target.mtype, damageType, range) &&
      ports.now() >= (memory.retryAt || 0);
  }
  function continueSession(session: WeaponSession, target: { mtype?: string } | null, allowed: boolean) {
    if (!owned(session)) return;
    if (session.restoring) run(() => restore(session));
    else if (allowed && target?.mtype === "porcupine" && !ports.same(ports.hands().mainhand, session.bow))
      run(() => swap(session));
  }
  function beginSwap() {
    const bow = ports.items().map((item, index) => ({ item, index }))
      .filter((entry): entry is { item: WeaponItem; index: number } => !!entry.item && ports.usableBow(entry.item))
      .sort((a, b) => (Number(b.item.level) || 0) - (Number(a.item.level) || 0) || a.index - b.index)[0]?.item;
    if (!bow) {
      memory.retryAt = ports.now() + 2000;
      ports.report("Porcupine melee blocked: no usable inventory bow");
      return;
    }
    const next: WeaponSession = { original: copyHands(), expected: copyHands(), bow: ports.fingerprint(bow)!, restoring: false };
    memory.session = next;
    run(() => swap(next));
  }
  return {
    tick(target: { id: string; mtype?: string } | null, damageType: string | undefined, range: number, allowed: boolean) {
      if (!active || memory.pending) return;
      if (target) memory.target = target.id;
      const session = memory.session;
      if (session) {
        continueSession(session, target, allowed);
        return;
      }
      if (needsBow(target, damageType, range, allowed)) beginSwap();
    },
    depart(purpose?: string) {
      if (purpose === "grouped-approach") return;
      memory.suppressedTarget = memory.target;
      if (!memory.session) return;
      memory.session.restoring = true;
      memory.retryAt = 0;
      run(() => restore(memory.session!));
    },
    async manual() {
      relinquish();
      await memory.pending;
    },
    busy: () => !!memory.pending,
    ownsHands: () => !!memory.session,
    stop() { active = false; },
  };
}
