import { randomUUID } from 'node:crypto';
import { planCleanupTeam, planDesired, planOwns, planTeam, readPlanConfig, type ActivityPlan, type ActivityPhase, type PlanOperation } from '../../activity-plan.ts';
import { object, sameHalloweenSpawn, type HalloweenAttendanceReport, type HalloweenObservation } from '../../events/halloween.ts';
import { mandatoryCollectionPickups, type PickupState } from '../merchant/collection-pickups.ts';
import { craftProtection } from '../merchant/craft-reservations.ts';
import { markedItem, sameMarkedItem } from '../inventory/item-identity.ts';
import type { ObservedCharacterStatus } from '../status/observed-status.ts';
import { requestObject, type HttpRouter } from '../http/contracts.ts';
import type { MerchantCommand } from '../merchant/work.ts';

interface State extends PickupState {
  activityPlan: ActivityPlan | null;
  statuses: Record<string, ObservedCharacterStatus | undefined>;
  commands: Record<string, MerchantCommand | undefined>;
  headlessSlots: (string | null)[];
  steamMembers: string[];
  nativeOwner: string | null;
  nextCommandId: number;
  merchantCurrent: PickupState['merchantCurrent'];
  merchantEventCombatEnabled?: boolean;
  halloweenAttendance?: Record<string, import('../../events/halloween.ts').HalloweenAttendance>;
  bankboiTransaction: unknown;
  realmSwitch: {phase: string} | null;
  activeConvoy?: {walkingActivity?: string; participants: string[]} | null;
}
interface Ports {
  now(): number;
  persist(): void;
  roster(): {name: string; ctype?: string; online?: boolean; home?: string | null}[];
  resolveRealm(realm: string): unknown;
  rosterOperation(action: 'login' | 'logout' | 'realm', name: string, realm: string): Promise<void>;
  worker(name: string): {enabled?: boolean; connected?: boolean; clientInstance?: string; realm?: string} | undefined;
  waypoint(name: string): unknown;
  blocked(): boolean;
  cancelEventTravel(): void;
}
function realm(value: unknown): string { return 'SR_' + String(value || '').replace(/^SR_/, ''); }
function itemKey(value: unknown): string {
  const item = requestObject(value);
  return JSON.stringify([item.name, item.level || 0, item.p ?? null, item.stat_type ?? null, item.rid ?? null, item.data ?? null]);
}
function totals(report: ObservedCharacterStatus | undefined): Record<string, number> {
  const result: Record<string, number> = {};
  for (const entry of report?.items || []) if (entry) {
    const key = itemKey(entry.item); result[key] = (result[key] || 0) + Number(entry.item.q || 1);
  }
  return result;
}

/** One durable owner advances only from fresh game observations and matching operation receipts. */
export function createActivityPlan(state: State, ports: Ports) {
  let busy = false;
  function plan() { return state.activityPlan; }
  function wait(reason: string | null) {
    const run = plan()?.run;
    if (run && run.waiting !== reason) { run.waiting = reason; ports.persist(); }
  }
  function fresh(name: string, inventory = false): ObservedCharacterStatus | null {
    const status = state.statuses[name], worker = ports.worker(name);
    if (!status || ports.now() - (inventory ? Number(status.inventorySeenAt || 0) : status.seenAt) > 10000 ||
        status.runtime !== 'headless' || !worker?.enabled || !worker.connected ||
        status.clientInstance !== worker.clientInstance || realm(status.server) !== plan()?.config.realm) return null;
    return status;
  }
  function phase(next: ActivityPhase) {
    const run = plan()!.run!;
    if (next === 'looting' && state.activeConvoy?.walkingActivity === 'event') ports.cancelEventTravel();
    run.phase = next; run.phaseAt = ports.now(); run.operation = null; run.waiting = null;
    ports.persist();
  }
  function manual(reason: string) {
    const run = plan()?.run;
    if (!run) return;
    run.mode = 'paused'; run.waiting = reason; ports.persist();
  }
  function observation(): HalloweenObservation | null {
    const p = plan(); if (!p) return null;
    for (const name of [p.config.farmer, p.config.merchant]) {
      const report = fresh(name), feed = report?.halloweenObservation;
      if (feed && ports.now() - feed.feedAt <= 120000 && feed.feedAt <= ports.now() + 5000) return feed;
    }
    return null;
  }
  function townReady(name: string): boolean {
    const report = fresh(name);
    return !!report && !report.rip && report.map === 'main' && Math.hypot(report.x, report.y) <= 90;
  }
  async function reconcileRoster(): Promise<boolean> {
    const p = plan()!, run = p.run!, desired = planDesired(p);
    if (state.bankboiTransaction || ports.blocked()) { wait('Waiting for the current roster, realm, or inventory owner'); return false; }
    const account = ports.roster();
    const conflict = account.find(member => member.online && !state.headlessSlots.includes(member.name));
    if (conflict || state.steamMembers.length || state.nativeOwner) {
      wait('External or Steam session conflict: ' + (conflict?.name || state.steamMembers.join(', ') || state.nativeOwner)); return false;
    }
    for (const name of state.headlessSlots) if (name && !desired.includes(name)) {
      if (state.commands[name] || fresh(name)?.banking || fresh(name)?.upgrading || fresh(name)?.stocking) {
        wait('Waiting for ' + name + "'s current operation before logout"); return false;
      }
      wait('Confirming account logout for ' + name);
      await ports.rosterOperation('logout', name, p.config.realm); return false;
    }
    for (const name of desired) {
      if (run.mode === 'paused') return false;
      const worker = ports.worker(name);
      if (!state.headlessSlots.includes(name)) {
        wait('Logging in ' + name); await ports.rosterOperation('login', name, p.config.realm); return false;
      }
      if (!worker?.enabled || worker.realm !== p.config.realm) {
        wait('Restoring ' + name + ' on ' + p.config.realm.replace('SR_', ''));
        await ports.rosterOperation('realm', name, p.config.realm); return false;
      }
      const report = fresh(name);
      if (!report) { wait('Waiting for a fresh managed report from ' + name); return false; }
      if (report.rip) { wait('Waiting for ' + name + ' to respawn'); return false; }
      const fatigue = Array.isArray(report.conditions) && report.conditions.some(c =>
        ['hopsickness', 'homesick'].includes(String(object(c)?.id)));
      const home = realm(report.home);
      if (name !== p.config.merchant && run.mode !== 'stopping' && ['solo','preparing','participating'].includes(run.phase) && (home !== p.config.realm || fatigue)) {
        wait(name + ' needs actual game home ' + p.config.realm.replace('SR_', '') + ' and no realm fatigue'); return false;
      }
    }
    return true;
  }
  function issue(name: string, action: PlanOperation['action']) {
    const p = plan()!, run = p.run!;
    if (state.commands[name]) { wait('Waiting for ' + name + "'s current command"); return; }
    if (action === 'collect' && (!fresh(name, true) || !fresh(p.config.merchant, true))) {
      wait('Waiting for fresh fighter and merchant inventories'); return;
    }
    const merchant = fresh(p.config.merchant, true);
    const size = Number(merchant?.inventorySize || 42);
    const occupied = new Set((merchant?.items || []).filter(e => !!e).map(e => e!.slot));
    const capacity = Math.max(0, size - occupied.size);
    const pickups = action === 'collect' ? mandatoryCollectionPickups(state, name) : [];
    if (action === 'collect' && craftProtection(state).error) {
      wait('Waiting for existing crafting reservations to reconcile before collection'); return;
    }
    if (action === 'collect' && pickups.length && !capacity) {
      wait('Merchant inventory is full. Free capacity manually in game; companions remain online until collection finishes.'); return;
    }
    const op: PlanOperation = {id: state.nextCommandId++, name, action, issuedAt: ports.now(), receipt: null, merchantBefore: totals(merchant || undefined)};
    run.operation = op;
    state.commands[name] = {id: op.id, type: 'activity-plan', planId: run.id, encounterGeneration: run.generation,
      action, merchant: p.config.merchant, location: action === 'event' ? run.encounter : run.farmLocation, capacity, merchantMarked: pickups,
      marked: [], upgrades: [], compounds: [], autoCompounds: [], autoItemMarks: {},
      craftProtection: craftProtection(state),
      protectedSlots: (state.statuses[name]?.items || []).filter(e => e && !pickups.some(m => m.slot === e.slot && sameMarkedItem(markedItem(m), e.item))).map(e => e!.slot)};
    ports.persist();
  }
  function settle(): boolean {
    const p = plan()!, run = p.run!, op = run.operation;
    if (!op) return true;
    if (!op.receipt) {
      // An interrupted executor adopts the same durable command. No newer inventory work can pass it.
      if (run.mode !== 'paused' && !state.commands[op.name] && fresh(op.name)) {
        const saved = op; run.operation = null;
        issue(saved.name, saved.action);
      }
      wait('Waiting for ' + op.name + ' to confirm ' + op.action); return false;
    }
    if (!op.receipt.success) {
      wait(op.name + ': ' + (op.receipt.error || 'Operation interrupted') + '. Resume to retry.');
      run.mode = 'paused'; ports.persist(); return false;
    }
    const report = fresh(op.name, op.action === 'collect');
    if (!report || (op.action === 'collect' ? Number(report.inventorySeenAt) : report.seenAt) <= op.receipt.at) {
      wait('Waiting for observations after ' + op.name + "'s receipt"); return false;
    }
    if (op.action === 'collect') {
      const merchant = fresh(p.config.merchant, true);
      if (!merchant || Number(merchant.inventorySeenAt) <= op.receipt.at) {
        wait('Waiting for the merchant inventory after transfer'); return false;
      }
      const received = totals(merchant), sent: Record<string, number> = {};
      for (const entry of op.receipt.sent) { const key = itemKey(entry.item); sent[key] = (sent[key] || 0) + entry.quantity; }
      if (Object.entries(sent).some(([key, quantity]) => (received[key] || 0) < (op.merchantBefore[key] || 0) + quantity)) {
        wait('Waiting for matching merchant cargo after ' + op.name + "'s transfer"); return false;
      }
      if (!mandatoryCollectionPickups(state, op.name).length && !run.collected.includes(op.name)) run.collected.push(op.name);
    } else if (op.action === 'town' ? !townReady(op.name) : !(op.action === 'event' ? run.encounter : run.farmLocation) ||
      report.map !== (op.action === 'event' ? run.encounter : run.farmLocation)!.map ||
      Math.hypot(report.x - (op.action === 'event' ? run.encounter : run.farmLocation)!.x,
        report.y - (op.action === 'event' ? run.encounter : run.farmLocation)!.y) > 90) {
      wait('Waiting for confirmed arrival from ' + op.name); return false;
    }
    run.operation = null; ports.persist(); return true;
  }
  async function step() {
    const p = plan(), run = p?.run;
    if (!p || !run || ports.blocked()) return;
    const feed = observation(), now = ports.now();
    if (run.mode !== 'paused' && ['preparing','participating'].includes(run.phase)) {
      const attendees = p.config.companions.filter(name => ports.worker(name)?.connected);
      for (const name of attendees) if (!run.attendees.includes(name)) {run.attendees.push(name);ports.persist();}
      // A missed spawn must recover even when a companion never finished login.
      if (!run.operation && feed && !feed.bosses.some(b=>b.type===run.encounter?.type) &&
          (run.phase==='preparing' && (now>Number(run.encounter?.spawnAt)+30000 || !feed.season || run.mode==='stopping') ||
            run.phase==='participating' && now-Number(run.lastLiveAt)>=3000)) phase('looting');
    }
    // Restore intended sessions before reconciling an operation interrupted by restart.
    if (run.mode !== 'paused' && !await reconcileRoster()) return;
    if (run.operation && !settle()) return;
    if (run.mode === 'paused') return;
    if (run.phase === 'solo') {
      if (run.mode === 'stopping') { phase('returning'); return; }
      if (!feed) { wait('Waiting for fresh announced event times'); return; }
      const liveAnnounced = run.announced.filter(e=>e.spawnAt<=now+1000 && feed.bosses.some(b=>b.type===e.type));
      const upcoming = feed.season ? [...(feed.upcoming || []),...liveAnnounced].filter(e => p.config.bosses.includes(e.type) &&
        (now <= e.spawnAt + 30000 || feed.bosses.some(b=>b.type===e.type)) && !run.completed.some(previous=>sameHalloweenSpawn(previous,e)))
        .sort((a,b) => a.spawnAt - b.spawnAt)[0] : undefined;
      if (!upcoming || upcoming.spawnAt - now > p.config.preparationSeconds * 1000) { wait(null); return; }
      if (state.merchantCurrent || planDesired(p).some(name => state.commands[name] || fresh(name)?.banking || fresh(name)?.upgrading || fresh(name)?.stocking)) {
        wait('Waiting for current work to settle before event preparation'); return;
      }
      run.encounter = upcoming; run.lastLiveAt = null; run.teamReadyAt = undefined; run.attendees=[]; run.collected = []; run.generation++;
      phase('preparing'); return;
    }
    if (run.phase === 'preparing' || run.phase === 'participating') {
      if (!feed) { wait('Waiting for fresh observations of the selected encounter'); return; }
      const live = feed.bosses.find(b => b.type === run.encounter?.type);
      const fightersReady = planTeam(p).every(name => {
        const report = fresh(name); return report && report.map === run.encounter?.map &&
          Math.hypot(report.x-run.encounter.x,report.y-run.encounter.y) <= 350;
      });
      if (fightersReady && !run.teamReadyAt) { run.teamReadyAt = now; ports.persist(); }
      if (live) {
        run.lastLiveAt = now;
        if (run.phase === 'preparing') phase('participating');
      } else if (run.phase === 'participating' && now - Number(run.lastLiveAt) >= 3000 ||
          run.phase === 'preparing' && (now > Number(run.encounter?.spawnAt) + 30000 || !feed.season || run.mode === 'stopping')) {
        phase('looting');
      }
      if (['preparing','participating'].includes(run.phase) && state.merchantEventCombatEnabled !== true &&
          !state.commands[p.config.merchant] && run.encounter &&
          (!fresh(p.config.merchant) || fresh(p.config.merchant)!.map !== run.encounter.map ||
            Math.hypot(fresh(p.config.merchant)!.x-run.encounter.x,fresh(p.config.merchant)!.y-run.encounter.y)>90))
        issue(p.config.merchant,'event');
      if (!run.teamReadyAt) wait('Assembling the selected fighters at the encounter');
      return;
    }
    if (run.phase === 'looting') {
      const capacityBlocked = planDesired(p).find(name=>object(fresh(name)?.lootStatus)?.capacityBlocked === true);
      if (capacityBlocked) {
        wait(capacityBlocked + ' needs loot capacity. Free space manually; the plan will keep waiting for eligible chests.'); return;
      }
      if (planDesired(p).some(name => {
        const report = fresh(name);
        return !report || report.seenAt <= run.phaseAt || report.halloweenDeparturePending || Number(report.activityEligibleChests) > 0 || report.activityDepartureCombatPending;
      })) { wait('Finishing encounter combat and eligible chests'); return; }
      phase('town'); return;
    }
    if (run.phase === 'town') {
      const next = planDesired(p).find(name => !townReady(name));
      if (next) issue(next, 'town'); else phase('collecting');
      return;
    }
    if (run.phase === 'collecting') {
      if (planDesired(p).some(name => !townReady(name))) { phase('town'); return; }
      const next = planCleanupTeam(p).find(name => !run.collected.includes(name));
      if (next) issue(next, 'collect');
      else {
        if (planCleanupTeam(p).some(name => !fresh(name, true) || mandatoryCollectionPickups(state, name).length)) {
          run.collected = []; ports.persist(); wait('Rechecking all fighter inventories'); return;
        }
        phase('returning');
      }
      return;
    }
    if (run.phase === 'returning') {
      const farmer = fresh(p.config.farmer);
      if (!run.farmLocation) { wait('Select a saved farming location for ' + p.config.farmer); return; }
      if (!farmer || farmer.map !== run.farmLocation.map || Math.hypot(farmer.x-run.farmLocation.x, farmer.y-run.farmLocation.y) > 90) {
        issue(p.config.farmer, 'farm'); return;
      }
      if (run.encounter) run.completed = [...run.completed.slice(-15), run.encounter];
      run.encounter = null; run.lastLiveAt = null;
      if (run.mode === 'stopping') { p.run = null; ports.persist(); return; }
      phase('solo');
    }
  }
  async function tick() {
    if (busy || !plan()?.run) return;
    const p = plan()!, feed = observation();
    for (const spawn of feed?.upcoming || []) if (p.config.bosses.includes(spawn.type) &&
        !p.run!.announced.some(previous=>sameHalloweenSpawn(previous,spawn))) {
      p.run!.announced = [...p.run!.announced.filter(previous=>previous.type!==spawn.type),spawn];ports.persist();
    }
    p.status = {desired:planDesired(p), observed:ports.roster().filter(m=>m.online).map(m=>m.name),
      next:p.run?.encounter || (feed?.season ? (feed.upcoming || []).filter(e=>p.config.bosses.includes(e.type) &&
        e.spawnAt >= ports.now() && !p.run?.completed.some(previous=>sameHalloweenSpawn(previous,e))).sort((a,b)=>a.spawnAt-b.spawnAt)[0] || null : null)};
    busy = true;
    try { await step(); } catch (error) { wait(String(error instanceof Error ? error.message : error)); }
    finally { busy = false; }
  }
  function attendance(name: string): HalloweenAttendanceReport | null {
    const p = plan(), run = p?.run;
    if (!p || !run || !planOwns(p, name)) return null;
    const owner = {source: p.config.farmer, realm: p.config.realm.replace(/^SR_/, ''), generation: run.generation, validUntil: ports.now()+10000};
    if (!run.encounter || !['preparing', 'participating'].includes(run.phase)) return {...owner, phase: 'idle'};
    const live = observation()?.bosses.find(b => b.type === run.encounter!.type);
    const response: HalloweenAttendanceReport = live ? {...owner, phase: 'attending', encounter: {...live, map: run.encounter.map, x:run.encounter.x,y:run.encounter.y}, lastLiveAt: run.lastLiveAt || ports.now()}
      : run.phase === 'preparing' ? {...owner, phase: 'preparing', encounter: run.encounter} : {...owner, phase: 'waiting'};
    (state.halloweenAttendance ||= {})[JSON.stringify([owner.source,owner.realm])] = response;
    return response;
  }
  function control(name: string) {
    const p = plan(), run = p?.run;
    return p && run && planOwns(p,name) ? {id: run.id, phase: run.phase, generation:run.generation,
      farmer:p.config.farmer, fightersReady:!!run.teamReadyAt,
      hold: !['solo', 'preparing', 'participating'].includes(run.phase), mode:run.mode} : null;
  }
  function install(router: HttpRouter) {
    router.post('/party-api/activity-plan', (req,res) => {
      const body = requestObject(req.body), p = plan();
      try {
        if (body.action === 'configure' || body.action === 'start') {
          if (p?.run) throw Error('Stop the current plan before changing its configuration');
          const config = readPlanConfig(body.config);
          if (!config || !ports.resolveRealm(config.realm) || config.realm.endsWith('PVP')) throw Error('Choose distinct fighters, a merchant, bosses, and an available non-PVP realm');
          const roster = ports.roster();
          if ([config.farmer,...config.companions].some(n => !roster.some(m => m.name === n && m.ctype !== 'merchant')) ||
              !roster.some(m => m.name === config.merchant && m.ctype === 'merchant')) throw Error('Choose owned fighters and a merchant');
          if (body.action === 'start') {
            const location = object(ports.waypoint(config.farmer));
            if (!location || typeof location.map !== 'string' || typeof location.x !== 'number' || typeof location.y !== 'number') throw Error('Save a farming location for the selected farmer first');
            if (ports.blocked() || state.bankboiTransaction || state.merchantCurrent ||
                Object.values(state.statuses).some(s=>s && ports.now()-s.seenAt<10000 &&
                  (s.joinedEvent || s.halloweenDeparturePending || s.deathLoop || s.banking || s.stocking || s.upgrading)))
              throw Error('Wait for the current event, death loop, or inventory operation to finish before starting');
            state.activityPlan = {config,run:{id:randomUUID(),mode:'running',stopRequested:false,phase:'solo',phaseAt:ports.now(),generation:0,
              encounter:null,lastLiveAt:null,collected:[],completed:[],announced:[],attendees:[],operation:null,waiting:null,
              farmLocation:{map:location.map,x:location.x,y:location.y}}};
          } else state.activityPlan = {config,run:null};
        } else if (p?.run) {
          if (body.action === 'pause') manual('Paused. The current operation may settle.');
          else if (body.action === 'resume') {
            if (p.run.operation?.receipt?.success === false) p.run.operation = null;
            p.run.mode = p.run.stopRequested ? 'stopping' : 'running'; p.run.waiting = null;
          } else if (body.action === 'stop') { p.run.stopRequested = true; p.run.mode = 'stopping'; }
          else throw Error('Unknown activity action');
        } else throw Error('No running plan');
        ports.persist(); res.json({ok:true,activityPlan:state.activityPlan});
      } catch (error) { res.status(409).json({error:String(error instanceof Error ? error.message : error)}); }
    });
    router.post('/party-api/activity-plan/receipt', (req,res) => {
      const body = requestObject(req.body), run = plan()?.run, op = run?.operation;
      const command = op && state.commands[op.name];
      if (!run || !op || body.planId !== run.id || body.encounterGeneration !== run.generation ||
          body.character !== op.name || body.commandId !== op.id || command?.id !== op.id ||
          body.clientInstance !== ports.worker(op.name)?.clientInstance || op.receipt) return res.json({ok:true,stale:true});
      op.receipt = {at:ports.now(),success:body.success === true,error:typeof body.error === 'string' ? body.error : null,
        sent:Array.isArray(body.sent) ? body.sent.flatMap(value => {
          const entry = object(value); return entry && object(entry.item) && typeof entry.quantity === 'number' && entry.quantity > 0 ? [{item:entry.item,quantity:entry.quantity}] : [];
        }) : []};
      delete state.commands[op.name]; ports.persist(); return res.json({ok:true});
    });
  }
  return {tick,install,manual,attendance,control, owns:(name?:string)=>planOwns(plan(),name),
    merchantReserved:()=>!!plan()?.run && (plan()!.run!.phase !== 'solo' || plan()!.run!.mode === 'paused'),
    startupOwned:()=>!!plan()?.run && plan()!.run!.mode !== 'paused'};
}
