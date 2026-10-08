import { createStartupSlots } from "./startup-slots.ts";
import {
  coordinatorGenerationPorts,
  installCoordinatorShutdownSignals,
} from "./runtime-lifecycle.ts";
import { reservedForSteam } from "../../roster/handoff.ts";
import type { RosterOwnership } from "../../roster/handoff.ts";
import type { watchGenerations } from "../../lifecycle/generations.ts";

type Worker = Parameters<typeof coordinatorGenerationPorts>[0][string] & { connected?: boolean };
interface StartupState {
  nativeOwner: RosterOwnership["native"];
  steamMembers: RosterOwnership["steam"];
  headlessSlots: RosterOwnership["slots"];
  steamSwitch: RosterOwnership["handoff"];
}
interface StartupPorts<Block> {
  events: Parameters<typeof installCoordinatorShutdownSignals>[0];
  shutdown: (reason: string) => Promise<unknown>;
  watch: (name: string, worker: Block) => void;
  owned: (name: string) => { type?: string } | null | undefined;
  ensure: (name: string) => Block;
  homeWorld: (name: string) => string | undefined;
  start: (name: string) => void;
  persist: () => void;
  later: (callback: () => void, milliseconds: number) => unknown;
  watchCode: boolean;
  watchGenerations: (ports: Parameters<typeof watchGenerations>[0]) => unknown;
  stop: (worker: Block, reason: string) => Promise<unknown>;
  report: (message: string, details?: unknown) => void;
  subscribeAccount: () => void;
}

/** Prepare workers before subscribing to updates; delayed restoration uses current Steam reservations. */
export function startCoordinatorCharacters<Block extends Worker>(
  workers: Record<string, Block>,
  state: StartupState,
  ports: StartupPorts<Block>,
): void {
  installCoordinatorShutdownSignals(ports.events, ports.shutdown);
  const slots = createStartupSlots(workers, state, {
    watch: ports.watch,
    owned: (name) => !!ports.owned(name),
    ensure: ports.ensure,
    homeWorld: ports.homeWorld,
    reserved: (name) =>
      reservedForSteam(
        {
          native: state.nativeOwner,
          steam: state.steamMembers,
          slots: state.headlessSlots,
          handoff: state.steamSwitch,
        },
        name!,
      ),
    start: ports.start,
    persist: ports.persist,
  });
  slots.prepare();
  ports.later(() => slots.restore(), 4000);
  if (ports.watchCode)
    ports.watchGenerations(
      coordinatorGenerationPorts(workers, {
        owned: (name) => ports.owned(name)!,
        stop: ports.stop,
        report: ports.report,
      }),
    );
  ports.subscribeAccount();
}
