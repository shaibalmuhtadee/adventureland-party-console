import { requestObject, type HttpRequest, type HttpResponse } from "./contracts.ts";
import type { MerchantWork } from "../merchant/work.ts";
import { currentMerchantReport } from '../merchant/commerce-progress.ts';

interface MerchantRealmState {
  merchantCharacter: string | null;
  merchantCurrent: MerchantWork | null;
  activeRealm: string;
}
interface RealmBlock {
  realm?: string;
  connected?: boolean;
}
interface MerchantRealmPorts<Block extends RealmBlock> {
  now(): number;
  resolve(realm: string): unknown;
  block(name: string): Block;
  log(message: string, level: string): void;
  persist(): void;
  restart(block: Block, delay: number): void;
  label(realm: string): string;
}
const realmJobs = [
  "ALData marketplace purchases",
  "ALData marketplace sales",
  "join giveaway",
  "Ponty purchases",
  "ponty shop",
];

function matchingRealmJob(current: MerchantWork | null, jobId: unknown): current is MerchantWork {
  return !!current && current.id === jobId && realmJobs.includes(current.reason);
}
function matchingPontyCommand(current: MerchantWork, body: Record<string, unknown>): boolean {
  return current.reason !== 'ponty shop' || (currentMerchantReport(current, body) && body.commandId === current.commandId);
}
function purpose(reason: string): string {
  if (reason === 'join giveaway') return ' for giveaway entry';
  if (reason === 'ponty shop') return ' for Ponty Shop';
  return ' for marketplace transaction';
}

export function createMerchantRealmRoutes<Block extends RealmBlock>(
  state: MerchantRealmState,
  ports: MerchantRealmPorts<Block>,
) {
  function switchRealm(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      current = state.merchantCurrent,
      merchant = state.merchantCharacter;
    if (!merchant || !matchingRealmJob(current, body.jobId) || body.character !== merchant)
      return res.status(409).json({ error: "ALData marketplace job is no longer current" });
    if (!matchingPontyCommand(current, body))
      return res.status(409).json({ error: 'Ponty Shop command is no longer current' });
    const realm = typeof body.realm === "string" ? body.realm : "";
    if (!ports.resolve(realm))
      return res.status(400).json({ error: "unknown Adventure Land realm" });
    const block = ports.block(merchant);
    if (block.realm === realm && block.connected) return res.json({ ok: true, alreadyThere: true });
    block.realm = realm;
    current.phase = "switching realm";
    current.destinationRealm = realm;
    current.realmStartedAt = ports.now();
    current.heartbeatAt = current.progressAt = ports.now();
    ports.log(
      "Switching " +
        merchant +
        " to " +
        realm.replace(/^SR_/, "") +
        purpose(current.reason),
      "info",
    );
    ports.persist();
    const response = res.json({ ok: true, realm });
    ports.restart(block, 150);
    return response;
  }
  function ensureHome(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      merchant = state.merchantCharacter;
    if (!merchant || body.character !== merchant)
      return res.status(409).json({ error: "merchant is no longer configured" });
    const realm = typeof body.realm === "string" ? body.realm : "";
    if (realm !== state.activeRealm || !ports.resolve(realm))
      return res.status(400).json({ error: "invalid merchant home realm" });
    const block = ports.block(merchant);
    if (block.realm === realm && block.connected) return res.json({ ok: true, alreadyThere: true });
    block.realm = realm;
    ports.log(
      "Returning " + merchant + " to active realm " + ports.label(realm) + " before opening stand",
      "info",
    );
    ports.persist();
    const response = res.json({ ok: true, realm });
    ports.restart(block, 150);
    return response;
  }
  return { switchRealm, ensureHome };
}
