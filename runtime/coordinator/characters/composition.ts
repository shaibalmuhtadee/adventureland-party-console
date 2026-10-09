import { createCharacterManager, type CharacterManagerPorts } from "./manager.ts";
import { createCharacterCode } from "./code.ts";
import type { Lifecycle } from "./types.ts";
import type { Hash } from "node:crypto";

type CodePorts = Parameters<typeof createCharacterCode>[0];
interface Account {
  resolve_realm: CharacterManagerPorts["resolveRealm"];
  resolve_char: CharacterManagerPorts["resolveCharacter"];
  updateInfo: CharacterManagerPorts["refreshAccount"];
  response: unknown;
}
interface Configuration {
  enable_TYPECODE?: boolean;
  watch_CODE?: boolean;
  web_app?: { enable_minimap?: boolean };
}
type ManagerInput = Pick<
  CharacterManagerPorts,
  | "blocks"
  | "allowed"
  | "clock"
  | "log"
  | "local"
  | "session"
  | "version"
  | "currentVersion"
  | "clientUpdate"
  | "sessionToken"
  | "classIds"
  | "repair"
  | "fork"
  | "pipe"
  | "monitor"
>;
interface CharacterServicesInput extends ManagerInput {
  configuration: Configuration;
  accountSource: Account;
  lifecycleState: () => Record<string, Lifecycle>;
  code: {
    hash: () => Hash;
    read: (path: string) => Uint8Array;
    reload: CodePorts["reload"];
    stop: CodePorts["stop"];
    watch: CodePorts["watch"];
    warn: (details: { error: unknown; script_path: string }, message: string) => void;
  };
}

/** File names and contents both participate, in caller order, in the existing CODE digest. */
export function coordinatorCodeDigest(
  files: readonly string[],
  ports: CharacterServicesInput["code"],
): string {
  const hash = ports.hash();
  for (const file of files) hash.update(file).update(ports.read("./CODE/" + file));
  return hash.digest("hex");
}

/** Compose worker management and CODE reload services without capturing account snapshots. */
export function createCoordinatorCharacterServices(input: CharacterServicesInput) {
  const manager = createCharacterManager({
    allowed: input.allowed,
    blocks: input.blocks,
    clock: input.clock,
    log: input.log,
    local: input.local,
    session: input.session,
    version: input.version,
    currentVersion: input.currentVersion,
    clientUpdate: input.clientUpdate,
    sessionToken: input.sessionToken,
    classIds: input.classIds,
    typeCode: !!input.configuration.enable_TYPECODE,
    minimap: !!input.configuration.web_app?.enable_minimap,
    lifecycle: (name, state) => {
      input.lifecycleState()[name] = state;
    },
    resolveRealm: (realm) => input.accountSource.resolve_realm(realm),
    resolveCharacter: (name) => input.accountSource.resolve_char(name),
    refreshAccount: () => input.accountSource.updateInfo(),
    account: () => input.accountSource.response,
    repair: input.repair,
    fork: input.fork,
    pipe: input.pipe,
    monitor: input.monitor,
  });
  const code = createCharacterCode({
    clock: input.clock,
    log: input.log,
    enabled: !!input.configuration.watch_CODE,
    digest: (files) => coordinatorCodeDigest(files, input.code),
    reload: (worker, generation) => input.code.reload(worker, generation),
    stop: (block, reason) => input.code.stop(block, reason),
    watch: (script, changed) => input.code.watch(script, changed),
    watchFailed: (error, script_path) =>
      input.code.warn({ error, script_path }, "Unable to watch character CODE"),
  });
  return { manager, code };
}
