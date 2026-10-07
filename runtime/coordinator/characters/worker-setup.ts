import type { CharacterBlock } from "./types.ts";

export type SetupWorker = CharacterBlock;
interface SetupState {
  activeRealm?: string;
  location?: { realm?: string } | null;
  headlessSlots: (string | null)[];
  lifecycle: Record<string, string | undefined>;
}
interface SetupPorts {
  configuredRealm: string;
  script(name: string): string;
  watch(name: string, worker: SetupWorker): void;
  persist(): void;
  start(name: string): void;
}

/** Normalize worker configuration before starting or assigning it to a headless slot. */
export function createWorkerSetup(
  workers: Record<string, SetupWorker | undefined>,
  state: SetupState,
  ports: SetupPorts,
) {
  function ensure(name: string): SetupWorker {
    const block = workers[name] || (workers[name] = {});
    block.realm =
      block.realm || state.activeRealm || state.location?.realm || ports.configuredRealm;
    if (block.code_watcher) {
      block.code_watcher.close();
      block.code_watcher = null;
    }
    block.script = ports.script(name);
    block.version = block.version || 0;
    block.connected = !!block.connected;
    ports.watch(name, block);
    return block;
  }
  function assign(slot: number, name: string, realm?: string): void {
    state.headlessSlots[slot - 1] = name;
    ports.persist();
    const block = ensure(name);
    if (realm) block.realm = realm;
    block.enabled = true;
    state.lifecycle[name] = block.connected ? "online" : "starting";
    if (!block.instance) ports.start(name);
  }
  return { ensure, assign };
}
