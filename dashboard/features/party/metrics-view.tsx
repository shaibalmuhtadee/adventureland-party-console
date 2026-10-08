'use client';
import { memo, useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Play, RotateCcw, Users } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { MetricsResponse, MetricResetKind, MetricResets } from '../../../runtime/metrics/contracts.ts';
import { read, useDomain, useVisible } from './query-cache';
import { MetricsChart } from './metrics-chart';
import { MetricsSelect, metricsControl, metricsIconControl, metricsMenu } from './metrics-controls';
import { applyAcknowledgedResets, applyTemporaryResets, pingGraph, selectMetricRows, type TemporaryMetricReset, type GraphPoint, type GraphSeries } from './metrics-series';
import { MetricsDropEstimator } from './metrics-drop-estimator';
import { MetricsKills } from './metrics-kills';
import { MetricsMeasurements } from './metrics-measurements';
import { MetricsGold } from './metrics-gold';
import { useMetricsReset } from './metrics-reset';

const ranges = [{ value: 900_000, label: '15 minutes' }, { value: 3_600_000, label: '1 hour' }, { value: 21_600_000, label: '6 hours' }, { value: 86_400_000, label: '24 hours' }, { value: 604_800_000, label: '7 days' }];
function localDate(at: number) {
  const date = new Date(at - new Date(at).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}
function MetricsView({ active }: { active: boolean }) {
  const client = useQueryClient(), visible = useVisible(), catalog = useDomain('catalog', active), core = useDomain('core', active);
  const resetMutation = useMetricsReset();
  const [estimateVersion, setEstimateVersion] = useState(0);
  const [acknowledgedResets, setAcknowledgedResets] = useState<MetricResets>({});
  const [temporaryResets, setTemporaryResets] = useState<Partial<Record<MetricResetKind, TemporaryMetricReset>>>({});
  const [duration, setDuration] = useState(3_600_000), [live, setLive] = useState(true), [clock, setClock] = useState(Date.now);
  const [customFrom, setCustomFrom] = useState(() => localDate(Date.now() - 3_600_000)), [customTo, setCustomTo] = useState(() => localDate(Date.now()));
  const [characters, setCharacters] = useState<string[]>([]), [server, setServer] = useState('');
  const [killFiltersVersion, setKillFiltersVersion] = useState(0);
  useEffect(() => {
    if (!active || !live || !visible || duration === 0) return;
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, live, visible, duration]);
  const from = duration ? clock - duration : new Date(customFrom).getTime(), to = duration ? clock : new Date(customTo).getTime();
  const valid = Number.isFinite(from) && Number.isFinite(to) && from < to && to - from <= 180 * 86_400_000;
  const query = useQuery({
    queryKey: ['party', 'metrics', from, to],
    queryFn: ({ signal }) => read<MetricsResponse>(client, '/metrics?from=' + from + '&to=' + to, signal),
    enabled: active && visible && valid && !resetMutation.isPending, staleTime: live ? 500 : Infinity, gcTime: 10_000,
    placeholderData: keepPreviousData, retry: false,
  });
  const rawData = query.data;
  const data = useMemo(() => rawData ? applyTemporaryResets(applyAcknowledgedResets(rawData, acknowledgedResets), temporaryResets) : undefined, [rawData, acknowledgedResets, temporaryResets]);
  const pingCharacters = useMemo(() => [...new Set((core.data?.activeSlots || [])
    .filter(slot => slot.state === 'online' && slot.character)
    .flatMap(slot => slot.character ? [slot.character] : []))]
    .filter(name => !characters.length || characters.includes(name)), [core.data?.activeSlots, characters]);
  const graphs = useMemo(() => data ? pingGraph(data, { characters: pingCharacters, server }) : null, [data, pingCharacters, server]);
  const rows = useMemo(() => data ? selectMetricRows(data.points.flatMap(point => point.values), characters, server) : [], [data, characters, server]);
  const itemNames = new Map(catalog.data?.merchantCatalog?.allItems?.map(item => [item.id, item.name]));
  const monsterNames = new Map(catalog.data?.bestiaryCatalog?.map(monster => [monster.id, monster.name]));
  const skillNames = new Map(catalog.data?.skillCatalog?.flatMap(group => group.skills.map(skill => [skill.id, skill.name] as const)));
  const select = (label: string, value: string, change: (value: string) => void, options: { value: string; label: string }[], width?: string) =>
    <MetricsSelect label={label} value={value} onChange={change} options={options} className={width} />;
  const breakdown = (kind: 'loot' | 'damage'): { data: GraphPoint[]; series: GraphSeries[]; labels: string[] } => {
    const totals = new Map<string, number>();
    for (const row of rows) {
      if (kind === 'loot') for (const item of row.loot) totals.set(item.item, (totals.get(item.item) || 0) + item.quantity);
      else for (const hit of row.damage) totals.set(row.character, (totals.get(row.character) || 0) + hit.amount);
    }
    const entries = [...totals].sort((a, b) => b[1] - a[1]).slice(0, 12);
    return { data: entries.map(([, value], at) => ({ at, total: value })), labels: entries.map(([id]) => kind === 'loot' ? itemNames.get(id) || id : id),
      series: [{ key: 'total', label: kind === 'loot' ? 'Quantity' : 'Damage', color: kind === 'loot' ? '#fbbf24' : '#a78bfa' }] };
  };
  const lootBars = breakdown('loot'), damageBars = breakdown('damage');
  function clearView(kinds: MetricResetKind[]) {
    if (!rawData) return;
    const latest = rawData.points[rawData.points.length - 1];
    const baseline: TemporaryMetricReset = { at: Date.now(), bucketAt: latest?.at ?? 0, resolutionMs: rawData.resolutionMs, values: structuredClone(latest?.values || []) };
    setTemporaryResets(previous => ({ ...previous, ...Object.fromEntries(kinds.map(kind => [kind, baseline])) }));
  }
  function resetMetric(kind: MetricResetKind | 'all') {
    if (kind !== 'all' && kind !== 'kills' && kind !== 'damage') { clearView([kind]); return; }
    resetMutation.mutate(kind === 'all' ? 'performance' : kind, { onSuccess: cuts => {
      setAcknowledgedResets(cuts);
      if (kind === 'all') { clearView(['gold', 'loot', 'ping']); setEstimateVersion(value => value + 1); }
    } });
  }
  const resetControls = (kind: MetricResetKind) => ({
    onReset: () => resetMetric(kind), resetDisabled: resetMutation.isPending,
    resetting: resetMutation.isPending && (resetMutation.variables === kind || resetMutation.variables === 'performance'),
    resetTitle: kind === 'kills' || kind === 'damage' ? 'Permanently delete all stored ' + kind + ' data' : 'Clear graph; keep stored history',
  });
  function reset() {
    setCharacters([]); setServer(''); setKillFiltersVersion(value => value + 1);
    setTemporaryResets({});
    setDuration(3_600_000); setLive(true); setClock(Date.now());
  }
  return <section className="mx-auto max-w-[1760px] px-4 py-7 md:px-6 md:py-8" aria-label="Game metrics">
    <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
      <h2 className="flex items-center gap-3 text-[30px] font-semibold tracking-[-0.03em] text-[#e8f3ed]">
        Metrics<span className={'size-2 rounded-full ' + (query.isError ? 'bg-rose-400' : data?.incomplete ? 'bg-amber-400' : live && duration ? 'bg-emerald-400' : 'bg-slate-500')}
          title={query.isError ? 'Unavailable' : data?.incomplete ? 'Partial coverage' : live && duration ? 'Live' : 'Paused'} />
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        {select('Time range', String(duration), value => { setDuration(Number(value)); setClock(Date.now()); }, [...ranges.map(range => ({ value: String(range.value), label: range.label })), { value: '0', label: 'Custom' }])}
        {duration === 0 && <><input aria-label="Range start" type="datetime-local" className={metricsControl} value={customFrom} onChange={event => setCustomFrom(event.target.value)} /><input aria-label="Range end" type="datetime-local" className={metricsControl} value={customTo} onChange={event => setCustomTo(event.target.value)} /></>}
        <Popover><PopoverTrigger className={metricsControl} aria-label="Filter characters"><Users size={14} />{characters.length ? characters.length + ' selected' : 'All characters'}</PopoverTrigger>
          <PopoverContent align="end" positionerClassName="z-[130]" className={metricsMenu + ' w-60'}>
            <button className={metricsControl + ' mb-2 w-full'} onClick={() => setCharacters([])}>All characters</button>
            <div className="max-h-64 overflow-auto">{data?.characters.map(name => <label key={name} className="flex cursor-pointer gap-3 rounded-lg px-2 py-2 text-base hover:bg-[#1a3228]">
              <input className="accent-emerald-400" type="checkbox" checked={characters.includes(name)} onChange={() => setCharacters(characters.includes(name) ? characters.filter(value => value !== name) : [...characters, name])} />{name}
            </label>)}</div>
          </PopoverContent>
        </Popover>
        {select('Server', server, setServer, [{ value: '', label: 'All servers' }, ...(data?.servers || []).map(server => ({ value: server, label: server }))])}
        <div className="mx-1 h-5 w-px bg-[#30433f]" />
        <button className={metricsControl} aria-pressed={live && duration !== 0} disabled={duration === 0} onClick={() => setLive(!live)}>{live ? <Pause size={18} /> : <Play size={18} />}{live ? 'Live' : 'Paused'}</button>
        <button className={metricsIconControl} onClick={reset} aria-label="Reset metrics filters and restore temporarily hidden history" title="Reset filters / restore history"><RotateCcw size={18} /></button>
        <button className={metricsControl} disabled={resetMutation.isPending} onClick={() => resetMetric('all')} title="Delete kills and damage history; clear other graphs from view">Reset data</button>
      </div>
    </div>
    {!valid && <p role="status" className="mb-4 text-base text-amber-300">Invalid date range</p>}
    {query.isError && !resetMutation.isPending && <p role="status" className="mb-4 text-base text-rose-300">Metrics unavailable</p>}
    {resetMutation.isError && <p role="status" className="mb-4 text-base text-rose-300">Could not reset metrics</p>}
    {query.isPending && !data && <p role="status" className="py-20 text-center text-base text-[#789087]">Loading…</p>}
    {data && graphs && <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <MetricsKills key={killFiltersVersion} active={active} live={live && duration !== 0} from={from} to={to} clock={clock}
        characters={characters} server={server} catalog={catalog.data?.bestiaryCatalog} resetAt={Math.max(acknowledgedResets.kills || 0, data.resets?.kills || 0)}
        {...resetControls('kills')} />
      <MetricsMeasurements key={'damage:' + killFiltersVersion} metric="damage" active={active} live={live && duration !== 0} from={from} to={to} clock={clock}
        characters={characters} server={server} names={itemNames} monsterNames={monsterNames} skillNames={skillNames}
        resetAt={Math.max(acknowledgedResets.damage || 0, data.resets?.damage || 0)} {...resetControls('damage')} />
      <MetricsGold key={'gold:' + killFiltersVersion} data={data} characters={characters} server={server} {...resetControls('gold')} />
      <MetricsMeasurements key={'loot:' + killFiltersVersion} metric="loot" active={active} live={live && duration !== 0} from={from} to={to} clock={clock}
        characters={characters} server={server} names={itemNames} monsterNames={monsterNames} skillNames={skillNames}
        resetAt={rawData?.resets?.loot || 0} temporaryReset={temporaryResets.loot} {...resetControls('loot')} />
      <MetricsDropEstimator key={estimateVersion} data={data} catalog={catalog.data?.merchantCatalog} characters={characters} server={server} live={live && duration !== 0} />
      <MetricsChart {...resetControls('loot')} title="Loot breakdown" data={lootBars.data} series={lootBars.series} yLabel="Quantity" xFormat={value => lootBars.labels[Math.round(value)] || ''} type="bar" categoryAxis />
      <MetricsChart {...resetControls('damage')} title="Damage breakdown" data={damageBars.data} series={damageBars.series} yLabel="Damage" xFormat={value => damageBars.labels[Math.round(value)] || ''} type="bar" categoryAxis />
      <MetricsChart {...resetControls('ping')} title="Ping history" data={graphs.ping} series={graphs.series} yLabel="Ping (ms)" empty={pingCharacters.length ? 'No recorded ping' : 'No logged-in characters'} />
    </div>}
  </section>;
}
export default memo(MetricsView);
