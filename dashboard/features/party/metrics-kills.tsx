'use client';
import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListFilter, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { MetricsKillsResponse } from '../../../runtime/metrics/contracts.ts';
import type { BestiaryMonster } from './bestiary-monster';
import { read, useVisible } from './query-cache';
import { MetricsChart } from './metrics-chart';
import { MetricsSelect, metricsControl, metricsMenu } from './metrics-controls';

const rateUnits = [{ value: 900_000, label: '/ 15 min', suffix: '/15m' }, { value: 1_800_000, label: '/ 30 min', suffix: '/30m' },
  { value: 3_600_000, label: '/ hour', suffix: '/h' }, { value: 86_400_000, label: '/ day', suffix: '/day' }];
interface Props {
  active: boolean; live: boolean; from: number; to: number; clock: number;
  characters: string[]; server: string; catalog?: BestiaryMonster[]; resetAt: number;
  onReset(): void; resetting: boolean; resetDisabled: boolean; resetTitle: string;
}
/** Rate labels normalize the selected observation range, not the latest short
 * bucket. Rare monsters retain useful averages between spawns.
 */
export function MetricsKills(props: Props) {
  const client = useQueryClient(), visible = useVisible();
  const [selected, setSelected] = useState<string[]>([]), [search, setSearch] = useState(''), [rateMs, setRateMs] = useState(3_600_000);
  const dayStart = new Date(props.clock); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
  const dayFrom = dayStart.getTime(), dayTo = dayEnd.getTime();
  const valid = Number.isFinite(props.from) && Number.isFinite(props.to) && props.from < props.to && props.to - props.from <= 180 * 86_400_000;
  const query = useQuery({
    queryKey: ['party', 'metrics', 'kills', props.from, props.to, dayFrom, dayTo, props.characters, props.server],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ from: String(props.from), to: String(props.to), dayFrom: String(dayFrom), dayTo: String(dayTo) });
      if (props.characters.length) params.set('characters', props.characters.join(','));
      if (props.server) params.set('servers', props.server);
      return read<MetricsKillsResponse>(client, '/metrics/kills?' + params, signal);
    },
    enabled: props.active && visible && valid && !props.resetDisabled, staleTime: props.live ? 500 : Infinity, gcTime: 10_000,
    placeholderData: keepPreviousData, retry: false,
  });
  const data = query.data, staleReset = !!data && data.resetAt < props.resetAt;
  const totals = staleReset ? [] : data?.monsters || [];
  const options = useMemo(() => {
    const names = new Map((props.catalog || []).map(monster => [monster.id, monster.name]));
    for (const row of data?.monsters || []) if (!names.has(row.monster)) names.set(row.monster, row.monster);
    return [...names].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [props.catalog, data]);
  const names = new Map(options.map(option => [option.id, option.name]));
  const byMonster = new Map(totals.map(row => [row.monster, row]));
  const monsters = (selected.length ? selected.map(monster => byMonster.get(monster) || { monster, count: 0, total: 0, today: 0 }) : totals)
    .slice().sort((a, b) => b.count - a.count || (names.get(a.monster) || a.monster).localeCompare(names.get(b.monster) || b.monster));
  const unit = rateUnits.find(unit => unit.value === rateMs) || rateUnits[2];
  const daily = monsters.reduce((count, row) => count + row.today, 0);
  const labels = monsters.map(row => {
    const rate = data && data.elapsedMs > 0 ? row.count * rateMs / data.elapsedMs : null;
    return { label: names.get(row.monster) || row.monster, total: row.total,
      rate: (rate === null ? '—' : new Intl.NumberFormat(undefined, { maximumSignificantDigits: 3, notation: rate >= 10000 ? 'compact' : 'standard' }).format(rate)) + unit.suffix };
  });
  return <MetricsChart title="Kills" data={monsters.map((row, at) => ({ at, kills: row.count }))} series={[{ key: 'kills', label: 'Kills in selected range', color: '#22d3ee' }]}
    yLabel="Kills" xFormat={value => labels[Math.round(value)]?.label || ''} type="bar" barCategories={labels} logarithmic
    currentValue={{ amount: data && !query.isError ? daily : null, unit: 'today', label: 'Total kills today', exact: true }}
    onReset={props.onReset} resetDisabled={props.resetDisabled} resetting={props.resetting} resetTitle={props.resetTitle}
    empty={query.isError ? 'Kills unavailable' : query.isPending ? 'Loading…' : 'No recorded kills'}
    controls={<>
      <Popover><PopoverTrigger className={metricsControl} aria-label="Filter monsters"><ListFilter size={18} />{selected.length ? selected.length + ' monsters' : 'All monsters'}</PopoverTrigger>
        <PopoverContent align="start" positionerClassName="z-[130]" className={metricsMenu}>
          <div className="flex items-center gap-2 rounded-lg border border-[#30433f] bg-[#07100d] px-3"><Search size={18} /><input aria-label="Search monsters" className="h-11 min-w-0 flex-1 bg-transparent text-base text-slate-100 outline-none" placeholder="Search monsters" value={search} onChange={event => setSearch(event.target.value)} /></div>
          <button className={metricsControl + ' mt-2 w-full'} onClick={() => setSelected([])}>All monsters</button>
          <div className="mt-2 max-h-64 overflow-y-auto">{options.filter(option => (option.name + ' ' + option.id).toLowerCase().includes(search.trim().toLowerCase())).map(option => <label key={option.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-base hover:bg-[#1a3228]">
            <input type="checkbox" className="accent-emerald-400" checked={selected.includes(option.id)} onChange={() => setSelected(selected.includes(option.id) ? selected.filter(id => id !== option.id) : [...selected, option.id])} />{option.name}
          </label>)}</div>
        </PopoverContent>
      </Popover>
      <MetricsSelect label="Kill rate unit" value={String(rateMs)} onChange={value => setRateMs(Number(value))} options={rateUnits.map(unit => ({ value: String(unit.value), label: unit.label }))} className="w-32" />
    </>} />;
}
