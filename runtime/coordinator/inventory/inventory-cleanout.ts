import { strategyEnabled, strategiesFor, type CharacterStrategies } from '../../combat/strategies.ts';
import { sameSwapItem, validSwapItem, type ItemSwaps } from '../../item-swaps.ts';
import type { Item, ItemMark } from '../contracts/item.ts';
import { requestObject } from '../http/contracts.ts';
import { playerSaleReserved, type PlayerSaleState } from '../merchant/player-npc-sales.ts';
import type { NpcSale } from '../merchant/npc-sales.ts';
import type { ObservedCharacterStatus } from '../status/observed-status.ts';
import { markedItem, sameMarkedItem } from './item-identity.ts';
import { itemRuleConflicts, sharedMember } from './shared-rules.ts';

export type CleanoutSale = Pick<NpcSale, 'slot' | 'item' | 'quantity'> & { id?: string };
export interface InventoryCleanoutPlan {
  marked: ItemMark[];
  npcSales: CleanoutSale[];
  returnLocation: unknown;
}
interface State extends PlayerSaleState {
  combatStrategies: CharacterStrategies;
  itemSwaps: ItemSwaps;
  autoConsumables: Record<string, string | undefined>;
  statuses: Record<string, ObservedCharacterStatus | undefined>;
  commands: Record<string, unknown>;
  marked: Record<string, ItemMark[] | undefined>;
}

/** Resolve only sale/bank intent against a fresh, full bag before dispatch. */
export function inventoryCleanoutPlan(state: State, name: string, ports: {
  now(): number;
  blocked(name: string): boolean;
  destination(name: string): unknown;
}): InventoryCleanoutPlan | null {
  const report = state.statuses[name];
  if (!report || !strategiesFor(report.ctype || '').some(strategy => strategy.id === 'inventory-cleanout') ||
      !strategyEnabled(state.combatStrategies[name], 'inventory-cleanout') ||
      ports.now() - Number(report.inventorySeenAt || 0) > 10000 ||
      report.rip || report.deathLoop || report.cave || report.banking || report.stocking || report.upgrading ||
      report.inventoryCleanoutRetry ||
      report.activeEvent || report.joinedEvent || state.commands[name] || ports.blocked(name)) return null;
  const navigation = requestObject(report.farmingNavigationDebug);
  if (navigation.occupied || navigation.departurePending || navigation.town || navigation.anniversary ||
      navigation.event || navigation.forceTravel || report.huntEventPending) return null;
  const items = report.items, size = Number(report.inventorySize);
  if (!Array.isArray(items) || !Number.isSafeInteger(size) || size <= 0 || size > items.length) return null;
  const occupied = new Set(items.filter(entry => entry?.item).map(entry => entry?.slot));
  for (let slot = 0; slot < size; slot++) if (!occupied.has(slot)) return null;

  function protectedItem(item: Item): boolean {
    return !!item.l || !!item.b || item.name === state.autoConsumables[name] ||
      ['tracker', 'supercomputer', 'hpot0', 'mpot0', 'hpot1', 'mpot1'].includes(String(item.name)) ||
      validSwapItem(item) && (state.itemSwaps[name] || []).some(swap =>
        swap.items.some(selection => sameSwapItem(item, selection.item)));
  }
  const marked: ItemMark[] = [], npcSales: CleanoutSale[] = [];
  for (const entry of items) {
    if (!entry || protectedItem(entry.item)) continue;
    const bankMark = (state.marked[name] || []).find(mark =>
      (mark.slot === undefined || mark.slot === entry.slot) && sameMarkedItem(entry.item, markedItem(mark)));
    if (bankMark) { marked.push({ slot: entry.slot, item: { ...entry.item } }); continue; }
    if (playerSaleReserved(state, name, entry.slot, entry.item)) continue;
    const sale = state.npcSaleMarks.find(mark => mark.source === 'character' && mark.character === name &&
      mark.state !== 'blocked' && mark.slot === entry.slot && sameMarkedItem(entry.item, mark.item));
    const automatic = sharedMember(state, name) && !!state.autoNpcSales[String(entry.item.name)] &&
      itemRuleConflicts(state, entry.item).length === 0;
    if (!sale && !automatic) continue;
    npcSales.push({ ...(sale ? { id: sale.id } : {}), slot: entry.slot, item: { ...entry.item },
      quantity: Math.min(sale?.quantity ?? Number(entry.item.q || 1), Number(entry.item.q || 1)) });
  }
  if (!marked.length && !npcSales.length) return null;
  return { marked, npcSales, returnLocation: ports.destination(name) ||
    { map: report.map, x: report.x, y: report.y } };
}
