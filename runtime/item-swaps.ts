import type { ItemInfo, SlotType } from 'typed-adventureland';

// Saved inventory observations can contain newer item IDs and modifiers than
// typed-adventureland 0.0.57. Live rabbitsfoot observations also use p: null for
// an absent modifier; nullable optional identity fields normalize to absence.
// Only identity fields belong in a swap selection.
export type SwapItem = Omit<Pick<ItemInfo, 'name' | 'level' | 'p' | 'stat_type' | 'rid'>,
  'name' | 'p' | 'stat_type' | 'rid'> & {
    name: string; p?: string | null; stat_type?: string | null; rid?: string | null; data?: unknown;
  };
export const swapSlots = ['helmet', 'chest', 'pants', 'gloves', 'shoes', 'cape', 'belt', 'amulet',
  'orb', 'ring1', 'ring2', 'earring1', 'earring2', 'mainhand', 'offhand'] as const satisfies readonly SlotType[];
export type SwapSlot = typeof swapSlots[number];
export const swapStrategies = [{ id: 'luck-before-kill', label: 'Luck before kill' }] as const;
export type SwapStrategy = typeof swapStrategies[number]['id'];
export interface SwapSelection { slot: SwapSlot; inventorySlot: number; item: SwapItem }
export interface ItemSwap { strategy: SwapStrategy; enabled: boolean; items: SwapSelection[] }
export type ItemSwaps = Record<string, ItemSwap[]>;

export function swapIdentity(item: SwapItem): SwapItem {
  return { name: item.name, level: item.level || 0, p: item.p ?? undefined, stat_type: item.stat_type ?? undefined,
    data: item.data, rid: item.rid ?? undefined };
}
export function sameSwapItem(a: SwapItem | null | undefined, b: SwapItem | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  const x = swapIdentity(a), y = swapIdentity(b);
  return x.name === y.name && x.level === y.level && x.p === y.p && x.stat_type === y.stat_type &&
    x.rid === y.rid && JSON.stringify(x.data) === JSON.stringify(y.data);
}
export function isSwapSlot(value: unknown): value is SwapSlot {
  return swapSlots.some(slot => slot === value);
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function validSwapItem(value: unknown): value is SwapItem {
  return object(value) && typeof value.name === 'string' && value.name.length > 0 &&
    (value.level === undefined || typeof value.level === 'number' && Number.isSafeInteger(value.level) && value.level >= 0) &&
    ['p', 'stat_type', 'rid'].every(key => value[key] == null || typeof value[key] === 'string');
}
function validSelection(value: unknown): value is SwapSelection {
  return object(value) && isSwapSlot(value.slot) && typeof value.inventorySlot === 'number' &&
    Number.isSafeInteger(value.inventorySlot) && value.inventorySlot >= 0 && validSwapItem(value.item);
}
export function validItemSwaps(value: unknown): value is ItemSwap[] {
  return Array.isArray(value) && value.length <= swapStrategies.length && value.every(entry =>
    object(entry) && swapStrategies.some(strategy => strategy.id === entry.strategy) &&
    typeof entry.enabled === 'boolean' && Array.isArray(entry.items) && entry.items.every(validSelection) &&
    new Set(entry.items.map(item => item.slot)).size === entry.items.length &&
    new Set(entry.items.map(item => item.inventorySlot)).size === entry.items.length) &&
    new Set(value.map(entry => entry.strategy)).size === value.length;
}
export function validItemSwapMap(value: unknown): value is ItemSwaps {
  return object(value) && Object.values(value).every(validItemSwaps);
}
/** Hand choice stays explicit; rings and earrings default to the first free slot. */
export function itemSwapSlots(type: unknown): SwapSlot[] {
  if (type === 'ring') return ['ring1', 'ring2'];
  if (type === 'earring') return ['earring1', 'earring2'];
  if (type === 'weapon') return ['mainhand', 'offhand'];
  if (['shield', 'source', 'quiver', 'offhand'].includes(String(type))) return ['offhand'];
  return isSwapSlot(type) ? [type] : [];
}
