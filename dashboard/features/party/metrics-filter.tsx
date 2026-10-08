'use client';
import { useState } from 'react';
import { ListFilter, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { metricsControl, metricsMenu } from './metrics-controls';

export function MetricsFilter({ label, allLabel, selected, options, onChange }: {
  label: string; allLabel: string; selected: string[]; options: { id: string; label: string }[]; onChange(value: string[]): void;
}) {
  const [search, setSearch] = useState('');
  return <Popover><PopoverTrigger className={metricsControl} aria-label={label}><ListFilter size={18} />{selected.length ? selected.length + ' selected' : allLabel}</PopoverTrigger>
    <PopoverContent align="start" positionerClassName="z-[130]" className={metricsMenu}>
      <div className="flex items-center gap-2 rounded-lg border border-[#30433f] bg-[#07100d] px-3"><Search size={18} /><input aria-label={'Search ' + label.toLowerCase()} className="h-11 min-w-0 flex-1 bg-transparent text-base text-slate-100 outline-none" placeholder="Search" value={search} onChange={event => setSearch(event.target.value)} /></div>
      <button className={metricsControl + ' mt-2 w-full'} onClick={() => onChange([])}>{allLabel}</button>
      <div className="mt-2 max-h-64 overflow-y-auto">{options.filter(option => (option.label + ' ' + option.id).toLowerCase().includes(search.trim().toLowerCase())).map(option => <label key={option.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-base hover:bg-[#1a3228]">
        <input type="checkbox" className="accent-emerald-400" checked={selected.includes(option.id)} onChange={() => onChange(selected.includes(option.id) ? selected.filter(id => id !== option.id) : [...selected, option.id])} />{option.label}
      </label>)}</div>
    </PopoverContent>
  </Popover>;
}
