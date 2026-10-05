import { automaticCommerceRuleKey, automaticNpcSaleRuleKey, sameMarkedItem } from './item-identity.ts';
import type { Item } from '../contracts/item.ts';
import { requestObject, type HttpRouter } from '../http/contracts.ts';

export type RuleFamily = 'item' | 'upgrade' | 'compound' | 'deconstruction' | 'npc' | 'stand' | 'exchange';
export interface RuleChoice { owner: string; value: unknown }
export interface RuleConflict { id: string; family: RuleFamily; key: string; choices: RuleChoice[] }
export interface SharedRules { version: 1; owner: string; members: string[]; backup: unknown; conflicts: RuleConflict[] }
export interface SharedScope { merchantCharacter?: string | null; merchantRules?: SharedRules | null }
interface RuleData extends SharedScope {
  npcSaleMarks?: {item:Item;auto?:boolean;character?:string;autoRuleKey?:string}[];
  autoItemMarks: Record<string, Record<string, unknown> | undefined>;
  autoUpgradeMarks: Record<string, Record<string, unknown> | undefined>;
  autoCompounds: Record<string, { name: string }[] | undefined>;
  autoDeconstruction: Record<string, Record<string, { item: Item }>>;
  autoNpcSales: Record<string, { item: Item; character?: string }>;
  autoStandMarks: Record<string, unknown>;
  autoExchanges: Record<string, unknown>;
}
export function ruleOwner(state: SharedScope, name: string): string {
  return state.merchantRules?.version === 1 ? String(state.merchantCharacter) : name;
}
export function sharedMember(state: SharedScope, name: string): boolean {
  return !state.merchantRules || state.merchantRules.members.includes(name) || name === state.merchantCharacter;
}
function choose(family: RuleFamily, key: string, choices: RuleChoice[], rules: SharedRules): unknown {
  const merchant = choices.find(choice => choice.owner === rules.owner);
  if (merchant) return merchant.value;
  if (choices.every(choice => ruleSignature(choice.value) === ruleSignature(choices[0].value))) return choices[0].value;
  rules.conflicts.push({ id: `${family}:${key}`, family, key, choices });
  return undefined;
}
function merge(family: RuleFamily, records: Record<string, Record<string, unknown> | undefined>, rules: SharedRules) {
  const grouped = new Map<string, RuleChoice[]>();
  for (const owner of rules.members) for (const [key, value] of migrationEntries(family,records[owner] || {})) {
    const list = grouped.get(key) || []; list.push({ owner, value }); grouped.set(key, list);
  }
  const result: Record<string, unknown> = {};
  for (const [key, choices] of grouped) {
    const value = choose(family, key, choices, rules);
    if (value !== undefined) result[key] = value;
  }
  for (const owner of rules.members) delete records[owner];
  records[rules.owner] = result;
  return result;
}
function compoundRecords(state: RuleData) {
  return Object.fromEntries(Object.entries(state.autoCompounds).map(([owner, rules]) =>
    [owner, Object.fromEntries((rules || []).map(rule => [rule.name, rule]))]));
}
function npcRecords(state: RuleData, owner: string) {
  const records: Record<string, Record<string, unknown>> = {};
  for (const rule of Object.values(state.autoNpcSales)) {
    const { character, ...value } = rule;
    (records[character || owner] ||= {})[automaticNpcSaleRuleKey(rule.item)] = value;
  }
  return records;
}
/** One-time migration retains every conflicting choice and the original documents. */
export function migrateSharedRules(state: RuleData, members: string[]): boolean {
  if (state.merchantRules || !state.merchantCharacter) return false;
  const owner = state.merchantCharacter;
  const rules: SharedRules = { version: 1, owner, members: [...new Set([owner, ...members])], conflicts: [],
    backup: JSON.parse(JSON.stringify({ autoItemMarks: state.autoItemMarks, autoUpgradeMarks: state.autoUpgradeMarks,
      autoCompounds: state.autoCompounds, autoDeconstruction: state.autoDeconstruction, autoNpcSales: state.autoNpcSales })) };
  merge('item', state.autoItemMarks, rules);
  merge('upgrade', state.autoUpgradeMarks, rules);
  merge('deconstruction', state.autoDeconstruction, rules);
  const compounds = merge('compound', compoundRecords(state), rules);
  for (const member of rules.members) delete state.autoCompounds[member];
  state.autoCompounds[owner] = Object.values(compounds) as {name:string}[];
  const npc = merge('npc', npcRecords(state, owner), rules);
  for (const [key, rule] of Object.entries(state.autoNpcSales))
    if (!rule.character || rules.members.includes(rule.character)) delete state.autoNpcSales[key];
  Object.assign(state.autoNpcSales, npc);
  rekeyNpcReservations(state,rules);
  state.merchantRules = rules;
  return true;
}

export function resolveRuleConflict(state: RuleData, id: string, owner: string): boolean {
  const conflict = state.merchantRules?.conflicts.find(value => value.id === id), choice = conflict?.choices.find(value => value.owner === owner);
  if (!conflict || !choice) return false;
  const merchant = String(state.merchantCharacter), key = conflict.key;
  const maps = { item: state.autoItemMarks[merchant] ||= {}, upgrade: state.autoUpgradeMarks[merchant] ||= {},
    deconstruction: state.autoDeconstruction[merchant] ||= {}, npc: state.autoNpcSales, stand: state.autoStandMarks, exchange: state.autoExchanges };
  if (conflict.family === 'compound') {
    state.autoCompounds[merchant] = (state.autoCompounds[merchant] || []).filter(rule => rule.name !== key);
    state.autoCompounds[merchant]!.push(choice.value as {name:string});
  } else (maps[conflict.family] as Record<string, unknown>)[key] = choice.value;
  state.merchantRules!.conflicts = state.merchantRules!.conflicts.filter(value => value !== conflict);
  return true;
}

export function installSharedRuleRoutes(router: HttpRouter, state: RuleData, persist: () => void) {
  router.post('/party-api/merchant/rule-conflict', (req,res) => {
    const body = requestObject(req.body);
    if (!resolveRuleConflict(state,String(body.id),String(body.owner))) return res.status(404).json({error:'Rule choice no longer available'});
    persist(); return res.json({ok:true});
  });
}

export interface ConflictState extends SharedScope {
  upgrades?: Record<string, unknown[] | undefined>;
  autoUpgradeMarks?: Record<string, Record<string, unknown> | undefined>;
  autoCompounds?: Record<string, {name:string;targetTier?:number;quantity?:number}[] | undefined>;
  autoNpcSales?: Record<string, unknown>;
  autoStandMarks?: Record<string, unknown>;
  autoDeconstruction?: Record<string, Record<string, unknown> | undefined>;
}
export function itemRuleConflicts(state: ConflictState, item: Item): string[] {
  if (!state.merchantRules) return [];
  const owner = String(state.merchantCharacter), key = automaticCommerceRuleKey(item);
  const actions: string[] = [];
  if (processingPending(state,item)) actions.push('Processing');
  if (state.autoNpcSales?.[automaticNpcSaleRuleKey(item)]) actions.push('NPC sale');
  if (state.autoStandMarks?.[key]) actions.push('Stand sale');
  if (deconstructionRule(state,owner,key)) actions.push('Deconstruction');
  return actions.length > 1 ? actions : [];
}

function activeUpgrade(value: unknown): boolean {
  if (!value) return false;
  return typeof value !== 'object' || Number((value as {quantity?:number}).quantity) !== 0;
}
export function processingPending(state: ConflictState, item: Item): boolean {
  const owner = ruleOwner(state, String(state.merchantCharacter));
  return offeringUpgradePending(state, item) || activeUpgrade(state.autoUpgradeMarks?.[owner]?.[`${item.name}@+${Number(item.level || 0)}`]) ||
    !!state.autoCompounds?.[owner]?.some(rule => rule.name === item.name && Number(rule.quantity) !== 0 && Number(item.level || 0) < Number(rule.targetTier || 1));
}

function deconstructionRule(state: ConflictState, owner: string, key: string) { return state.autoDeconstruction?.[owner]?.[key]; }

function ruleSignature(value: unknown): string {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'createdAt').sort(([a],[b]) => a.localeCompare(b))));
}

function rekeyNpcReservations(state: RuleData, rules: SharedRules) {
  for (const mark of state.npcSaleMarks || [])
    if (mark.auto && (!mark.character || rules.members.includes(mark.character))) mark.autoRuleKey = automaticNpcSaleRuleKey(mark.item);
}

function migrationEntries(family: RuleFamily, entries: Record<string,unknown>): [string,unknown][] {
  const normalized = Object.entries(entries).sort(([a],[b]) => Number(a.includes('@+')) - Number(b.includes('@+'))).map(([key,value]): [string,unknown] => {
    if (family === 'item') return [key.includes('@+') ? key : key+'@+0',value];
    if (family === 'upgrade') return [key,normalizeUpgrade(value)];
    return [key,value];
  });
  return Object.entries(Object.fromEntries(normalized));
}
function normalizeUpgrade(value: unknown) {
  const rule = value && typeof value === 'object' ? value as {tiers?:number;quantity?:number} : {tiers:Number(value)};
  return {tiers:Number(rule.tiers),quantity:rule.quantity ?? -1};
}



function offeringUpgradePending(state: ConflictState, item: Item): boolean {
  return Object.values(state.upgrades || {}).flatMap(marks => marks || []).some(raw => {
    const mark = requestObject(raw), waiting = requestObject(mark.waitingOffering), original = requestObject(mark.item);
    return !!mark.auto && original.name === item.name && (waiting.level === Number(item.level || 0) || unfinishedUpgrade(mark, original, item));
  });
}
function unfinishedUpgrade(mark: Record<string, unknown>, original: Record<string, unknown>, item: Item): boolean {
  const start = Number(original.level) || 0, level = Number(item.level) || 0;
  return !!mark.passId && level >= start && level < start + Number(mark.tiers) &&
    sameMarkedItem({...item, level: start}, {...original, level: start});
}
