interface StartupWorker {
  connected?: boolean;
  enabled?: boolean;
  realm?: string;
}
interface StartupSlots {
  headlessSlots: (string | null)[];
  nativeOwner: string | null;
}
interface StartupPorts<T extends StartupWorker> {
  watch(name: string, worker: T): void;
  reserved(name: string | null): boolean;
  owned(name: string): boolean;
  ensure(name: string): T;
  homeWorld(name: string): string | undefined;
  start(name: string): void;
  persist(): void;
}

/** Startup restoration is the single authority for enabling saved headless slots. */
export function createStartupSlots<T extends StartupWorker>(
  workers: Record<string, T>,
  state: StartupSlots,
  ports: StartupPorts<T>,
) {
  function prepare(): void {
    for (const name of Object.keys(workers)) {
      const worker = workers[name];
      worker.connected = false;
      ports.watch(name, worker);
      worker.enabled = false;
    }
  }
  function restore(): void {
    const native = state.nativeOwner;
    state.headlessSlots.forEach((name, index) => {
      if (ports.reserved(name)) return;
      if (!name || !ports.owned(name) || name === native) {
        state.headlessSlots[index] = null;
        return;
      }
      const worker = ports.ensure(name);
      const homeWorld = ports.homeWorld(name);
      if (homeWorld) worker.realm = homeWorld;
      if (!worker.enabled) {
        worker.enabled = true;
        ports.start(name);
      }
    });
    ports.persist();
  }
  return { prepare, restore };
}
