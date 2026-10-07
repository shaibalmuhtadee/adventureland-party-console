'use client';
import { useMemo, useState } from 'react';
import { Command } from 'cmdk';
import { Check, ChevronDown, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { MerchantCatalogItem } from './merchant-catalog-item';
import { SpriteCrop } from './sprite-crop';
import { metricsControl, metricsMenu } from './metrics-controls';

function normalize(value: string) { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_-]/g, ' ').trim(); }
export function MetricsItemPicker({ items, value, onChange }: { items: MerchantCatalogItem[]; value: string; onChange(value: string): void }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const selected = items.find(item => item.id === value);
  const results = useMemo(() => {
    const search = normalize(query), tokens = search.split(/\s+/).filter(Boolean);
    return items.filter(item => {
      const text = normalize(`${item.name} ${item.id} ${item.meta?.definition.set || ''} ${item.meta?.definition.type || ''}`);
      return tokens.every(token => text.includes(token));
    }).sort((a, b) => {
      const rank = (item: MerchantCatalogItem) => normalize(item.name) === search || normalize(item.id) === search ? 2 : normalize(item.name).startsWith(search) ? 1 : 0;
      return rank(b) - rank(a) || a.name.localeCompare(b.name);
    }).slice(0, 100);
  }, [items, query]);
  return <Popover open={open} onOpenChange={value => { setOpen(value); if (!value) setQuery(''); }}>
    <PopoverTrigger className={metricsControl + ' w-44 justify-start'} aria-label="Choose drop item" title={selected?.name || 'Choose drop item'}>
      {selected?.sprite ? <span className="relative size-6 shrink-0"><SpriteCrop sprite={selected.sprite} size={24} /></span> : <Search size={14} className="shrink-0 text-slate-400" />}
      <span className="min-w-0 flex-1 truncate text-left">{selected?.name || 'Search items'}</span><ChevronDown size={16} className="shrink-0 text-slate-400" />
    </PopoverTrigger>
    <PopoverContent align="start" sideOffset={8} positionerClassName="z-[130]" className={metricsMenu + ' w-[360px] max-w-[calc(100vw-32px)] p-0'}>
      <Command shouldFilter={false} className="overflow-hidden rounded-xl" label="Drop item search">
        <div className="flex items-center gap-3 border-b border-[#30433f] px-4"><Search size={16} className="shrink-0 text-emerald-400" />
          <Command.Input value={query} onValueChange={setQuery} placeholder="Search name, ID, set or type" aria-label="Search drop items" className="h-14 w-full bg-transparent text-base text-slate-100 outline-none placeholder:text-slate-500" />
        </div>
        <Command.List className="max-h-80 overflow-y-auto p-1.5">
          <Command.Empty className="p-6 text-center text-base text-slate-400">No items found</Command.Empty>
          {results.map(item => <Command.Item key={item.id} value={item.id} onSelect={() => { onChange(item.id); setOpen(false); setQuery(''); }}
            className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2.5 text-slate-200 outline-none data-[selected=true]:bg-[#1d3b30] data-[selected=true]:text-white">
            <span className="relative size-9 shrink-0 rounded-md border border-[#30433f] bg-[#07100d]">{item.sprite && <SpriteCrop sprite={item.sprite} size={28} />}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-base font-medium">{item.name}</span><span className="block truncate text-sm text-slate-400">{item.id}{item.meta?.definition.set ? ` · ${item.meta.definition.set}` : ''}</span></span>
            {item.id === value && <Check size={15} className="text-emerald-400" />}
          </Command.Item>)}
        </Command.List>
      </Command>
    </PopoverContent>
  </Popover>;
}
