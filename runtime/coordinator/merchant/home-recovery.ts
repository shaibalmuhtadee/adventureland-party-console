import { realmSwitchInProgress, type RealmOperation } from '../characters/realm-switch.ts';

interface Worker {
  realm?: string;
}
interface Sale {
  reason?: string;
  startedAt?: unknown;
  buyOrder?: { buyer?: string; item?: { name?: string } };
}
interface HomeState {
  merchantCharacter: string | null;
  activeRealm: string;
  merchantHomeReturnAt?: number;
  statuses: Record<string, { server?: string } | undefined>;
  commands: Record<string, unknown>;
  merchantCurrent?: Sale | null;
  realmSwitch?: Pick<RealmOperation, 'phase'> | null;
}
interface HomePorts<T extends Worker> {
  now(): number;
  block(name: string): T;
  realmLabel(realm: string): string;
  log(message: string, level: string, details?: unknown): void;
  persist(): void;
  restart(block: T, delay: number): void;
}

export function merchantRoutineNeedsHome(reason: string): boolean {
  return ![
    "ALData marketplace purchases",
    "ALData marketplace sales",
    "join giveaway",
    "Ponty purchases",
    "ponty shop",
    "stand maintenance",
  ].includes(reason);
}

/** Realm recovery waits for both the worker assignment and the character's reported arrival. */
export function createMerchantHomeRecovery<T extends Worker>(
  state: HomeState,
  ports: HomePorts<T>,
) {
  function ensureHome(reason: string): boolean {
    if (realmSwitchInProgress(state.realmSwitch)) return false;
    const merchant = state.merchantCharacter,
      status = state.statuses[String(merchant)];
    if (!merchant || !status) return false;
    const block = ports.block(merchant),
      home = state.activeRealm;
    if ("SR_" + String(status.server || "").replace(/^SR_/, "") === home && block.realm === home) {
      state.merchantHomeReturnAt = 0;
      return true;
    }
    if (!state.merchantHomeReturnAt || ports.now() - state.merchantHomeReturnAt > 15000) {
      state.merchantHomeReturnAt = ports.now();
      block.realm = home;
      delete state.commands[merchant];
      ports.log(
        "Returning " + merchant + " to " + ports.realmLabel(home) + " before " + reason,
        "info",
      );
      ports.persist();
      ports.restart(block, 150);
    }
    return false;
  }

  /** Never retry an ambiguous WTB sale: the server may already have fulfilled it. */
  function recoverStalledSale(): boolean {
    if (realmSwitchInProgress(state.realmSwitch)) return false;
    const job = state.merchantCurrent;
    const merchant = state.merchantCharacter;
    if (
      !merchant ||
      !job ||
      job.reason !== "ALData marketplace sales" ||
      ports.now() - Number(job.startedAt || ports.now()) < 180000
    )
      return false;
    state.merchantCurrent = null;
    delete state.commands[String(state.merchantCharacter)];
    const block = ports.block(merchant);
    block.realm = state.activeRealm;
    state.merchantHomeReturnAt = ports.now();
    ports.log(
      "Stopped stalled WTB fill for " +
        (job.buyOrder?.buyer || "unknown buyer") +
        " after 3 minutes; returning home without retrying the sale",
      "error",
      { item: job.buyOrder?.item?.name },
    );
    ports.persist();
    ports.restart(block, 100);
    return true;
  }
  return { ensureHome, recoverStalledSale };
}
