import type { CharacterBlock } from "./types.ts";

export interface RealmOperation {
  id: string;
  realm: string;
  participants: string[];
  startedAt: number;
  setHome?: boolean;
  phase: string;
  characters: { name: string; realm: string | null; arrived: boolean }[];
  completedAt?: number | null;
  message?: string;
  error?: string | null;
  fromRealm?: string | null;
  homeRealm?: string | null;
  homeExecutor?: string;
}

/** Party realm transitions own worker assignments until arrival and home confirmation finish. */
export function realmSwitchInProgress(operation: Pick<RealmOperation, 'phase'> | null | undefined): boolean {
  return operation?.phase === 'switching' || operation?.phase === 'setting-home';
}
interface RealmStatus {
  seenAt: number;
  server?: string;
  ctype?: string;
}
interface RealmCommand {
  id: number;
  type: "native-realm-switch" | "realm-set-home";
  realm: string;
  operationId: string;
}
interface RealmPorts {
  now(): number;
  sleep(ms: number): Promise<void>;
  pauseMerchant(): void;
  clearCommand(name: string): void;
  native(): string | null;
  steamMembers(): readonly string[];
  block(name: string): CharacterBlock;
  stop(block: CharacterBlock): Promise<void>;
  nextCommand(): number;
  command(name: string, command: RealmCommand): void;
  persist(): void;
  status(name: string): RealmStatus | undefined;
  setActiveRealm(realm: string): void;
  label(realm: string): string;
  leader(): string | null;
  dispatchMerchant(): void;
}

/** Coordinates one requested realm transition without changing worker restart ownership. */
export function createRealmSwitch(ports: RealmPorts) {
  function arrived(name: string, operation: RealmOperation): boolean {
    const status = ports.status(name);
    return (
      !!status && status.seenAt >= operation.startedAt && "SR_" + status.server === operation.realm
    );
  }

  function observations(operation: RealmOperation): RealmOperation["characters"] {
    return operation.participants.map((name) => ({
      name,
      realm: ports.status(name)?.server ? "SR_" + ports.status(name)?.server : null,
      arrived: arrived(name, operation),
    }));
  }

  async function depart(operation: RealmOperation): Promise<void> {
    ports.pauseMerchant();
    operation.participants.forEach((name) => ports.clearCommand(name));
    const native = ports.native();
    const headless = operation.participants.filter((name) => !ports.steamMembers().includes(name));
    for (const name of headless) {
      const block = ports.block(name);
      block.realm = operation.realm;
      if (block.enabled) await ports.stop(block);
    }
    if (native)
      ports.command(native, {
        id: ports.nextCommand(),
        type: "native-realm-switch",
        realm: operation.realm,
        operationId: operation.id,
      });
    ports.persist();
  }

  async function awaitArrival(operation: RealmOperation): Promise<void> {
    const deadline = ports.now() + 60_000;
    while (ports.now() < deadline) {
      const allArrived = operation.participants.every((name) => arrived(name, operation));
      operation.characters = observations(operation);
      if (allArrived) break;
      await ports.sleep(500);
    }
    if (
      !operation.participants.every((name) =>
        operation.characters.some((entry) => entry.name === name && entry.arrived),
      )
    )
      throw new Error("Not every active character confirmed the destination within 60 seconds");
  }

  function canSetHome(name: string): boolean {
    const status = ports.status(name);
    return !!status && status.ctype !== "merchant";
  }

  function assignHomeExecutor(operation: RealmOperation): void {
    const leader = ports.leader();
    const executor =
      leader && operation.participants.includes(leader) && canSetHome(leader)
        ? leader
        : operation.participants.find(canSetHome);
    if (!executor) throw new Error("No connected non-merchant character can visit Bean");
    operation.homeExecutor = executor;
    ports.command(executor, {
      id: ports.nextCommand(),
      type: "realm-set-home",
      operationId: operation.id,
      realm: operation.realm,
    });
  }

  function finish(operation: RealmOperation): void {
    ports.setActiveRealm(operation.realm);
    operation.phase = operation.setHome ? "setting-home" : "complete";
    operation.completedAt = operation.setHome ? null : ports.now();
    operation.message = operation.setHome
      ? "Party arrived; visiting Bean to set the home realm"
      : "Every active character arrived on " + ports.label(operation.realm);
    ports.persist();
    if (operation.setHome) assignHomeExecutor(operation);
    else ports.dispatchMerchant();
  }

  async function run(operation: RealmOperation): Promise<void> {
    try {
      await depart(operation);
      await awaitArrival(operation);
      finish(operation);
    } catch (error) {
      operation.phase = "failed";
      operation.error = error instanceof Error ? error.message : String(error);
      operation.completedAt = ports.now();
      ports.persist();
    }
  }

  return { run };
}
