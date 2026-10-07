'use client';
import { useState } from 'react';
import { ChevronDown, ChevronRight, Check, X, ArrowUp, ArrowDown } from 'lucide-react';
import { swapStrategies, itemSwapSlots, swapIdentity, sameSwapItem, isSwapSlot,
  type ItemSwap, type SwapSelection } from '../../../runtime/item-swaps';
import type { Char } from './char';
import type { InventoryEntry } from './inventory-entry';
import { ItemSprite } from './item-sprite';

const control = 'rounded border border-emerald-700 bg-[#102720] px-2 py-1 text-emerald-50 hover:border-emerald-400 hover:bg-[#1b3b30] disabled:opacity-40';
export function InventorySwaps({ character, swaps, onSave }: {
  character: Char; swaps: ItemSwap[]; onSave(swaps: ItemSwap[]): Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ItemSwap['strategy']>('luck-before-kill');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const current = swaps.find(swap => swap.strategy === selected);
  const selections = current?.items || [];
  const selectedInventory = new Map<number, SwapSelection>();
  for (const selection of selections) {
    const preferred = character.items.find(entry => entry?.slot === selection.inventorySlot && sameSwapItem(entry.item, selection.item));
    const entry = preferred && !selectedInventory.has(preferred.slot) ? preferred : character.items.find(entry =>
      entry && !selectedInventory.has(entry.slot) && sameSwapItem(entry.item, selection.item));
    if (entry) selectedInventory.set(entry.slot, selection);
  }
  async function save(next: ItemSwap[]) {
    setSaving(true); setError('');
    try { await onSave(next); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  }
  function setItems(items: SwapSelection[]) {
    const next = { strategy: selected, enabled: !!current?.enabled && items.length > 0, items };
    void save(current ? swaps.map(swap => swap.strategy === selected ? next : swap) : [...swaps, next]);
  }
  function choose(entry: InventoryEntry) {
    const existing = selectedInventory.get(entry.slot);
    if (existing) return setItems(selections.filter(selection => selection !== existing));
    const choices = itemSwapSlots(entry.meta?.definition.type);
    const slot = choices.find(slot => !selections.some(selection => selection.slot === slot)) || choices[0];
    if (slot) setItems([...selections.filter(selection => selection.slot !== slot),
      { slot, inventorySlot: entry.slot, item: swapIdentity(entry.item) }]);
  }
  function move(index: number, direction: number) {
    const next = [...swaps], swap = next[index], other = next[index + direction];
    if (swap && other) { next[index] = other; next[index + direction] = swap; void save(next); }
  }
  const status = character.itemSwap;
  return <section className="border-t border-emerald-900/70 p-5">
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
      className="flex w-full items-center justify-between bg-[#0b1916] text-left text-emerald-100">
      <span className="flex items-center gap-2 font-mono text-xs uppercase text-emerald-100/55">
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}Inventory swaps
      </span>
      <span className="text-xs text-emerald-200">{swaps.filter(swap => swap.enabled).length} enabled</span>
    </button>
    {open && <div className="mt-3 space-y-3">
      {swaps.map((swap, index) => <div key={swap.strategy} className="flex items-center gap-2 rounded border border-emerald-900 bg-[#081713] p-2">
        <button type="button" disabled={saving} onClick={() => setSelected(swap.strategy)}
          aria-pressed={selected === swap.strategy} className={`${control} flex-1 text-left text-xs ${selected === swap.strategy ? 'border-emerald-400' : ''}`}>
          {swapStrategies.find(strategy => strategy.id === swap.strategy)?.label} · {swap.items.length} items
        </button>
        <label className="flex items-center gap-1 text-xs text-emerald-50">
          <input type="checkbox" checked={swap.enabled} disabled={saving || !swap.items.length}
            onChange={event => void save(swaps.map(entry => entry === swap ? { ...entry, enabled: event.target.checked } : entry))} />On
        </label>
        {swaps.length > 1 && <>
          <button type="button" className={control} disabled={saving || index === 0} aria-label="Higher priority" onClick={() => move(index, -1)}><ArrowUp className="h-3 w-3" /></button>
          <button type="button" className={control} disabled={saving || index === swaps.length - 1} aria-label="Lower priority" onClick={() => move(index, 1)}><ArrowDown className="h-3 w-3" /></button>
        </>}
        <button type="button" className={control} disabled={saving} aria-label="Remove swap strategy" onClick={() => void save(swaps.filter(entry => entry !== swap))}><X className="h-3 w-3" /></button>
      </div>)}
      <label className="block text-xs text-emerald-100">Edit strategy
        <select value={selected} disabled={saving} onChange={event => {
          const strategy = swapStrategies.find(entry => entry.id === event.target.value);
          if (strategy) setSelected(strategy.id);
        }} className={`${control} mt-1 w-full`}>
          {swapStrategies.map(strategy => <option key={strategy.id} value={strategy.id}>{strategy.label}</option>)}
        </select>
      </label>
      {status && status.phase !== 'idle' && <output className={`block rounded border p-2 text-xs ${status.error ? 'border-rose-700 bg-rose-950 text-rose-100' : 'border-emerald-700 bg-[#102720] text-emerald-100'}`}>
        {status.phase === 'equipped' ? 'Swap equipped' : status.phase}{status.target ? ` · ${status.target}` : ''}
        {status.threshold !== undefined ? ` · HP threshold ${Math.round(status.threshold).toLocaleString()}` : ''}
        {status.error && ` · ${status.error}`}
      </output>}
      <div className="grid grid-cols-5 gap-2" aria-label={`${character.name} inventory swap selection`}>
        {Array.from({ length: character.inventorySize || character.items.length }, (_, index) => {
          const entry = character.items.find(entry => entry?.slot === index);
          if (!entry) return <div key={index} className="aspect-square rounded border border-emerald-900 bg-[#07100d]" />;
          const chosen = selectedInventory.has(entry.slot);
          const usable = itemSwapSlots(entry.meta?.definition.type).length > 0;
          const others = swaps.filter(swap => swap.strategy !== selected && swap.items.some(selection => sameSwapItem(selection.item, entry.item)));
          return <button type="button" key={index} disabled={saving || !usable} aria-pressed={chosen}
            aria-label={`${chosen ? 'Deselect' : 'Select'} ${entry.item.name} +${entry.item.level || 0}, slot ${index}`}
            title={`${entry.meta?.definition.name || entry.item.name} +${entry.item.level || 0}${others.length ? '\nAlso used by: ' + others.map(swap => swap.strategy).join(', ') : ''}${usable ? '' : '\nCannot equip this item'}`}
            onClick={() => choose(entry)} className={`relative flex aspect-square items-center justify-center rounded border bg-[#07100d] text-emerald-50 hover:bg-[#19352a] disabled:opacity-40 ${chosen ? 'border-emerald-300 ring-1 ring-emerald-300' : 'border-emerald-900'}`}>
            {entry.meta?.sprite ? <ItemSprite sprite={entry.meta.sprite} /> : <span className="break-all px-1 text-[9px]">{entry.item.name}</span>}
            {!!entry.item.level && <span className="absolute bottom-0 right-1 text-[10px] text-white">+{entry.item.level}</span>}
            {chosen && <Check className="absolute left-0 top-0 h-4 w-4 rounded bg-emerald-950 text-emerald-200" />}
            {!!others.length && <span className="absolute right-0 top-0 rounded bg-sky-950 px-1 text-[9px] text-sky-100">{others.length}</span>}
          </button>;
        })}
      </div>
      <div className="space-y-2" aria-label="Selected swap gear">
        {selections.map(selection => {
          const entry = character.items.find(entry => entry && sameSwapItem(entry.item, selection.item));
          const equipped = sameSwapItem(character.slots[selection.slot]?.item, selection.item);
          const choices = itemSwapSlots((entry?.meta || character.slots[selection.slot]?.meta)?.definition.type);
          return <div key={selection.slot} className="flex items-center gap-2 text-xs text-emerald-100">
            <span className="min-w-0 flex-1 truncate" title={selection.item.name}>{selection.item.name} +{selection.item.level || 0}
              {equipped ? ' · equipped' : !entry ? ' · missing' : ''}</span>
            <select aria-label={`Equipment slot for ${selection.item.name}`} value={selection.slot} disabled={saving}
              className={control} onChange={event => {
                const slot = event.target.value;
                if (!isSwapSlot(slot)) return;
                const occupant = selections.find(entry => entry.slot === slot);
                setItems(selections.map(entry => entry === selection ? { ...entry, slot } : entry === occupant ? { ...entry, slot: selection.slot } : entry));
              }}>
              {(choices.length ? choices : [selection.slot]).map(slot => <option key={slot} value={slot}>{slot}</option>)}
            </select>
            <button type="button" className={control} disabled={saving} aria-label={`Remove ${selection.item.name} from swap`} onClick={() => setItems(selections.filter(entry => entry !== selection))}><X className="h-3 w-3" /></button>
          </div>;
        })}
      </div>
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
      {saving && <p role="status" className="text-xs text-emerald-200">Saving…</p>}
    </div>}
  </section>;
}
