import type { MerchantWork } from './work.ts';
import { currentMerchantReport } from './commerce-progress.ts';
import { normalizedRealm } from './party-realm.ts';
import { requestObject, type HttpRouter, type HttpRequest, type HttpResponse } from '../http/contracts.ts';

export const PONTY_SHOP_INTERVAL_MS = 60 * 60_000;
export const PONTY_SHOP_REALMS = [
  'SR_USI', 'SR_USII', 'SR_USIII', 'SR_USIV', 'SR_USV',
  'SR_EUI', 'SR_EUII', 'SR_EUIII', 'SR_EUIV', 'SR_ASIAI', 'SR_ASIAII',
] as const;

/** A trip retains its progress across worker reconnects and coordinator restarts. */
export interface PontyShoppingTrip {
  startedAt: number | null;
  scannedRealms: string[];
  attemptedListingKeys: string[];
}
type ShoppingJob = MerchantWork & { pontyShop: PontyShoppingTrip };
interface State {
  merchantCharacter: string | null;
  merchantAutomations: Record<string, boolean>;
  merchantQueue: MerchantWork[];
  merchantCurrent: MerchantWork | null;
  pontyShoppingList: string[];
  pontyShopLastRunAt: number | null;
  merchantCatalog: { allItems: { id: string }[] } | null;
  statuses: Record<string, { server?: string; seenAt: number } | undefined>;
  commands: Record<string, unknown>;
}
interface Ports {
  now(): number;
  nextCommand(): number;
  stamp(job: MerchantWork): MerchantWork;
  persist(): void;
  dispatch(): void;
  log(message: string, level: string, details?: unknown): void;
  ensureHome(reason: string): boolean;
}

export function createPontyShopping(state: State, ports: Ports) {
  function matchingTrip(job: MerchantWork | null, body: Record<string, unknown>): job is ShoppingJob {
    return currentMerchantReport(job, body) && job.reason === 'ponty shop' && !!job.pontyShop &&
      body.commandId === job.commandId && body.character === state.merchantCharacter;
  }
  function arrived(realm: string, since = 0): boolean {
    const status = state.statuses[String(state.merchantCharacter)];
    return !!status && status.seenAt > since && status.seenAt >= ports.now() - 10_000 &&
      normalizedRealm(status.server) === realm;
  }
  function pending() {
    return [state.merchantCurrent, ...state.merchantQueue].find(job => job?.reason === 'ponty shop');
  }
  function enqueue(manual: boolean): MerchantWork | undefined {
    const existing = pending();
    if (existing) {
      if (manual) requestManual(existing);
      return existing;
    }
    if (!state.merchantCharacter || !state.pontyShoppingList.length) return;
    const job = ports.stamp({
      id: 'ponty-shop-' + ports.now() + '-' + ports.nextCommand(),
      target: state.merchantCharacter, reason: 'ponty shop', manual,
      pontyShop: { startedAt: null, scannedRealms: [], attemptedListingKeys: [] },
    });
    state.merchantQueue.push(job);
    ports.persist();
    return job;
  }
  function requestManual(job: MerchantWork): void {
    job.manual = true;
    if (job === state.merchantCurrent) return;
    // A fresh manual request also retries a queued trip, preserving its scan and purchase progress.
    delete job.realmRetryExhausted;
    delete job.realmBlockedReason;
    delete job.realmError;
    job.realmAttempts = 0;
    job.retryAt = 0;
  }
  function schedule(): void {
    reconcileSwitch();
    if (state.merchantAutomations['ponty shop'] === false || pending()) return;
    if (state.pontyShopLastRunAt !== null && ports.now() < state.pontyShopLastRunAt + PONTY_SHOP_INTERVAL_MS) return;
    enqueue(false);
  }
  function reconcileSwitch(): void {
    const job = state.merchantCurrent;
    if (job?.reason !== 'ponty shop' || job.phase !== 'switching realm') return;
    if (arrived(job.destinationRealm || '', Number(job.realmStartedAt))) {
      job.phase = 'assigned';
      job.startedAt = job.heartbeatAt = ports.now();
      ports.persist();
      return;
    }
    if (ports.now() - Number(job.realmStartedAt) < 90_000) return;
    // Keep the trip available for explicit Retry without locking all other merchant work forever.
    job.realmRetryExhausted = true;
    job.realmBlockedReason = 'Ponty server switch timed out; manual retry required';
    delete job.phase;
    state.merchantCurrent = null;
    state.merchantQueue.push(job);
    delete state.commands[String(state.merchantCharacter)];
    ports.log('Ponty Shop server switch timed out', 'error', { jobId: job.id, realm: job.destinationRealm });
    ports.ensureHome('Ponty Shop recovery');
    ports.persist();
  }
  function started(job: MerchantWork): void {
    if (job.reason !== 'ponty shop' || !job.pontyShop || job.pontyShop.startedAt !== null) return;
    job.pontyShop.startedAt = state.pontyShopLastRunAt = ports.now();
    ports.log('Ponty Shop started', 'info', { jobId: job.id });
  }
  function list(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body);
    if (body.clear === true) state.pontyShoppingList = [];
    else {
      const itemId = body.itemId;
      if (typeof itemId !== 'string') return res.status(400).json({ error: 'provide an item ID' });
      if (body.remove === true) state.pontyShoppingList = state.pontyShoppingList.filter(id => id !== itemId);
      else {
        if (!state.merchantCatalog?.allItems.some(item => item.id === itemId))
          return res.status(400).json({ error: 'unknown catalog item' });
        state.pontyShoppingList = [...new Set([...state.pontyShoppingList, itemId])];
      }
    }
    ports.persist();
    return res.json({ ok: true, items: state.pontyShoppingList });
  }
  function run(_req: HttpRequest, res: HttpResponse): unknown {
    if (!state.merchantCharacter) return res.status(409).json({ error: 'configure a merchant first' });
    if (!state.pontyShoppingList.length) return res.status(400).json({ error: 'add catalog items to the Ponty shopping list first' });
    const alreadyRunning = state.merchantCurrent?.reason === 'ponty shop';
    const job = enqueue(true);
    ports.persist();
    ports.dispatch();
    return res.json({ ok: true, jobId: job?.id, alreadyRunning });
  }
  function progress(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body), job = state.merchantCurrent;
    if (!matchingTrip(job, body))
      return res.status(409).json({ error: 'Ponty Shop is no longer current' });
    const realm = body.realm;
    if (typeof realm !== 'string' || !PONTY_SHOP_REALMS.some(entry => entry === realm))
      return res.status(400).json({ error: 'invalid Ponty server' });
    if (!arrived(realm))
      return res.status(409).json({ error: 'waiting for merchant arrival on the Ponty server' });
    if (body.action === 'claim') return claim(job, realm, body, res);
    if (body.action !== 'scanned') return res.status(400).json({ error: 'invalid Ponty progress action' });
    return scanned(job, realm, body, res);
  }
  function claim(job: ShoppingJob, realm: string, body: Record<string, unknown>, res: HttpResponse): unknown {
    if (typeof body.itemId !== 'string' || typeof body.rid !== 'string' || !body.rid)
      return res.status(400).json({ error: 'invalid Ponty listing' });
    const key = realm + ':' + body.rid;
    const allowed = (job.manual === true || state.merchantAutomations['ponty shop'] !== false) &&
      state.pontyShoppingList.includes(body.itemId) && !job.pontyShop.attemptedListingKeys.includes(key);
    // Persist before buying. An ambiguous game response must never buy the same lot twice.
    if (allowed) job.pontyShop.attemptedListingKeys.push(key);
    ports.persist();
    return res.json({ ok: true, allowed });
  }
  function scanned(job: ShoppingJob, realm: string, body: Record<string, unknown>, res: HttpResponse): unknown {
    if (!job.pontyShop.scannedRealms.includes(realm)) {
      job.pontyShop.scannedRealms.push(realm);
      ports.log('Ponty Shop checked ' + realm.replace(/^SR_/, ''), body.error ? 'error' : 'info', {
        jobId: job.id, error: body.error, purchases: body.purchases,
      });
    }
    job.phase = 'processing';
    job.progressAt = job.heartbeatAt = ports.now();
    ports.persist();
    return res.json({ ok: true });
  }
  function install(router: HttpRouter): void {
    router.post('/party-api/merchant/ponty-shopping-list', list);
    router.post('/party-api/merchant/ponty-shop', run);
    router.post('/party-api/merchant/ponty-shop-progress', progress);
  }
  function tick(): void {
    schedule();
    if (!state.merchantCurrent && pending()) ports.dispatch();
  }
  return { schedule, started, install, tick };
}
