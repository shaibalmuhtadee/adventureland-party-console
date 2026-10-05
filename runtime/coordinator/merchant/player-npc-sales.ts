import { itemRuleConflicts, sharedMember, type ConflictState } from "../inventory/shared-rules.ts";
import type { Item, ItemMark } from "../contracts/item.ts";
import { automaticNpcSaleRuleKey, sameMarkedItem } from "../inventory/item-identity.ts";
import type { NpcSale } from "./npc-sales.ts";

export interface NpcSaleRule {
  item: Item;
  createdAt: number;
  character?: string;
}
export const npcSaleRuleKey = automaticNpcSaleRuleKey;
export interface PlayerSaleState extends ConflictState {
  merchantAutomations?: Record<string, boolean | undefined>;
  merchantCharacter: string | null;
  npcSaleMarks: NpcSale[];
  merchantMarked?: Record<string, ItemMark[] | undefined>;
  autoNpcSales: Record<string, NpcSaleRule>;
  marked?: Record<string, ItemMark[] | undefined>;
  upgrades?: Record<string, { slot?: string | number; npcSaleId?: unknown }[] | undefined>;
  statScrolls?: Record<string, { slot?: string | number; npcSaleId?: unknown }[] | undefined>;
  compounds?: Record<string, { items: { slot?: number }[] }[] | undefined>;
  deconstructionMarks?: { owner: string; slot: number; state: string; item: Item }[];
}
export function playerSaleReserved(state: PlayerSaleState, name: string, slot: number, item: Item) {
  return (
    [state.marked?.[name], state.upgrades?.[name], state.statScrolls?.[name], state.merchantMarked?.[name]].some((marks) =>
      marks?.some((mark) => mark.slot === slot && !mark.npcSaleId),
    ) ||
    compoundReserved(state, name, slot) || !!state.deconstructionMarks?.some(
      (mark) => mark.owner === name && mark.slot === slot && mark.state !== "complete" && sameMarkedItem(mark.item, item),
    )
  );
}
function compoundReserved(state: PlayerSaleState, name: string, slot: number) {
  return !!state.compounds?.[name]?.some(group => group.items.some(entry => entry.slot === slot));
}
export function reservePlayerSale(state: Pick<PlayerSaleState, "merchantMarked">, mark: NpcSale) {
  const byCharacter = (state.merchantMarked ||= {});
  const marks = (byCharacter[mark.character!] ||= []);
  const existing = marks.find((entry) => entry.npcSaleId === mark.id);
  const reservation = {
    slot: mark.slot,
    item: mark.item,
    quantity: mark.quantity,
    npcSaleId: mark.id,
  };
  if (existing) Object.assign(existing, reservation);
  else marks.push(reservation);
}
export function releasePlayerSale(state: Pick<PlayerSaleState, "merchantMarked">, mark: NpcSale) {
  if (state.merchantMarked && mark.character)
    state.merchantMarked[mark.character] = (state.merchantMarked[mark.character] || []).filter(
      (entry) => entry.npcSaleId !== mark.id,
    );
}
export function receivePlayerSales(
  state: Pick<PlayerSaleState, "npcSaleMarks" | "merchantMarked">,
  character: string,
  kept: unknown,
  now: number,
) {
  if (!Array.isArray(kept)) return;
  for (const receipt of kept) {
    const mark = state.npcSaleMarks.find(
      (mark) =>
        mark.id === receipt?.npcSaleId &&
        mark.source === "character" &&
        mark.character === character,
    );
    if (!mark || !Number.isSafeInteger(receipt.quantity) || receipt.quantity < 1) continue;
    releasePlayerSale(state, mark);
    mark.source = "merchant";
    mark.quantity = Math.min(mark.quantity, receipt.quantity);
    mark.slot = -1;
    mark.state = "queued";
    mark.receivedAt = now;
  }
}
type PlayerStatus = { name: string; items: readonly ({ slot: number; item: Item } | null)[] };
type PlayerPorts = {
  now(): number;
  nextCommand(): number;
  queue(names: (string | null)[], reason: string): void;
};
function existingIntent(
  state: PlayerSaleState,
  status: PlayerStatus,
  entry: NonNullable<PlayerStatus["items"][number]>,
  now: number,
) {
  return state.npcSaleMarks.some((mark) => {
    if (mark.character !== status.name || !sameMarkedItem(entry.item, mark.item)) return false;
    if (mark.receivedAt && mark.receivedAt > now - 10000) return true;
    if (mark.source !== "character") return false;
    return (
      mark.slot === entry.slot ||
      !status.items.some((live) => live?.slot === mark.slot && sameMarkedItem(live.item, mark.item))
    );
  });
}
function automatic(state: PlayerSaleState, status: PlayerStatus, ports: PlayerPorts) {
  const name = status.name;
  if (!sharedMember(state,name)) return;
  for (const entry of status.items) {
    if (!entry?.item || protectedEntry(state,name,entry))
      continue;
    const key = npcSaleRuleKey(entry.item);
    if (!automaticRule(state,key,entry.item)) continue;
    if (!existingIntent(state, status, entry, ports.now()))
      state.npcSaleMarks.push({
        id: "auto-npc-sale-" + ports.nextCommand(),
        source: "character",
        character: name,
        slot: entry.slot,
        item: { ...entry.item },
        quantity: Math.max(1, Number(entry.item.q) || 1),
        auto: true,
        autoRuleKey: key,
        state: "collecting",
        queuedAt: ports.now(),
      });
  }
}
function reconcileMark(
  state: PlayerSaleState,
  status: PlayerStatus,
  mark: NpcSale,
  used: Set<number>,
) {
  const matches = (entry: (typeof status.items)[number]) =>
    !!entry && !used.has(entry.slot) && sameMarkedItem(entry.item, mark.item);
  const entry =
    status.items.find((entry) => entry?.slot === mark.slot && matches(entry)) ||
    status.items.find(matches);
  if (
    !entry ||
    (mark.auto && itemRuleConflicts(state, mark.item).length > 0) ||
    entry.item.l ||
    entry.item.b ||
    playerSaleReserved(state, status.name, entry.slot, entry.item)
  ) {
    mark.state = "blocked";
    mark.error = "Item is missing, protected, or reserved for other work";
    releasePlayerSale(state, mark);
    return false;
  }
  used.add(entry.slot);
  mark.slot = entry.slot;
  mark.state = "collecting";
  mark.error = null;
  reservePlayerSale(state, mark);
  return true;
}
function autoSalesEnabled(state: PlayerSaleState) { return state.merchantAutomations?.['auto npc sales'] !== false; }
export function reconcilePlayerSales(
  state: PlayerSaleState,
  status: PlayerStatus,
  ports: PlayerPorts,
) {
  const name = status.name,
    before = JSON.stringify([state.npcSaleMarks, state.merchantMarked?.[name]]);
  if (!state.merchantCharacter) return false;
  if (autoSalesEnabled(state)) automatic(state, status, ports);
  const used = new Set<number>();
  const collect = new Set<string>();
  for (const mark of state.npcSaleMarks.filter(
    (mark) => mark.source === "character" && mark.character === name && (!mark.auto || autoSalesEnabled(state)),
  )) {
    if (reconcileMark(state, status, mark, used)) collect.add(mark.auto ? "marked items" : "npc sale pickup");
  }
  for (const reason of collect) ports.queue([name], reason);
  return before !== JSON.stringify([state.npcSaleMarks, state.merchantMarked?.[name]]);
}

function automaticRule(state: PlayerSaleState, key: string, item: Item) { return !!state.autoNpcSales[key] && !itemRuleConflicts(state,item).length; }

function protectedEntry(state: PlayerSaleState, name: string, entry: {slot:number;item:Item}) {
  return !!entry.item.l || !!entry.item.b || playerSaleReserved(state,name,entry.slot,entry.item);
}

