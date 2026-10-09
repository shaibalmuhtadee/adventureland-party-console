'use client';
import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MetricsBarsResponse } from '../../../runtime/metrics/contracts.ts';
import { read, useVisible } from './query-cache';
import { MetricsChart } from './metrics-chart';
import { MetricsSelect, metricsControl } from './metrics-controls';
import { metricDay, metricDayStart, shiftMetricDay } from './metrics-days';

export function MetricsLoot(props: { active: boolean; clock: number; live: boolean; characters: string[]; server: string; names: Map<string, string>; resetDisabled: boolean }) {
  const client = useQueryClient(), visible = useVisible();
  const [mode, setMode] = useState('today'), [first, setFirst] = useState(() => metricDay(Date.now())), [last, setLast] = useState(() => metricDay(Date.now()));
  const today = metricDay(props.clock), day = mode === 'today' ? today : mode === 'yesterday' ? shiftMetricDay(today, -1) : first;
  const from = metricDayStart(day), end = metricDayStart(shiftMetricDay(mode === 'range' ? last : day, 1));
  const to = Math.min(end, props.clock), valid = Number.isFinite(from) && Number.isFinite(to) && from < to && to - from <= 180 * 86_400_000;
  const query = useQuery({
    queryKey: ['party', 'metrics', 'loot-days', from, to, props.characters, props.server],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ metric: 'loot', from: String(from), to: String(to), dayFrom: String(metricDayStart(today)), dayTo: String(metricDayStart(shiftMetricDay(today, 1))) });
      if (props.characters.length) params.set('characters', props.characters.join(','));
      if (props.server) params.set('servers', props.server);
      return read<MetricsBarsResponse>(client, '/metrics/bars?' + params, signal);
    },
    enabled: props.active && visible && valid && !props.resetDisabled, staleTime: props.live ? 500 : Infinity, gcTime: 10_000, placeholderData: keepPreviousData, retry: false,
  });
  const rows = valid && !query.isError ? (query.data?.rows || []).filter(row => row.amount > 0) : [];
  const label = (at: number) => props.names.get(rows[Math.round(at)]?.id || '') || rows[Math.round(at)]?.id || '';
  return <MetricsChart title="Loot breakdown" data={rows.map((row, at) => ({ at, total: row.amount }))} series={[{ key: 'total', label: 'Acquired', color: '#fbbf24' }]}
    yLabel="Quantity" xFormat={label} type="bar" categoryAxis onReset={() => { setMode('today'); setFirst(today); setLast(today); }} resetDisabled={props.resetDisabled}
    resetTitle="Restore today's loot and date filters" currentValue={{ amount: rows.reduce((total, row) => total + row.amount, 0), unit: 'items in selected days', exact: true }}
    empty={!valid ? 'Choose a valid day or range of up to 180 days' : query.isError ? 'Metrics unavailable' : query.isPending ? 'Loading…' : 'No loot in selected days'}
    controls={<>
      <MetricsSelect label="Loot days" value={mode} onChange={setMode} options={[{ value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' }, { value: 'day', label: 'Pick a day' }, { value: 'range', label: 'Date range' }]} />
      {(mode === 'day' || mode === 'range') && <label className="text-sm">{mode === 'range' ? 'First day' : 'Day'}<input aria-label="Loot first day" type="date" className={metricsControl + ' mt-1 w-full'} value={first} max={today} onChange={event => setFirst(event.target.value)} /></label>}
      {mode === 'range' && <label className="text-sm">Last day<input aria-label="Loot last day" type="date" className={metricsControl + ' mt-1 w-full'} value={last} min={first} max={today} onChange={event => setLast(event.target.value)} /></label>}
    </>} optionDetails={<p className="text-sm text-[#aabfb6]">Calendar days use America/Toronto, including daylight saving time. Date ranges include both selected days. All acquired items are shown.</p>} />;
}
