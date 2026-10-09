import type { InventoryCleanoutPlan } from './inventory-cleanout.ts';

interface Job {
  name: string;
  type: string;
}
interface State {
  bankCurrent: Job | null;
  bankQueue: Job[];
  bankStartedAt: number;
  location: unknown;
  commands: Record<string, unknown>;
  upgrades: Record<string, unknown>;
  purchases: Record<string, unknown>;
  compounds: Record<string, unknown>;
  marked: Record<string, unknown>;
  withdrawals: Record<string, unknown>;
  goldTargets: Record<string, unknown>;
}
/** Serializes legacy character bank visits and snapshots their command payload at dispatch. */
export function createBankQueue(state: State, ports: {
  now(): number;
  nextCommand(): number;
  cleanout?(name: string): InventoryCleanoutPlan | null;
  allowed?(name: string): boolean;
}) {
  function dispatch(): void {
    if (state.bankCurrent || !state.bankQueue.length) return;
    if (ports.allowed?.(state.bankQueue[0]!.name) === false) return;
    const job = state.bankQueue.shift()!,
      name = job.name;
    if (job.type === 'inventory-cleanout') {
      const plan = ports.cleanout?.(name);
      if (!plan) { dispatch(); return; }
      state.bankCurrent = job;
      state.bankStartedAt = ports.now();
      state.commands[name] = { id: ports.nextCommand(), type: 'bank', inventoryCleanout: true,
        ...plan, withdrawals: [] };
      return;
    }
    state.bankCurrent = job;
    state.bankStartedAt = ports.now();
    state.commands[name] =
      job.type === "upgrade"
        ? {
            id: ports.nextCommand(),
            type: "upgrade",
            items: state.upgrades[name] || [],
            purchases: state.purchases[name] || [],
            compounds: state.compounds[name] || [],
            returnLocation: state.location,
          }
        : {
            id: ports.nextCommand(),
            type: "bank",
            marked: state.marked[name] || [],
            withdrawals: state.withdrawals[name] || [],
            goldTarget: Number.isSafeInteger(state.goldTargets[name])
              ? state.goldTargets[name]
              : null,
            returnLocation: state.location,
          };
  }
  function queue(names: string[], type = "bank"): void {
    for (const name of names) {
      const matches = (job: Job | null) => job?.name === name && job.type === type;
      if (!matches(state.bankCurrent) && !state.bankQueue.some(matches))
        state.bankQueue.push({ name, type });
    }
    dispatch();
  }
  return { queue, dispatch };
}
