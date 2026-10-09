import { randomUUID } from "node:crypto";
import { receiveWorkerMessage, type IPCPorts } from "./ipc.ts";
import { sendWorker, stopWorker, workerExited } from "./processes.ts";
import type {
  CharacterBlock,
  Lifecycle,
  Worker,
  WorkerArguments,
  WorkerClock,
  WorkerLog,
  WorkerStore,
} from "./types.ts";

interface Realm {
  address?: string;
  addr?: string;
  path?: string;
  port?: string | number;
}
interface Character {
  id: string | number;
  type: string;
}

export interface CharacterManagerPorts {
  allowed?(name: string): boolean;
  blocks: Record<string, CharacterBlock>;
  clock: WorkerClock;
  log: WorkerLog;
  local: WorkerStore;
  session: WorkerStore;
  version: number;
  currentVersion?(): number;
  clientUpdate?(event: "welcome" | "reloaded"): void;
  sessionToken: string | undefined;
  typeCode: boolean;
  minimap: boolean;
  classIds: Readonly<Record<string, number>>;
  lifecycle(name: string, lifecycle: Lifecycle): void;
  resolveRealm(realm: string | undefined): Realm | undefined;
  resolveCharacter(name: string): Character | undefined;
  refreshAccount(): Promise<unknown>;
  account(): unknown;
  repair(): Promise<unknown>;
  fork(): Worker;
  pipe(worker: Worker): void;
  monitor(name: string, block: CharacterBlock): { destroy(): void } | null;
}

function argumentsFor(
  name: string,
  block: CharacterBlock,
  realm: Realm,
  character: Character,
  ports: CharacterManagerPorts,
): WorkerArguments {
  const args: WorkerArguments = {
    version: block.version || ports.currentVersion?.() || ports.version,
    clientInstance: randomUUID(),
    realm_address: realm.address || realm.addr,
    realm_path: realm.path || "",
    realm_port: realm.port || "",
    sess: ports.sessionToken,
    cid: character.id,
    script_file: block.script,
    enable_map: ports.minimap,
    cname: name,
    clid: ports.classIds[character.type] || -1,
  };
  if (ports.typeCode) args.typescript_file = block.typescript;
  return args;
}

/** The manager owns worker process transitions; gameplay services only request starts/stops. */
export function createCharacterManager(ports: CharacterManagerPorts) {
  function stop(block: CharacterBlock, reason = "requested worker restart"): Promise<void> {
    return stopWorker(block, reason, ports.clock, ports.log);
  }

  function siblings(account: unknown = ports.account()): void {
    const names = Object.keys(ports.blocks)
      .filter((name) => ports.blocks[name].connected)
      .sort();
    for (const name of names)
      sendWorker(ports.blocks[name].instance, {
        type: "siblings_and_acc",
        account,
        siblings: names,
      });
  }

  function missingRealm(name: string, block: CharacterBlock): void {
    ports.log.warn(
      `could not find intended realm ${block.realm}; refusing to start ${name} elsewhere`,
    );
    ports.lifecycle(name, "realm-error");
    ports.clock.cancel(block.restart_timeout);
    void ports
      .refreshAccount()
      .catch((error) => ports.log.warn(`realm refresh failed for ${name}`, error));
    block.restart_timeout = ports.clock.later(() => {
      if (block.enabled && !block.instance) start(name);
    }, 3000);
  }

  function connect(name: string, block: CharacterBlock, args: WorkerArguments): Worker {
    const worker = ports.fork();
    ports.pipe(worker);
    block.instance = worker;
    worker.on("exit", (code, signal) =>
      workerExited(name, block, worker, code, signal, { ...ports, start }),
    );
    const ipc: IPCPorts = { ...ports, start, stop, siblings: () => siblings() };
    worker.on("message", (value) => receiveWorkerMessage(name, block, worker, args, value, ipc));
    const monitor = ports.monitor(name, block);
    if (monitor) block.monitor = monitor;
    return worker;
  }

  function start(name: string): Worker | undefined {
    const block = ports.blocks[name];
    if (ports.allowed?.(name) === false) { block.enabled = false; ports.lifecycle(name, 'offline'); return; }
    ports.lifecycle(name, "starting");
    const realm = ports.resolveRealm(block.realm);
    if (!realm) {
      missingRealm(name, block);
      return;
    }
    const character = ports.resolveCharacter(name);
    if (!character) {
      ports.log.error(`could not resolve character ${name}`, "this character will not be started");
      ports.log.error("are you sure you own this character and have not deleted it?");
      block.enabled = false;
      return;
    }
    const args = argumentsFor(name, block, realm, character, ports);
    block.clientVersion = args.version;
    block.clientInstance = args.clientInstance;
    ports.log.log(`starting ${name} running version ${args.version} in ${block.realm}`);
    return connect(name, block, args);
  }

  async function stopAll(): Promise<void> {
    await Promise.all(
      Object.values(ports.blocks).map((block) => {
        block.enabled = false;
        return stop(block);
      }),
    );
  }

  return { start, stop, siblings, stopAll };
}
