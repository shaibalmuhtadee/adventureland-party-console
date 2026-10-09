import { isHalloweenBoss, object, readHalloweenSpawn, type HalloweenBoss, type HalloweenSpawn } from './events/halloween.ts';

export interface ActivityPlanConfig {
  farmer: string;
  companions: string[];
  merchant: string;
  realm: string;
  bosses: HalloweenBoss[];
  preparationSeconds: number;
}
export type ActivityPhase = 'solo' | 'preparing' | 'participating' | 'looting' | 'town' | 'collecting' | 'returning';
export interface PlanOperation {
  id: number;
  name: string;
  action: 'town' | 'collect' | 'farm' | 'event';
  issuedAt: number;
  receipt: { at: number; success: boolean; error: string | null; sent: { item: unknown; quantity: number }[] } | null;
  merchantBefore: Record<string, number>;
}
export interface ActivityPlan {
  status?: { desired: string[]; observed: string[]; next: HalloweenSpawn | null };
  config: ActivityPlanConfig;
  run: null | {
    id: string;
    mode: 'running' | 'paused' | 'stopping';
    stopRequested: boolean;
    phase: ActivityPhase;
    phaseAt: number;
    generation: number;
    encounter: HalloweenSpawn | null;
    lastLiveAt: number | null;
    teamReadyAt?: number;
    completed: HalloweenSpawn[];
    announced: HalloweenSpawn[];
    attendees: string[];
    collected: string[];
    operation: PlanOperation | null;
    waiting: string | null;
    farmLocation: { map: string; x: number; y: number } | null;
  };
}
export function planOwns(plan: ActivityPlan | null | undefined, name?: string): boolean {
  return !!plan?.run && (!name || [plan.config.farmer, plan.config.merchant, ...plan.config.companions].includes(name));
}
export function planTeam(plan: ActivityPlan): string[] {
  return [plan.config.farmer, ...plan.config.companions];
}
export function planDesired(plan: ActivityPlan): string[] {
  return !plan.run ? [] : [plan.config.farmer, plan.config.merchant,
    ...(['solo', 'returning'].includes(plan.run.phase) ? [] :
      ['preparing','participating'].includes(plan.run.phase) ? plan.config.companions : plan.run.attendees)];
}
export function planCleanupTeam(plan: ActivityPlan): string[] { return [plan.config.farmer, ...(plan.run?.attendees || [])]; }
export function readPlanConfig(value: unknown): ActivityPlanConfig | null {
  const v = object(value);
  if (!v || typeof v.farmer !== 'string' || !v.farmer || typeof v.merchant !== 'string' || !v.merchant ||
      typeof v.realm !== 'string' || !/^SR_(US|EU|ASIA)\w+$/.test(v.realm) ||
      !Array.isArray(v.companions) || v.companions.length > 2 || !v.companions.every(n => typeof n === 'string' && !!n) ||
      !Array.isArray(v.bosses) || !v.bosses.length || !v.bosses.every(isHalloweenBoss) ||
      typeof v.preparationSeconds !== 'number' || !Number.isInteger(v.preparationSeconds) || v.preparationSeconds < 30 || v.preparationSeconds > 600) return null;
  const members = [v.farmer, v.merchant, ...v.companions];
  if (new Set(members).size !== members.length) return null;
  return { farmer: v.farmer, merchant: v.merchant, realm: v.realm, companions: [...v.companions],
    bosses: [...new Set(v.bosses)], preparationSeconds: v.preparationSeconds };
}
/** Journal decoding happens once at startup; malformed progress never starts characters. */
export function restoreActivityPlan(value: unknown): ActivityPlan | null {
  const v = object(value), config = readPlanConfig(v?.config);
  if (!config) return null;
  if (v?.run === null) return { config, run: null };
  const r = object(v?.run);
  if (!r || typeof r.id !== 'string' || (r.mode !== 'running' && r.mode !== 'paused' && r.mode !== 'stopping') ||
      !isPhase(r.phase) || !finite(r.phaseAt) || !finite(r.generation) ||
      !Array.isArray(r.completed) || !Array.isArray(r.announced) || typeof r.stopRequested!=='boolean' ||
      !strings(r.collected) || !strings(r.attendees) ||
      (r.lastLiveAt !== null && !finite(r.lastLiveAt)) || (r.teamReadyAt !== undefined && !finite(r.teamReadyAt)) ||
      (r.waiting !== null && typeof r.waiting !== 'string')) return { config, run: null };
  const encounter = readHalloweenSpawn(r.encounter), operation = readOperation(r.operation), farmLocation = point(r.farmLocation);
  const completed = r.completed.map(readHalloweenSpawn);
  const announced = r.announced.map(readHalloweenSpawn);
  if (r.encounter !== null && !encounter || r.operation !== null && !operation ||
      r.farmLocation !== null && !farmLocation || completed.some(e=>!e) || announced.some(e=>!e) ||
      ['preparing','participating','looting','town','collecting'].includes(r.phase) && !encounter) return {config, run:null};
  return { config, run: {id:r.id,mode:r.mode,stopRequested:r.stopRequested,phase:r.phase,phaseAt:r.phaseAt,generation:r.generation,
    encounter,operation,farmLocation,lastLiveAt:r.lastLiveAt,
    ...(r.teamReadyAt !== undefined ? {teamReadyAt:r.teamReadyAt} : {}),
    completed:completed.filter((e):e is HalloweenSpawn=>e!==null),announced:announced.filter((e):e is HalloweenSpawn=>e!==null),
    attendees:r.attendees,collected:r.collected,waiting:r.waiting} };
}
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(n=>typeof n==='string'); }
function finite(value: unknown): value is number {return typeof value==='number' && Number.isFinite(value);}
function isPhase(value: unknown): value is ActivityPhase {
  return value === 'solo' || value === 'preparing' || value === 'participating' || value === 'looting' ||
    value === 'town' || value === 'collecting' || value === 'returning';
}
function point(value: unknown): NonNullable<NonNullable<ActivityPlan['run']>['farmLocation']> | null {
  const p=object(value); return p && typeof p.map==='string' && finite(p.x) && finite(p.y) ? {map:p.map,x:p.x,y:p.y} : null;
}
function readOperation(value: unknown): PlanOperation | null {
  const op=object(value), before=object(op?.merchantBefore);
  if (!op || !finite(op.id) || typeof op.name!=='string' || !finite(op.issuedAt) || !before ||
      (op.action!=='town' && op.action!=='farm' && op.action!=='collect' && op.action!=='event')) return null;
  const merchantBefore:Record<string,number>={};
  for (const [key,quantity] of Object.entries(before)) {if(!finite(quantity))return null;merchantBefore[key]=quantity;}
  let receipt:PlanOperation['receipt']=null;
  if (op.receipt!==null) {
    const r=object(op.receipt);
    if (!r || !finite(r.at) || typeof r.success!=='boolean' || (r.error!==null && typeof r.error!=='string') || !Array.isArray(r.sent)) return null;
    const sent:NonNullable<PlanOperation['receipt']>['sent']=[];
    for(const value of r.sent) {const entry=object(value);if(!entry || !object(entry.item) || !finite(entry.quantity) || entry.quantity<=0)return null;sent.push({item:entry.item,quantity:entry.quantity});}
    receipt={at:r.at,success:r.success,error:r.error,sent};
  }
  return {id:op.id,name:op.name,action:op.action,issuedAt:op.issuedAt,merchantBefore,receipt};
}
